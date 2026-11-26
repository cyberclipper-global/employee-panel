// Plivo integration (server only). Credentials never leave the server.
//
// Call flow (number privacy):
//  1. The browser asks /api/crm/calls/initiate for a lead it is assigned to.
//     The server creates a call record and a single-use, short-lived call token.
//  2. The browser (Plivo Browser SDK, logged in with a short-lived access token)
//     places a WebRTC call to Plivo carrying only that token.
//  3. Plivo asks our Answer URL what to do. The server validates Plivo's
//     signature and the token, decrypts the lead's number and answers with
//     <Dial><Number>…</Number></Dial>. The real number only travels between
//     our server and Plivo; it is never sent to the employee's browser.
import crypto from 'crypto';
// plivo is CommonJS with __esModule set and no default export: use named imports.
import { validateV3Signature, Response as PlivoResponse } from 'plivo';
import { CrmError } from './errors';

const API = 'https://api.plivo.com/v1/Account';

export function plivoConfig({ required = true } = {}) {
  const cfg = {
    authId: process.env.PLIVO_AUTH_ID || '',
    authToken: process.env.PLIVO_AUTH_TOKEN || '',
    appId: process.env.PLIVO_APPLICATION_ID || '',
    callerId: process.env.PLIVO_CALLER_ID || process.env.PLIVO_PHONE_NUMBER || '',
    webhookBase: (process.env.PLIVO_WEBHOOK_BASE_URL || '').replace(/\/+$/, ''),
    ringTimeout: Math.min(Math.max(parseInt(process.env.PLIVO_RING_TIMEOUT || '45', 10) || 45, 10), 120),
  };
  cfg.configured = Boolean(cfg.authId && cfg.authToken && cfg.appId && cfg.callerId && /^https:\/\//.test(cfg.webhookBase));
  if (required && !cfg.configured) {
    throw new CrmError(503, 'Calling is not configured yet. Ask your admin to set the Plivo environment variables.', 'calling_not_configured');
  }
  return cfg;
}

function authHeader(cfg) {
  return `Basic ${Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64')}`;
}

async function plivoRequest(cfg, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API}/${encodeURIComponent(cfg.authId)}/${path}`, {
      method,
      headers: { Authorization: authHeader(cfg), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    return { status: res.status, ok: res.ok, json };
  } catch (err) {
    throw new CrmError(502, 'Could not reach the calling provider. Please try again.', 'provider_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// Stable, opaque identity for the employee inside Plivo (no personal data).
export function plivoIdentity(companyId, employeeId) {
  return `cc${crypto.createHash('sha256').update(`${companyId}:${employeeId}`).digest('hex').slice(0, 24)}`;
}

// Short-lived Browser SDK access token: outgoing calls only, bound to our
// Plivo Application (whose Answer URL is /api/crm/plivo/answer).
export async function createAccessToken(cfg, identity, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const { ok, status, json } = await plivoRequest(cfg, 'POST', 'JWT/Token/', {
    iss: cfg.authId,
    sub: identity,
    nbf: now - 30,
    exp: now + ttlSeconds,
    per: { voice: { incoming_allow: false, outgoing_allow: true } },
    app: cfg.appId,
  });
  if (!ok || !json.token) {
    console.error('[plivo] access token request failed with status', status, json && json.error ? String(json.error).slice(0, 200) : '');
    throw new CrmError(502, 'Could not start the dialer. Check the Plivo configuration.', 'token_failed');
  }
  return { token: json.token, expiresAt: (now + ttlSeconds) * 1000 };
}

export async function hangupProviderCall(cfg, callUuid) {
  if (!callUuid) return false;
  const { ok, status } = await plivoRequest(cfg, 'DELETE', `Call/${encodeURIComponent(callUuid)}/`);
  return ok || status === 404;
}

// Verifies X-Plivo-Signature-V3 using Plivo's official helper. The URL is
// rebuilt from PLIVO_WEBHOOK_BASE_URL (never from the Host header).
export function verifyPlivoRequest(req, cfg) {
  const signature = req.headers['x-plivo-signature-v3'];
  const nonce = req.headers['x-plivo-signature-v3-nonce'];
  if (typeof signature !== 'string' || typeof nonce !== 'string' || !signature || !nonce) return false;
  const url = `${cfg.webhookBase}${req.url}`;
  const params = req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {};
  try {
    return validateV3Signature(req.method, url, nonce, cfg.authToken, signature, params);
  } catch {
    return false;
  }
}

export function sendXml(res, xml) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(xml);
}

export function hangupXml(reason = 'rejected') {
  const r = new PlivoResponse();
  r.addHangup({ reason });
  return r.toXML();
}

export function dialXml(cfg, e164, { action, callbackUrl }) {
  const r = new PlivoResponse();
  const dial = r.addDial({
    callerId: cfg.callerId,
    timeout: cfg.ringTimeout,
    action,
    method: 'POST',
    redirect: 'true',
    callbackUrl,
    callbackMethod: 'POST',
  });
  dial.addNumber(e164);
  return r.toXML();
}

export function webhookUrl(cfg, path, query) {
  const qs = new URLSearchParams(query).toString();
  return `${cfg.webhookBase}${path}${qs ? `?${qs}` : ''}`;
}

// Finds a custom SIP header in Plivo's webhook params, case-insensitively.
export function findParam(body, name) {
  if (!body || typeof body !== 'object') return null;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(body)) {
    if (k.toLowerCase() === target) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}
