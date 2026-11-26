import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { badRequest, notFound } from '@/lib/crm/errors';
import { refs, getCrmDb, FieldValue } from '@/lib/crm/firestore';
import { addActivity, normalizeStatus, statusChangeActivity, serializeCall, getLeadOr404 } from '@/lib/crm/leads';
import { scheduleFollowup } from '@/lib/crm/followups';
import { getEmployeeCallOr404 } from '@/lib/crm/calls';
import { CALL_OUTCOMES, outcomeLabel } from '@/lib/crm/constants';

const OUTCOMES = new Set(CALL_OUTCOMES.map((o) => o.value));

// Body: { outcome, note?, leadStatus?, followUpAt?, followUpNote? }
export default crmHandler({
  POST: async (req, res) => {
    const { companyId, employeeId, actor } = await requireEmployee(req);
    const b = req.body || {};
    if (!OUTCOMES.has(b.outcome)) throw badRequest('Choose a call outcome');
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
    const leadStatus = b.leadStatus ? normalizeStatus(b.leadStatus) : undefined;
    const callSnap = await getEmployeeCallOr404(companyId, employeeId, req.query.callId);
    const leadRef = refs.lead(companyId, callSnap.get('leadId'));
    await getCrmDb().runTransaction(async (tx) => {
      const lead = await tx.get(leadRef);
      if (!lead.exists || lead.get('assignedTo') !== employeeId) throw notFound('Lead not found');
      tx.update(callSnap.ref, { outcome: b.outcome, outcomeNote: note, outcomeAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      addActivity(tx, companyId, lead.id, {
        type: 'call_outcome',
        description: `Call outcome: ${outcomeLabel(b.outcome)}${note ? ` — ${note}` : ''}`,
        actor,
        meta: { callId: callSnap.id, outcome: b.outcome },
      });
      const update = { updatedAt: FieldValue.serverTimestamp() };
      if (leadStatus && leadStatus !== lead.get('status')) {
        update.status = leadStatus;
        statusChangeActivity(tx, companyId, lead.id, lead.get('status'), leadStatus, actor);
      }
      tx.update(leadRef, update);
    });
    if (b.followUpAt) {
      const lead = await getLeadOr404(companyId, leadRef.id);
      await scheduleFollowup(companyId, lead, { dueAt: b.followUpAt, note: b.followUpNote }, actor);
    }
    return res.status(200).json({ call: serializeCall(await callSnap.ref.get()) });
  },
});
