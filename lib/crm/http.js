// Small helpers shared by every CRM API route: method routing, CSRF guard,
// consistent JSON errors, no-store caching and a per-instance rate limiter.
import { CrmError } from './errors';
import { indexErrorLink } from './firestore';

export const CSRF_HEADER = 'x-crm-request';

function assertCsrf(req) {
  // Browsers cannot send a custom header cross-site without a CORS preflight,
  // and these routes never answer preflights, so this blocks CSRF.
  if (req.headers[CSRF_HEADER] !== '1') throw new CrmError(403, 'Missing request header', 'csrf');
}

export function crmHandler(methods, { csrf = true } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fn = methods[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      if (csrf && req.method !== 'GET' && req.method !== 'HEAD') assertCsrf(req);
      return await fn(req, res);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

export function sendError(res, err) {
  if (res.headersSent) return undefined;
  if (err instanceof CrmError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const link = indexErrorLink(err);
  if (link) {
    console.error('[crm] missing Firestore index');
    return res.status(500).json({ error: 'A database index is still being built or is missing. Create it from the link, then retry.', code: 'index_required', indexUrl: link });
  }
  // Log the message only: request bodies may hold customer data.
  console.error('[crm] unexpected error:', err && err.message ? err.message : err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

const buckets = new Map();
// Lets automated test runs (many requests from one IP) raise the limits.
const RATE_MULTIPLIER = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER || 1));
// Best-effort limiter: per serverless instance, so it slows abuse rather than
// guaranteeing a global limit.
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    return;
  }
  entry.count += 1;
  if (entry.count > limit * RATE_MULTIPLIER) {
    throw new CrmError(429, 'Too many requests. Please wait a moment and try again.', 'rate_limited');
  }
}

// Client IP for rate limiting. Only headers set by the hosting proxy are
// trusted (Vercel sets x-vercel-forwarded-for / x-real-ip); a client-supplied
// X-Forwarded-For could otherwise be used to dodge the limits.
export function clientIp(req) {
  const vercel = req.headers['x-vercel-forwarded-for'];
  if (typeof vercel === 'string' && vercel) return vercel.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function readCookie(req, name) {
  if (req.cookies && typeof req.cookies[name] === 'string') return req.cookies[name];
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function queryString(value, max = 200) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}
