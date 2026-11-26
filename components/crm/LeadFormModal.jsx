import React, { useEffect, useState } from 'react';
import { Modal, Button, Field, inputClass, toLocalInput } from './ui';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCES } from '../../lib/crm/constants';

const EMPTY = { fullName: '', phone: '', email: '', companyName: '', location: '', source: '', product: '', status: 'new', priority: 'warm', assignedTo: '', additionalInfo: '', followUpAt: '', followUpNote: '' };

// Create or edit a lead. `onSubmit(payload)` must return a promise.
export default function LeadFormModal({ open, onClose, lead, employees = [], onSubmit, showAssignment = true, showPhone = true }) {
  const [form, setForm] = useState(EMPTY);
  const [customRows, setCustomRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (lead) {
      setForm({ ...EMPTY, ...lead, phone: lead.phone || '', assignedTo: lead.assignedTo || '', followUpAt: '', followUpNote: '' });
      setCustomRows(Object.entries(lead.customFields || {}).map(([key, value]) => ({ key, value })));
    } else {
      setForm(EMPTY);
      setCustomRows([]);
    }
  }, [open, lead]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!form.fullName.trim()) return setError('Full name is required');
    if (showPhone && !lead && !form.phone.trim()) return setError('Mobile number is required');
    const customFields = {};
    customRows.forEach(({ key, value }) => { if (key.trim()) customFields[key.trim()] = value; });
    const payload = {
      fullName: form.fullName, email: form.email, companyName: form.companyName, location: form.location,
      source: form.source, product: form.product, status: form.status, priority: form.priority,
      additionalInfo: form.additionalInfo, customFields,
    };
    if (showPhone && (form.phone || '').trim() && form.phone !== lead?.phone) payload.phone = form.phone.trim();
    if (showAssignment) payload.assignedTo = form.assignedTo || null;
    if (!lead && form.followUpAt) {
      payload.followUpAt = new Date(form.followUpAt).toISOString();
      payload.followUpNote = form.followUpNote;
    }
    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={lead ? 'Edit lead' : 'Add lead'}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{lead ? 'Save changes' : 'Create lead'}</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <Field label="Full name" required><input className={inputClass} value={form.fullName} onChange={set('fullName')} maxLength={120} autoFocus /></Field>
        {showPhone && (
          <Field label="Mobile number" required={!lead} hint="10-digit Indian number or full number with +country code">
            <input className={inputClass} value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={20} autoComplete="off" />
          </Field>
        )}
        <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={set('email')} maxLength={254} /></Field>
        <Field label="Company name"><input className={inputClass} value={form.companyName} onChange={set('companyName')} maxLength={160} /></Field>
        <Field label="Location"><input className={inputClass} value={form.location} onChange={set('location')} maxLength={160} /></Field>
        <Field label="Lead source">
          <input className={inputClass} list="crm-lead-sources" value={form.source} onChange={set('source')} maxLength={80} />
          <datalist id="crm-lead-sources">{LEAD_SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Interested product / service"><input className={inputClass} value={form.product} onChange={set('product')} maxLength={160} /></Field>
        <Field label="Status">
          <select className={inputClass} value={form.status} onChange={set('status')}>{LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={form.priority} onChange={set('priority')}>{LEAD_PRIORITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </Field>
        {showAssignment && (
          <Field label="Assigned employee">
            <select className={inputClass} value={form.assignedTo} onChange={set('assignedTo')}>
              <option value="">Unassigned</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.role ? ` — ${e.role}` : ''}</option>)}
            </select>
          </Field>
        )}
        {!lead && (
          <>
            <Field label="Follow-up date & time"><input className={inputClass} type="datetime-local" min={toLocalInput(new Date())} value={form.followUpAt} onChange={set('followUpAt')} /></Field>
            <Field label="Follow-up note"><input className={inputClass} value={form.followUpNote} onChange={set('followUpNote')} maxLength={2000} /></Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="Additional information"><textarea className={inputClass} rows={3} value={form.additionalInfo} onChange={set('additionalInfo')} maxLength={5000} /></Field>
        </div>
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Custom fields</span>
            <Button size="sm" variant="ghost" onClick={() => setCustomRows((r) => [...r, { key: '', value: '' }])} disabled={customRows.length >= 30}>+ Add field</Button>
          </div>
          {customRows.map((row, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className={inputClass} placeholder="Field name" value={row.key} maxLength={60} onChange={(e) => setCustomRows((r) => r.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <input className={inputClass} placeholder="Value" value={row.value} maxLength={1000} onChange={(e) => setCustomRows((r) => r.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setCustomRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove field">✕</Button>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
