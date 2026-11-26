import { crmHandler } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { serializeCall } from '@/lib/crm/leads';
import { getEmployeeCallOr404, finalizeCall } from '@/lib/crm/calls';
import { plivoConfig, hangupProviderCall } from '@/lib/crm/plivo';
import { FINAL_CALL_STATUSES } from '@/lib/crm/constants';

// Server-side hangup. The dialer calls this after the SDK hangup (or when the
// SDK reports a failure) so a call can never stay open on Plivo's side, and so
// the call log is closed even if a webhook is delayed.
export default crmHandler({
  POST: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const snap = await getEmployeeCallOr404(companyId, employeeId, req.query.callId);
    const call = snap.data();
    if (!FINAL_CALL_STATUSES.includes(call.status)) {
      const cfg = plivoConfig({ required: false });
      if (call.providerCallUuid && cfg.configured) {
        await hangupProviderCall(cfg, call.providerCallUuid).catch(() => false);
      }
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : undefined;
      if (!call.providerCallUuid) {
        // Plivo never reached our Answer URL: the call did not start.
        await finalizeCall(companyId, snap.id, { status: reason ? 'failed' : 'cancelled', failureReason: reason });
      } else if (!call.answeredAt) {
        await finalizeCall(companyId, snap.id, { status: 'cancelled', failureReason: reason });
      }
      // Answered calls are closed by Plivo's dial/hangup callbacks, which carry
      // the exact talk time. finalizeCall falls back to wall-clock time otherwise.
    }
    return res.status(200).json({ call: serializeCall(await snap.ref.get()) });
  },
});
