// CRM employee access uses the main employee session (lib/auth/employee.js),
// which re-checks the session version and that the employee still exists.
import { requireEmployeeSession, EMPLOYEE_SESSION_COOKIE } from '../auth/employee';
import { forbidden } from './errors';
import { getEmployeeSummary } from './leads';

export const EMPLOYEE_COOKIE = EMPLOYEE_SESSION_COOKIE;

export async function requireEmployee(req) {
  const { companyId, employeeId } = await requireEmployeeSession(req);
  const employee = await getEmployeeSummary(companyId, employeeId);
  if (!employee) throw forbidden('Your employee account was not found. Contact your admin.');
  return {
    companyId,
    employeeId,
    employee,
    actor: { type: 'employee', id: employeeId, name: employee.name },
  };
}
