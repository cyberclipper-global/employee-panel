// Unit tests for request guards, phone protection and the vault helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.CRM_PHONE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.AUTH_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.INTERNAL_API_SECRET = crypto.randomBytes(32).toString('hex');

const { secureRoute, registerSessionResolver } = await import('../../lib/server/guard.js');
const phone = await import('../../lib/crm/phone.js');
const { sanitizeLeadFields, buildSearchKeywords } = await import('../../lib/crm/leads.js');
const { CrmError } = await import('../../lib/crm/errors.js');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  res.headersSent = false;
  return res;
}
const req = (over = {}) => ({ method: 'GET', headers: { host: 'panel.example.com' }, query: {}, body: {}, socket: {}, ...over });

registerSessionResolver('admin', async (r) => {
  if (r.headers.cookie !== 'ok') throw new CrmError(401, 'Please sign in');
  return { companyId: 'c1' };
});
registerSessionResolver('employee', async (r) => {
  if (r.headers.cookie !== 'ok') throw new CrmError(401, 'Please sign in');
  return { companyId: 'c1', employeeId: 'e1' };
});

const okHandler = async (r, res) => res.status(200).json({ auth: r.auth });

test('guard: requires a session', async () => {
  const res = mockRes();
  await secureRoute(okHandler, { auth: 'admin' })(req(), res);
  assert.equal(res.statusCode, 401);
});

test('guard: session ids are exposed and company must match', async () => {
  let res = mockRes();
  await secureRoute(okHandler, { auth: 'admin' })(req({ headers: { host: 'h', cookie: 'ok' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.auth.companyId, 'c1');
  res = mockRes();
  await secureRoute(okHandler, { auth: 'admin' })(req({ headers: { host: 'h', cookie: 'ok' }, query: { companyId: 'c2' } }), res);
  assert.equal(res.statusCode, 403);
  res = mockRes();
  await secureRoute(okHandler, { auth: 'admin' })(req({ headers: { host: 'h', cookie: 'ok' }, query: { clientId: 'c2' } }), res);
  assert.equal(res.statusCode, 403, 'clientId is checked too');
});

test('guard: employee can only act on own records', async () => {
  let res = mockRes();
  const h = secureRoute(okHandler, { auth: 'employee', employeeFields: ['employeeId'] });
  await h(req({ method: 'POST', headers: { host: 'h', cookie: 'ok', origin: 'https://h' }, body: { companyId: 'c1', employeeId: 'e2' } }), res);
  assert.equal(res.statusCode, 403);
  res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'h', cookie: 'ok', origin: 'https://h' }, body: { companyId: 'c1', employeeId: 'e1' } }), res);
  assert.equal(res.statusCode, 200);
});

test('guard: blocks cross-site writes', async () => {
  const h = secureRoute(okHandler, { auth: 'admin' });
  let res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'panel.example.com', cookie: 'ok', origin: 'https://evil.example' } }), res);
  assert.equal(res.statusCode, 403);
  res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'panel.example.com', cookie: 'ok' } }), res);
  assert.equal(res.statusCode, 403, 'no Origin and no CSRF header');
  res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'panel.example.com', cookie: 'ok', origin: 'https://panel.example.com' } }), res);
  assert.equal(res.statusCode, 200);
});

test('guard: internal secret', async () => {
  const h = secureRoute(okHandler, { auth: 'admin|internal' });
  let res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'h', 'x-internal-secret': 'wrong' } }), res);
  assert.ok([401, 403].includes(res.statusCode), `rejected (${res.statusCode})`);
  res = mockRes();
  await h(req({ method: 'POST', headers: { host: 'h', 'x-internal-secret': process.env.INTERNAL_API_SECRET } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.auth.internal, true);
  res = mockRes();
  await secureRoute(okHandler, { auth: 'admin' })(req({ method: 'POST', headers: { host: 'h', 'x-internal-secret': process.env.INTERNAL_API_SECRET } }), res);
  assert.ok([401, 403].includes(res.statusCode), 'internal secret only works where allowed');
});

test('guard: hides internal error details', async () => {
  const res = mockRes();
  await secureRoute(async () => { throw new Error('db password=secret'); }, { auth: 'admin' })(req({ headers: { host: 'h', cookie: 'ok' } }), res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('phone: normalise, mask, encrypt, hash', () => {
  assert.equal(phone.normalizePhone('98765 43245'), '+919876543245');
  assert.equal(phone.normalizePhone('09876543245'), '+919876543245');
  assert.equal(phone.normalizePhone('+1 (415) 555-0100'), '+14155550100');
  assert.throws(() => phone.normalizePhone('12345'));
  assert.throws(() => phone.normalizePhone('5876543245'));
  assert.equal(phone.maskPhone('+919876543245'), 'XXXXXXXX45');
  const enc = phone.encryptPhone('+919876543245');
  assert.ok(!enc.includes('9876543245'));
  assert.equal(phone.decryptPhone(enc), '+919876543245');
  assert.equal(phone.hashPhone('+919876543245'), phone.hashPhone('+919876543245'));
});

test('leads: validation and search keywords never include phone digits', () => {
  assert.throws(() => sanitizeLeadFields({}));
  assert.throws(() => sanitizeLeadFields({ fullName: 'A', email: 'bad' }));
  const f = sanitizeLeadFields({ fullName: 'Rahul Verma', email: 'R@X.COM', status: 'Follow Up' });
  assert.equal(f.email, 'r@x.com');
  assert.equal(f.status, 'follow_up');
  const p = phone.protectPhone('9876543245');
  const kw = buildSearchKeywords({ ...f, companyName: 'Acme', ...p });
  assert.ok(kw.includes('ra') && kw.includes('acme'));
  assert.ok(kw.every((k) => !/\d{2,}/.test(k)), 'no phone digits indexed');
});
