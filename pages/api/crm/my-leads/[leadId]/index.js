import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { forbidden, notFound } from '@/lib/crm/errors';
import { refs, getCrmDb, FieldValue } from '@/lib/crm/firestore';
import {
  getEmployeeLeadOr404, serializeLead, serializeActivity, serializeFollowup, serializeCall,
  normalizeStatus, normalizePriority, statusChangeActivity, addActivity, getCrmSettings, deleteLeadCascade,
} from '@/lib/crm/leads';

export default crmHandler({
  GET: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const snap = await getEmployeeLeadOr404(companyId, employeeId, req.query.leadId);
    const [acts, fups, calls] = await Promise.all([
      refs.activities(companyId, snap.id).orderBy('createdAt', 'desc').limit(100).get(),
      refs.followups(companyId).where('leadId', '==', snap.id).orderBy('dueAt', 'desc').limit(50).get(),
      // Only this employee's own calls on the lead.
      refs.calls(companyId).where('leadId', '==', snap.id).where('employeeId', '==', employeeId).orderBy('createdAt', 'desc').limit(50).get(),
    ]);
    return res.status(200).json({
      lead: serializeLead(snap, 'employee'),
      activities: acts.docs.map(serializeActivity).filter((a) => !a.adminOnly),
      followups: fups.docs.map(serializeFollowup),
      calls: calls.docs.map(serializeCall),
    });
  },

  // Employees may change status and priority only.
  PATCH: async (req, res) => {
    const { companyId, employeeId, actor } = await requireEmployee(req);
    const status = req.body?.status !== undefined ? normalizeStatus(req.body.status) : undefined;
    const priority = req.body?.priority !== undefined ? normalizePriority(req.body.priority) : undefined;
    const leadRef = refs.lead(companyId, String(req.query.leadId || '').slice(0, 128) || 'x');
    await getCrmDb().runTransaction(async (tx) => {
      const snap = await tx.get(leadRef);
      if (!snap.exists || snap.get('assignedTo') !== employeeId) throw notFound('Lead not found');
      const update = { updatedAt: FieldValue.serverTimestamp() };
      if (status && status !== snap.get('status')) {
        update.status = status;
        statusChangeActivity(tx, companyId, snap.id, snap.get('status'), status, actor);
      }
      if (priority && priority !== snap.get('priority')) {
        update.priority = priority;
        addActivity(tx, companyId, snap.id, { type: 'updated', description: `Priority set to ${priority}`, actor });
      }
      tx.update(leadRef, update);
    });
    return res.status(200).json({ lead: serializeLead(await leadRef.get(), 'employee') });
  },

  DELETE: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const settings = await getCrmSettings(companyId);
    if (!settings.allowEmployeeDelete) throw forbidden('Only your admin can delete leads');
    const snap = await getEmployeeLeadOr404(companyId, employeeId, req.query.leadId);
    await deleteLeadCascade(companyId, snap);
    return res.status(200).json({ ok: true });
  },
});
