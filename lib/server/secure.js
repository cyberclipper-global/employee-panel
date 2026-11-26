// Employee panel: secureRoute with the employee session resolver registered.
import { secureRoute, registerSessionResolver, internalHeaders } from './guard';
import { requireEmployeeSession } from '../auth/employee';

registerSessionResolver('employee', async (req) => {
  const { companyId, employeeId, role } = await requireEmployeeSession(req);
  return { companyId, employeeId, role };
});

export { secureRoute, internalHeaders };
