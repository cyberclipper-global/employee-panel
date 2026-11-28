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

// Errors from Firestore itself (project not set up, wrong service account,
// network), as opposed to our own validation errors.
const isStoreError = (err) => !(err instanceof CrmError) || err.code === 'not_configured' || err.code === 'wrong_project';

/**
 * Vault with a backup store: `getPrimary(req)` and `getBackup(req)` return
 * Firestore collections. Reads merge both; writes go to the primary and fall
 * back to the backup when the primary cannot be used, so the vault keeps
 * working while the primary project is not set up.
 */
export function vaultHandlersWithBackup(getPrimary, getBackup, { label = 'vault' } = {}) {
  const tryCol = async (get, req) => {
    try { return { col: await get(req) }; } catch (err) { if (!isStoreError(err)) throw err; return { err }; }
  };
  const warn = (what, err) => console.warn(`[${label}] ${what}:`, err?.code || '', String(err?.message || err).slice(0, 200));

  async function list(req) {
    const [p, b] = await Promise.all([tryCol(getPrimary, req), tryCol(getBackup, req)]);
    const results = await Promise.all([
      p.col ? listVault(p.col).catch((err) => { if (!isStoreError(err)) throw err; warn('primary store unavailable', err); return null; }) : (warn('primary store unavailable', p.err), null),
      b.col ? listVault(b.col).catch((err) => { if (!isStoreError(err)) throw err; warn('backup store unavailable', err); return null; }) : null,
    ]);
    if (results.every((r) => r === null)) {
      throw new CrmError(503, 'Your saved passwords cannot be loaded right now. Please try again in a minute.', 'vault_unavailable');
    }
    const seen = new Set();
    const items = [];
    for (const item of [...(results[0] || []), ...(results[1] || [])]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    items.sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
    return items;
  }

  async function add(req) {
    const p = await tryCol(getPrimary, req);
    if (p.col) {
      try { return await addVault(p.col, req.body); } catch (err) { if (!isStoreError(err)) throw err; warn('primary store unavailable, saving to backup', err); }
    }
    return addVault(await getBackup(req), req.body);
  }

  // Runs fn on whichever store holds the entry.
  async function onEntry(req, fn) {
    const id = req.query.id;
    for (const get of [getPrimary, getBackup]) {
      const c = await tryCol(get, req);
      if (!c.col) continue;
      try {
        if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && (await c.col.doc(id).get()).exists) return fn(c.col, id);
      } catch (err) {
        if (!isStoreError(err)) throw err;
        warn('store unavailable', err);
      }
    }
    throw new CrmError(404, 'Entry not found');
  }

  return {
    GET: async (req, res) => res.status(200).json({ items: await list(req) }),
    POST: async (req, res) => res.status(201).json({ id: await add(req) }),
    PATCH: async (req, res) => { await onEntry(req, (col, id) => updateVault(col, id, req.body)); return res.status(200).json({ ok: true }); },
    DELETE: async (req, res) => { await onEntry(req, (col, id) => deleteVault(col, id)); return res.status(200).json({ ok: true }); },
  };
}

export function vaultHandlers(getCol) {
  return {
    GET: async (req, res) => res.status(200).json({ items: await listVault(await getCol(req)) }),
    POST: async (req, res) => res.status(201).json({ id: await addVault(await getCol(req), req.body) }),
    PATCH: async (req, res) => { await updateVault(await getCol(req), req.query.id, req.body); return res.status(200).json({ ok: true }); },
    DELETE: async (req, res) => { await deleteVault(await getCol(req), req.query.id); return res.status(200).json({ ok: true }); },
  };
}
