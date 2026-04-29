'use client';

import { useState, useEffect, useCallback } from 'react';
import ConfirmationTable, { ConfirmationRecord } from '@/components/ConfirmationTable';
import EntityAttachmentModal from '@/components/EntityAttachmentModal';
import SendConfirmModal from '@/components/SendConfirmModal';
import { categoryForModule, moduleKeyToRoute } from '@/lib/module-types';
import type { ModuleKey, ModuleRouteSegment } from '@/lib/module-types';
import type { TradeInvoiceLineRow, TradeInvoiceLinesSummary } from '@/app/api/modules/[segment]/invoice-lines/route';
import { parseInrAmountString, debitCreditLabel, formatInrAmount } from '@/lib/inr-amount';

type TradeWorkspaceStats = {
  total: number;
  notSent: number;
  sent: number;
  followupSent: number;
  responseReceived: number;
};

const TRADE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const STATUS_OPTIONS = [
  { value: 'not_sent', label: 'Not Sent' },
  { value: 'sent', label: 'Email Sent' },
  { value: 'followup_sent', label: 'Follow-up Sent' },
  { value: 'response_received', label: 'Response Received' },
];

const CONFIRMATION_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'queried', label: 'Queried' },
  { value: 'none', label: 'Pending' },
];

type SortField = 'entityName' | 'category' | 'status' | 'sentAt' | 'responseReceivedAt';

interface ModuleWorkspaceClientProps {
  moduleKey: ModuleKey;
  title: string;
  subtitle?: string;
}

export default function ModuleWorkspaceClient({ moduleKey, title, subtitle }: ModuleWorkspaceClientProps) {
  const apiSegment = moduleKeyToRoute(moduleKey);
  const fixedCategory = categoryForModule(moduleKey);
  const isMsme = moduleKey === 'confirm_msme';
  const isTrade = moduleKey === 'trade_payable' || moduleKey === 'trade_receivable';

  const [records, setRecords] = useState<ConfirmationRecord[]>([]);
  const [entityNames, setEntityNames] = useState<string[]>([]);
  const [totalAnchors, setTotalAnchors] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tradeWorkspaceStats, setTradeWorkspaceStats] = useState<TradeWorkspaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [repliesMessage, setRepliesMessage] = useState<string | null>(null);

  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [confirmationKindFilter, setConfirmationKindFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [sortField, setSortField] = useState<SortField>('entityName');
  const [sortAsc, setSortAsc] = useState(true);

  const [showListingUpload, setShowListingUpload] = useState(false);
  const [showEntityAttachment, setShowEntityAttachment] = useState(false);
  const [showBulkSend, setShowBulkSend] = useState(false);
  const [showBulkFollowup, setShowBulkFollowup] = useState(false);
  const [showTradeBulkSend, setShowTradeBulkSend] = useState(false);
  const [invoiceLinesAnchorId, setInvoiceLinesAnchorId] = useState<string | null>(null);

  const pageStats: TradeWorkspaceStats = {
    total: records.length,
    notSent: records.filter((r) => r.status === 'not_sent').length,
    sent: records.filter((r) => r.status === 'sent').length,
    followupSent: records.filter((r) => r.status === 'followup_sent').length,
    responseReceived: records.filter((r) => r.status === 'response_received').length,
  };

  const stats = isTrade && tradeWorkspaceStats ? tradeWorkspaceStats : pageStats;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('module', moduleKey);
      selectedEntities.forEach((e) => params.append('entity', e));
      selectedStatuses.forEach((s) => params.append('status', s));
      if (search) params.set('search', search);
      if (confirmationKindFilter !== 'all') params.set('confirmationKind', confirmationKindFilter);
      if (isTrade) {
        params.set('listMode', 'by_code');
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
      }
      params.set('metadata', 'true');

      const res = await fetch(`/api/confirmations?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        console.error(data.error || 'Fetch failed');
        setRecords([]);
        setTotalAnchors(0);
        setTradeWorkspaceStats(null);
        return;
      }
      setRecords(data.records || []);
      setTotalAnchors(typeof data.total === 'number' ? data.total : (data.records?.length ?? 0));
      if (data.entityNames) setEntityNames(data.entityNames);
      if (isTrade && data.stats && typeof data.stats === 'object') {
        setTradeWorkspaceStats(data.stats as TradeWorkspaceStats);
      } else {
        setTradeWorkspaceStats(null);
      }
    } finally {
      setLoading(false);
    }
  }, [moduleKey, selectedEntities, selectedStatuses, search, confirmationKindFilter, isTrade, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [moduleKey, selectedEntities, selectedStatuses, search, confirmationKindFilter, pageSize]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleCheckReplies = async () => {
    setCheckingReplies(true);
    setRepliesMessage(null);
    try {
      const res = await fetch('/api/confirmations/check-replies', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRepliesMessage(
          data.repliesFound > 0
            ? `Found ${data.repliesFound} new ${data.repliesFound > 1 ? 'replies' : 'reply'}`
            : 'No new replies found'
        );
        if (data.repliesFound > 0) fetchRecords();
      }
    } finally {
      setCheckingReplies(false);
      setTimeout(() => setRepliesMessage(null), 4000);
    }
  };

  useEffect(() => {
    if (!isMsme) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/modules/${apiSegment}/hydrate-from-suppliers`, { method: 'POST' });
        if (!cancelled && res.ok) await fetchRecords();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once when opening MSME workspace
  }, [isMsme, apiSegment]);

  const sortedRecords = [...records].sort((a, b) => {
    const aVal = a[sortField] || '';
    const bVal = b[sortField] || '';
    const cmp = String(aVal).localeCompare(String(bVal));
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const toggleFilter = <T extends string>(arr: T[], setArr: (a: T[]) => void, val: T) => {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const clearFilters = () => {
    setSelectedEntities([]);
    setSelectedStatuses([]);
    setSearch('');
    setConfirmationKindFilter('all');
    setPage(1);
  };

  const hasActiveFilters =
    selectedEntities.length > 0 ||
    selectedStatuses.length > 0 ||
    search.length > 0 ||
    confirmationKindFilter !== 'all';

  const totalPages = isTrade ? Math.max(1, Math.ceil(totalAnchors / pageSize)) : 1;

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {subtitle ||
              (isMsme ? `MSME confirmations — ${fixedCategory}` : `Balance confirmation — ${fixedCategory}`)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {repliesMessage && (
            <span className="text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
              {repliesMessage}
            </span>
          )}
          <button
            onClick={handleCheckReplies}
            disabled={checkingReplies}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${checkingReplies ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Check Replies
          </button>
          {/* <button
            onClick={() => setShowEntityAttachment(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Entity attachments
          </button> */}
          {isTrade && (
            <button
              type="button"
              onClick={() => setShowTradeBulkSend(true)}
              className="flex items-center gap-2 px-4 py-2 border border-violet-300 text-violet-900 text-sm font-medium rounded-xl hover:bg-violet-50 transition-colors"
            >
              Bulk send
            </button>
          )}
          {isMsme ? (
            <>
              <button
                type="button"
                onClick={() => setShowBulkSend(true)}
                className="flex items-center gap-2 px-4 py-2 border border-violet-300 text-violet-900 text-sm font-medium rounded-xl hover:bg-violet-50 transition-colors"
              >
                Bulk send
              </button>
              <button
                type="button"
                onClick={() => setShowBulkFollowup(true)}
                className="flex items-center gap-2 px-4 py-2 border border-amber-300 text-amber-900 text-sm font-medium rounded-xl hover:bg-amber-50 transition-colors"
              >
                Bulk follow-up
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowListingUpload(true)}
              className="flex items-center gap-2 px-4 py-2 border border-indigo-200 text-indigo-800 text-sm font-medium rounded-xl hover:bg-indigo-50 transition-colors"
            >
              Upload listing (Excel/CSV)
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 flex-shrink-0 flex-wrap">
        {[
          { label: 'Total', count: stats.total, color: 'text-gray-700', bg: 'bg-gray-100' },
          { label: 'Not Sent', count: stats.notSent, color: 'text-gray-600', bg: 'bg-gray-100' },
          { label: 'Sent', count: stats.sent, color: 'text-blue-700', bg: 'bg-blue-100' },
          { label: 'Follow-up', count: stats.followupSent, color: 'text-amber-700', bg: 'bg-amber-100' },
          { label: 'Response', count: stats.responseReceived, color: 'text-green-700', bg: 'bg-green-100' },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.bg} ${s.color}`}>{s.count}</span>
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
        <div className="flex-1" />
        {stats.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${Math.round((stats.responseReceived / stats.total) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">
              {Math.round((stats.responseReceived / stats.total) * 100)}% response rate
            </span>
          </div>
        )}
      </div>

      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-start gap-4 flex-shrink-0 flex-wrap">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entity, bank, email…"
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-56"
          />
        </div>

        <FilterDropdown
          label={selectedEntities.length ? `${selectedEntities.length} entities` : 'All entities'}
          options={entityNames}
          selected={selectedEntities}
          onToggle={(v) => toggleFilter(selectedEntities, setSelectedEntities, v)}
          onClear={() => setSelectedEntities([])}
        />

        <FilterDropdown
          label={selectedStatuses.length ? `${selectedStatuses.length} status` : 'All status'}
          options={STATUS_OPTIONS.map((s) => s.label)}
          selected={selectedStatuses.map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label || s)}
          onToggle={(v) => {
            const val = STATUS_OPTIONS.find((o) => o.label === v)?.value || v;
            toggleFilter(selectedStatuses, setSelectedStatuses, val);
          }}
          onClear={() => setSelectedStatuses([])}
        />

        <label className="flex flex-col gap-0.5 text-xs text-gray-500">
          <span className="sr-only md:not-sr-only">Confirmation</span>
          <select
            value={confirmationKindFilter}
            onChange={(e) => setConfirmationKindFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[10rem]"
            aria-label="Filter by confirmation status"
          >
            {CONFIRMATION_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition-colors px-3 py-2"
          >
            Clear filters
          </button>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Sort:</span>
          {(['entityName', 'status', 'sentAt', 'responseReceivedAt'] as SortField[]).map((f) => (
            <button
              key={f}
              onClick={() => handleSort(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                sortField === f ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            >
              {(
                { entityName: 'Entity', category: 'Category', status: 'Status', sentAt: 'Sent', responseReceivedAt: 'Response' } as Record<string, string>
              )[f]}
              {sortField === f && <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white">
        <ConfirmationTable
          records={sortedRecords}
          onRefresh={fetchRecords}
          loading={loading}
          msmeVendorMasterLayout={isMsme}
          tradeListingLayout={isTrade}
          tradePartyColumnHeader={moduleKey === 'trade_payable' ? 'Supplier' : 'Customer'}
          rowNumberOffset={(page - 1) * pageSize}
          onOpenInvoiceLines={isTrade ? (r) => setInvoiceLinesAnchorId(r.id) : undefined}
        />
        {isTrade && totalAnchors > 0 && (
          <div className="sticky bottom-0 border-t border-gray-100 bg-gray-50/95 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-600">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalAnchors)} of{' '}
              {totalAnchors} supplier/customer code{totalAnchors === 1 ? '' : 's'}
            </span>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <span className="text-gray-500 whitespace-nowrap">Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 25)}
                  className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Rows per page"
                >
                  {TRADE_PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 tabular-nums">
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showListingUpload && (
        <ModuleListingUploadModal
          apiSegment={apiSegment}
          moduleLabel={title}
          variant={isMsme ? 'msme' : 'sap'}
          onClose={() => setShowListingUpload(false)}
          onSuccess={() => {
            setShowListingUpload(false);
            fetchRecords();
          }}
        />
      )}

      {showBulkSend && isMsme && (
        <MsmeBulkSendModal
          records={sortedRecords.filter((r) => r.status === 'not_sent')}
          apiSegment={apiSegment}
          onClose={() => setShowBulkSend(false)}
          onSuccess={() => {
            setShowBulkSend(false);
            fetchRecords();
          }}
          onRefreshList={fetchRecords}
        />
      )}

      {showBulkFollowup && isMsme && (
        <MsmeBulkFollowupModal
          records={sortedRecords.filter((r) => r.status === 'sent' || r.status === 'followup_sent')}
          apiSegment={apiSegment}
          onClose={() => setShowBulkFollowup(false)}
          onSuccess={() => {
            setShowBulkFollowup(false);
            fetchRecords();
          }}
          onRefreshList={fetchRecords}
        />
      )}

      {showTradeBulkSend && isTrade && (
        <MsmeBulkSendModal
          records={sortedRecords.filter((r) => r.status === 'not_sent')}
          apiSegment={apiSegment}
          heading="Bulk send"
          helperText="One email per company / party code cluster (not-sent anchors)."
          onClose={() => setShowTradeBulkSend(false)}
          onSuccess={() => {
            setShowTradeBulkSend(false);
            fetchRecords();
          }}
          onRefreshList={fetchRecords}
        />
      )}

      {showEntityAttachment && (
        <EntityAttachmentModal
          entityNames={entityNames}
          scopeCategory={fixedCategory}
          scopeModule={moduleKey}
          onClose={() => setShowEntityAttachment(false)}
          onSuccess={() => {
            setShowEntityAttachment(false);
            fetchRecords();
          }}
        />
      )}

      {invoiceLinesAnchorId && isTrade && (
        <TradeInvoiceLinesModal
          apiSegment={apiSegment}
          moduleTitle={title}
          anchorId={invoiceLinesAnchorId}
          onClose={() => setInvoiceLinesAnchorId(null)}
        />
      )}
    </div>
  );
}

function fallbackInvoiceSummary(lines: TradeInvoiceLineRow[]): TradeInvoiceLinesSummary {
  const names = new Set(lines.map((l) => l.entityName.trim()).filter(Boolean));
  const entityLabel =
    names.size === 0 ? '—' : names.size === 1 ? [...names][0]! : 'Multiple entities';

  let sum = 0;
  let anyParsed = false;
  for (const line of lines) {
    const v = parseInrAmountString(line.currencyRaw);
    if (v !== null) {
      anyParsed = true;
      sum += v;
    }
  }
  if (!anyParsed) {
    return { entityLabel, outstandingAmount: '—', outstandingDebitCredit: '—' };
  }
  return {
    entityLabel,
    outstandingAmount: formatInrAmount(Math.abs(sum)),
    outstandingDebitCredit: debitCreditLabel(sum),
  };
}

function TradeInvoiceLinesModal({
  apiSegment,
  moduleTitle,
  anchorId,
  onClose,
}: {
  apiSegment: ModuleRouteSegment;
  moduleTitle: string;
  anchorId: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TradeInvoiceLineRow[] | null>(null);
  const [summary, setSummary] = useState<TradeInvoiceLinesSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setSummary(null);
      try {
        const q = `/api/modules/${apiSegment}/invoice-lines?anchorId=${encodeURIComponent(anchorId)}`;
        const res = await fetch(q);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(data.error || 'Failed to load');
          setLines([]);
          setSummary(null);
          return;
        }
        if (!cancel) {
          const list = Array.isArray(data.lines) ? data.lines : [];
          setLines(list);
          setSummary(
            data.summary && typeof data.summary === 'object'
              ? (data.summary as TradeInvoiceLinesSummary)
              : list.length > 0
                ? fallbackInvoiceSummary(list)
                : null,
          );
        }
      } catch {
        if (!cancel) {
          setErr('Network error');
          setLines([]);
          setSummary(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [apiSegment, anchorId]);

  const statusBadge = (s: TradeInvoiceLineRow['lineStatus']) => {
    if (s === 'confirmed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (s === 'queried_no_confirm') return 'bg-amber-100 text-amber-900 border-amber-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };

  const statusLabel = (s: TradeInvoiceLineRow['lineStatus']) => {
    if (s === 'confirmed') return 'Confirmed';
    if (s === 'queried_no_confirm') return 'Query';
    return 'Open';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
            <p className="text-sm text-slate-500 mt-0.5">{moduleTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
          {loading && <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>}
          {err && <p className="text-sm text-red-600 py-4">{err}</p>}
          {!loading && !err && lines && lines.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">No lines found.</p>
          )}
          {!loading && lines && lines.length > 0 && (
            <>
              {summary && (
                <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <p>
                    <span className="text-slate-500">Entity </span>
                    <span className="font-medium text-slate-900">{summary.entityLabel}</span>
                  </p>
                  <p className="mt-2">
                    <span className="text-slate-500">Outstanding </span>
                    <span className="font-semibold tabular-nums text-slate-900">{summary.outstandingAmount}</span>
                    {summary.outstandingDebitCredit !== '—' && (
                      <span className="ml-2 text-slate-700">{summary.outstandingDebitCredit}</span>
                    )}
                  </p>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-600 text-xs uppercase tracking-wide">
                      <th className="p-3">Document date</th>
                      <th className="p-3">Document no.</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3">Dr/Cr</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">In party books (query)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((r) => (
                      <tr key={r.id} className="bg-white hover:bg-slate-50/80">
                        <td className="p-3 text-slate-700">{r.documentDate || '—'}</td>
                        <td className="p-3 font-mono text-xs text-slate-700">{r.documentNumber || '—'}</td>
                        <td className="p-3 text-right tabular-nums text-slate-900">{r.amountAbsDisplay}</td>
                        <td className="p-3 text-slate-800">{r.debitCredit}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusBadge(r.lineStatus)}`}
                          >
                            {statusLabel(r.lineStatus)}
                          </span>
                        </td>
                        <td className="p-3 text-right tabular-nums text-slate-800">
                          {r.amountInBooksDisplay ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end flex-shrink-0 bg-slate-50/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 text-slate-800 text-sm font-medium hover:bg-slate-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleListingUploadModal({
  apiSegment,
  moduleLabel,
  variant = 'sap',
  onClose,
  onSuccess,
}: {
  apiSegment: ModuleRouteSegment;
  moduleLabel: string;
  variant?: 'sap' | 'msme';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    try {
      const res = await fetch(`/api/modules/${apiSegment}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
        return;
      }
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{variant === 'msme' ? 'Upload customers' : 'Upload listing'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {variant === 'msme'
                ? `${moduleLabel} — CSV or Excel with Customer Name, Email TO, optional Email CC / Remarks`
                : `${moduleLabel} — Excel/CSV from SAP-style listing export`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
          <div className="flex gap-3">
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="flex-1 cursor-pointer">
                <input type="radio" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                <div className={`p-3 rounded-xl border-2 ${mode === m ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="text-sm font-medium capitalize">{m}</p>
                  <p className="text-xs text-gray-500">{m === 'replace' ? 'Remove existing rows in this module only' : 'Add new rows'}</p>
                </div>
              </label>
            ))}
          </div>
          {mode === 'replace' && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Replace deletes only <strong>{moduleLabel}</strong> records, not the other module.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-800 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            {uploading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MsmeBulkSendModal({
  records,
  apiSegment,
  heading = 'Bulk send',
  helperText,
  onClose,
  onSuccess,
  onRefreshList,
}: {
  records: ConfirmationRecord[];
  apiSegment: ModuleRouteSegment;
  heading?: string;
  /** Replaces default MSME/trade helper line under the title */
  helperText?: string;
  onClose: () => void;
  onSuccess: () => void;
  onRefreshList: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(records.map((r) => r.id)));
  const [remainingDaily, setRemainingDaily] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ConfirmationRecord | null>(null);
  const [previewSending, setPreviewSending] = useState(false);

  useEffect(() => {
    fetch('/api/confirmations/email-limit')
      .then((r) => r.json())
      .then((d) => setRemainingDaily(typeof d.remaining === 'number' ? d.remaining : null))
      .catch(() => setRemainingDaily(null));
  }, []);

  useEffect(() => {
    setSelectedIds(new Set(records.map((r) => r.id)));
  }, [records]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const dailyLine = `Daily limit (all modules): ${remainingDaily ?? '—'} remaining before this run.`;
  const helperLine = helperText ? `${helperText} ${dailyLine}` : `Not-sent rows only. ${dailyLine}`;

  const handlePreviewSendConfirm = async (overrides: {
    emailTo: string;
    emailCc: string;
    remarks: string;
    emailBody?: string;
  }) => {
    if (!previewRecord) return;
    setPreviewSending(true);
    try {
      const putRes = await fetch(`/api/confirmations/${previewRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailTo: overrides.emailTo,
          emailCc: overrides.emailCc || null,
          remarks: overrides.remarks || null,
        }),
      });
      const putData = await putRes.json().catch(() => ({}));
      if (!putRes.ok) throw new Error((putData as { error?: string }).error || 'Failed to save');
      const res = await fetch(`/api/confirmations/${previewRecord.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody: overrides.emailBody || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setPreviewRecord(null);
      onRefreshList();
    } finally {
      setPreviewSending(false);
    }
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      setError('Select at least one row.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/modules/${apiSegment}/bulk-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordIds: [...selectedIds],
          includeNotSentOnly: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Bulk send failed');
        return;
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const msg = data.errors
          .slice(0, 5)
          .map((e: { id: string; error: string }) => e.error)
          .join('; ');
        window.alert(
          `Sent ${data.sent} email(s). ${data.errors.length} failed${data.errors.length > 5 ? ' (showing first 5 errors)' : ''}: ${msg}`
        );
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bulk send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{helperLine}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            ✕
          </button>
        </div>
        <div className="px-6 py-4 flex-1 min-h-0 flex flex-col gap-3">
          {records.length === 0 ? (
            <p className="text-sm text-gray-600">No rows with status &quot;Not Sent&quot;.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline"
                  onClick={() => setSelectedIds(new Set(records.map((r) => r.id)))}
                >
                  Select all
                </button>
                <button type="button" className="text-xs text-gray-600 hover:underline" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
              </div>
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 min-h-0 max-h-[50vh] overflow-y-auto">
                {records.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-gray-50/80"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="mt-1 rounded border-gray-300 text-blue-600"
                    />
                    <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 sm:items-center">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">{r.entityName}</div>
                        <div className="text-xs text-gray-500 break-all">{r.emailTo}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewRecord(r)}
                        className="text-xs font-medium text-violet-600 hover:text-violet-800 whitespace-nowrap self-start sm:self-center"
                      >
                        Preview email
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-600 flex-shrink-0">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-800 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || records.length === 0 || selectedIds.size === 0}
            onClick={handleSend}
            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send selected'}
          </button>
        </div>
      </div>
    </div>
    {previewRecord && (
      <SendConfirmModal
        record={previewRecord}
        mode="send"
        onClose={() => !previewSending && setPreviewRecord(null)}
        onConfirm={handlePreviewSendConfirm}
      />
    )}
    </>
  );
}

function MsmeBulkFollowupModal({
  records,
  apiSegment,
  onClose,
  onSuccess,
  onRefreshList,
}: {
  records: ConfirmationRecord[];
  apiSegment: ModuleRouteSegment;
  onClose: () => void;
  onSuccess: () => void;
  onRefreshList: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(records.map((r) => r.id)));
  const [remainingDaily, setRemainingDaily] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ConfirmationRecord | null>(null);
  const [previewSending, setPreviewSending] = useState(false);

  useEffect(() => {
    fetch('/api/confirmations/email-limit')
      .then((r) => r.json())
      .then((d) => setRemainingDaily(typeof d.remaining === 'number' ? d.remaining : null))
      .catch(() => setRemainingDaily(null));
  }, []);

  useEffect(() => {
    setSelectedIds(new Set(records.map((r) => r.id)));
  }, [records]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const dailyLine = `Daily limit (all modules): ${remainingDaily ?? '—'} remaining before this run.`;

  const handlePreviewFollowupConfirm = async (overrides: {
    emailTo: string;
    emailCc: string;
    remarks: string;
    emailBody?: string;
  }) => {
    if (!previewRecord) return;
    setPreviewSending(true);
    try {
      const putRes = await fetch(`/api/confirmations/${previewRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailTo: overrides.emailTo,
          emailCc: overrides.emailCc || null,
          remarks: overrides.remarks || null,
        }),
      });
      const putData = await putRes.json().catch(() => ({}));
      if (!putRes.ok) throw new Error((putData as { error?: string }).error || 'Failed to save');
      const res = await fetch(`/api/confirmations/${previewRecord.id}/followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody: overrides.emailBody || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Follow-up failed');
      setPreviewRecord(null);
      onRefreshList();
    } finally {
      setPreviewSending(false);
    }
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      setError('Select at least one row.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/modules/${apiSegment}/bulk-followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordIds: [...selectedIds],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Bulk follow-up failed');
        return;
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const msg = data.errors
          .slice(0, 5)
          .map((e: { id: string; error: string }) => e.error)
          .join('; ');
        window.alert(
          `Sent ${data.sent} follow-up(s). ${data.errors.length} failed${data.errors.length > 5 ? ' (showing first 5 errors)' : ''}: ${msg}`
        );
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bulk follow-up failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 flex-shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bulk follow-up</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Rows with status Email sent or Follow-up sent. {dailyLine}
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
              ✕
            </button>
          </div>
          <div className="px-6 py-4 flex-1 min-h-0 flex flex-col gap-3">
            {records.length === 0 ? (
              <p className="text-sm text-gray-600">No rows eligible for follow-up.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setSelectedIds(new Set(records.map((r) => r.id)))}
                  >
                    Select all
                  </button>
                  <button type="button" className="text-xs text-gray-600 hover:underline" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                </div>
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 min-h-0 max-h-[50vh] overflow-y-auto">
                  {records.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-gray-50/80"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggle(r.id)}
                        className="mt-1 rounded border-gray-300 text-amber-600"
                      />
                      <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 sm:items-center">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900">{r.entityName}</div>
                          <div className="text-xs text-gray-500 break-all">{r.emailTo}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewRecord(r)}
                          className="text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap self-start sm:self-center"
                        >
                          Preview follow-up
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {error && <p className="text-sm text-red-600 flex-shrink-0">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-800 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={sending || records.length === 0 || selectedIds.size === 0}
              onClick={handleSend}
              className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send follow-up to selected'}
            </button>
          </div>
        </div>
      </div>
      {previewRecord && (
        <SendConfirmModal
          record={previewRecord}
          mode="followup"
          onClose={() => !previewSending && setPreviewRecord(null)}
          onConfirm={handlePreviewFollowupConfirm}
        />
      )}
    </>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-xl transition-colors ${
          selected.length ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        {label}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[210px] max-h-64 overflow-y-auto">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="w-full px-4 py-2 text-left text-xs text-red-500 hover:bg-red-50 border-b border-gray-100"
              >
                Clear selection
              </button>
            )}
            {options.map((opt) => (
              <button
                type="button"
                key={opt}
                onClick={() => onToggle(opt)}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <span
                  className={`w-4 h-4 border rounded flex-shrink-0 ${selected.includes(opt) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}
                />
                <span className="text-xs">{opt}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
