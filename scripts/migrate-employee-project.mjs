// Copies every Firestore document (all collections and sub-collections)
// from the OLD employee Firebase project to the NEW one.
//
//   OLD_EMPLOYEE_SERVICE_ACCOUNT='<json of employee-panel-7a54c>' \
//   EMPLOYEE_SERVICE_ACCOUNT='<json of employee-27679>' \
//   node scripts/migrate-employee-project.mjs            # copy
//   DRY_RUN=1 node scripts/migrate-employee-project.mjs  # only count
//
// Safe to run more than once: documents that already exist in the new
// project are NOT overwritten (so nothing written after the switch is lost).
// The old project is only read, never changed.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, DocumentReference } from 'firebase-admin/firestore';

function open(name, envVar) {
  const raw = process.env[envVar];
  if (!raw) {
    console.error(`${envVar} is not set`);
    process.exit(1);
  }
  const sa = JSON.parse(raw);
  return { db: getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }, name)), projectId: sa.project_id };
}

const src = open('source', 'OLD_EMPLOYEE_SERVICE_ACCOUNT');
const dst = open('target', 'EMPLOYEE_SERVICE_ACCOUNT');
const dryRun = process.env.DRY_RUN === '1';
if (src.projectId === dst.projectId) {
  console.error(`Source and target are the same project (${src.projectId}). Nothing to do.`);
  process.exit(1);
}
console.log(`${dryRun ? '[DRY RUN] ' : ''}Copying ${src.projectId} -> ${dst.projectId}`);

// Document references stored inside documents must point at the new project.
function convert(value) {
  if (value instanceof DocumentReference) return dst.db.doc(value.path);
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
  }
  return value;
}

const stats = { copied: 0, skippedExisting: 0, failed: 0, collections: 0 };
const writer = dryRun ? null : dst.db.bulkWriter();
if (writer) {
  writer.onWriteError((err) => {
    if (err.code === 6) { stats.skippedExisting += 1; return false; } // ALREADY_EXISTS
    if (err.failedAttempts < 3) return true;
    stats.failed += 1;
    console.error(`  failed: ${err.documentRef.path}: ${err.message}`);
    return false;
  });
  writer.onWriteResult(() => { stats.copied += 1; });
}

async function copyCollection(col) {
  stats.collections += 1;
  // listDocuments also returns "missing" parents that only hold sub-collections.
  const refs = await col.listDocuments();
  for (let i = 0; i < refs.length; i += 300) {
    const chunk = refs.slice(i, i + 300);
    const snaps = await src.db.getAll(...chunk);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      if (dryRun) stats.copied += 1;
      else writer.create(dst.db.doc(snap.ref.path), convert(snap.data()));
    }
  }
  for (const ref of refs) {
    for (const sub of await ref.listCollections()) await copyCollection(sub);
  }
}

for (const col of await src.db.listCollections()) {
  console.log(`- ${col.id}`);
  await copyCollection(col);
}
if (writer) await writer.close();
console.log(dryRun
  ? `Would copy ${stats.copied} documents in ${stats.collections} collections.`
  : `Done: ${stats.copied} copied, ${stats.skippedExisting} already existed (kept), ${stats.failed} failed, ${stats.collections} collections.`);
process.exit(stats.failed ? 1 : 0);
