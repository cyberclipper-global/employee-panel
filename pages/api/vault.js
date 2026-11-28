// Personal password vault (employee). Encrypted server-side; see lib/server/vault.js.
// Stored in the employee Firebase project; when that project cannot be used
// (not set up, wrong service account), entries are kept in a server-only
// collection of the main database instead, so the vault still works.
import { crmHandler } from '@/lib/crm/http';
import { requireEmployeeSession } from '@/lib/auth/employee';
import { getEmployeeDb } from '@/lib/server/employeeProject';
import { getCrmDb } from '@/lib/crm/firestore';
import { vaultHandlersWithBackup } from '@/lib/server/vault';

export default crmHandler(vaultHandlersWithBackup(
  async (req) => {
    const { companyId, employeeId } = await requireEmployeeSession(req);
    return getEmployeeDb().collection('users').doc(companyId).collection('employees').doc(employeeId).collection('passwords');
  },
  async (req) => {
    const { companyId, employeeId } = await requireEmployeeSession(req);
    // Top-level and not matched by any Firestore rule: server-only.
    return getCrmDb().collection('employeeVaults').doc(`${companyId}__${employeeId}`).collection('items');
  },
  { label: 'vault' },
));
