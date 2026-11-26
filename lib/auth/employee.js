// Employee panel sign-in: the employee's registered email + one-time code.
import { getCrmDb } from '../crm/firestore';
import { CrmError } from '../crm/errors';
import { createAuth } from './core';
import { getEmployeeDb, getEmployeeAuth } from '../server/employeeProject';

export const EMPLOYEE_SESSION_COOKIE = 'employeeSession';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new CrmError(500, 'SESSION_SECRET is not configured (needs at least 32 characters)', 'not_configured');
  return s;
}

const DISABLED = new Set(['inactive', 'disabled', 'suspended', 'terminated', 'deleted', 'left']);
const ID_RE = /^[^/\s]{1,128}$/;

function toPrincipal(companyId, employeeId, d) {
  if (!d || DISABLED.has(String(d.status || '').toLowerCase()) || d.active === false) return null;
  const name = `${(d.firstName || '').trim()} ${(d.lastName || '').trim()}`.trim() || d.name || employeeId;
  return {
    companyId,
    employeeId,
    email: typeof d.email === 'string' ? d.email.trim().toLowerCase() : '',
    name,
    role: d.role || '',
    accountLabel: `${name} — ${companyId}`,
  };
}

async function loadEmployeeDoc(companyId, employeeId) {
  // The admin database holds the master employee list; the employee project
  // copy is used as a fallback for employees that were never synced.
  const master = await getCrmDb().collection('users').doc(companyId).collection('employees').doc(employeeId).get();
  if (master.exists) return master.data() || {};
  try {
    const local = await getEmployeeDb().collection('users').doc(companyId).collection('employees').doc(employeeId).get();
    return local.exists ? local.data() || {} : null;
  } catch (err) {
    if (err instanceof CrmError) return null;
    throw err;
  }
}

export async function resolveEmployee({ companyId, employeeId }) {
  if (!ID_RE.test(String(companyId || '')) || !ID_RE.test(String(employeeId || ''))) return null;
  return toPrincipal(companyId, employeeId, await loadEmployeeDoc(companyId, employeeId));
}

// All employee records (in any company) using this email. Needs the
// collection-group index on employees.email / employees.emailLower
// (firebase/firestore.indexes.json in the admin panel repository).
async function searchEmployees(db, email) {
  const group = db.collectionGroup('employees');
  const [a, b] = await Promise.all([
    group.where('email', '==', email).limit(20).get(),
    group.where('emailLower', '==', email).limit(20).get(),
  ]);
  return [...a.docs, ...b.docs];
}

export async function findEmployeesByEmail(email) {
  // Admin database first (master list), then the employee project for
  // employees that HR added directly in the employee panel.
  let docs = await searchEmployees(getCrmDb(), email);
  try {
    docs = docs.concat(await searchEmployees(getEmployeeDb(), email));
  } catch (err) {
    if (!(err instanceof CrmError)) throw err;
  }
  const found = new Map();
  for (const doc of docs) {
    const company = doc.ref.parent.parent;
    // Only users/{companyId}/employees/{employeeId}
    if (!company || company.parent.id !== 'users' || company.parent.parent) continue;
    const p = toPrincipal(company.id, doc.id, doc.data());
    if (p && !found.has(`${company.id}/${doc.id}`)) found.set(`${company.id}/${doc.id}`, p);
  }
  return [...found.values()];
}

export const employeeAuth = createAuth({
  kind: 'employee',
  appName: 'CyberClipper Employee',
  cookieName: EMPLOYEE_SESSION_COOKIE,
  sessionTtlSeconds: 12 * 60 * 60,
  secret,
  findByEmail: findEmployeesByEmail,
  resolvePrincipal: resolveEmployee,
  // companyId/employeeId names are kept so older server code can read them.
  sessionClaims: (p) => ({ companyId: p.companyId, employeeId: p.employeeId }),
  idsFromSession: (payload) => (typeof payload.companyId === 'string' && typeof payload.employeeId === 'string'
    ? { companyId: payload.companyId, employeeId: payload.employeeId }
    : null),
  firebase: {
    auth: () => getEmployeeAuth(),
    uid: (p) => `emp:${p.companyId}:${p.employeeId}`.slice(0, 128),
    claims: (p) => ({ cid: p.companyId, eid: p.employeeId, role: 'employee', erole: String(p.role || '').toLowerCase().slice(0, 40) }),
  },
});

// For API routes: { companyId, employeeId, role, principal } or throws 401.
export async function requireEmployeeSession(req) {
  const { principal } = await employeeAuth.requireSession(req);
  return {
    companyId: principal.companyId,
    employeeId: principal.employeeId,
    role: String(principal.role || '').toLowerCase(),
    principal,
  };
}

export const PRIVILEGED_ROLES = new Set(['hr', 'manager', 'team lead']);
