// Small UI kit for the Leads/CRM screens, matching the panel's green theme.
import React, { useEffect, createContext, useCallback, useContext, useState } from 'react';
import { statusLabel, priorityLabel, callStatusLabel } from '../../lib/crm/constants';

export const BRAND = '#28BD78';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

// Value for <input type="datetime-local"> in the viewer's timezone.
export function toLocalInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_STYLES = {
  new: 'bg-blue-50 text-blue-700 ring-blue-200',
  contacted: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  interested: 'bg-amber-50 text-amber-700 ring-amber-200',
  follow_up: 'bg-purple-50 text-purple-700 ring-purple-200',
  not_interested: 'bg-gray-100 text-gray-600 ring-gray-200',
  converted: 'bg-green-50 text-green-700 ring-green-200',
  lost: 'bg-red-50 text-red-700 ring-red-200',
};
const PRIORITY_STYLES = {
  hot: 'bg-red-50 text-red-700 ring-red-200',
  warm: 'bg-orange-50 text-orange-700 ring-orange-200',
  cold: 'bg-sky-50 text-sky-700 ring-sky-200',
};
const CALL_STYLES = {
  completed: 'bg-green-50 text-green-700 ring-green-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  ringing: 'bg-blue-50 text-blue-700 ring-blue-200',
  initiated: 'bg-gray-100 text-gray-600 ring-gray-200',
  no_answer: 'bg-amber-50 text-amber-700 ring-amber-200',
  busy: 'bg-amber-50 text-amber-700 ring-amber-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-gray-100 text-gray-600 ring-gray-200',
};

export function Badge({ className, children }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', className)}>{children}</span>;
}
export const StatusBadge = ({ value }) => <Badge className={STATUS_STYLES[value] || STATUS_STYLES.new}>{statusLabel(value)}</Badge>;
export const PriorityBadge = ({ value }) => <Badge className={PRIORITY_STYLES[value] || PRIORITY_STYLES.warm}>{priorityLabel(value)}</Badge>;
export const CallStatusBadge = ({ value }) => <Badge className={CALL_STYLES[value] || CALL_STYLES.initiated}>{callStatusLabel(value)}</Badge>;

export function Button({ variant = 'primary', size = 'md', className, loading, children, ...props }) {
  const variants = {
    primary: 'bg-[#28BD78] text-white hover:bg-[#21a467] disabled:bg-[#9fdcbf]',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    ghost: 'text-gray-600 hover:bg-gray-100',
    subtle: 'bg-[#e9fff2] text-[#10784b] border border-[#d7f1de] hover:bg-[#d9f8e7]',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button
      type="button"
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-6 w-6' }) {
  return (
    <svg className={cx('animate-spin text-current', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-gray-500" role="status">
      <Spinner className="h-5 w-5 text-[#28BD78]" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#e9fff2] text-[#28BD78]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </div>
      <div className="font-semibold text-gray-800">{title}</div>
      {description && <div className="mt-1 max-w-md text-sm text-gray-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const indexUrl = error?.body?.indexUrl;
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
      <div>
        <div>{message}</div>
        {indexUrl && (
          <div className="mt-1">
            Fix: an admin opens <strong>Leads → Settings</strong> and clicks <strong>Set up database indexes</strong>; after 5–15 minutes, retry.{' '}
            <a className="font-medium underline" href={indexUrl} target="_blank" rel="noopener noreferrer">(or create this one index in Firebase)</a>
          </div>
        )}
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', widths[size])}>
        <div className="flex items-center justify-between border-b px-5 py-4 border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3 border-gray-200">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel, loading }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      <p className="text-sm text-gray-600">{message}</p>
    </Modal>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 'max-w-3xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className={cx('flex h-full w-full flex-col bg-[#fbf9f4] shadow-2xl', width)}>
        <div className="flex items-start justify-between gap-3 border-b bg-white px-5 py-4 border-gray-200">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-gray-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </aside>
    </div>
  );
}

export function Field({ label, required, hint, error, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#28BD78] focus:outline-none focus:ring-2 focus:ring-[#28BD78]/30 disabled:bg-gray-100';

export function StatCard({ label, value, hint, accent = '#28BD78' }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: accent }}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors', value === t.value ? 'bg-[#28BD78] text-white' : 'text-gray-600 hover:bg-gray-100')}
        >
          {t.label}
          {t.count ? <span className={cx('ml-2 rounded-full px-1.5 text-xs', value === t.value ? 'bg-white/25' : 'bg-red-100 text-red-700')}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Minimal toast system (no extra dependency).
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto rounded-lg px-4 py-3 text-sm text-white shadow-lg', t.type === 'error' ? 'bg-red-600' : 'bg-gray-900')}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function Timeline({ activities }) {
  if (!activities?.length) return <EmptyState title="No activity yet" />;
  const dot = (type) => {
    if (type.startsWith('call_failed')) return 'bg-red-400';
    if (type.startsWith('call')) return 'bg-blue-400';
    if (type.startsWith('followup')) return 'bg-purple-400';
    if (type === 'note') return 'bg-amber-400';
    if (type.includes('assign')) return 'bg-gray-400';
    return 'bg-[#28BD78]';
  };
  return (
    <ol className="relative ml-2 border-l border-gray-200">
      {activities.map((a) => (
        <li key={a.id} className="mb-4 ml-4">
          <span className={cx('absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-4 ring-[#fbf9f4]', dot(a.type))} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-gray-800">{a.label}</span>
            {a.adminOnly && <Badge className="bg-gray-100 text-gray-600 ring-gray-200">Admin only</Badge>}
            <span className="text-xs text-gray-400">{formatDateTime(a.createdAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-600">{a.description}</p>
          {a.actor && <div className="text-xs text-gray-400">by {a.actor.name}{a.actor.type === 'admin' ? ' (admin)' : ''}</div>}
        </li>
      ))}
    </ol>
  );
}

export function Pagination({ page, hasNext, onPrev, onNext, total, loading }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 text-sm text-gray-600 border-gray-200">
      <span>{typeof total === 'number' ? `${total} total` : ''}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onPrev} disabled={page <= 1 || loading}>Previous</Button>
        <span>Page {page}</span>
        <Button size="sm" variant="secondary" onClick={onNext} disabled={!hasNext || loading}>Next</Button>
      </div>
    </div>
  );
}

// Cursor pagination helper: keeps a stack of cursors so "Previous" works.
export function useCursorPager() {
  const [stack, setStack] = useState([null]);
  const page = stack.length;
  const cursor = stack[stack.length - 1];
  return {
    page,
    cursor,
    next: (nextCursor) => nextCursor && setStack((s) => [...s, nextCursor]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([null]),
  };
}

export function useDebounced(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
