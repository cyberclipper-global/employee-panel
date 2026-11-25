import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { updateFollowup } from '@/lib/crm/followups';

export default crmHandler({
  PATCH: async (req, res) => {
    const { companyId, employeeId, actor } = await requireEmployee(req);
    const followup = await updateFollowup(companyId, req.query.followupId, { action: req.body?.action, note: req.body?.note }, actor, { employeeId });
    return res.status(200).json({ followup });
  },
});
