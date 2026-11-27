// Shared vocabulary for the CRM. Safe to import from browser code as well.
export const LEAD_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

export const LEAD_PRIORITIES = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
];

export const LEAD_SOURCES = ['Website', 'Referral', 'Social Media', 'Facebook', 'Instagram', 'X (Twitter)', 'LinkedIn', 'Google Ads', 'Cold Call', 'Email Campaign', 'Event', 'Walk-in', 'Import', 'Other'];

// Marketing channels for campaigns and automatic lead capture.
export const CHANNELS = [
  { value: 'facebook', label: 'Facebook', source: 'Facebook' },
  { value: 'instagram', label: 'Instagram', source: 'Instagram' },
  { value: 'x', label: 'X (Twitter)', source: 'X (Twitter)' },
  { value: 'linkedin', label: 'LinkedIn', source: 'LinkedIn' },
  { value: 'google_ads', label: 'Google Ads', source: 'Google Ads' },
  { value: 'website', label: 'Website form', source: 'Website' },
  { value: 'email', label: 'Email', source: 'Email Campaign' },
  { value: 'other', label: 'Other', source: 'Other' },
];
export const channelLabel = (v) => CHANNELS.find((c) => c.value === v)?.label || v || '—';

export const CALL_OUTCOMES = [
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'callback', label: 'Asked to call back' },
  { value: 'converted', label: 'Converted' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'switched_off', label: 'Switched off / unreachable' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'other', label: 'Other' },
];

export const CALL_STATUSES = [
  { value: 'initiated', label: 'Initiated' },
  { value: 'ringing', label: 'Ringing' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const FINAL_CALL_STATUSES = ['completed', 'no_answer', 'busy', 'failed', 'cancelled'];

export const ACTIVITY_TYPES = {
  created: 'Lead created',
  updated: 'Lead updated',
  assigned: 'Lead assigned',
  reassigned: 'Lead reassigned',
  unassigned: 'Lead unassigned',
  status_changed: 'Status changed',
  note: 'Note',
  followup_scheduled: 'Follow-up scheduled',
  followup_completed: 'Follow-up completed',
  followup_cancelled: 'Follow-up cancelled',
  call_initiated: 'Call initiated',
  call_connected: 'Call connected',
  call_ended: 'Call ended',
  call_failed: 'Call failed',
  call_outcome: 'Call outcome',
  imported: 'Lead imported',
  captured: 'Lead captured automatically',
  re_enquired: 'Enquired again',
  email_sent: 'Email sent',
  email_failed: 'Email failed',
  unsubscribed: 'Unsubscribed from emails',
};

export const statusLabel = (v) => LEAD_STATUSES.find((s) => s.value === v)?.label || v || '—';
export const priorityLabel = (v) => LEAD_PRIORITIES.find((s) => s.value === v)?.label || v || '—';
export const outcomeLabel = (v) => CALL_OUTCOMES.find((s) => s.value === v)?.label || v || '—';
export const callStatusLabel = (v) => CALL_STATUSES.find((s) => s.value === v)?.label || v || '—';

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}
