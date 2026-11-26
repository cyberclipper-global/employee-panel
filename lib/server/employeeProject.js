// firebase-admin access to the employee panel's own Firebase project
// (see lib/firebaseProject.js), used for Firebase Auth custom tokens and for
// server-side reads/writes that used to happen through the browser SDK.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { CrmError } from '../crm/errors';
import { EMPLOYEE_FIREBASE_PROJECT_ID } from '../firebaseProject';

const APP_NAME = 'employee-project';
let db = null;

export function getEmployeeApp() {
  let app = getApps().find((a) => a.name === APP_NAME);
  if (app) return app;
  const raw = process.env.EMPLOYEE_SERVICE_ACCOUNT;
  if (!raw) throw new CrmError(500, 'EMPLOYEE_SERVICE_ACCOUNT is not configured', 'not_configured');
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new CrmError(500, 'EMPLOYEE_SERVICE_ACCOUNT is not valid JSON', 'not_configured'); }
  // The browser signs in to EMPLOYEE_FIREBASE_PROJECT_ID; tokens and data
  // must come from the same project.
  if (sa.project_id !== EMPLOYEE_FIREBASE_PROJECT_ID) {
    throw new CrmError(500, `EMPLOYEE_SERVICE_ACCOUNT is for project "${sa.project_id}", but the employee panel uses "${EMPLOYEE_FIREBASE_PROJECT_ID}". Put the ${EMPLOYEE_FIREBASE_PROJECT_ID} service-account JSON in Vercel.`, 'wrong_project');
  }
  app = initializeApp({ credential: cert(sa), projectId: sa.project_id }, APP_NAME);
  return app;
}

export function getEmployeeDb() {
  if (!db) {
    db = getFirestore(getEmployeeApp());
    try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already set */ }
  }
  return db;
}

export const getEmployeeAuth = () => getAuth(getEmployeeApp());
