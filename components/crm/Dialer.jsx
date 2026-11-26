import React, { useEffect, useState } from 'react';
import { Button, Field, inputClass, toLocalInput, useToast, cx } from './ui';
import usePlivoDialer from './usePlivoDialer';
import { crmFetch } from '../../utils/crmClient';
import { CALL_OUTCOMES, LEAD_STATUSES, formatDuration } from '../../lib/crm/constants';

const STATUS_TEXT = {
  idle: 'Ready to call',
  preparing: 'Preparing…',
  connecting: 'Connecting…',
  ringing: 'Ringing…',
  connected: 'Connected',
  ending: 'Ending call…',
  ended: 'Call ended',
  failed: 'Call failed',
};

const OUTCOME_STATUS = { interested: 'interested', not_interested: 'not_interested', converted: 'converted', callback: 'follow_up' };

function OutcomeForm({ callId, lead, onSaved, onSkip }) {
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [leadStatus, setLeadStatus] = useState(lead.status);
  const [followUpAt, setFollowUpAt] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => { if (OUTCOME_STATUS[outcome]) setLeadStatus(OUTCOME_STATUS[outcome]); }, [outcome]);

  const save = async (e) => {
    e.preventDefault();
    if (!outcome) return setError('Choose what happened on the call');
    setSaving(true);
    setError('');
    try {
      await crmFetch(`/api/crm/calls/${encodeURIComponent(callId)}/outcome`, {
        method: 'POST',
        body: {
          outcome, note,
          leadStatus: leadStatus !== lead.status ? leadStatus : undefined,
          followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
          followUpNote,
        },
      });
      toast('Call outcome saved');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-3 text-left sm:grid-cols-2">
      <div className="sm:col-span-2 text-sm font-semibold">How did the call go?</div>
      {error && <div className="sm:col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Field label="Outcome" required>
        <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Select…</option>{CALL_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Lead status">
        <select className={inputClass} value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
          {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2"><Field label="Notes"><textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field></div>
      <Field label="Schedule follow-up"><input type="datetime-local" className={inputClass} min={toLocalInput(new Date())} value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} /></Field>
      <Field label="Follow-up note"><input className={inputClass} value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} maxLength={2000} disabled={!followUpAt} /></Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onSkip} disabled={saving}>Skip</Button>
        <Button type="submit" loading={saving}>Save outcome</Button>
      </div>
    </form>
  );
}

// In-CRM dialer. Shows the lead's name only; the number is never on the client.
export default function Dialer({ lead, callingEnabled, onCallFinished, onBusyChange }) {
  const d = usePlivoDialer();
  const [showOutcome, setShowOutcome] = useState(false);

  useEffect(() => { onBusyChange?.(d.busy); }, [d.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if ((d.status === 'ended' || d.status === 'failed') && d.callId) {
      setShowOutcome(true);
      onCallFinished?.();
    }
  }, [d.status, d.callId]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = ['connecting', 'ringing', 'connected', 'ending', 'preparing'].includes(d.status);
  const disabled = !callingEnabled || !lead.hasPhone;

  return (
    <div className={cx('rounded-2xl p-5 text-white shadow-md', d.status === 'failed' ? 'bg-gradient-to-br from-red-600 to-red-500' : 'bg-gradient-to-br from-[#16a34a] to-[#28BD78]')}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{lead.fullName}</div>
          <div className="text-sm text-white/85" aria-live="polite">
            {STATUS_TEXT[d.status]}
            {d.status === 'connected' && <span className="ml-2 font-mono">{formatDuration(d.seconds)}</span>}
            {d.status === 'ended' && d.seconds > 0 && <span className="ml-2 font-mono">{formatDuration(d.seconds)}</span>}
          </div>
          <div className="mt-0.5 font-mono text-xs text-white/70">{lead.phoneMasked || 'No number'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!live && (
            <button type="button" onClick={() => { setShowOutcome(false); d.call(lead.id); }} disabled={disabled} className="rounded-full bg-white px-6 py-2.5 font-semibold text-[#10784b] shadow hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60">
              {d.status === 'ended' || d.status === 'failed' ? 'Call again' : 'Call'}
            </button>
          )}
          {d.status === 'connected' && (
            <button type="button" onClick={d.toggleMute} aria-pressed={d.muted} className={cx('rounded-full px-5 py-2.5 font-semibold shadow', d.muted ? 'bg-amber-300 text-amber-900' : 'bg-white/20 text-white hover:bg-white/30')}>
              {d.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          {live && (
            <button type="button" onClick={d.hangup} disabled={d.status === 'ending'} className="rounded-full bg-red-600 px-6 py-2.5 font-semibold text-white shadow hover:bg-red-700 disabled:opacity-70">Hang up</button>
          )}
        </div>
      </div>
      {!callingEnabled && <p className="mt-3 text-sm text-white/90">Calling is not set up yet. Ask your admin to configure Plivo.</p>}
      {callingEnabled && !lead.hasPhone && <p className="mt-3 text-sm text-white/90">This lead has no mobile number. Ask your admin to add one.</p>}
      {d.error && <p className="mt-3 rounded bg-white/15 px-3 py-2 text-sm" role="alert">{d.error}</p>}
      {showOutcome && d.callId && (
        <div className="mt-2 rounded-xl bg-white p-4 text-gray-800">
          <OutcomeForm callId={d.callId} lead={lead} onSaved={() => { setShowOutcome(false); d.reset(); onCallFinished?.(); }} onSkip={() => { setShowOutcome(false); d.reset(); }} />
        </div>
      )}
    </div>
  );
}
