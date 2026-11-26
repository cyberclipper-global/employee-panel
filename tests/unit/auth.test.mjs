// Unit tests for the sign-in building blocks (email + one-time code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.AUTH_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { sealSecret, openSecret, codeHash, safeEqualHex, randomDigits, timingSafeStringEqual } = await import('../../lib/auth/secrets.js');
const { normalizeEmail, accountId } = await import('../../lib/auth/core.js');

test('emails are normalised and validated', () => {
  assert.equal(normalizeEmail('  Ravi.Kumar@Example.COM '), 'ravi.kumar@example.com');
  for (const bad of ['', 'no-at-sign', 'a@b', 'a@b.c', 'x/y@z.com', 'a b@c.com', null, 42]) {
    assert.throws(() => normalizeEmail(bad), /valid email/, String(bad));
  }
});

test('one-time codes are 6 digits and compared by keyed hash', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const c = randomDigits(6);
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 150, 'codes are random');
  assert.equal(safeEqualHex(codeHash('admin:a@b.co:123456'), codeHash('admin:a@b.co:123456')), true);
  assert.equal(safeEqualHex(codeHash('admin:a@b.co:123456'), codeHash('admin:a@b.co:123457')), false);
  assert.equal(safeEqualHex(codeHash('admin:a@b.co:123456'), codeHash('employee:a@b.co:123456')), false, 'codes are bound to the panel');
  assert.equal(safeEqualHex('', ''), false);
});

test('account ids are stable and separate per panel', () => {
  assert.equal(accountId('admin', 'c1'), accountId('admin', 'c1'));
  assert.notEqual(accountId('admin', 'c1'), accountId('employee', 'c1'));
  assert.notEqual(accountId('employee', 'c1', 'e1'), accountId('employee', 'c1', 'e2'));
  assert.match(accountId('employee', 'c/1', 'e 1'), /^[0-9a-f]{40}$/);
});

test('secrets are sealed with AES-GCM and tamper-evident', () => {
  const sealed = sealSecret('vault-password');
  assert.notEqual(sealed, sealSecret('vault-password'));
  assert.equal(openSecret(sealed), 'vault-password');
  const buf = Buffer.from(sealed.slice(3), 'base64');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => openSecret(`v1.${buf.toString('base64')}`));
  assert.equal(timingSafeStringEqual('x', 'x'), true);
  assert.equal(timingSafeStringEqual('x', 'y'), false);
});
