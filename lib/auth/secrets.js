// Encryption for secrets stored in Firestore (2FA seeds) and keyed hashes for
// one-time codes. Keys come only from server environment variables.
import crypto from 'crypto';

let key = null;
function getKey() {
  if (key) return key;
  const raw = process.env.AUTH_ENCRYPTION_KEY || process.env.CRM_PHONE_ENCRYPTION_KEY;
  if (!raw) throw new Error('AUTH_ENCRYPTION_KEY is not configured');
  const master = Buffer.from(raw.trim(), 'base64');
  if (master.length !== 32) throw new Error('AUTH_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
  key = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from('cc-auth-secrets-v1'), 32));
  return key;
}

export function sealSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

export function openSecret(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1.')) throw new Error('Unreadable secret');
  const buf = Buffer.from(sealed.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function codeHash(value) {
  return crypto.createHmac('sha256', getKey()).update(String(value)).digest('hex');
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export const randomDigits = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');

export function makeRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const timingSafeStringEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// Sign-in PINs: scrypt with a random salt, over an HMAC of the PIN keyed with
// the server secret (so a leaked database alone cannot be brute-forced).
const scryptAsync = (pw, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(codeHash(`pin:${pin}`), salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPin(pin, stored) {
  const [v, salt, hash] = String(stored || '').split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const key = await scryptAsync(codeHash(`pin:${pin}`), Buffer.from(salt, 'base64'));
  const want = Buffer.from(hash, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
