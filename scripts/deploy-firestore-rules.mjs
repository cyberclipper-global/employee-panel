// Publishes firebase/firestore.rules to the employee Firebase project using
// EMPLOYEE_SERVICE_ACCOUNT (no Firebase CLI needed).
//
//   EMPLOYEE_SERVICE_ACCOUNT='<json>' node scripts/deploy-firestore-rules.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const envVar = process.env.SERVICE_ACCOUNT_ENV || 'EMPLOYEE_SERVICE_ACCOUNT';
const raw = process.env[envVar];
if (!raw) {
  console.error(`${envVar} is not set`);
  process.exit(1);
}
const sa = JSON.parse(raw);
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firebase', 'firestore.rules');
const source = fs.readFileSync(file, 'utf8');
const ruleset = await getSecurityRules(app).releaseFirestoreRulesetFromSource(source);
console.log(`Published Firestore rules to ${sa.project_id} (ruleset ${ruleset.name}).`);
