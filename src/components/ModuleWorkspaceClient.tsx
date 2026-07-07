'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ConfirmationTable, { ConfirmationRecord } from '@/components/ConfirmationTable';
import EntityAttachmentModal from '@/components/EntityAttachmentModal';
import SendConfirmModal from '@/components/SendConfirmModal';
import { categoryForModule, moduleKeyToRoute } from '@/lib/module-types';
import type { ModuleKey, ModuleRouteSegment } from '@/lib/module-types';
import type { TradeInvoiceLineRow, TradeInvoiceLinesSummary } from '@/app/api/modules/[segment]/invoice-lines/route';
import { parseInrAmountString, debitCreditLabel, formatInrAmount, drCrBadgeClassNames } from '@/lib/inr-amount';
import { effectiveMsmeContactEmail } from '@/lib/msme-display-email';
import FiscalFilterBar from '@/components/FiscalFilterBar';
import FiscalPeriodSelects from '@/components/FiscalPeriodSelects';
import {
  formatFyOption,
  formatQuarterOption,
  useFiscalFilter,
} from '@/components/FiscalFilterProvider';
import {
  defaultListingFiscalSelection,
  listingUploadYearOptions,
} from '@/lib/listing-upload-fiscal';

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

const FISCAL_QUARTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All quarters' },
  { value: '1', label: 'Q1 (Apr–Jun)' },
  { value: '2', label: 'Q2 (Jul–Sep)' },
  { value: '3', label: 'Q3 (Oct–Dec)' },
  { value: '4', label: 'Q4 (Jan–Mar)' },
];

const CONFIRMATION_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'queried', label: 'Queried' },
  { value: 'none', label: 'Pending' },
];

function fiscalPayloadFromSelection(fiscalYear: string, fiscalQuarter: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (fiscalYear) {
    const y = parseInt(fiscalYear, 10);
    if (Number.isFinite(y)) out.reportingFiscalYear = y;
  }
  if (fiscalQuarter) {
    const q = parseInt(fiscalQuarter, 10);
    if (Number.isFinite(q)) out.reportingFiscalQuarter = q;
  }
  return out;
}

type BulkWorkspaceFilters = {
  selectedEntities: string[];
  selectedStatuses: string[];
  search: string;
  confirmationKindFilter: string;
  selectedCompanyCodes: string[];
};

function buildBulkConfirmationsParams(
  moduleKey: ModuleKey,
  isTrade: boolean,
  workspace: BulkWorkspaceFilters,
  fiscalYear: string,
  fiscalQuarter: string,
  mode: 'workspace_status' | 'followup_eligible'
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('module', moduleKey);
  workspace.selectedEntities.forEach((e) => params.append('entity', e));
  if (mode === 'followup_eligible') {
    params.append('status', 'sent');
    params.append('status', 'followup_sent');
    params.set('fiscalMatchMode', 'includeDerivedSent');
    params.set('diagnostics', 'true');
  } else {
    workspace.selectedStatuses.forEach((s) => params.append('status', s));
    if (workspace.confirmationKindFilter !== 'all') {
      params.set('confirmationKind', workspace.confirmationKindFilter);
    }
  }
  if (workspace.search) params.set('search', workspace.search);
  if (fiscalYear) params.append('reportingFiscalYear', fiscalYear);
  if (fiscalQuarter) params.append('reportingFiscalQuarter', fiscalQuarter);
  workspace.selectedCompanyCodes.forEach((c) => params.append('company', c));
  if (isTrade) {
    params.set('listMode', 'by_code');
    params.set('omitTradeLines', 'true');
  }
  params.set('unpaged', 'true');
  return params;
}

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

  const { fiscalYear, fiscalQuarter, availableYears, ready: fiscalReady } = useFiscalFilter();

  useEffect(() => {
    fetch('/api/fiscal-filter/backfill', { method: 'POST' }).catch(() => {});
  }, []);

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
  const [companyCodeOptions, setCompanyCodeOptions] = useState<string[]>([]);
  const [selectedCompanyCodes, setSelectedCompanyCodes] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [sortField, setSortField] = useState<SortField>('entityName');
  const [sortAsc, setSortAsc] = useState(true);

  const [showListingUpload, setShowListingUpload] = useState(false);
  const [showEntityAttachment, setShowEntityAttachment] = useState(false);
  const [showBulkSend, setShowBulkSend] = useState(false);
  const [showBulkFollowup, setShowBulkFollowup] = useState(false);
  const [showTradeBulkSend, setShowTradeBulkSend] = useState(false);
  const [invoiceLinesAnchorId, setInvoiceLinesAnchorId] = useState<string | null>(null);
  const [tpHydrated, setTpHydrated] = useState(moduleKey !== 'trade_payable');

  const pageStats: TradeWorkspaceStats = {
    total: records.length,
    notSent: records.filter((r) => r.status === 'not_sent').length,
    sent: records.filter((r) => r.status === 'sent').length,
    followupSent: records.filter((r) => r.status === 'followup_sent').length,
    responseReceived: records.filter((r) => r.status === 'response_received').length,
  };

  const stats = isTrade && tradeWorkspaceStats ? tradeWorkspaceStats : pageStats;

  const fetchRecords = useCallback(async () => {
    if (!fiscalReady || !fiscalYear || !fiscalQuarter) return;
    if (moduleKey === 'trade_payable' && !tpHydrated) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('module', moduleKey);
      selectedEntities.forEach((e) => params.append('entity', e));
      selectedStatuses.forEach((s) => params.append('status', s));
      if (search) params.set('search', search);
      if (confirmationKindFilter !== 'all') params.set('confirmationKind', confirmationKindFilter);
      params.append('reportingFiscalYear', fiscalYear);
      params.append('reportingFiscalQuarter', fiscalQuarter);
      selectedCompanyCodes.forEach((c) => params.append('company', c));
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
      if (Array.isArray(data.companyCodes)) {
        setCompanyCodeOptions(data.companyCodes as string[]);
      }
      if (isTrade && data.stats && typeof data.stats === 'object') {
        setTradeWorkspaceStats(data.stats as TradeWorkspaceStats);
      } else {
        setTradeWorkspaceStats(null);
      }
    } finally {
      setLoading(false);
    }
  }, [
    moduleKey,
    selectedEntities,
    selectedStatuses,
    search,
    confirmationKindFilter,
    fiscalYear,
    fiscalQuarter,
    fiscalReady,
    selectedCompanyCodes,
    isTrade,
    page,
    pageSize,
    tpHydrated,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    moduleKey,
    selectedEntities,
    selectedStatuses,
    search,
    confirmationKindFilter,
    fiscalYear,
    fiscalQuarter,
    selectedCompanyCodes,
    pageSize,
  ]);

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

  useEffect(() => {
    if (moduleKey !== 'trade_payable') {
      setTpHydrated(true);
      return;
    }
    let cancelled = false;
    setTpHydrated(false);
    (async () => {
      try {
        await fetch(`/api/modules/${apiSegment}/hydrate-from-vendors`, { method: 'POST' });
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setTpHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, apiSegment]);

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
    setSelectedCompanyCodes([]);
    setPage(1);
  };

  const hasActiveFilters =
    selectedEntities.length > 0 ||
    selectedStatuses.length > 0 ||
    search.length > 0 ||
    confirmationKindFilter !== 'all' ||
    selectedCompanyCodes.length > 0;

  const totalPages = isTrade ? Math.max(1, Math.ceil(totalAnchors / pageSize)) : 1;

  const workspaceBulkFilters = useMemo(
    (): BulkWorkspaceFilters => ({
      selectedEntities,
      selectedStatuses,
      search,
      confirmationKindFilter,
      selectedCompanyCodes,
    }),
    [selectedEntities, selectedStatuses, search, confirmationKindFilter, selectedCompanyCodes]
  );

  const fiscalSelectionIncomplete = !fiscalYear || !fiscalQuarter;

  const openMsmeBulkSend = useCallback(() => {
    if (fiscalSelectionIncomplete) {
      window.alert('Select a financial year and quarter before bulk send.');
      return;
    }
    setShowBulkSend(true);
  }, [fiscalSelectionIncomplete]);

  const openMsmeBulkFollowup = useCallback(() => {
    if (fiscalSelectionIncomplete) {
      window.alert('Select a financial year and quarter before bulk follow-up.');
      return;
    }
    setShowBulkFollowup(true);
  }, [fiscalSelectionIncomplete]);

  const openTradeBulkSend = useCallback(() => {
    if (fiscalSelectionIncomplete) {
      window.alert('Select a financial year and quarter before bulk send.');
      return;
    }
    setShowTradeBulkSend(true);
  }, [fiscalSelectionIncomplete]);

  const openTradeBulkFollowup = useCallback(() => {
    if (fiscalSelectionIncomplete) {
      window.alert('Select a financial year and quarter before bulk follow-up.');
      return;
    }
    setShowBulkFollowup(true);
  }, [fiscalSelectionIncomplete]);

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-gray-200/90 px-6 py-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-2xl">
            {subtitle ||
              (isMsme ? `MSME confirmations — ${fixedCategory}` : `Balance confirmation — ${fixedCategory}`)}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:justify-end shrink-0">
          {repliesMessage && (
            <span className="text-sm text-emerald-800 font-medium bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200/80 order-first sm:order-none">
              {repliesMessage}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2 justify-end p-1 rounded-xl bg-neutral-50/90 border border-gray-200/80">
            <button
              type="button"
              onClick={handleCheckReplies}
              disabled={checkingReplies}
              className="flex items-center justify-center gap-2 px-3.5 py-2 border border-gray-200/90 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50/80 transition-colors disabled:opacity-50 shadow-sm"
            >
              <svg className={`w-4 h-4 ${checkingReplies ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Check replies
            </button>
            {isTrade && (
              <>
                <button
                  type="button"
                  onClick={openTradeBulkSend}
                  className="flex items-center justify-center px-3.5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 transition-colors shadow-sm"
                >
                  Bulk send
                </button>
                <button
                  type="button"
                  onClick={openTradeBulkFollowup}
                  className="flex items-center justify-center px-3.5 py-2 border border-gray-200 bg-white text-gray-800 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  Bulk follow-up
                </button>
              </>
            )}
            {isMsme ? (
              <>
                <button
                  type="button"
                  onClick={openMsmeBulkSend}
                  className="flex items-center justify-center px-3.5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 transition-colors shadow-sm"
                >
                  Bulk send
                </button>
                <button
                  type="button"
                  onClick={openMsmeBulkFollowup}
                  className="flex items-center justify-center px-3.5 py-2 border border-gray-200 bg-white text-gray-800 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  Bulk follow-up
                </button>
              </>
            ) : !isTrade ? (
              <button
                type="button"
                onClick={() => setShowListingUpload(true)}
                className="flex items-center justify-center px-3.5 py-2 border border-gray-200 bg-white text-gray-800 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              >
                Upload customers
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="rounded-2xl border border-gray-100 bg-neutral-50/70 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {[
              { label: 'Total', count: stats.total, color: 'text-gray-800', bg: 'bg-white border border-gray-200/90' },
              { label: 'Not sent', count: stats.notSent, color: 'text-gray-700', bg: 'bg-white border border-gray-200/90' },
              { label: 'Sent', count: stats.sent, color: 'text-neutral-900', bg: 'bg-white border border-gray-200/90' },
              { label: 'Follow-up', count: stats.followupSent, color: 'text-neutral-800', bg: 'bg-white border border-gray-200/90' },
              { label: 'Response', count: stats.responseReceived, color: 'text-emerald-800', bg: 'bg-emerald-50 border border-emerald-200/70' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className={`text-xs font-semibold tabular-nums px-2.5 py-1 rounded-lg ${s.bg} ${s.color}`}>{s.count}</span>
                <span className="text-xs font-medium text-gray-500">{s.label}</span>
              </div>
            ))}
          </div>
          {stats.total > 0 && (
            <div className="flex items-center gap-3 min-w-[10rem]">
              <div className="flex-1 h-2 bg-gray-200/90 rounded-full overflow-hidden max-w-[140px]">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${Math.round((stats.responseReceived / stats.total) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                {Math.round((stats.responseReceived / stats.total) * 100)}% responded
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <FiscalFilterBar inline className="lg:mr-2" />
            <div className="hidden sm:block w-px h-10 bg-gray-200 self-end" aria-hidden />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end flex-1 min-w-0 w-full">
          <div className="lg:col-span-3 relative min-w-0">
            <label className="sr-only">Search</label>
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entity, bank, email…"
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20 focus:border-transparent"
            />
          </div>

          <div className="lg:col-span-2 min-w-0">
            <FilterDropdown
              fullWidth
              label={selectedEntities.length ? `${selectedEntities.length} entities` : 'All entities'}
              options={entityNames}
              selected={selectedEntities}
              onToggle={(v) => toggleFilter(selectedEntities, setSelectedEntities, v)}
              onClear={() => setSelectedEntities([])}
            />
          </div>

          <div className="lg:col-span-2 min-w-0">
            <FilterDropdown
              fullWidth
              label={selectedStatuses.length ? `${selectedStatuses.length} status` : 'All status'}
              options={STATUS_OPTIONS.map((s) => s.label)}
              selected={selectedStatuses.map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label || s)}
              onToggle={(v) => {
                const val = STATUS_OPTIONS.find((o) => o.label === v)?.value || v;
                toggleFilter(selectedStatuses, setSelectedStatuses, val);
              }}
              onClear={() => setSelectedStatuses([])}
            />
          </div>

          <div className="lg:col-span-2 min-w-0">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Confirmation</label>
            <select
              value={confirmationKindFilter}
              onChange={(e) => setConfirmationKindFilter(e.target.value)}
              className="w-full h-10 text-sm border border-gray-200 rounded-xl px-3 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
              aria-label="Filter by confirmation status"
            >
              {CONFIRMATION_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {(isTrade || isMsme) && (
            <div className="lg:col-span-2 min-w-0">
              <FilterDropdown
                fullWidth
                label={selectedCompanyCodes.length ? `${selectedCompanyCodes.length} co.` : 'All companies'}
                options={companyCodeOptions}
                selected={selectedCompanyCodes}
                onToggle={(v) => toggleFilter(selectedCompanyCodes, setSelectedCompanyCodes, v)}
                onClear={() => setSelectedCompanyCodes([])}
              />
            </div>
          )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-3 mt-1 border-t border-gray-100">
          <p className="text-[11px] text-neutral-500 order-2 sm:order-1">
            {fiscalSelectionIncomplete
              ? 'Select a financial year and quarter above to load records.'
              : 'Records, sends, and follow-ups are scoped to the selected reporting period.'}
          </p>
          <div className="flex flex-wrap items-center gap-3 justify-end order-1 sm:order-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50/80 transition-colors"
              >
                Clear all filters
              </button>
            )}
            <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500">
              <span className="font-medium text-gray-600 mr-1">Sort</span>
              {(['entityName', 'status', 'sentAt', 'responseReceivedAt'] as SortField[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleSort(f)}
                  className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                    sortField === f ? 'bg-neutral-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                  }`}
                >
                  {(
                    {
                      entityName: 'Entity',
                      category: 'Category',
                      status: 'Status',
                      sentAt: 'Sent',
                      responseReceivedAt: 'Response',
                    } as Record<string, string>
                  )[f]}
                  {sortField === f && <span className="ml-0.5">{sortAsc ? '↑' : '↓'}</span>}
                </button>
              ))}
            </div>
          </div>
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
                  className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/25"
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
          apiSegment={apiSegment}
          moduleKey={moduleKey}
          isTrade={false}
          workspaceBulkFilters={workspaceBulkFilters}
          fiscalYear={fiscalYear}
          fiscalQuarter={fiscalQuarter}
          availableYears={availableYears}
          onClose={() => setShowBulkSend(false)}
          onSuccess={() => {
            setShowBulkSend(false);
            fetchRecords();
          }}
          onRefreshList={fetchRecords}
        />
      )}

      {showBulkFollowup && (isMsme || isTrade) && (
        <MsmeBulkFollowupModal
          apiSegment={apiSegment}
          moduleKey={moduleKey}
          isTrade={isTrade}
          helperText={
            isTrade
              ? 'One follow-up email per company / party code cluster (sent or follow-up sent anchors matching filters below).'
              : undefined
          }
          workspaceBulkFilters={workspaceBulkFilters}
          fiscalYear={fiscalYear}
          fiscalQuarter={fiscalQuarter}
          availableYears={availableYears}
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
          apiSegment={apiSegment}
          moduleKey={moduleKey}
          isTrade
          heading="Bulk send"
          helperText="One email per company / party code cluster (not-sent anchors matching filters below)."
          workspaceBulkFilters={workspaceBulkFilters}
          fiscalYear={fiscalYear}
          fiscalQuarter={fiscalQuarter}
          availableYears={availableYears}
          onClose={() => {
            setShowTradeBulkSend(false);
          }}
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
    if (s === 'queried_no_confirm') return 'bg-neutral-100 text-neutral-900 border-neutral-300';
    return 'bg-neutral-100 text-neutral-600 border-neutral-200';
  };

  const statusLabel = (s: TradeInvoiceLineRow['lineStatus']) => {
    if (s === 'confirmed') return 'Confirmed';
    if (s === 'queried_no_confirm') return 'Query';
    return 'Open';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col border border-neutral-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Invoices</h2>
            <p className="text-sm text-neutral-500 mt-0.5">{moduleTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-600 rounded-lg hover:bg-neutral-100">
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
          {loading && <p className="text-sm text-neutral-500 py-8 text-center">Loading…</p>}
          {err && <p className="text-sm text-red-600 py-4">{err}</p>}
          {!loading && !err && lines && lines.length === 0 && (
            <p className="text-sm text-neutral-500 py-8 text-center">No lines found.</p>
          )}
          {!loading && lines && lines.length > 0 && (
            <>
              {summary && (
                <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm">
                  <p>
                    <span className="text-neutral-500">Entity </span>
                    <span className="font-medium text-neutral-900">{summary.entityLabel}</span>
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-neutral-500">Outstanding </span>
                    <span className="font-semibold tabular-nums text-neutral-900">{summary.outstandingAmount}</span>
                    {summary.outstandingDebitCredit !== '—' && (
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium ${drCrBadgeClassNames(summary.outstandingDebitCredit)}`}
                      >
                        {summary.outstandingDebitCredit}
                      </span>
                    )}
                  </p>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-neutral-100">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 text-left text-neutral-600 text-xs uppercase tracking-wide">
                      <th className="p-3">Document date</th>
                      <th className="p-3">Document no.</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3">Dr/Cr</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">In party books (query)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {lines.map((r) => (
                      <tr key={r.id} className="bg-white hover:bg-neutral-50/80">
                        <td className="p-3 text-neutral-700">{r.documentDate || '—'}</td>
                        <td className="p-3 font-mono text-xs text-neutral-700">{r.documentNumber || '—'}</td>
                        <td className="p-3 text-right tabular-nums text-neutral-900">{r.amountAbsDisplay}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium ${drCrBadgeClassNames(r.debitCredit)}`}
                          >
                            {r.debitCredit}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusBadge(r.lineStatus)}`}
                          >
                            {statusLabel(r.lineStatus)}
                          </span>
                        </td>
                        <td className="p-3 text-right tabular-nums text-neutral-800">
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
        <div className="px-6 py-3 border-t border-neutral-100 flex justify-end flex-shrink-0 bg-neutral-50/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-neutral-200 text-neutral-800 text-sm font-medium hover:bg-neutral-300 transition-colors"
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
  const fiscalYearChoices = useMemo(() => listingUploadYearOptions(), []);
  const fiscalDefaults = useMemo(() => defaultListingFiscalSelection(), []);
  const [reportingFiscalYear, setReportingFiscalYear] = useState(
    () => fiscalDefaults.reportingFiscalYear
  );
  const [reportingFiscalQuarter, setReportingFiscalQuarter] = useState(
    () => fiscalDefaults.reportingFiscalQuarter
  );

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    if (variant === 'sap') {
      formData.append('reportingFiscalYear', reportingFiscalYear);
      formData.append('reportingFiscalQuarter', reportingFiscalQuarter);
    }
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
          {variant === 'sap' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Reporting FY (starts April)</span>
                <select
                  value={reportingFiscalYear}
                  onChange={(e) => setReportingFiscalYear(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                >
                  {fiscalYearChoices.map((y) => (
                    <option key={y} value={String(y)}>
                      FY {y}–{String(y + 1).slice(-2)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Quarter</span>
                <select
                  value={reportingFiscalQuarter}
                  onChange={(e) => setReportingFiscalQuarter(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                >
                  <option value="1">Q1 (Apr–Jun)</option>
                  <option value="2">Q2 (Jul–Sep)</option>
                  <option value="3">Q3 (Oct–Dec)</option>
                  <option value="4">Q4 (Jan–Mar)</option>
                </select>
              </label>
            </div>
          )}
          <div className="flex gap-3">
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="flex-1 cursor-pointer">
                <input type="radio" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                <div className={`p-3 rounded-xl border-2 ${mode === m ? 'border-neutral-900 bg-neutral-50' : 'border-gray-200'}`}>
                  <p className="text-sm font-medium capitalize">{m}</p>
                  <p className="text-xs text-gray-500">{m === 'replace' ? 'Remove existing rows in this module only' : 'Add new rows'}</p>
                </div>
              </label>
            ))}
          </div>
          {mode === 'replace' && (
            <p className="text-xs text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
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
            className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm disabled:opacity-50"
          >
            {uploading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MsmeBulkSendModal({
  apiSegment,
  moduleKey,
  isTrade,
  heading = 'Bulk send',
  helperText,
  workspaceBulkFilters,
  fiscalYear,
  fiscalQuarter,
  availableYears,
  onClose,
  onSuccess,
  onRefreshList,
}: {
  apiSegment: ModuleRouteSegment;
  moduleKey: ModuleKey;
  isTrade: boolean;
  heading?: string;
  helperText?: string;
  workspaceBulkFilters: BulkWorkspaceFilters;
  fiscalYear: string;
  fiscalQuarter: string;
  availableYears: number[];
  onClose: () => void;
  onSuccess: () => void;
  onRefreshList: () => void;
}) {
  const [records, setRecords] = useState<ConfirmationRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remainingDaily, setRemainingDaily] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ConfirmationRecord | null>(null);
  const [previewSending, setPreviewSending] = useState(false);
  const [templateChoices, setTemplateChoices] = useState<
    { id: string; name: string; category: string | null; isDefault: boolean; moduleKey: string | null }[]
  >([]);
  const [templateChoicesLoading, setTemplateChoicesLoading] = useState(false);
  const [bulkTemplateId, setBulkTemplateId] = useState('');

  const fiscalIncomplete = !fiscalYear || !fiscalQuarter;
  const fiscalPayload = useMemo(
    () => fiscalPayloadFromSelection(fiscalYear, fiscalQuarter),
    [fiscalYear, fiscalQuarter]
  );

  useEffect(() => {
    fetch('/api/confirmations/email-limit')
      .then((r) => r.json())
      .then((d) => setRemainingDaily(typeof d.remaining === 'number' ? d.remaining : null))
      .catch(() => setRemainingDaily(null));
  }, []);

  useEffect(() => {
    setTemplateChoicesLoading(true);
    setBulkTemplateId('');
    const q = new URLSearchParams({ moduleKey, purpose: 'initial' });
    fetch(`/api/masters/email-body-templates?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.templates)) setTemplateChoices(d.templates);
        else setTemplateChoices([]);
      })
      .catch(() => setTemplateChoices([]))
      .finally(() => setTemplateChoicesLoading(false));
  }, [moduleKey]);

  useEffect(() => {
    if (fiscalIncomplete) {
      setListLoading(false);
      setRecords([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setFetchError(null);
    const params = buildBulkConfirmationsParams(
      moduleKey,
      isTrade,
      workspaceBulkFilters,
      fiscalYear,
      fiscalQuarter,
      'workspace_status'
    );
    fetch(`/api/confirmations?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not load rows');
        if (cancelled) return;
        setRecords((data.records || []) as ConfirmationRecord[]);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : 'Could not load rows');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleKey, isTrade, workspaceBulkFilters, fiscalYear, fiscalQuarter, fiscalIncomplete]);

  const notSentRows = useMemo(() => records.filter((r) => r.status === 'not_sent'), [records]);

  useEffect(() => {
    setSelectedIds(new Set(notSentRows.map((r) => r.id)));
  }, [notSentRows]);

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
    emailBodyTemplateId?: string;
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
        body: JSON.stringify({
          emailBody: overrides.emailBody || undefined,
          emailBodyTemplateId: overrides.emailBodyTemplateId || undefined,
          ...fiscalPayload,
        }),
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
    if (fiscalIncomplete) {
      setError('Select a financial year and quarter in the filter bar above.');
      return;
    }
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
          ...(bulkTemplateId.trim() ? { emailBodyTemplateId: bulkTemplateId.trim() } : {}),
          ...fiscalPayload,
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

  const periodLabel =
    fiscalYear && fiscalQuarter
      ? `${formatFyOption(fiscalYear)} · ${formatQuarterOption(fiscalQuarter)}`
      : '—';

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200/80">
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
            <div className="rounded-xl border border-gray-200 bg-neutral-50/90 p-4 space-y-3">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Reporting period for this send
              </p>
              <FiscalPeriodSelects
                readOnly
                compact
                fiscalYear={fiscalYear}
                fiscalQuarter={fiscalQuarter}
                availableYears={availableYears}
              />
              {fiscalIncomplete && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
                  Select a financial year and quarter in the filter bar above.
                </p>
              )}
              <p className="text-[11px] text-gray-500">
                Period matches the workspace filter ({periodLabel}). Main-page filters (entity, status, search) still apply.
              </p>
            </div>

            {listLoading && <p className="text-sm text-gray-500">Loading rows…</p>}
            {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}

            {!listLoading && !fetchError && notSentRows.length === 0 && (
              <p className="text-sm text-gray-600">No not-sent rows for this scope.</p>
            )}

            {!listLoading && !fetchError && notSentRows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-neutral-800 hover:underline"
                    onClick={() => setSelectedIds(new Set(notSentRows.map((r) => r.id)))}
                  >
                    Select all
                  </button>
                  <button type="button" className="text-xs text-gray-600 hover:underline" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                  <span className="text-xs text-gray-500 ml-auto">{notSentRows.length} not sent</span>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">
                    Email template
                    <select
                      value={bulkTemplateId}
                      onChange={(e) => setBulkTemplateId(e.target.value)}
                      disabled={templateChoicesLoading}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60 h-10"
                    >
                      <option value="">Automatic (match category / default)</option>
                      {templateChoices.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.isDefault ? ' · default' : ''}
                          {t.category ? ` · ${t.category}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] text-gray-500">
                    Placeholders such as entity name still resolve per row. Preview uses the selected template.
                  </p>
                </div>
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 min-h-0 max-h-[50vh] overflow-y-auto">
                  {notSentRows.map((r) => (
                    <div key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-gray-50/80">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggle(r.id)}
                        className="mt-1 rounded border-gray-300 text-neutral-800"
                      />
                      <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 sm:items-center">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900">{r.entityName}</div>
                          <div className="text-xs text-gray-500 break-all">{r.emailTo}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewRecord(r)}
                          className="text-xs font-medium text-neutral-700 hover:text-neutral-900 whitespace-nowrap self-start sm:self-center"
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
              disabled={sending || fiscalIncomplete || listLoading || notSentRows.length === 0 || selectedIds.size === 0}
              onClick={handleSend}
              className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm disabled:opacity-50"
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
          syncTemplateId={bulkTemplateId}
          onClose={() => !previewSending && setPreviewRecord(null)}
          onConfirm={handlePreviewSendConfirm}
        />
      )}
    </>
  );
}

function MsmeBulkFollowupModal({
  apiSegment,
  moduleKey,
  isTrade,
  helperText,
  workspaceBulkFilters,
  fiscalYear,
  fiscalQuarter,
  availableYears,
  onClose,
  onSuccess,
  onRefreshList,
}: {
  apiSegment: ModuleRouteSegment;
  moduleKey: ModuleKey;
  isTrade: boolean;
  helperText?: string;
  workspaceBulkFilters: BulkWorkspaceFilters;
  fiscalYear: string;
  fiscalQuarter: string;
  availableYears: number[];
  onClose: () => void;
  onSuccess: () => void;
  onRefreshList: () => void;
}) {
  const [records, setRecords] = useState<ConfirmationRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    sentWithoutFiscalStamp: number;
    sentOtherPeriod: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remainingDaily, setRemainingDaily] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ConfirmationRecord | null>(null);
  const [previewSending, setPreviewSending] = useState(false);
  const [templateChoices, setTemplateChoices] = useState<
    { id: string; name: string; category: string | null; isDefault: boolean; moduleKey: string | null }[]
  >([]);
  const [templateChoicesLoading, setTemplateChoicesLoading] = useState(false);
  const [bulkTemplateId, setBulkTemplateId] = useState('');

  const fiscalIncomplete = !fiscalYear || !fiscalQuarter;
  const fiscalPayload = useMemo(
    () => fiscalPayloadFromSelection(fiscalYear, fiscalQuarter),
    [fiscalYear, fiscalQuarter]
  );

  useEffect(() => {
    fetch('/api/confirmations/email-limit')
      .then((r) => r.json())
      .then((d) => setRemainingDaily(typeof d.remaining === 'number' ? d.remaining : null))
      .catch(() => setRemainingDaily(null));
  }, []);

  useEffect(() => {
    setTemplateChoicesLoading(true);
    setBulkTemplateId('');
    const q = new URLSearchParams({ moduleKey, purpose: 'followup' });
    fetch(`/api/masters/email-body-templates?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.templates)) setTemplateChoices(d.templates);
        else setTemplateChoices([]);
      })
      .catch(() => setTemplateChoices([]))
      .finally(() => setTemplateChoicesLoading(false));
  }, [moduleKey]);

  const refreshList = useCallback(() => {
    if (fiscalIncomplete) {
      setListLoading(false);
      setRecords([]);
      setDiagnostics(null);
      return;
    }
    setListLoading(true);
    setFetchError(null);
    const params = buildBulkConfirmationsParams(
      moduleKey,
      isTrade,
      workspaceBulkFilters,
      fiscalYear,
      fiscalQuarter,
      'followup_eligible'
    );
    fetch(`/api/confirmations?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not load rows');
        setRecords((data.records || []) as ConfirmationRecord[]);
        const diag = (data as { diagnostics?: { sentWithoutFiscalStamp?: number; sentOtherPeriod?: number } })
          .diagnostics;
        if (diag) {
          setDiagnostics({
            sentWithoutFiscalStamp: diag.sentWithoutFiscalStamp ?? 0,
            sentOtherPeriod: diag.sentOtherPeriod ?? 0,
          });
        } else {
          setDiagnostics(null);
        }
      })
      .catch((e: unknown) => {
        setFetchError(e instanceof Error ? e.message : 'Could not load rows');
      })
      .finally(() => setListLoading(false));
  }, [moduleKey, isTrade, workspaceBulkFilters, fiscalYear, fiscalQuarter, fiscalIncomplete]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const eligibleRows = useMemo(
    () => records.filter((r) => r.status === 'sent' || r.status === 'followup_sent'),
    [records]
  );

  useEffect(() => {
    setSelectedIds(new Set(eligibleRows.map((r) => r.id)));
  }, [eligibleRows]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const dailyLine = `Daily limit (all modules): ${remainingDaily ?? '—'} remaining before this run.`;
  const periodLabel =
    fiscalYear && fiscalQuarter
      ? `${formatFyOption(fiscalYear)} · ${formatQuarterOption(fiscalQuarter)}`
      : '—';

  const statusLabel = (status: string) =>
    STATUS_OPTIONS.find((o) => o.value === status)?.label || status;

  const formatRowFyQ = (r: ConfirmationRecord) => {
    if (r.reportingFiscalYear != null && r.reportingFiscalQuarter != null) {
      return `${formatFyOption(String(r.reportingFiscalYear))} ${formatQuarterOption(String(r.reportingFiscalQuarter))}`;
    }
    return '—';
  };

  const handlePreviewFollowupConfirm = async (overrides: {
    emailTo: string;
    emailCc: string;
    remarks: string;
    emailBody?: string;
    emailBodyTemplateId?: string;
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
        body: JSON.stringify({
          emailBody: overrides.emailBody || undefined,
          emailBodyTemplateId: overrides.emailBodyTemplateId || undefined,
          ...fiscalPayload,
        }),
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
    if (fiscalIncomplete) {
      setError('Select a financial year and quarter in the filter bar above.');
      return;
    }
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
          ...(bulkTemplateId.trim() ? { emailBodyTemplateId: bulkTemplateId.trim() } : {}),
          ...fiscalPayload,
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200/80">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 flex-shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bulk follow-up</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {helperText || 'Email sent or follow-up sent rows.'} {dailyLine}
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
              ✕
            </button>
          </div>
          <div className="px-6 py-4 flex-1 min-h-0 flex flex-col gap-3">
            <div className="rounded-xl border border-gray-200 bg-neutral-50/90 p-4 space-y-3">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Reporting period for follow-up list
              </p>
              <FiscalPeriodSelects
                readOnly
                compact
                fiscalYear={fiscalYear}
                fiscalQuarter={fiscalQuarter}
                availableYears={availableYears}
              />
              {fiscalIncomplete && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
                  Select a financial year and quarter in the filter bar above.
                </p>
              )}
              <p className="text-[11px] text-gray-500">
                Period matches the workspace filter ({periodLabel}). Main-page filters still apply.
              </p>
            </div>

            {listLoading && <p className="text-sm text-gray-500">Loading rows…</p>}
            {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}

            {!listLoading && !fetchError && eligibleRows.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 text-sm text-gray-700">
                <p className="font-medium text-gray-900">
                  No rows eligible for follow-up in {periodLabel}.
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Possible reasons</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-600">
                  {diagnostics && diagnostics.sentWithoutFiscalStamp > 0 && (
                    <li>
                      {diagnostics.sentWithoutFiscalStamp} sent row
                      {diagnostics.sentWithoutFiscalStamp === 1 ? '' : 's'} exist but have no FY/quarter stamp (will be
                      fixed automatically)
                    </li>
                  )}
                  {diagnostics && diagnostics.sentOtherPeriod > 0 && (
                    <li>
                      {diagnostics.sentOtherPeriod} sent row
                      {diagnostics.sentOtherPeriod === 1 ? '' : 's'} belong to a different period
                    </li>
                  )}
                  <li>Main-page entity, search, or company filters are narrowing the list</li>
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => refreshList()}
                    className="text-xs font-medium text-neutral-800 hover:underline"
                  >
                    Refresh list
                  </button>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-500">Change period in the filter bar above</span>
                </div>
              </div>
            )}

            {!listLoading && !fetchError && eligibleRows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-neutral-800 hover:underline"
                    onClick={() => setSelectedIds(new Set(eligibleRows.map((r) => r.id)))}
                  >
                    Select all
                  </button>
                  <button type="button" className="text-xs text-gray-600 hover:underline" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                  <span className="text-xs text-gray-500 ml-auto">{eligibleRows.length} eligible</span>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">
                    Follow-up template
                    <select
                      value={bulkTemplateId}
                      onChange={(e) => setBulkTemplateId(e.target.value)}
                      disabled={templateChoicesLoading}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60 h-10"
                    >
                      <option value="">Automatic (match category / default)</option>
                      {templateChoices.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.isDefault ? ' · default' : ''}
                          {t.category ? ` · ${t.category}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] text-gray-500">
                    Placeholders still resolve per row. Preview uses the selected follow-up template.
                  </p>
                </div>
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 min-h-0 max-h-[50vh] overflow-y-auto">
                  {eligibleRows.map((r) => {
                    const isMsmeModule = moduleKey === 'confirm_msme';
                    const displayName = isMsmeModule
                      ? r.vendorMasterPartyName?.trim() || r.entityName
                      : r.entityName;
                    const emailDisplay = isMsmeModule ? effectiveMsmeContactEmail(r) : { text: r.emailTo || '', fromReply: false };
                    return (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-gray-50/80">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="mt-1 rounded border-gray-300 text-neutral-700"
                        />
                        <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 sm:items-start">
                          <div className="min-w-0 space-y-1">
                            <div className="font-medium text-gray-900">{displayName}</div>
                            <div className="text-xs text-gray-500 break-all">{emailDisplay.text || '—'}</div>
                            {emailDisplay.fromReply && emailDisplay.text && (
                              <p className="text-[10px] text-gray-400">Vendor reply</p>
                            )}
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 pt-0.5">
                              <span>{statusLabel(r.status)}</span>
                              <span>Follow-up #{r.followupCount ?? 0}</span>
                              <span>{formatRowFyQ(r)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviewRecord(r)}
                            className="text-xs font-medium text-neutral-800 hover:text-neutral-950 whitespace-nowrap self-start"
                          >
                            Preview follow-up
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
              disabled={sending || fiscalIncomplete || listLoading || eligibleRows.length === 0 || selectedIds.size === 0}
              onClick={handleSend}
              className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm disabled:opacity-50"
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
          syncTemplateId={bulkTemplateId}
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
  formatOption,
  fullWidth,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  formatOption?: (opt: string) => string;
  /** Stretch trigger to container width (e.g. grid cells) */
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={fullWidth ? 'relative w-full min-w-0' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-xl transition-colors h-10 ${
          fullWidth ? 'w-full justify-between' : ''
        } ${
          selected.length ? 'border-neutral-800 bg-neutral-100 text-neutral-900' : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
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
                  className={`w-4 h-4 border rounded flex-shrink-0 ${selected.includes(opt) ? 'bg-neutral-900 border-neutral-900' : 'border-neutral-300'}`}
                />
                <span className="text-xs">{formatOption ? formatOption(opt) : opt}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
