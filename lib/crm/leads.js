// Lead validation, serialisation and querying shared by the admin and
// employee APIs. Serialisers use explicit allowlists so encrypted phone data
// never leaves the server by accident.
import { badRequest, notFound, conflict, forbidden } from './errors';
import { refs, getCrmDb, FieldValue, Timestamp, toIso } from './firestore';
import { protectPhone, decryptPhone } from './phone';
import { LEAD_STATUSES, LEAD_PRIORITIES, ACTIVITY_TYPES } from './constants';

const STATUS_SET = new Set(LEAD_STATUSES.map((s) => s.value));
const PRIORITY_SET = new Set(LEAD_PRIORITIES.map((s) => s.value));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(value, field, max, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`${field} must be text`);
  const s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return s;
}

export function parseDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${field} is not a valid date`);
  return Timestamp.fromMillis(ms);
}

export function normalizeStatus(value) {
  if (value === undefined) return undefined;
  const v = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!STATUS_SET.has(v)) throw badRequest('Status is not valid');
  return v;
}

export function normalizePriority(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 'warm';
  const v = String(value).trim().toLowerCase();
  if (!PRIORITY_SET.has(v)) throw badRequest('Priority is not valid');
  return v;
}

function customFields(value) {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('customFields must be an object');
  const out = {};
  const entries = Object.entries(value);
  if (entries.length > 30) throw badRequest('At most 30 custom fields are allowed');
  for (const [k, v] of entries) {
    const key = String(k).trim().slice(0, 60);
    if (!key || /[./]/.test(key)) continue;
    out[key] = str(v, `Custom field "${key}"`, 1000) ?? '';
  }
  return out;
}

// Validates lead fields from a request body. `partial` allows missing fields
// (for updates). Phone is handled separately by the caller.
export function sanitizeLeadFields(body, { partial = false } = {}) {
  const b = body || {};
  const out = {
    fullName: str(b.fullName, 'Full name', 120, { required: !partial }),
    email: str(b.email, 'Email', 254),
    companyName: str(b.companyName, 'Company name', 160),
    location: str(b.location, 'Location', 160),
    source: str(b.source, 'Lead source', 80),
    product: str(b.product, 'Interested product/service', 160),
    additionalInfo: str(b.additionalInfo, 'Additional information', 5000),
    status: normalizeStatus(b.status),
    priority: normalizePriority(b.priority),
    customFields: customFields(b.customFields),
  };
  if (out.email) {
    out.email = out.email.toLowerCase();
    if (!EMAIL_RE.test(out.email)) throw badRequest('Email is not valid');
  }
  if (!partial) {
    out.status = out.status || 'new';
    out.priority = out.priority || 'warm';
  }
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

export function buildSearchKeywords(lead) {
  const tokens = new Set();
  const addWords = (text, prefixes) => {
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}@._-]+/u)
      .filter(Boolean)
      .forEach((word) => {
        const w = word.slice(0, 30);
        tokens.add(w);
        if (prefixes) for (let i = 2; i < Math.min(w.length, 15); i += 1) tokens.add(w.slice(0, i));
      });
  };
  addWords(lead.fullName, true);
  addWords(lead.companyName, true);
  addWords(lead.location, false);
  addWords(lead.product, false);
  if (lead.email) {
    tokens.add(lead.email.toLowerCase());
    addWords(lead.email.split('@')[0], true);
  }
  // Phone digits are deliberately NOT indexed: a search on them would let an
  // employee discover a number digit by digit.
  return Array.from(tokens).slice(0, 150);
}

export function searchToken(term) {
  return String(term || '').toLowerCase().trim().split(/\s+/)[0]?.slice(0, 30) || '';
}

const actorOf = (a) => (a ? { type: a.type, id: a.id, name: a.name || a.id } : { type: 'system', id: 'system', name: 'System' });

// role: 'admin' returns the full phone number; anything else gets the mask only.
export function serializeLead(snap, role) {
  const d = snap.data() || {};
  const lead = {
    id: snap.id,
    fullName: d.fullName || '',
    email: d.email || '',
    companyName: d.companyName || '',
    location: d.location || '',
    source: d.source || '',
    product: d.product || '',
    status: d.status || 'new',
    priority: d.priority || 'warm',
    additionalInfo: d.additionalInfo || '',
    customFields: d.customFields || {},
    assignedTo: d.assignedTo || null,
    assignedToName: d.assignedToName || null,
    assignedAt: toIso(d.assignedAt),
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    createdBy: d.createdBy ? { type: d.createdBy.type, name: d.createdBy.name } : null,
    nextFollowUpAt: toIso(d.nextFollowUpAt),
    lastContactedAt: toIso(d.lastContactedAt),
    lastCallAt: toIso(d.lastCallAt),
    callCount: d.callCount || 0,
    totalCallSeconds: d.totalCallSeconds || 0,
    phoneMasked: d.phoneMasked || null,
    hasPhone: Boolean(d.phoneEnc),
  };
  if (role === 'admin') {
    try {
      lead.phone = d.phoneEnc ? decryptPhone(d.phoneEnc) : null;
    } catch {
      lead.phone = null;
      lead.phoneError = true;
    }
  }
  return lead;
}

export function serializeActivity(snap) {
  const d = snap.data() || {};
  return {
    id: snap.id,
    type: d.type,
    label: ACTIVITY_TYPES[d.type] || d.type,
    description: d.description || '',
    actor: d.actor ? { type: d.actor.type, name: d.actor.name } : null,
    createdAt: toIso(d.createdAt),
    meta: d.meta || {},
    adminOnly: Boolean(d.adminOnly),
  };
}

export function serializeFollowup(snap) {
  const d = snap.data() || {};
  const dueAt = toIso(d.dueAt);
  return {
    id: snap.id,
    leadId: d.leadId,
    leadName: d.leadName || '',
    assignedTo: d.assignedTo || null,
    assignedToName: d.assignedToName || null,
    dueAt,
    note: d.note || '',
    status: d.status,
    overdue: d.status === 'pending' && dueAt ? Date.parse(dueAt) < Date.now() : false,
    createdAt: toIso(d.createdAt),
    createdBy: d.createdBy ? { type: d.createdBy.type, name: d.createdBy.name } : null,
    completedAt: toIso(d.completedAt),
    completedBy: d.completedBy ? { type: d.completedBy.type, name: d.completedBy.name } : null,
    completionNote: d.completionNote || '',
  };
}

export function serializeCall(snap) {
  const d = snap.data() || {};
  return {
    id: snap.id,
    leadId: d.leadId,
    leadName: d.leadName || '',
    employeeId: d.employeeId,
    employeeName: d.employeeName || '',
    status: d.status,
    outcome: d.outcome || null,
    outcomeNote: d.outcomeNote || '',
    startedAt: toIso(d.startedAt || d.createdAt),
    answeredAt: toIso(d.answeredAt),
    endedAt: toIso(d.endedAt),
    durationSec: d.durationSec || 0,
    providerCallUuid: d.providerCallUuid || null,
    failureReason: d.failureReason || null,
    hangupCause: d.hangupCause || null,
    createdAt: toIso(d.createdAt),
  };
}

// Writes an activity entry, inside a transaction/batch when one is given.
export function addActivity(writer, companyId, leadId, { type, description, actor, meta, adminOnly = false }) {
  const ref = refs.activities(companyId, leadId).doc();
  const data = {
    type,
    description: description || ACTIVITY_TYPES[type] || type,
    actor: actorOf(actor),
    meta: meta || {},
    adminOnly: Boolean(adminOnly),
    createdAt: FieldValue.serverTimestamp(),
  };
  if (writer) writer.set(ref, data);
  else return ref.set(data);
  return undefined;
}

export async function getLeadOr404(companyId, leadId) {
  if (!leadId || typeof leadId !== 'string' || leadId.length > 128) throw notFound('Lead not found');
  const snap = await refs.lead(companyId, leadId).get();
  if (!snap.exists) throw notFound('Lead not found');
  return snap;
}

// Employees may only touch leads currently assigned to them. A 404 (not 403)
// avoids confirming that someone else's lead exists.
export async function getEmployeeLeadOr404(companyId, employeeId, leadId) {
  const snap = await getLeadOr404(companyId, leadId);
  if (snap.get('assignedTo') !== employeeId) throw notFound('Lead not found');
  return snap;
}

export async function getEmployeeMap(companyId) {
  const snap = await refs.employees(companyId).get();
  const map = {};
  snap.docs.forEach((doc) => {
    const d = doc.data() || {};
    const name = `${(d.firstName || '').trim()} ${(d.lastName || '').trim()}`.trim() || d.name || d.email || doc.id;
    map[doc.id] = { id: doc.id, name, role: d.role || '', email: d.email || '' };
  });
  return map;
}

export async function getEmployeeSummary(companyId, employeeId) {
  const snap = await refs.employees(companyId).doc(employeeId).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const name = `${(d.firstName || '').trim()} ${(d.lastName || '').trim()}`.trim() || d.name || d.email || employeeId;
  return { id: employeeId, name, role: d.role || '', email: d.email || '' };
}

export async function getCrmSettings(companyId) {
  const snap = await refs.settings(companyId).get();
  const d = snap.exists ? snap.data() : {};
  return {
    allowEmployeeCreate: d.allowEmployeeCreate !== false,
    allowEmployeeDelete: d.allowEmployeeDelete === true,
  };
}

// Creates a lead and its phone-uniqueness record atomically.
export async function createLead(companyId, { fields, phone, assignee, actor, activityType = 'created', extra = {}, allowNoPhone = false }) {
  const db = getCrmDb();
  const noPhone = allowNoPhone && (phone === undefined || phone === null || String(phone).trim() === '');
  const protectedPhone = noPhone ? { phoneEnc: null, phoneHash: null, phoneMasked: null } : protectPhone(phone);
  const leadRef = refs.leads(companyId).doc();
  const indexRef = noPhone ? null : refs.phoneIndex(companyId, protectedPhone.phoneHash);
  const now = FieldValue.serverTimestamp();
  const data = {
    fullName: fields.fullName,
    email: fields.email || '',
    companyName: fields.companyName || '',
    location: fields.location || '',
    source: fields.source || '',
    product: fields.product || '',
    additionalInfo: fields.additionalInfo || '',
    status: fields.status || 'new',
    priority: fields.priority || 'warm',
    customFields: fields.customFields || {},
    phoneEnc: protectedPhone.phoneEnc,
    phoneHash: protectedPhone.phoneHash,
    phoneMasked: protectedPhone.phoneMasked,
    assignedTo: assignee ? assignee.id : null,
    assignedToName: assignee ? assignee.name : null,
    assignedAt: assignee ? now : null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    lastCallAt: null,
    callCount: 0,
    totalCallSeconds: 0,
    createdBy: { type: actor.type, id: actor.id, name: actor.name },
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  data.searchKeywords = buildSearchKeywords(data);

  await db.runTransaction(async (tx) => {
    if (indexRef) {
      const existing = await tx.get(indexRef);
      if (existing.exists) {
        throw conflict('A lead with this mobile number already exists', 'duplicate_phone');
      }
      tx.set(indexRef, { leadId: leadRef.id, createdAt: now });
    }
    tx.set(leadRef, data);
    addActivity(tx, companyId, leadRef.id, {
      type: activityType,
      description: activityType === 'imported' ? `Lead imported by ${actor.name}` : `Lead created by ${actor.name}`,
      meta: extra.legacy ? { migratedFrom: 'employee-panel' } : {},
      actor,
    });
    if (assignee) {
      addActivity(tx, companyId, leadRef.id, {
        type: 'assigned',
        description: `Assigned to ${assignee.name}`,
        actor,
        meta: { to: assignee.id },
      });
    }
  });
  return leadRef.id;
}

// Replaces a lead's phone number, keeping the uniqueness index consistent.
export async function changeLeadPhone(tx, companyId, leadSnap, newPhone) {
  const p = protectPhone(newPhone);
  const oldHash = leadSnap.get('phoneHash');
  if (oldHash === p.phoneHash) return null;
  const newIndex = refs.phoneIndex(companyId, p.phoneHash);
  const existing = await tx.get(newIndex);
  if (existing.exists && existing.get('leadId') !== leadSnap.id) {
    throw conflict('Another lead already uses this mobile number', 'duplicate_phone');
  }
  return {
    apply() {
      if (oldHash) tx.delete(refs.phoneIndex(companyId, oldHash));
      tx.set(newIndex, { leadId: leadSnap.id, createdAt: FieldValue.serverTimestamp() });
    },
    fields: { phoneEnc: p.phoneEnc, phoneHash: p.phoneHash, phoneMasked: p.phoneMasked },
  };
}

export function encodeCursor(id) {
  return id ? Buffer.from(String(id)).toString('base64url') : null;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const id = Buffer.from(String(cursor), 'base64url').toString('utf8');
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// Paginated lead listing. Filters are equality filters so Firestore can serve
// them from the single-field + (field, createdAt) indexes in firestore.indexes.json.
export async function listLeads(companyId, { assignedTo, status, priority, source, search, phoneHash, pageSize = 25, cursor }) {
  let q = refs.leads(companyId);
  if (assignedTo !== undefined) q = q.where('assignedTo', '==', assignedTo);
  if (status) q = q.where('status', '==', status);
  if (priority) q = q.where('priority', '==', priority);
  if (source) q = q.where('source', '==', source);
  if (phoneHash) q = q.where('phoneHash', '==', phoneHash);
  const token = searchToken(search);
  if (token) q = q.where('searchKeywords', 'array-contains', token);

  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  let pageQuery = q.orderBy('createdAt', 'desc').limit(size + 1);
  const cursorId = decodeCursor(cursor);
  if (cursorId) {
    const cursorSnap = await refs.lead(companyId, cursorId).get();
    if (cursorSnap.exists) pageQuery = pageQuery.startAfter(cursorSnap);
  }
  const [pageSnap, countSnap] = await Promise.all([pageQuery.get(), cursor ? Promise.resolve(null) : q.count().get()]);
  const docs = pageSnap.docs.slice(0, size);
  return {
    docs,
    nextCursor: pageSnap.docs.length > size ? encodeCursor(docs[docs.length - 1].id) : null,
    total: countSnap ? countSnap.data().count : undefined,
  };
}

export function assertLeadAccess(leadSnap, employeeId) {
  if (leadSnap.get('assignedTo') !== employeeId) throw forbidden();
}

// Applies an assignment change inside a transaction and logs it.
export function applyAssignment(tx, companyId, leadSnap, assignee, actor) {
  const previous = leadSnap.get('assignedTo') || null;
  const next = assignee ? assignee.id : null;
  if (previous === next) return false;
  tx.update(leadSnap.ref, {
    assignedTo: next,
    assignedToName: assignee ? assignee.name : null,
    assignedAt: assignee ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  let type = 'assigned';
  let description = `Assigned to ${assignee ? assignee.name : ''}`;
  if (!next) {
    type = 'unassigned';
    description = `Unassigned from ${leadSnap.get('assignedToName') || 'employee'}`;
  } else if (previous) {
    type = 'reassigned';
    description = `Reassigned from ${leadSnap.get('assignedToName') || 'previous employee'} to ${assignee.name}`;
  }
  addActivity(tx, companyId, leadSnap.id, { type, description, actor, meta: { from: previous, to: next } });
  return true;
}

export function statusChangeActivity(tx, companyId, leadId, from, to, actor, suffix = '') {
  addActivity(tx, companyId, leadId, {
    type: 'status_changed',
    description: `Status changed from ${LEAD_STATUSES.find((s) => s.value === from)?.label || from || '—'} to ${LEAD_STATUSES.find((s) => s.value === to)?.label || to}${suffix}`,
    actor,
    meta: { from: from || null, to },
  });
}

// Deletes a lead with its phone index, timeline and open follow-ups. Call logs
// are kept for reporting.
export async function deleteLeadCascade(companyId, leadSnap) {
  const db = getCrmDb();
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(leadSnap.ref);
    if (!fresh.exists) return;
    const hash = fresh.get('phoneHash');
    if (hash) {
      const idx = refs.phoneIndex(companyId, hash);
      const idxSnap = await tx.get(idx);
      if (idxSnap.exists && idxSnap.get('leadId') === leadSnap.id) tx.delete(idx);
    }
    tx.delete(leadSnap.ref);
  });
  const writer = db.bulkWriter();
  const acts = await refs.activities(companyId, leadSnap.id).get();
  acts.docs.forEach((d) => writer.delete(d.ref));
  const fups = await refs.followups(companyId).where('leadId', '==', leadSnap.id).get();
  fups.docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
}
