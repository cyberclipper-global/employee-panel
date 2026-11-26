// <Dial callbackUrl>: Plivo reports B-leg (customer) events here.
import { plivoConfig, verifyPlivoRequest, findParam } from '@/lib/crm/plivo';
import { markAnswered } from '@/lib/crm/calls';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const cfg = plivoConfig({ required: false });
  if (!cfg.configured || !verifyPlivoRequest(req, cfg)) return res.status(403).end();
  const { c, k } = req.query;
  try {
    const action = String(findParam(req.body, 'DialAction') || '').toLowerCase();
    if (action === 'answer' && typeof c === 'string' && typeof k === 'string') {
      await markAnswered(c, k, String(findParam(req.body, 'DialBLegUUID') || '').slice(0, 64) || null);
    }
  } catch (err) {
    console.error('[plivo-dial-events] error:', err?.message);
  }
  return res.status(200).json({ ok: true });
}
