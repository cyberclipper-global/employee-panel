import { crmHandler, queryString, rateLimit } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { forbidden } from '@/lib/crm/errors';
import { listLeads, serializeLead, sanitizeLeadFields, createLead, getLeadOr404, normalizeStatus, normalizePriority, getCrmSettings } from '@/lib/crm/leads';
import { followupCounts } from '@/lib/crm/followups';

// Only leads assigned to the signed-in employee. Phone numbers are masked.
export default crmHandler({
  GET: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const status = queryString(req.query.status, 40);
    const priority = queryString(req.query.priority, 20);
    const [result, counts, settings] = await Promise.all([
      listLeads(companyId, {
        assignedTo: employeeId,
        status: status ? normalizeStatus(status) : undefined,
        priority: priority ? normalizePriority(priority) : undefined,
        search: queryString(req.query.search, 60),
        pageSize: req.query.pageSize,
        cursor: queryString(req.query.cursor, 300) || undefined,
      }),
      req.query.cursor ? Promise.resolve(undefined) : followupCounts(companyId, employeeId),
      getCrmSettings(companyId),
    ]);
    return res.status(200).json({
      leads: result.docs.map((d) => serializeLead(d, 'employee')),
      nextCursor: result.nextCursor,
      total: result.total,
      followups: counts,
      permissions: { canCreate: settings.allowEmployeeCreate, canDelete: settings.allowEmployeeDelete },
    });
  },

  // Employees can add their own leads (assigned to themselves) unless the
  // admin turned this off in Leads > Settings.
  POST: async (req, res) => {
    const session = await requireEmployee(req);
    const { companyId, employee, actor } = session;
    rateLimit(`crm-emp-create:${companyId}:${employee.id}`, 30, 60 * 1000);
    const settings = await getCrmSettings(companyId);
    if (!settings.allowEmployeeCreate) throw forbidden('Your admin has turned off adding leads from the employee panel');
    const fields = sanitizeLeadFields(req.body || {});
    const leadId = await createLead(companyId, { fields, phone: req.body?.phone, assignee: { id: employee.id, name: employee.name }, actor });
    return res.status(201).json({ lead: serializeLead(await getLeadOr404(companyId, leadId), 'employee') });
  },
});
