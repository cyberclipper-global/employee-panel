import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { listFollowups, followupCounts } from '@/lib/crm/followups';

export default crmHandler({
  GET: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const view = ['pending', 'overdue', 'completed'].includes(req.query.view) ? req.query.view : 'pending';
    const [followups, counts] = await Promise.all([
      listFollowups(companyId, { assignedTo: employeeId, view, limit: req.query.limit }),
      followupCounts(companyId, employeeId),
    ]);
    return res.status(200).json({ followups, counts });
  },
});
