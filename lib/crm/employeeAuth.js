// Server-side employee identity for the CRM APIs.
//
// The employee panel already signs an `employeeSession` JWT on the server with
// SESSION_SECRET (see /api/createSession). Every CRM route verifies that
// signature, then confirms the employee still exists in the admin database.
// Company and employee ids are never taken from the request body or URL.
import jwt from 'jsonwebtoken';
import { CrmError, unauthorized, forbidden } from './errors';
import { readCookie } from './http';
import { getEmployeeSummary } from './leads';

export const EMPLOYEE_COOKIE = 'employeeSession';
const cache = new Map();
const ID_RE = /^[^/\s]{1,128}$/;

async function loadEmployee(companyId, employeeId) {
  const key = `${companyId}/${employeeId}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await getEmployeeSummary(companyId, employeeId);
  cache.set(key, { value, expires: Date.now() + 60 * 1000 });
  if (cache.size > 2000) cache.clear();
  return value;
}

export async function requireEmployee(req) {
  const token = readCookie(req, EMPLOYEE_COOKIE);
  if (!token) throw unauthorized('Your session has expired. Please sign in again.');
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new CrmError(500, 'SESSION_SECRET is not configured', 'not_configured');
  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const { companyId, employeeId } = payload || {};
  if (typeof companyId !== 'string' || typeof employeeId !== 'string' || !ID_RE.test(companyId) || !ID_RE.test(employeeId)) {
    throw unauthorized('Your session is not valid. Please sign in again.');
  }
  const employee = await loadEmployee(companyId, employeeId);
  if (!employee) throw forbidden('Your employee account was not found. Contact your admin.');
  return {
    companyId,
    employeeId,
    employee,
    actor: { type: 'employee', id: employeeId, name: employee.name },
  };
}
