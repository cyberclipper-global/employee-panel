import { crmHandler, rateLimit } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { badRequest } from '@/lib/crm/errors';
import { getCrmDb, FieldValue } from '@/lib/crm/firestore';
import { getEmployeeLeadOr404, addActivity } from '@/lib/crm/leads';

export default crmHandler({
  POST: async (req, res) => {
    const { companyId, employeeId, actor } = await requireEmployee(req);
    rateLimit(`crm-note:${companyId}:${employeeId}`, 60, 60 * 1000);
    const lead = await getEmployeeLeadOr404(companyId, employeeId, req.query.leadId);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw badRequest('Note cannot be empty');
    if (text.length > 5000) throw badRequest('Note must be at most 5000 characters');
    const batch = getCrmDb().batch();
    addActivity(batch, companyId, lead.id, { type: 'note', description: text, actor });
    batch.update(lead.ref, { updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return res.status(201).json({ ok: true });
  },
});
