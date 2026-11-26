// <Dial action>: Plivo calls this once the dial attempt ends, with the final
// DialStatus and the customer leg's talk time.
import { plivoConfig, verifyPlivoRequest, sendXml, hangupXml, findParam } from '@/lib/crm/plivo';
import { finalizeCall, mapDialStatus } from '@/lib/crm/calls';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const cfg = plivoConfig({ required: false });
  if (!cfg.configured || !verifyPlivoRequest(req, cfg)) return res.status(403).end();
  const { c, k } = req.query;
  try {
    if (typeof c === 'string' && typeof k === 'string') {
      const body = req.body || {};
      await finalizeCall(c, k, {
        status: mapDialStatus(findParam(body, 'DialStatus')),
        durationSec: Number(findParam(body, 'DialBLegDuration') || 0),
        hangupCause: findParam(body, 'DialBLegHangupCause'),
        bLegUuid: String(findParam(body, 'DialBLegUUID') || '').slice(0, 64) || null,
      });
    }
  } catch (err) {
    console.error('[plivo-dial-status] error:', err?.message);
  }
  // End the agent's leg once the customer leg is over.
  return sendXml(res, hangupXml('rejected'));
}
