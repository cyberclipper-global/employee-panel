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
    console.warn('[auth] employee project read skipped:', err?.code || '', String(err?.message || err).slice(0, 200));
    return null;
  }
}

export async function resolveEmployee({ companyId, employeeId }) {
  if (!ID_RE.test(String(companyId || '')) || !ID_RE.test(String(employeeId || ''))) return null;
  const [d, companyName] = await Promise.all([loadEmployeeDoc(companyId, employeeId), loadCompanyName(companyId)]);
  const p = toPrincipal(companyId, employeeId, d);
  if (p) p.companyName = companyName || (typeof d.company === 'string' ? d.company : '') || '';
  return p;
}

// Company display name from the admin database (users/{companyId}).
async function loadCompanyName(companyId) {
  try {
    const snap = await getCrmDb().collection('users').doc(companyId).get();
    const c = snap.exists ? snap.data() || {} : {};
    return String(c.company || c.companyName || c.name || '').trim();
  } catch {
    return '';
  }
}

// All employee records (in any company) using this email. Needs the
// collection-group index on employees.email / employees.emailLower
// (firebase/firestore.indexes.json in the admin panel repository).
const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(err.message)));

async function searchEmployees(db, email) {
  const fields = ['email', 'emailLower'];
  try {
    const group = db.collectionGroup('employees');
    const snaps = await Promise.all(fields.map((f) => group.where(f, '==', email).limit(20).get()));
    return snaps.flatMap((s) => s.docs);
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    // The collection-group email index is not built yet (it is listed in
    // firebase/firestore.indexes.json). Search company by company instead;
    // these queries use Firestore's automatic single-field indexes.
    console.warn('[auth] employees email index missing; using per-company lookup');
    const companies = await db.collection('users').listDocuments();
    const snaps = await Promise.all(companies.flatMap((c) => fields.map((f) => c.collection('employees').where(f, '==', email).limit(5).get())));
    return snaps.flatMap((s) => s.docs);
  }
}

// Makes sure the employee's profile exists in the employee Firebase project
// (the panel's pages read it from there). Copies it from the admin
// database's master record when missing, e.g. right after moving to a new
// Firebase project. Best effort: never blocks sign-in.
const provisioned = new Set();
const SENSITIVE = /pass|secret|token|otp|2fa|twofactor|totp|hash|vault/i;
export async function ensureEmployeeProfile(companyId, employeeId) {
  const key = `${companyId}/${employeeId}`;
  if (provisioned.has(key)) return;
  try {
    const ref = getEmployeeDb().collection('users').doc(companyId).collection('employees').doc(employeeId);
    if ((await ref.get()).exists) { provisioned.add(key); return; }
    const master = await getCrmDb().collection('users').doc(companyId).collection('employees').doc(employeeId).get();
    if (!master.exists) return;
    const data = Object.fromEntries(Object.entries(master.data() || {}).filter(([k]) => !SENSITIVE.test(k)));
    if (typeof data.email === 'string') data.emailLower = data.email.trim().toLowerCase();
    try {
      await ref.create({ ...data, profileCopiedFromAdminAt: new Date() });
    } catch (err) {
      if (err.code !== 6) throw err; // 6 = already exists (created meanwhile)
    }
    provisioned.add(key);
    if (provisioned.size > 10000) provisioned.clear();
  } catch (err) {
    console.warn('[auth] could not prepare the employee profile:', err?.code || '', String(err?.message || err).slice(0, 200));
  }
}

export async function findEmployeesByEmail(email) {
  return findIn(getCrmDb(), getEmployeeDb, email);
}

// Admin database first (master list), then the employee project for
// employees that HR added directly in the employee panel.
async function findIn(adminDb, employeeDbFn, email) {
  let docs = await searchEmployees(adminDb, email);
  // Best effort: if the employee project is not reachable or not set up yet
  // (no Firestore database, missing index, wrong key), sign-in still works
  // from the admin database.
  try {
    docs = docs.concat(await searchEmployees(employeeDbFn(), email));
  } catch (err) {
    console.warn('[auth] employee project lookup skipped:', err?.code || '', String(err?.message || err).slice(0, 200));
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

// Exported for unit tests.
export const _findInForTest = findIn;
export const _searchEmployeesForTest = searchEmployees;

export const PRIVILEGED_ROLES = new Set(['hr', 'manager', 'team lead']);
