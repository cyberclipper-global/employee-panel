// The vault keeps working when the employee Firebase project cannot be used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.AUTH_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const { vaultHandlersWithBackup } = await import('../../lib/server/vault.js');
const { CrmError } = await import('../../lib/crm/errors.js');

// Minimal in-memory stand-in for a Firestore collection.
function memCol(broken = false) {
  const docs = new Map();
  let n = 0;
  const fail = () => { if (broken) { const e = new Error('5 NOT_FOUND: database (default) does not exist'); e.code = 5; throw e; } };
  const snap = () => ({ docs: [...docs].map(([id, d]) => ({ id, data: () => d, ref: { update: async (u) => docs.set(id, { ...d, ...u }) } })) });
  const col = {
    docs,
    orderBy: () => col,
    limit: () => ({ get: async () => { fail(); return snap(); } }),
    add: async (d) => { fail(); const id = `id${++n}`; docs.set(id, d); return { id }; },
    doc: (id) => ({
      get: async () => { fail(); return { exists: docs.has(id), data: () => docs.get(id) }; },
      update: async (u) => { fail(); docs.set(id, { ...docs.get(id), ...u }); },
      delete: async () => { fail(); docs.delete(id); },
    }),
  };
  return col;
}

const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('primary store down: add, list, update and delete use the backup', async () => {
  const backup = memCol();
  const h = vaultHandlersWithBackup(async () => memCol(true), async () => backup, { label: 'test' });
  const r1 = await h.POST({ body: { title: 'Bank', password: 'S3cret!' }, query: {} }, res());
  assert.equal(r1.code, 201);
  assert.equal(backup.docs.size, 1);
  const stored = [...backup.docs.values()][0];
  assert.ok(stored.passwordEnc && !stored.password, 'stored encrypted');
  const r2 = await h.GET({ query: {} }, res());
  assert.equal(r2.body.items.length, 1);
  assert.equal(r2.body.items[0].password, 'S3cret!');
  await h.PATCH({ query: { id: r1.body.id }, body: { title: 'Bank 2' } }, res());
  assert.equal([...backup.docs.values()][0].title, 'Bank 2');
  await h.DELETE({ query: { id: r1.body.id } }, res());
  assert.equal(backup.docs.size, 0);
});

test('primary store missing its service account: backup is used', async () => {
  const backup = memCol();
  const h = vaultHandlersWithBackup(async () => { throw new CrmError(500, 'EMPLOYEE_SERVICE_ACCOUNT is not configured', 'not_configured'); }, async () => backup);
  await h.POST({ body: { title: 'Mail', password: 'x1' }, query: {} }, res());
  assert.equal((await h.GET({ query: {} }, res())).body.items.length, 1);
});

test('both stores working: entries from both are listed, new ones go to the primary', async () => {
  const primary = memCol();
  const backup = memCol();
  backup.docs.set('old', { title: 'Saved during outage', createdAt: '2026-01-01' });
  const h = vaultHandlersWithBackup(async () => primary, async () => backup);
  await h.POST({ body: { title: 'New', password: 'p' }, query: {} }, res());
  assert.equal(primary.docs.size, 1);
  assert.equal((await h.GET({ query: {} }, res())).body.items.length, 2);
});

test('both stores down: a clear 503 error, and validation errors are not hidden', async () => {
  const h = vaultHandlersWithBackup(async () => memCol(true), async () => memCol(true));
  await assert.rejects(h.GET({ query: {} }, res()), (e) => e.status === 503 && /cannot be loaded/.test(e.message));
  const ok = vaultHandlersWithBackup(async () => memCol(), async () => memCol());
  await assert.rejects(ok.POST({ body: { title: 'No password' }, query: {} }, res()), (e) => e.status === 400);
});
