// Call lifecycle: initiation, Plivo webhook handling and finalisation.
// Call records never contain the customer's phone number.
import crypto from 'crypto';
import { conflict, badRequest, notFound } from './errors';
import { refs, getCrmDb, FieldValue, Timestamp } from './firestore';
import { addActivity, getEmployeeLeadOr404, statusChangeActivity } from './leads';
import { decryptPhone } from './phone';
import { FINAL_CALL_STATUSES, formatDuration } from './constants';

const TOKEN_TTL_MS = 2 * 60 * 1000;
const SETUP_LOCK_MS = 3 * 60 * 1000;
const ACTIVE_LOCK_MS = 4 * 60 * 60 * 1000;

export const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export async function initiateCall(session, leadId, identity) {
  const { companyId, employeeId, employee, actor } = session;
  const leadSnap = await getEmployeeLeadOr404(companyId, employeeId, leadId);
  if (!leadSnap.get('phoneEnc')) throw badRequest('This lead has no mobile number. Ask your admin to add one.');
  // Check now that this server can read the number, so the employee gets a
  // clear message instead of a call that silently fails later.
  decryptPhone(leadSnap.get('phoneEnc'));

  const db = getCrmDb();
  const callRef = refs.calls(companyId).doc();
  const lockRef = refs.activeCall(companyId, employeeId);
  const token = crypto.randomBytes(20).toString('hex');
  const tokenRef = refs.callToken(tokenHash(token));
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const [lock, lead] = await Promise.all([tx.get(lockRef), tx.get(leadSnap.ref)]);
    if (!lead.exists || lead.get('assignedTo') !== employeeId) throw notFound('Lead not found');
    if (lock.exists && lock.get('expiresAt')?.toMillis() > now) {
      const activeCall = await tx.get(refs.calls(companyId).doc(lock.get('callId')));
      if (activeCall.exists && !FINAL_CALL_STATUSES.includes(activeCall.get('status'))) {
        throw conflict('You already have a call in progress. End it before starting another.', 'call_in_progress');
      }
    }
    tx.set(callRef, {
      leadId: lead.id,
      leadName: lead.get('fullName') || '',
      employeeId,
      employeeName: employee.name,
      status: 'initiated',
      outcome: null,
      providerCallUuid: null,
      finalized: false,
      durationSec: 0,
      createdAt: FieldValue.serverTimestamp(),
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(tokenRef, {
      companyId,
      callId: callRef.id,
      employeeId,
      leadId: lead.id,
      identity,
      used: false,
      expiresAt: Timestamp.fromMillis(now + TOKEN_TTL_MS),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(lockRef, { callId: callRef.id, expiresAt: Timestamp.fromMillis(now + SETUP_LOCK_MS) });
    addActivity(tx, companyId, lead.id, { type: 'call_initiated', description: `Call started by ${actor.name}`, actor, meta: { callId: callRef.id } });
  });
  return { callId: callRef.id, callToken: token, leadName: leadSnap.get('fullName') || 'Lead' };
}

// Answer URL: turns a valid call token into the real destination number.
// Returns { e164, companyId, callId } or { reject: reason }.
export async function claimCallToken({ token, callUuid, from }) {
  if (!/^[a-f0-9]{40}$/.test(token || '')) return { reject: 'missing_token' };
  const db = getCrmDb();
  const tokenRef = refs.callToken(tokenHash(token));
  let result = null;
  await db.runTransaction(async (tx) => {
    const t = await tx.get(tokenRef);
    if (!t.exists) { result = { reject: 'unknown_token' }; return; }
    const data = t.data();
    if (data.used) { result = { reject: 'token_used' }; return; }
    if (data.expiresAt.toMillis() < Date.now()) { result = { reject: 'token_expired' }; return; }
    // Bind the token to the Plivo identity it was issued for, when Plivo
    // reports it in `From` (sip:<identity>@...).
    if (from && /cc[a-f0-9]{24}/.test(from) && !from.includes(data.identity)) { result = { reject: 'identity_mismatch' }; return; }
    const callRef = refs.calls(data.companyId).doc(data.callId);
    const leadRef = refs.lead(data.companyId, data.leadId);
    const [call, lead] = await Promise.all([tx.get(callRef), tx.get(leadRef)]);
    tx.update(tokenRef, { used: true, usedAt: FieldValue.serverTimestamp(), callUuid: callUuid || null });
    if (!call.exists || call.get('status') !== 'initiated') { result = { reject: 'call_not_pending' }; return; }
    if (!lead.exists || lead.get('assignedTo') !== data.employeeId || !lead.get('phoneEnc')) {
      tx.update(callRef, { status: 'failed', failureReason: 'Lead is no longer assigned to you', finalized: true, endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.delete(refs.activeCall(data.companyId, data.employeeId));
      result = { reject: 'lead_unavailable' };
      return;
    }
    tx.update(callRef, { status: 'ringing', providerCallUuid: callUuid || null, updatedAt: FieldValue.serverTimestamp() });
    if (callUuid) tx.set(refs.callIndex(callUuid), { companyId: data.companyId, callId: data.callId, createdAt: FieldValue.serverTimestamp() });
    tx.set(refs.activeCall(data.companyId, data.employeeId), { callId: data.callId, expiresAt: Timestamp.fromMillis(Date.now() + ACTIVE_LOCK_MS) });
    result = { companyId: data.companyId, callId: data.callId, phoneEnc: lead.get('phoneEnc') };
  });
  if (result.reject) return result;
  return { companyId: result.companyId, callId: result.callId, e164: decryptPhone(result.phoneEnc) };
}

export async function markAnswered(companyId, callId, bLegUuid) {
  const db = getCrmDb();
  const callRef = refs.calls(companyId).doc(callId);
  await db.runTransaction(async (tx) => {
    const call = await tx.get(callRef);
    if (!call.exists || call.get('finalized') || call.get('answeredAt')) return;
    tx.update(callRef, { status: 'in_progress', answeredAt: FieldValue.serverTimestamp(), providerBLegUuid: bLegUuid || null, updatedAt: FieldValue.serverTimestamp() });
    addActivity(tx, companyId, call.get('leadId'), {
      type: 'call_connected',
      description: `Call connected (${call.get('employeeName')})`,
      actor: { type: 'employee', id: call.get('employeeId'), name: call.get('employeeName') },
      meta: { callId },
    });
  });
}

const FAILURE_TEXT = {
  busy: 'Customer was busy',
  no_answer: 'No answer',
  failed: 'Call could not be connected',
  cancelled: 'Call cancelled before it connected',
};

// Idempotent: the first webhook (or manual hangup) to arrive wins.
export async function finalizeCall(companyId, callId, { status, durationSec = 0, hangupCause, failureReason, bLegUuid }) {
  const db = getCrmDb();
  const callRef = refs.calls(companyId).doc(callId);
  await db.runTransaction(async (tx) => {
    const call = await tx.get(callRef);
    if (!call.exists || call.get('finalized')) return;
    const leadRef = refs.lead(companyId, call.get('leadId'));
    const lockRef = refs.activeCall(companyId, call.get('employeeId'));
    const [lead, lock] = await Promise.all([tx.get(leadRef), tx.get(lockRef)]);
    let finalStatus = status;
    let seconds = Math.max(0, Math.round(Number(durationSec) || 0));
    if (finalStatus === 'completed' && !call.get('answeredAt') && seconds === 0) finalStatus = 'no_answer';
    if (finalStatus === 'completed' && seconds === 0 && call.get('answeredAt')) {
      seconds = Math.max(0, Math.round((Date.now() - call.get('answeredAt').toMillis()) / 1000));
    }
    const actor = { type: 'employee', id: call.get('employeeId'), name: call.get('employeeName') };
    tx.update(callRef, {
      status: finalStatus,
      durationSec: finalStatus === 'completed' ? seconds : 0,
      hangupCause: hangupCause ? String(hangupCause).slice(0, 120) : null,
      failureReason: finalStatus === 'completed' ? null : (failureReason || FAILURE_TEXT[finalStatus] || 'Call ended'),
      providerBLegUuid: bLegUuid || call.get('providerBLegUuid') || null,
      finalized: true,
      endedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (lock.exists && lock.get('callId') === callId) tx.delete(lockRef);
    if (!lead.exists) return;
    const leadUpdate = {
      callCount: FieldValue.increment(1),
      lastCallAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (finalStatus === 'completed') {
      leadUpdate.totalCallSeconds = FieldValue.increment(seconds);
      leadUpdate.lastContactedAt = FieldValue.serverTimestamp();
      if (lead.get('status') === 'new') {
        leadUpdate.status = 'contacted';
        statusChangeActivity(tx, companyId, lead.id, 'new', 'contacted', actor, ' after a connected call');
      }
      addActivity(tx, companyId, lead.id, { type: 'call_ended', description: `Call ended after ${formatDuration(seconds)}`, actor, meta: { callId, durationSec: seconds } });
    } else {
      addActivity(tx, companyId, lead.id, { type: 'call_failed', description: `Call not connected: ${failureReason || FAILURE_TEXT[finalStatus] || finalStatus}`, actor, meta: { callId, status: finalStatus } });
    }
    tx.update(leadRef, leadUpdate);
  });
}

// Maps Plivo's DialStatus to our call status.
export function mapDialStatus(dialStatus) {
  switch (String(dialStatus || '').toLowerCase()) {
    case 'completed': return 'completed';
    case 'busy': return 'busy';
    case 'no-answer':
    case 'timeout': return 'no_answer';
    case 'cancel':
    case 'cancelled': return 'cancelled';
    default: return 'failed';
  }
}

export async function getEmployeeCallOr404(companyId, employeeId, callId) {
  if (!callId || typeof callId !== 'string' || callId.length > 128) throw notFound('Call not found');
  const snap = await refs.calls(companyId).doc(callId).get();
  if (!snap.exists || snap.get('employeeId') !== employeeId) throw notFound('Call not found');
  return snap;
}
