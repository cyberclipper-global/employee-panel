// Personal password vault (employee). Encrypted server-side; see lib/server/vault.js.
import { crmHandler } from '@/lib/crm/http';
import { requireEmployeeSession } from '@/lib/auth/employee';
import { getEmployeeDb } from '@/lib/server/employeeProject';
import { vaultHandlers } from '@/lib/server/vault';

export default crmHandler(vaultHandlers(async (req) => {
  const { companyId, employeeId } = await requireEmployeeSession(req);
  return getEmployeeDb().collection('users').doc(companyId).collection('employees').doc(employeeId).collection('passwords');
}));
