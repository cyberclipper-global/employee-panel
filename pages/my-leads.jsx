import React, { useCallback, useEffect, useRef, useState } from 'react';
import SideMenu from '../components/sidemenu';
import Header from '../components/header';
import { useSidebar } from '../context/SidebarContext';
import {
  ToastProvider, Tabs, StatCard, Button, StatusBadge, PriorityBadge, LoadingBlock, ErrorBanner, EmptyState, Pagination,
  inputClass, formatDateTime, useCursorPager, useDebounced, useToast, cx,
} from '../components/crm/ui';
import { FollowupList, CallList } from '../components/crm/Sections';
import MyLeadDrawer from '../components/crm/MyLeadDrawer';
import LeadFormModal from '../components/crm/LeadFormModal';
import { crmFetch } from '../utils/crmClient';
import { LEAD_STATUSES, LEAD_PRIORITIES } from '../lib/crm/constants';

function LeadsList({ onOpen, reloadKey, onMeta, onAdd, canCreate }) {
  const [filters, setFilters] = useState({});
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(undefined);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pager = useCursorPager();

  useEffect(() => { pager.reset(); }, [filters, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await crmFetch('/api/crm/my-leads', { query: { ...filters, search, cursor: pager.cursor, pageSize: 25 } });
      setRows(res.leads);
      setNextCursor(res.nextCursor);
      if (typeof res.total === 'number') setTotal(res.total);
      if (res.followups || res.permissions) onMeta({ followups: res.followups, permissions: res.permissions, total: res.total });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters, search, pager.cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, reloadKey]);

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const anyFilter = filters.status || filters.priority || search;

  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 border-gray-200">
        <input className={cx(inputClass, 'sm:max-w-xs')} placeholder="Search name, company, email…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search my leads" />
        <select className={cx(inputClass, 'sm:w-auto')} value={filters.status || ''} onChange={setF('status')} aria-label="Status filter">
          <option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className={cx(inputClass, 'sm:w-auto')} value={filters.priority || ''} onChange={setF('priority')} aria-label="Priority filter">
          <option value="">All priorities</option>{LEAD_PRIORITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {anyFilter && <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setSearchInput(''); }}>Clear</Button>}
        {canCreate && <Button className="ml-auto" onClick={onAdd}>+ Add lead</Button>}
      </div>
      <div className="p-3 pb-0"><ErrorBanner error={error} onRetry={load} /></div>
      {rows === null ? <LoadingBlock /> : rows.length === 0 ? (
        <EmptyState title={anyFilter ? 'No leads match these filters' : 'No leads assigned to you yet'} description={anyFilter ? 'Try clearing the filters.' : 'Leads your admin assigns to you will show up here.'} />
      ) : (
        <div className={cx('overflow-x-auto', loading && 'opacity-60')}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-white" style={{ background: 'linear-gradient(90deg, #16a34a 0%, #45CA8A 100%)' }}>
              <tr><th className="px-3 py-2.5">Lead</th><th className="px-3 py-2.5">Mobile</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Priority</th><th className="px-3 py-2.5">Product</th><th className="px-3 py-2.5">Next follow-up</th><th className="px-3 py-2.5 text-right">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const overdue = l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < Date.now();
                return (
                  <tr key={l.id} className={cx('cursor-pointer border-b hover:bg-green-50 border-gray-200', i % 2 ? 'bg-gray-50' : 'bg-white')} onClick={() => onOpen(l.id)}>
                    <td className="px-3 py-2.5"><div className="font-medium text-gray-900">{l.fullName}</div><div className="text-xs text-gray-500">{[l.companyName, l.location].filter(Boolean).join(' · ')}</div></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{l.phoneMasked || '—'}</td>
                    <td className="px-3 py-2.5"><StatusBadge value={l.status} /></td>
                    <td className="px-3 py-2.5"><PriorityBadge value={l.priority} /></td>
                    <td className="px-3 py-2.5 text-gray-600">{l.product || '—'}</td>
                    <td className={cx('px-3 py-2.5 whitespace-nowrap', overdue ? 'font-medium text-red-600' : 'text-gray-600')}>{l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : '—'}</td>
                    <td className="px-3 py-2.5 text-right"><Button size="sm" onClick={(e) => { e.stopPropagation(); onOpen(l.id); }}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={pager.page} hasNext={!!nextCursor} total={total} loading={loading} onPrev={pager.prev} onNext={() => pager.next(nextCursor)} />
    </div>
  );
}

function MyFollowups({ onOpen, reloadKey }) {
  const [view, setView] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await crmFetch('/api/crm/followups', { query: { view, limit: 100 } })); } catch (err) { setError(err); }
  }, [view]);
  useEffect(() => { setData(null); load(); }, [load, reloadKey]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {['pending', 'overdue', 'completed'].map((v) => (
          <Button key={v} size="sm" variant={view === v ? 'primary' : 'secondary'} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}{data?.counts && v !== 'completed' ? ` (${v === 'pending' ? data.counts.pending : data.counts.overdue})` : ''}
          </Button>
        ))}
      </div>
      <ErrorBanner error={error} onRetry={load} />
      {!data && !error ? <LoadingBlock /> : data && (
        <FollowupList followups={data.followups} showLead onOpenLead={onOpen} onUpdate={async (id, action, note) => { await crmFetch(`/api/crm/followups/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action, note } }); await load(); }} />
      )}
    </div>
  );
}

function MyCalls({ onOpen, onCallingEnabled }) {
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const pager = useCursorPager();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await crmFetch('/api/crm/calls', { query: { cursor: pager.cursor, pageSize: 25 } });
      setRows(res.calls); setNextCursor(res.nextCursor); onCallingEnabled(res.callingEnabled);
    } catch (err) { setError(err); } finally { setLoading(false); }
  }, [pager.cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <ErrorBanner error={error} onRetry={load} />
      {rows === null ? <LoadingBlock /> : (
        <>
          <CallList calls={rows} showLead onOpenLead={onOpen} />
          <div className="rounded-xl bg-white shadow-sm"><Pagination page={pager.page} hasNext={!!nextCursor} loading={loading} onPrev={pager.prev} onNext={() => pager.next(nextCursor)} /></div>
        </>
      )}
    </div>
  );
}

function Workspace() {
  const [tab, setTab] = useState('leads');
  const [openId, setOpenId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [meta, setMeta] = useState({ followups: null, permissions: null, total: undefined });
  const [callingEnabled, setCallingEnabled] = useState(false);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  useEffect(() => {
    crmFetch('/api/crm/calls', { query: { pageSize: 1 } }).then((r) => setCallingEnabled(r.callingEnabled)).catch(() => {});
  }, []);

  const onMeta = useCallback((m) => setMeta((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) })), []);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="My leads" value={meta.total ?? '—'} />
        <StatCard label="Pending follow-ups" value={meta.followups?.pending ?? '—'} accent="#7c3aed" />
        <StatCard label="Overdue follow-ups" value={meta.followups?.overdue ?? '—'} accent="#dc2626" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'leads', label: 'My leads' },
        { value: 'followups', label: 'Follow-ups', count: meta.followups?.overdue },
        { value: 'calls', label: 'Call history' },
      ]} />
      {tab === 'leads' && <LeadsList onOpen={setOpenId} reloadKey={reloadKey} onMeta={onMeta} canCreate={meta.permissions?.canCreate} onAdd={() => setAdding(true)} />}
      {tab === 'followups' && <MyFollowups onOpen={setOpenId} reloadKey={reloadKey} />}
      {tab === 'calls' && <MyCalls onOpen={setOpenId} onCallingEnabled={setCallingEnabled} />}
      <MyLeadDrawer leadId={openId} onClose={() => setOpenId(null)} onChanged={reload} callingEnabled={callingEnabled} canDelete={meta.permissions?.canDelete} />
      <LeadFormModal
        open={adding}
        onClose={() => setAdding(false)}
        showAssignment={false}
        onSubmit={async (payload) => {
          const res = await crmFetch('/api/crm/my-leads', { method: 'POST', body: payload });
          toast('Lead added');
          reload();
          setOpenId(res.lead.id);
        }}
      />
    </>
  );
}

export default function MyLeadsPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isOpen, isMobile, isHydrated } = useSidebar();
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  useEffect(() => {
    const update = () => headerRef.current && setHeaderHeight(headerRef.current.offsetHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const marginLeft = !isHydrated ? 270 : isMobile ? 0 : isOpen ? 270 : 64;

  return (
    <div className="bg-[#fbf9f4] min-h-screen flex relative">
      <div className="hidden sm:block fixed top-0 left-0 h-full z-40" style={{ width: 270 }}><SideMenu /></div>
      {mobileSidebarOpen && (
        <div className="sm:hidden fixed inset-0 z-50 bg-white">
          <button className="absolute top-4 right-4 z-60 text-3xl text-gray-500" aria-label="Close sidebar" onClick={() => setMobileSidebarOpen(false)}>&times;</button>
          <SideMenu mobileOverlay />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-300" style={{ marginLeft }}>
        <Header ref={headerRef} onMobileSidebarToggle={() => setMobileSidebarOpen((v) => !v)} mobileSidebarOpen={mobileSidebarOpen} />
        <main className="px-2 sm:px-8 pb-12" style={{ paddingTop: headerHeight + 16 }}>
          <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-extrabold" style={{ color: '#45CA8A' }}>My Leads</h1>
            <p className="mb-6 text-sm text-gray-500">Leads assigned to you. Call, take notes and schedule follow-ups.</p>
            <ToastProvider><Workspace /></ToastProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
