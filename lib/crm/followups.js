// Follow-up scheduling shared by admin and employee APIs.
import { badRequest, notFound } from './errors';
import { refs, getCrmDb, FieldValue, Timestamp } from './firestore';
import { addActivity, parseDate, serializeFollowup } from './leads';

function formatWhen(ts) {
  return ts.toDate().toLocaleString('en-IN', { timeZone: process.env.CRM_TIMEZONE || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

// Keeps lead.nextFollowUpAt equal to the earliest pending follow-up.
export async function refreshNextFollowUp(companyId, leadId) {
  const snap = await refs
    .followups(companyId)
    .where('leadId', '==', leadId)
    .where('status', '==', 'pending')
    .orderBy('dueAt', 'asc')
    .limit(1)
    .get();
  const next = snap.empty ? null : snap.docs[0].get('dueAt');
  await refs.lead(companyId, leadId).update({ nextFollowUpAt: next });
}

export async function scheduleFollowup(companyId, leadSnap, { dueAt, note }, actor) {
  const due = parseDate(dueAt, 'Follow-up date');
  if (!due) throw badRequest('Follow-up date and time is required');
  if (due.toMillis() < Date.now() - 5 * 60 * 1000) throw badRequest('Follow-up time must be in the future');
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
  const db = getCrmDb();
  const ref = refs.followups(companyId).doc();
  const lead = leadSnap.data();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      leadId: leadSnap.id,
      leadName: lead.fullName || '',
      assignedTo: lead.assignedTo || null,
      assignedToName: lead.assignedToName || null,
      dueAt: due,
      note: cleanNote,
      status: 'pending',
      createdBy: { type: actor.type, id: actor.id, name: actor.name },
      createdAt: FieldValue.serverTimestamp(),
    });
    const current = lead.nextFollowUpAt;
    if (!current || current.toMillis() > due.toMillis()) {
      tx.update(leadSnap.ref, { nextFollowUpAt: due, updatedAt: FieldValue.serverTimestamp() });
    }
    addActivity(tx, companyId, leadSnap.id, {
      type: 'followup_scheduled',
      description: `Follow-up scheduled for ${formatWhen(due)}${cleanNote ? `: ${cleanNote}` : ''}`,
      actor,
      meta: { followupId: ref.id },
    });
  });
  return serializeFollowup(await ref.get());
}

export async function updateFollowup(companyId, followupId, { action, note }, actor, { employeeId } = {}) {
  if (!['complete', 'cancel'].includes(action)) throw badRequest('Action must be complete or cancel');
  const ref = refs.followups(companyId).doc(String(followupId || '').slice(0, 128) || 'x');
  const db = getCrmDb();
  let leadId;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('Follow-up not found');
    const f = snap.data();
    leadId = f.leadId;
    const leadSnap = await tx.get(refs.lead(companyId, f.leadId));
    if (employeeId && (!leadSnap.exists || leadSnap.get('assignedTo') !== employeeId)) throw notFound('Follow-up not found');
    if (f.status !== 'pending') throw badRequest('This follow-up is already closed');
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
    tx.update(ref, {
      status: action === 'complete' ? 'completed' : 'cancelled',
      completedAt: FieldValue.serverTimestamp(),
      completedBy: { type: actor.type, id: actor.id, name: actor.name },
      completionNote: cleanNote,
    });
    if (leadSnap.exists) {
      addActivity(tx, companyId, f.leadId, {
        type: action === 'complete' ? 'followup_completed' : 'followup_cancelled',
        description: `${action === 'complete' ? 'Follow-up completed' : 'Follow-up cancelled'}${cleanNote ? `: ${cleanNote}` : ''}`,
        actor,
        meta: { followupId: ref.id },
      });
      if (action === 'complete') tx.update(leadSnap.ref, { lastContactedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
  });
  await refreshNextFollowUp(companyId, leadId).catch(() => {});
  return serializeFollowup(await ref.get());
}

// view: 'pending' (default, includes overdue), 'overdue', 'completed'
export async function listFollowups(companyId, { assignedTo, view = 'pending', limit = 50 }) {
  const size = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  let q = refs.followups(companyId);
  if (assignedTo) q = q.where('assignedTo', '==', assignedTo);
  if (view === 'completed') {
    q = q.where('status', '==', 'completed').orderBy('completedAt', 'desc');
  } else {
    q = q.where('status', '==', 'pending');
    if (view === 'overdue') q = q.where('dueAt', '<', Timestamp.now());
    q = q.orderBy('dueAt', 'asc');
  }
  const snap = await q.limit(size).get();
  return snap.docs.map(serializeFollowup);
}

export async function followupCounts(companyId, assignedTo) {
  let base = refs.followups(companyId).where('status', '==', 'pending');
  if (assignedTo) base = refs.followups(companyId).where('assignedTo', '==', assignedTo).where('status', '==', 'pending');
  const [pending, overdue] = await Promise.all([
    base.count().get(),
    base.where('dueAt', '<', Timestamp.now()).count().get(),
  ]);
  return { pending: pending.data().count, overdue: overdue.data().count };
}

// Moves open follow-ups along with a lead when it is reassigned.
export async function reassignPendingFollowups(companyId, leadId, assignee) {
  const snap = await refs.followups(companyId).where('leadId', '==', leadId).where('status', '==', 'pending').get();
  if (snap.empty) return;
  const batch = getCrmDb().batch();
  snap.docs.forEach((d) => batch.update(d.ref, { assignedTo: assignee ? assignee.id : null, assignedToName: assignee ? assignee.name : null }));
  await batch.commit();
}
