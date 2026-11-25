// Plivo Application "Answer URL". Plivo calls this when the Browser SDK places
// a call. The request is authenticated with Plivo's V3 signature; the call
// token is single-use and expires after 2 minutes. Whatever number the browser
// dialed is ignored: only the assigned lead's stored number can be dialed.
import { plivoConfig, verifyPlivoRequest, sendXml, hangupXml, dialXml, webhookUrl, findParam } from '@/lib/crm/plivo';
import { claimCallToken } from '@/lib/crm/calls';

function extractToken(body) {
  const header = findParam(body, 'X-PH-CallToken');
  if (typeof header === 'string' && /^[a-f0-9]{40}$/.test(header)) return header;
  const to = String(findParam(body, 'To') || '');
  const m = to.match(/cc([a-f0-9]{40})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const cfg = plivoConfig({ required: false });
  if (!cfg.configured) return sendXml(res, hangupXml());
  if (!verifyPlivoRequest(req, cfg)) {
    console.warn('[plivo-answer] rejected request with invalid signature');
    return res.status(403).end();
  }
  try {
    const body = req.body || {};
    const result = await claimCallToken({
      token: extractToken(body),
      callUuid: String(findParam(body, 'CallUUID') || '').slice(0, 64) || null,
      from: String(findParam(body, 'From') || ''),
    });
    if (result.reject) {
      console.warn('[plivo-answer] call rejected:', result.reject);
      return sendXml(res, hangupXml());
    }
    const q = { c: result.companyId, k: result.callId };
    return sendXml(res, dialXml(cfg, result.e164, {
      action: webhookUrl(cfg, '/api/crm/plivo/dial-status', q),
      callbackUrl: webhookUrl(cfg, '/api/crm/plivo/dial-events', q),
    }));
  } catch (err) {
    console.error('[plivo-answer] error:', err?.message);
    return sendXml(res, hangupXml());
  }
}
