// Password hashing with Node's built-in scrypt (memory-hard, no dependency).
import crypto from 'crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

const scrypt = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) => crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Spends the same time as a real check when an account does not exist, so
// response timing does not reveal which IDs are valid.
let dummyHash = null;
export async function burnPasswordTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password || 'x', dummyHash);
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'admin123', 'welcome123', 'iloveyou', 'letmein123', 'cyberclipper', 'abc12345', 'password@123',
]);

// Returns an error message, or null when the password is acceptable.
export function passwordProblem(password, { identifiers = [] } = {}) {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Use at least three of: lowercase letters, uppercase letters, numbers, symbols';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common';
  for (const id of identifiers) {
    if (id && String(id).length >= 4 && lower.includes(String(id).toLowerCase())) {
      return 'Password must not contain your company ID or user ID';
    }
  }
  return null;
}
