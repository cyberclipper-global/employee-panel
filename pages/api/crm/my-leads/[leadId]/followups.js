import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { getEmployeeLeadOr404 } from '@/lib/crm/leads';
import { scheduleFollowup } from '@/lib/crm/followups';

export default crmHandler({
  POST: async (req, res) => {
    const { companyId, employeeId, actor } = await requireEmployee(req);
    const lead = await getEmployeeLeadOr404(companyId, employeeId, req.query.leadId);
    const followup = await scheduleFollowup(companyId, lead, { dueAt: req.body?.dueAt, note: req.body?.note }, actor);
    return res.status(201).json({ followup });
  },
});
