import React, { useCallback, useEffect, useState } from 'react';
import { Drawer, Button, StatusBadge, PriorityBadge, LoadingBlock, ErrorBanner, Timeline, ConfirmDialog, Tabs, inputClass, formatDateTime, useToast } from './ui';
import { NoteComposer, FollowupScheduler, FollowupList, CallList, InfoGrid } from './Sections';
import Dialer from './Dialer';
import { crmFetch } from '../../utils/crmClient';
import { LEAD_STATUSES, LEAD_PRIORITIES, formatDuration } from '../../lib/crm/constants';

export default function MyLeadDrawer({ leadId, onClose, onChanged, callingEnabled, canDelete }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('timeline');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const toast = useToast();
  const safeClose = () => {
    if (callBusy) { toast('Hang up the call before closing this lead', 'error'); return; }
    onClose();
  };

  const load = useCallback(async () => {
    if (!leadId) return;
    setError(null);
    try {
      setData(await crmFetch(`/api/crm/my-leads/${encodeURIComponent(leadId)}`));
    } catch (err) {
      setError(err);
    }
  }, [leadId]);
  useEffect(() => { setData(null); setTab('timeline'); load(); }, [load]);

  const refresh = async () => { await load(); onChanged?.(); };
  const lead = data?.lead;

  const patch = async (body) => {
    setSaving(true);
    try {
      await crmFetch(`/api/crm/my-leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body });
      toast('Lead updated');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await crmFetch(`/api/crm/my-leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
      toast('Lead deleted');
      onChanged?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Drawer open={!!leadId} onClose={safeClose} title={lead?.fullName || 'Lead'} subtitle={lead ? `${lead.companyName || 'No company'} · assigned ${formatDateTime(lead.assignedAt)}` : ''}>
      <ErrorBanner error={error} onRetry={load} />
      {!lead && !error && <LoadingBlock />}
      {lead && (
        <div className="space-y-5">
          <Dialer lead={lead} callingEnabled={callingEnabled} onCallFinished={refresh} onBusyChange={setCallBusy} />

          <div className="grid gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Status</span>
              <select className={inputClass} value={lead.status} disabled={saving} onChange={(e) => patch({ status: e.target.value })}>
                {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Priority</span>
              <select className={inputClass} value={lead.priority} disabled={saving} onChange={(e) => patch({ priority: e.target.value })}>
                {LEAD_PRIORITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button size="sm" variant="subtle" disabled={saving || lead.status === 'interested'} onClick={() => patch({ status: 'interested' })}>Interested</Button>
              <Button size="sm" variant="secondary" disabled={saving || lead.status === 'not_interested'} onClick={() => patch({ status: 'not_interested' })}>Not interested</Button>
              <Button size="sm" variant="subtle" disabled={saving || lead.status === 'converted'} onClick={() => patch({ status: 'converted' })}>Converted</Button>
              <Button size="sm" variant="secondary" disabled={saving || lead.status === 'lost'} onClick={() => patch({ status: 'lost' })}>Lost</Button>
              {canDelete && <Button size="sm" variant="danger" className="ml-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            </div>
          </div>

          <InfoGrid items={[
            ['Mobile number', <span key="p" className="font-mono">{lead.phoneMasked || 'Not set'}</span>],
            ['Email', lead.email],
            ['Company', lead.companyName],
            ['Location', lead.location],
            ['Lead source', lead.source],
            ['Interested product / service', lead.product],
            ['Next follow-up', formatDateTime(lead.nextFollowUpAt)],
            ['Calls', `${lead.callCount} (${formatDuration(lead.totalCallSeconds)} talk time)`],
            ...Object.entries(lead.customFields || {}).map(([k, v]) => [k, v]),
          ]} />
          {lead.additionalInfo && (
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Additional information</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{lead.additionalInfo}</p>
            </div>
          )}
          <div className="flex items-center gap-2"><StatusBadge value={lead.status} /><PriorityBadge value={lead.priority} /></div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'timeline', label: 'Activity' },
              { value: 'followups', label: 'Follow-ups', count: data.followups.filter((f) => f.status === 'pending' && f.overdue).length },
              { value: 'calls', label: `My calls (${data.calls.length})` },
            ]}
          />
          {tab === 'timeline' && (
            <>
              <NoteComposer onSubmit={async (text) => { await crmFetch(`/api/crm/my-leads/${encodeURIComponent(leadId)}/notes`, { method: 'POST', body: { text } }); await load(); }} />
              <Timeline activities={data.activities} />
            </>
          )}
          {tab === 'followups' && (
            <>
              <FollowupScheduler onSubmit={async (dueAt, note) => { await crmFetch(`/api/crm/my-leads/${encodeURIComponent(leadId)}/followups`, { method: 'POST', body: { dueAt, note } }); await refresh(); }} />
              <FollowupList followups={data.followups} onUpdate={async (id, action, note) => { await crmFetch(`/api/crm/followups/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action, note } }); await refresh(); }} />
            </>
          )}
          {tab === 'calls' && <CallList calls={data.calls} />}
        </div>
      )}
      <ConfirmDialog open={confirmDelete} title="Delete lead?" message={`This permanently deletes ${lead?.fullName || 'this lead'} and its timeline.`} onCancel={() => setConfirmDelete(false)} onConfirm={remove} loading={deleting} />
    </Drawer>
  );
}
