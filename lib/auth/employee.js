// Employee panel login configuration.
// Password is always required; 2FA is required when EMPLOYEE_REQUIRE_2FA=true
// and otherwise optional (an employee can turn it on in Passwords & Security).
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

export async function resolveEmployee(companyId, loginId) {
  const d = await loadEmployeeDoc(companyId, loginId);
  if (!d) return null;
  if (DISABLED.has(String(d.status || '').toLowerCase()) || d.active === false) return null;
  const name = `${(d.firstName || '').trim()} ${(d.lastName || '').trim()}`.trim() || d.name || loginId;
  return {
    companyId,
    loginId,
    employeeId: loginId,
    email: typeof d.email === 'string' ? d.email.trim() : '',
    name,
    role: d.role || '',
    displayLogin: `${name} (${companyId})`,
  };
}

export const employeeAuth = createAuth({
  kind: 'employee',
  appName: 'CyberClipper Employee',
  cookieName: EMPLOYEE_SESSION_COOKIE,
  sessionTtlSeconds: 12 * 60 * 60,
  secret,
  resolvePrincipal: resolveEmployee,
  require2fa: () => String(process.env.EMPLOYEE_REQUIRE_2FA || '').toLowerCase() === 'true',
  // companyId/employeeId names are kept so older server code can read them.
  sessionClaims: (p) => ({ companyId: p.companyId, employeeId: p.employeeId }),
  idsFromSession: (payload) => (typeof payload.companyId === 'string' && typeof payload.employeeId === 'string'
    ? { companyId: payload.companyId, employeeId: payload.employeeId, loginId: payload.employeeId }
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
