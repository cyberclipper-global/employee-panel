// Password vault ("Passwords & Security") stored encrypted on the server.
//
// Entries used to be encrypted in the browser with a key that was written in
// the source code. They are now encrypted here with AUTH_ENCRYPTION_KEY.
// Old entries are converted the first time they are read, using
// LEGACY_VAULT_KEY (set it to the old key until all entries are converted).
import CryptoJS from 'crypto-js';
import { FieldValue } from 'firebase-admin/firestore';
import { sealSecret, openSecret } from '../auth/secrets';
import { CrmError } from '../crm/errors';

const MAX_FIELDS = 25;
const MAX_LEN = 4000;

function decryptLegacy(cipher) {
  const key = process.env.LEGACY_VAULT_KEY;
  if (!key) return null;
  try {
    const plain = CryptoJS.AES.decrypt(cipher, key).toString(CryptoJS.enc.Utf8);
    return plain || null;
  } catch {
    return null;
  }
}

function cleanEntry(body, { requirePassword }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CrmError(400, 'Invalid entry');
  const out = {};
  const entries = Object.entries(body).filter(([k]) => !['id', 'passwordEnc', 'legacy', 'needsReentry'].includes(k));
  if (entries.length > MAX_FIELDS) throw new CrmError(400, 'Too many fields');
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    if (typeof v !== 'string') continue;
    if (v.length > MAX_LEN) throw new CrmError(400, `${k} is too long`);
    out[k] = v;
  }
  if (requirePassword && !out.password) throw new CrmError(400, 'Password is required');
  return out;
}

export async function listVault(col) {
  const snap = await col.orderBy('createdAt', 'desc').limit(500).get().catch(() => col.limit(500).get());
  const items = [];
  const upgrades = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    let password = '';
    let needsReentry = false;
    if (typeof d.passwordEnc === 'string') {
      try { password = openSecret(d.passwordEnc); } catch { needsReentry = true; }
    } else if (typeof d.password === 'string' && d.password) {
      const plain = decryptLegacy(d.password);
      if (plain !== null) {
        password = plain;
        upgrades.push(doc.ref.update({ passwordEnc: sealSecret(plain), password: FieldValue.delete() }));
      } else {
        needsReentry = true;
      }
    }
    const { passwordEnc, password: _legacy, ...rest } = d; // eslint-disable-line no-unused-vars
    items.push({ ...rest, id: doc.id, password, needsReentry });
  }
  await Promise.allSettled(upgrades);
  return items;
}

export async function addVault(col, body) {
  const entry = cleanEntry(body, { requirePassword: true });
  const { password, ...rest } = entry;
  const ref = await col.add({ ...rest, passwordEnc: sealSecret(password), createdAt: rest.createdAt || new Date().toISOString() });
  return ref.id;
}

export async function updateVault(col, id, body) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new CrmError(400, 'Invalid id');
  const ref = col.doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new CrmError(404, 'Entry not found');
  const entry = cleanEntry(body, { requirePassword: false });
  const { password, ...rest } = entry;
  const update = { ...rest };
  if (password) Object.assign(update, { passwordEnc: sealSecret(password), password: FieldValue.delete() });
  await ref.update(update);
}

export async function deleteVault(col, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new CrmError(400, 'Invalid id');
  await col.doc(id).delete();
}

export function vaultHandlers(getCol) {
  return {
    GET: async (req, res) => res.status(200).json({ items: await listVault(await getCol(req)) }),
    POST: async (req, res) => res.status(201).json({ id: await addVault(await getCol(req), req.body) }),
    PATCH: async (req, res) => { await updateVault(await getCol(req), req.query.id, req.body); return res.status(200).json({ ok: true }); },
    DELETE: async (req, res) => { await deleteVault(await getCol(req), req.query.id); return res.status(200).json({ ok: true }); },
  };
}
