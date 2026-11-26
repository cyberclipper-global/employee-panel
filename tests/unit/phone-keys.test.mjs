import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const m = await import('../../lib/crm/phone.js');
const set = (o) => { for (const k of ['CRM_PHONE_ENCRYPTION_KEY','AUTH_ENCRYPTION_KEY','INTERNAL_API_SECRET']) delete process.env[k]; Object.assign(process.env, o); m._resetPhoneKeysForTest(); };
// Leads can be added without CRM_PHONE_ENCRYPTION_KEY; calls explain what is missing.
test('phone encryption falls back to other server keys', () => {
  const auth = crypto.randomBytes(32).toString('base64');
  set({ AUTH_ENCRYPTION_KEY: auth, INTERNAL_API_SECRET: 'abc123hex' });
  const p = m.protectPhone('9520949163');
  assert.equal(m.decryptPhone(p.phoneEnc), '+919520949163');
  // later a dedicated key is added: old numbers still readable
  set({ CRM_PHONE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), AUTH_ENCRYPTION_KEY: auth });
  assert.equal(m.decryptPhone(p.phoneEnc), '+919520949163');
  // other panel has different keys: friendly calling error
  set({ AUTH_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') });
  assert.throws(() => m.decryptPhone(p.phoneEnc), (e) => e.status === 503 && e.code === 'calling_not_configured' || /Calling is not configured/.test(e.message));
  set({ INTERNAL_API_SECRET: 'only-this' });
  assert.ok(m.protectPhone('9520949163').phoneEnc.startsWith('v1.'));
  set({});
  assert.throws(() => m.protectPhone('9520949163'));
});
