// Building blocks shared by the admin lead drawer and the employee lead view.
import React, { useState } from 'react';
import { Button, Field, inputClass, toLocalInput, formatDateTime, Badge, EmptyState, CallStatusBadge, useToast } from './ui';
import { formatDuration, outcomeLabel } from '../../lib/crm/constants';

export function NoteComposer({ onSubmit, allowAdminOnly = false }) {
  const [text, setText] = useState('');
  const [adminOnly, setAdminOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onSubmit(text.trim(), adminOnly);
      setText('');
      setAdminOnly(false);
      toast('Note added');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="mb-5 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <textarea className={inputClass} rows={2} placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} aria-label="Note" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {allowAdminOnly ? (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} /> Internal (hidden from employee)
          </label>
        ) : <span />}
        <Button type="submit" size="sm" loading={saving} disabled={!text.trim()}>Add note</Button>
      </div>
    </form>
  );
}

export function FollowupScheduler({ onSubmit, compact }) {
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    if (!dueAt) return;
    setSaving(true);
    try {
      await onSubmit(new Date(dueAt).toISOString(), note.trim());
      setDueAt('');
      setNote('');
      toast('Follow-up scheduled');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className={compact ? 'grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end' : 'mb-5 grid gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end'}>
      <Field label="Follow-up date & time"><input type="datetime-local" className={inputClass} min={toLocalInput(new Date())} value={dueAt} onChange={(e) => setDueAt(e.target.value)} required /></Field>
      <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What to discuss" /></Field>
      <Button type="submit" loading={saving} disabled={!dueAt}>Schedule</Button>
    </form>
  );
}

export function FollowupList({ followups, onUpdate, showLead, onOpenLead }) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  if (!followups?.length) return <EmptyState title="No follow-ups" description="Scheduled follow-ups will appear here." />;
  const act = async (f, action) => {
    let note = '';
    if (action === 'complete') {
      note = window.prompt('Completion note (optional)') ?? null;
      if (note === null) return;
    }
    setBusy(f.id);
    try {
      await onUpdate(f.id, action, note);
      toast(action === 'complete' ? 'Follow-up completed' : 'Follow-up cancelled');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="divide-y rounded-xl border border-gray-100 bg-white shadow-sm divide-gray-100">
      {followups.map((f) => (
        <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">{formatDateTime(f.dueAt)}</span>
              {f.status === 'pending' && (f.overdue ? <Badge className="bg-red-50 text-red-700 ring-red-200">Overdue</Badge> : <Badge className="bg-purple-50 text-purple-700 ring-purple-200">Pending</Badge>)}
              {f.status === 'completed' && <Badge className="bg-green-50 text-green-700 ring-green-200">Completed</Badge>}
              {f.status === 'cancelled' && <Badge className="bg-gray-100 text-gray-600 ring-gray-200">Cancelled</Badge>}
            </div>
            {showLead && (
              <button type="button" className="mt-0.5 text-sm font-medium text-[#10784b] hover:underline" onClick={() => onOpenLead?.(f.leadId)}>{f.leadName || 'Open lead'}</button>
            )}
            {f.note && <p className="mt-0.5 text-sm text-gray-600">{f.note}</p>}
            <div className="text-xs text-gray-400">
              {showLead && f.assignedToName ? `${f.assignedToName} · ` : ''}
              {f.createdBy ? `scheduled by ${f.createdBy.name}` : ''}
              {f.completedBy ? ` · ${f.status} by ${f.completedBy.name} ${formatDateTime(f.completedAt)}` : ''}
            </div>
            {f.completionNote && <p className="text-xs text-gray-500">“{f.completionNote}”</p>}
          </div>
          {f.status === 'pending' && onUpdate && (
            <div className="flex gap-2">
              <Button size="sm" variant="subtle" loading={busy === f.id} onClick={() => act(f, 'complete')}>Mark done</Button>
              <Button size="sm" variant="ghost" disabled={busy === f.id} onClick={() => act(f, 'cancel')}>Cancel</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CallList({ calls, showEmployee, showLead, onOpenLead }) {
  if (!calls?.length) return <EmptyState title="No calls yet" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-[#f7faf7] text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Started</th>
            {showLead && <th className="px-3 py-2">Lead</th>}
            {showEmployee && <th className="px-3 py-2">Employee</th>}
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id} className="border-t align-top border-gray-200">
              <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDateTime(c.startedAt)}</td>
              {showLead && (
                <td className="px-3 py-2">
                  <button type="button" className="font-medium text-[#10784b] hover:underline" onClick={() => onOpenLead?.(c.leadId)}>{c.leadName || '—'}</button>
                </td>
              )}
              {showEmployee && <td className="px-3 py-2 text-gray-700">{c.employeeName}</td>}
              <td className="px-3 py-2">
                <CallStatusBadge value={c.status} />
                {c.failureReason && c.status !== 'completed' && <div className="mt-0.5 text-xs text-gray-500">{c.failureReason}</div>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-gray-700">{c.status === 'completed' ? formatDuration(c.durationSec) : '—'}</td>
              <td className="px-3 py-2 text-gray-700">
                {c.outcome ? outcomeLabel(c.outcome) : '—'}
                {c.outcomeNote && <div className="text-xs text-gray-500">{c.outcomeNote}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InfoGrid({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-gray-800">{value || value === 0 ? value : '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
