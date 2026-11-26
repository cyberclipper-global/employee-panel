// Plivo Application "Hangup URL": fires when the agent's (browser) leg ends.
// Closes the call log if the Dial callbacks have not already done so.
import { plivoConfig, verifyPlivoRequest, findParam } from '@/lib/crm/plivo';
import { refs } from '@/lib/crm/firestore';
import { finalizeCall } from '@/lib/crm/calls';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const cfg = plivoConfig({ required: false });
  if (!cfg.configured || !verifyPlivoRequest(req, cfg)) return res.status(403).end();
  try {
    const callUuid = String(findParam(req.body, 'CallUUID') || '').slice(0, 64);
    if (callUuid) {
      const idx = await refs.callIndex(callUuid).get();
      if (idx.exists) {
        const { companyId, callId } = idx.data();
        const call = await refs.calls(companyId).doc(callId).get();
        if (call.exists && !call.get('finalized')) {
          const cause = findParam(req.body, 'HangupCause');
          await finalizeCall(companyId, callId, {
            status: call.get('answeredAt') ? 'completed' : 'cancelled',
            durationSec: 0,
            hangupCause: cause,
            failureReason: call.get('answeredAt') ? undefined : 'Call ended before the customer answered',
          });
        }
      }
    }
  } catch (err) {
    console.error('[plivo-hangup] error:', err?.message);
  }
  return res.status(200).json({ ok: true });
}
