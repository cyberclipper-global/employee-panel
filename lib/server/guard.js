// Authentication/authorisation wrapper for the panel's API routes.
//
//   export default secureRoute(handler, { auth: 'admin' })
//
// auth: 'admin' | 'employee' | 'internal' | 'admin|internal' | 'employee|internal' | 'public'
// - public: no session; the handler does its own (token) checks. Used for
//   integration endpoints called from customer websites.
// - admin / employee: a valid HttpOnly session cookie is required.
// - internal: server-to-server calls with `x-internal-secret: $INTERNAL_API_SECRET`.
// Company/employee ids sent by the browser must match the session; the
// session's ids are exposed as req.auth.
import crypto from 'crypto';
import { CrmError } from '../crm/errors';
import { rateLimit, clientIp } from '../crm/http';

let sessionResolvers = {};
export function registerSessionResolver(kind, fn) {
  sessionResolvers[kind] = fn;
}

const COMPANY_FIELDS = ['companyId', 'cid', 'clientId', 'adminCompanyId'];

function isInternal(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  const given = req.headers['x-internal-secret'];
  if (!secret || secret.length < 32 || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(secret).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

function sameOrigin(req) {
  if (req.headers['x-crm-request'] === '1') return true;
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function valuesOf(req, fields) {
  const out = [];
  for (const src of [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}]) {
    for (const f of fields) {
      const v = src[f];
      if (typeof v === 'string' && v) out.push(v);
    }
  }
  return out;
}

export function secureRoute(handler, { auth, employeeFields = [], rate } = {}) {
  const modes = String(auth || '').split('|');
  return async function guarded(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (rate) rateLimit(`${rate.key}:${clientIp(req)}`, rate.limit, rate.windowMs);
      if (modes.includes('public')) {
        req.auth = { public: true };
        return await handler(req, res);
      }
      if (req.method === 'OPTIONS') return res.status(204).end();

      if (modes.includes('internal') && isInternal(req)) {
        req.auth = { internal: true };
        return await handler(req, res);
      }
      const kind = modes.find((m) => m === 'admin' || m === 'employee');
      if (!kind) throw new CrmError(401, 'Not authorised', 'unauthorized');
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
        throw new CrmError(403, 'Cross-site request blocked', 'csrf');
      }
      const resolver = sessionResolvers[kind];
      if (!resolver) throw new CrmError(500, `No session resolver for ${kind}`);
      const session = await resolver(req);
      req.auth = { ...session, kind };

      for (const v of valuesOf(req, COMPANY_FIELDS)) {
        if (v !== session.companyId) throw new CrmError(403, 'You do not have access to this company', 'forbidden');
      }
      if (kind === 'employee') {
        for (const v of valuesOf(req, employeeFields)) {
          if (v !== session.employeeId) throw new CrmError(403, 'You can only act on your own records', 'forbidden');
        }
      }
      return await handler(req, res);
    } catch (err) {
      if (res.headersSent) return undefined;
      if (err instanceof CrmError) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error('[api] error:', err?.message);
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

// Headers for calls from this server to the other panel's internal routes.
export function internalHeaders() {
  const secret = process.env.INTERNAL_API_SECRET;
  return secret ? { 'x-internal-secret': secret } : {};
}
