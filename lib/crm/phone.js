// Customer phone numbers are stored encrypted (AES-256-GCM) with a key that
// exists only in server environment variables. Even if a browser could read
// the Firestore documents, it would only see ciphertext. Employees only ever
// receive the masked form.
import crypto from 'crypto';
import { CrmError, badRequest } from './errors';

// Key material, in order of preference. CRM_PHONE_ENCRYPTION_KEY is the
// dedicated key; when it is not set, the other server secrets (which must
// also be identical in both panels) are used, so adding leads never breaks
// just because that one variable is missing. Decryption tries every
// candidate (AES-GCM verifies which key is right), so numbers saved before
// CRM_PHONE_ENCRYPTION_KEY was added stay readable afterwards.
const KEY_SOURCES = ['CRM_PHONE_ENCRYPTION_KEY', 'AUTH_ENCRYPTION_KEY', 'INTERNAL_API_SECRET'];

export const CALLING_KEY_MESSAGE = 'Calling is not configured yet: this number cannot be read on the server. Ask your admin to set CRM_PHONE_ENCRYPTION_KEY (the same value in both panels).';

let cache = null;

function toMaster(raw) {
  const s = String(raw).trim();
  const b = Buffer.from(s, 'base64');
  if (b.length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) return b;
  return crypto.createHash('sha256').update(s).digest();
}

function getKeySets() {
  if (cache) return cache;
  const seen = new Set();
  const sets = [];
  for (const name of KEY_SOURCES) {
    const raw = process.env[name];
    if (!raw || !String(raw).trim()) continue;
    const master = toMaster(raw);
    const id = master.toString('hex');
    if (seen.has(id)) continue;
    seen.add(id);
    const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info), 32));
    sets.push({ source: name, enc: derive('cc-crm-phone-encryption-v1'), mac: derive('cc-crm-phone-lookup-v1') });
  }
  if (!sets.length) {
    throw new CrmError(503, 'Phone numbers cannot be saved: no server encryption key is set. Ask your admin to set CRM_PHONE_ENCRYPTION_KEY.', 'not_configured');
  }
  cache = sets;
  return sets;
}

const getKeys = () => getKeySets()[0];

// Only for tests: forget cached keys after changing env variables.
export function _resetPhoneKeysForTest() { cache = null; }

const defaultCountryCode = () => (process.env.CRM_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '') || '91';

// Returns the number in E.164 form (+<country><number>) or throws a 400.
export function normalizePhone(input) {
  if (input === undefined || input === null) throw badRequest('Mobile number is required');
  let s = String(input).trim();
  if (!s) throw badRequest('Mobile number is required');
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const cc = defaultCountryCode();
  let digits;
  if (s.startsWith('+')) {
    digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) throw badRequest('Mobile number is not valid');
    return `+${digits}`;
  }
  if (!/^\d+$/.test(s)) throw badRequest('Mobile number can only contain digits');
  digits = s;
  if (cc === '91') {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) {
      if (!/^[6-9]/.test(digits)) throw badRequest('Indian mobile numbers start with 6, 7, 8 or 9');
      return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    throw badRequest('Enter a 10-digit mobile number, or include the country code with +');
  }
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.startsWith(cc) && digits.length > cc.length + 6) return `+${digits}`;
  const full = `${cc}${digits}`;
  if (!/^\d{8,15}$/.test(full)) throw badRequest('Mobile number is not valid');
  return `+${full}`;
}

export function encryptPhone(e164) {
  const { enc } = getKeys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', enc, iv);
  const ct = Buffer.concat([cipher.update(e164, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

export function decryptPhone(payload) {
  if (!payload || typeof payload !== 'string' || !payload.startsWith('v1.')) {
    throw new CrmError(500, 'Stored phone number is unreadable', 'phone_unreadable');
  }
  const buf = Buffer.from(payload.slice(3), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  for (const { enc } of getKeySets()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', enc, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch { /* try the next key */ }
  }
  throw new CrmError(503, CALLING_KEY_MESSAGE, 'calling_not_configured');
}

// Deterministic keyed hash, used for duplicate detection and exact admin lookup.
export function hashPhone(e164) {
  return crypto.createHmac('sha256', getKeys().mac).update(e164).digest('hex');
}

// "XXXXXXXX45": only the last two digits of the national number are kept.
export function maskPhone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  const cc = defaultCountryCode();
  const national = digits.startsWith(cc) && digits.length - cc.length >= 8 ? digits.slice(cc.length) : digits;
  if (national.length < 4) return 'XXXXXXXX';
  return `${'X'.repeat(national.length - 2)}${national.slice(-2)}`;
}

export function protectPhone(input) {
  const e164 = normalizePhone(input);
  return { e164, phoneEnc: encryptPhone(e164), phoneHash: hashPhone(e164), phoneMasked: maskPhone(e164) };
}
