import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { serializeCall } from '@/lib/crm/leads';
import { getEmployeeCallOr404 } from '@/lib/crm/calls';

export default crmHandler({
  GET: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const snap = await getEmployeeCallOr404(companyId, employeeId, req.query.callId);
    return res.status(200).json({ call: serializeCall(snap) });
  },
});
