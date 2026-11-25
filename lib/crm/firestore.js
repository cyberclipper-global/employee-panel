// Server-only access to the CRM data store.
//
// The CRM collections live in the admin panel Firestore project (the same
// project ADMIN_SERVICE_ACCOUNT points to, which both the admin panel and the
// employee panel already use for employees, tasks and DWR). They are only ever
// read and written through firebase-admin on the server, so Firestore security
// rules can deny all browser access to them (see docs/CRM_SETUP.md).
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, AggregateField } from 'firebase-admin/firestore';
import { CrmError } from './errors';

const APP_NAME = 'crm-admin-db';
let cachedDb = null;

export function getCrmDb() {
  if (cachedDb) return cachedDb;
  let app = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    const raw = process.env.ADMIN_SERVICE_ACCOUNT;
    if (!raw) throw new CrmError(500, 'CRM database is not configured (ADMIN_SERVICE_ACCOUNT is missing)', 'not_configured');
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new CrmError(500, 'ADMIN_SERVICE_ACCOUNT is not valid JSON', 'not_configured');
    }
    app = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }, APP_NAME);
  }
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() can only be called once per instance; ignore on hot reload.
  }
  cachedDb = db;
  return db;
}

const company = (companyId) => getCrmDb().collection('users').doc(companyId);

export const refs = {
  company,
  employees: (cid) => company(cid).collection('employees'),
  leads: (cid) => company(cid).collection('crmLeads'),
  lead: (cid, leadId) => company(cid).collection('crmLeads').doc(leadId),
  activities: (cid, leadId) => company(cid).collection('crmLeads').doc(leadId).collection('activities'),
  phoneIndex: (cid, phoneHash) => company(cid).collection('crmPhoneIndex').doc(phoneHash),
  followups: (cid) => company(cid).collection('crmFollowups'),
  calls: (cid) => company(cid).collection('crmCalls'),
  settings: (cid) => company(cid).collection('crmSettings').doc('config'),
  activeCall: (cid, employeeId) => company(cid).collection('crmActiveCalls').doc(employeeId),
  // Top-level lookups used by Plivo webhooks, which arrive without a company context.
  callToken: (tokenHash) => getCrmDb().collection('crmCallTokens').doc(tokenHash),
  callIndex: (callUuid) => getCrmDb().collection('crmCallIndex').doc(callUuid),
};

export { FieldValue, Timestamp, AggregateField };

export function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// Firestore rejects some queries until a composite index exists. Surface the
// console link (it only contains the project id) so an admin can create it.
export function indexErrorLink(err) {
  if (!err || (err.code !== 9 && err.code !== 'failed-precondition')) return null;
  const m = String(err.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/);
  return m ? m[0] : null;
}
