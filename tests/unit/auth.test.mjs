// Unit tests for the authentication building blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.AUTH_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { hashPassword, verifyPassword, passwordProblem } = await import('../../lib/auth/password.js');
const { hotp, verifyTotp, base32Encode, base32Decode, generateSecret, otpauthUrl, currentStep } = await import('../../lib/auth/totp.js');
const { sealSecret, openSecret, codeHash, safeEqualHex, makeRecoveryCodes, normalizeRecoveryCode, timingSafeStringEqual } = await import('../../lib/auth/secrets.js');

test('password hash verifies and rejects wrong passwords', async () => {
  const h = await hashPassword('Correct-Horse-9');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('Correct-Horse-9', h), true);
  assert.equal(await verifyPassword('correct-horse-9', h), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.notEqual(await hashPassword('Correct-Horse-9'), h, 'salted');
});

test('password policy', () => {
  assert.match(passwordProblem('short'), /at least 10/);
  assert.match(passwordProblem('alllowercaseletters'), /three of/);
  assert.match(passwordProblem('Password123'), /too common|three/i);
  assert.match(passwordProblem('CID-ABC-Secret1!', { identifiers: ['CID-ABC'] }), /must not contain/);
  assert.equal(passwordProblem('Blue-Tiger-2026'), null);
});

test('TOTP matches RFC 6238 test vector (SHA1)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  // RFC 6238 Appendix B: T=59s -> 94287082 (8 digits); 6 digits -> 287082
  assert.equal(hotp(secret, Math.floor(59 / 30)), '287082');
  assert.equal(hotp(secret, Math.floor(1111111109 / 30)), '081804');
});

test('TOTP verification window and replay protection', () => {
  const secret = generateSecret();
  const now = Date.now();
  const step = currentStep(now);
  const code = hotp(secret, step);
  assert.equal(verifyTotp(secret, code, { now }), step);
  assert.equal(verifyTotp(secret, hotp(secret, step - 1), { now }), step - 1, 'previous step accepted');
  assert.equal(verifyTotp(secret, hotp(secret, step - 3), { now }), null, 'old code rejected');
  assert.equal(verifyTotp(secret, code, { now, lastUsedStep: step }), null, 'replay rejected');
  assert.equal(verifyTotp(secret, '12345', { now }), null);
  assert.match(otpauthUrl({ issuer: 'CC Admin', account: 'a@b', secret }), /^otpauth:\/\/totp\/CC%20Admin%3Aa%40b\?secret=/);
});

test('secrets are sealed with AES-GCM and tamper-evident', () => {
  const sealed = sealSecret('JBSWY3DPEHPK3PXP');
  assert.notEqual(sealed, sealSecret('JBSWY3DPEHPK3PXP'));
  assert.equal(openSecret(sealed), 'JBSWY3DPEHPK3PXP');
  const buf = Buffer.from(sealed.slice(3), 'base64');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => openSecret(`v1.${buf.toString('base64')}`));
});

test('codes, hashes and recovery codes', () => {
  assert.equal(safeEqualHex(codeHash('a'), codeHash('a')), true);
  assert.equal(safeEqualHex(codeHash('a'), codeHash('b')), false);
  assert.equal(safeEqualHex('', ''), false);
  const codes = makeRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.equal(normalizeRecoveryCode(' ab12c-3d4e5 '), 'AB12C3D4E5');
  assert.equal(timingSafeStringEqual('x', 'x'), true);
  assert.equal(timingSafeStringEqual('x', 'y'), false);
});
