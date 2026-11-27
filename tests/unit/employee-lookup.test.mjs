// Employee email lookup keeps working before the collection-group index exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { _searchEmployeesForTest: search } = await import('../../lib/auth/employee.js');

function fakeDb({ groupError, companies }) {
  const query = (docs) => ({ where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: docs.filter((d) => d.data()[f] === v) }) }) }) });
  return {
    collectionGroup: () => ({ where: () => ({ limit: () => ({ get: async () => { if (groupError) throw groupError; return { docs: [] }; } }) }) }),
    collection: () => ({
      listDocuments: async () => Object.entries(companies).map(([cid, emps]) => ({
        id: cid,
        collection: () => query(emps.map(([id, data]) => ({ id, data: () => data }))),
      })),
    }),
  };
}

test('falls back to per-company search when the index is missing', async () => {
  const err = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index'), { code: 9 });
  const db = fakeDb({ groupError: err, companies: { c1: [['e1', { email: 'a@b.co' }], ['e2', { email: 'x@y.co' }]], c2: [['e9', { emailLower: 'a@b.co' }]] } });
  const docs = await search(db, 'a@b.co');
  assert.deepEqual(docs.map((d) => d.id).sort(), ['e1', 'e9']);
});

test('other errors are not hidden', async () => {
  const db = fakeDb({ groupError: Object.assign(new Error('permission denied'), { code: 7 }), companies: {} });
  await assert.rejects(() => search(db, 'a@b.co'), /permission denied/);
});

test('sign-in lookup still works when the employee project is broken', async () => {
  const { _findInForTest: findIn } = await import('../../lib/auth/employee.js');
  const docRef = (cid) => ({ parent: { parent: { id: cid, parent: { id: 'users', parent: null } } } });
  const adminDb = {
    collectionGroup: () => ({ where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: f === 'email' && v === 'a@b.co' ? [{ id: 'e1', ref: docRef('c1'), data: () => ({ email: 'a@b.co', firstName: 'A' }) }] : [] }) }) }) }),
  };
  for (const broken of [
    () => { throw Object.assign(new Error('5 NOT_FOUND: The database (default) does not exist'), { code: 5 }); },
    () => ({ collectionGroup: () => ({ where: () => ({ limit: () => ({ get: async () => { throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 }); } }) }) }) }),
  ]) {
    const found = await findIn(adminDb, broken, 'a@b.co');
    assert.equal(found.length, 1);
    assert.equal(found[0].employeeId, 'e1');
    assert.equal(found[0].companyId, 'c1');
  }
});
