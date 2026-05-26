'use client';

import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  buildExecutiveThreads,
  enrichReportRecords,
  type ExecutiveReportThread,
  type ReportFlatRecord,
  type EnrichedReportRecord,
} from '@/lib/report-thread-resolver';
import {
  stringifyBusinessThreadCsvRows,
  stringifyDetailCsvRows,
  stringifyExecutiveCsvRows,
} from '@/lib/report-csv';
import {
  fmtReportDate,
  stripReportHtml,
  buildReportWebSummary,
  isAttemptedOutbound,
} from '@/lib/report-format';
import EmailViewDrawer from '@/components/EmailViewDrawer';
import type { ConfirmationRecord } from '@/components/ConfirmationTable';

type AnyDt = Date | string | null | undefined;

interface FollowupEntry {
  followupNumber: number;
  sentAt: string;
  subject: string;
  filePath: string;
  messageId: string | null;
}

interface ResponseEntry {
  receivedAt: string;
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  htmlBody: string | null;
  body: string | null;
  filePath: string;
  hasAttachments: boolean;
}

interface CanonicalCommWire {
  sentMessageId?: string | null;
  sentAt?: AnyDt;
  sentEmailFilePath?: string | null;
  followupSentAt?: AnyDt;
  followupMessageId?: string | null;
  followupCount: number;
  followupsJson?: string | null;
  responseReceivedAt?: AnyDt;
  responseFromName?: string | null;
  responseFromEmail?: string | null;
  responseBody?: string | null;
  responseHtmlBody?: string | null;
  responseHasAttachments: boolean;
  responsesJson?: string | null;
  webConfirmedAt?: AnyDt;
  emailActionConsumedAt?: AnyDt;
  respondentQueryJson?: string | null;
  status: string;
}

export interface ApiReportRecord extends Omit<
  ReportFlatRecord,
  | 'sentAt'
  | 'followupSentAt'
  | 'responseReceivedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'webConfirmedAt'
  | 'emailActionConsumedAt'
> {
  canonicalComm: CanonicalCommWire;
  effectiveConversationIds: string[];
  effectiveInboundCount: number;
  effectiveOutboundFollowupCount: number;
  threadRootId: string;
  threadRole: 'anchor' | 'invoice_line' | 'standalone';
  canonicalRecordId: string;
  isThreadCanonical: boolean;
  displayEmailTo?: string;
  msmeHasCertificate?: boolean | null;
  listingUploadId?: string | null;
  webResponseSummary?: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
  sentAt: string | Date | null;
  followupSentAt: string | Date | null;
  responseReceivedAt: string | Date | null;
  webConfirmedAt: string | Date | null;
  emailActionConsumedAt: string | Date | null;
}

type ThreadWire = Omit<ExecutiveReportThread<ReportFlatRecord>, 'enrichedLines'> & {
  firstLineCreatedAt?: AnyDt;
  lastActivityAt?: AnyDt;
};

const MODULE_LABELS: Record<string, string> = {
  trade_payable: 'Trade Payables',
  trade_receivable: 'Trade Receivables',
  confirm_msme: 'Confirm MSME',
};

const STATUS_UI: Record<string, { label: string; dot: string; pill: string }> = {
  not_sent: { label: 'Not sent', dot: 'bg-zinc-400', pill: 'bg-zinc-100 text-zinc-800 ring-zinc-200' },
  sent: { label: 'Sent · awaiting reply', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-950 ring-amber-200/80' },
  followup_sent: { label: 'Follow-up sent', dot: 'bg-sky-500', pill: 'bg-sky-50 text-sky-950 ring-sky-200/80' },
  response_received: { label: 'Email response captured', dot: 'bg-emerald-600', pill: 'bg-emerald-50 text-emerald-950 ring-emerald-200/80' },
};

function fmtDtShort(v: AnyDt): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return fmtReportDate(v.toISOString());
  return fmtReportDate(v);
}

function downloadCsv(name: string, body: string) {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ChannelBadgesExec({ thread }: { thread: ThreadWire }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          thread.hasEmailInbound ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-400'
        }`}
        title="Inbox reply"
      >
        Inbox
      </span>
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          thread.hasWebConfirmed ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-400'
        }`}
        title="Web confirmation or secure link used"
      >
        Web
      </span>
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          thread.hasRespondentQuery ? 'bg-orange-600 text-white' : 'bg-zinc-100 text-zinc-400'
        }`}
        title="Counterparty query"
      >
        Query
      </span>
    </div>
  );
}

function displayEmailForRecord(record: ApiReportRecord): string {
  const enriched = record as ApiReportRecord & { displayEmailTo?: string };
  return enriched.displayEmailTo?.trim() || record.emailTo?.trim() || '—';
}

function apiRecordToDrawerRecord(r: ApiReportRecord): ConfirmationRecord {
  const canon = r.canonicalComm;
  const mod =
    r.module === 'trade_payable' || r.module === 'trade_receivable' || r.module === 'confirm_msme'
      ? r.module
      : undefined;
  return {
    id: r.canonicalRecordId,
    module: mod,
    entityName: r.entityName,
    category: r.category,
    bankName: r.bankName,
    custId: r.custId,
    emailTo: r.emailTo,
    emailCc: r.emailCc,
    status: canon.status,
    sentAt: canon.sentAt != null ? String(canon.sentAt) : r.sentAt != null ? String(r.sentAt) : null,
    followupSentAt: canon.followupSentAt != null ? String(canon.followupSentAt) : null,
    followupCount: canon.followupCount,
    followupsJson: canon.followupsJson,
    responsesJson: canon.responsesJson,
    responseReceivedAt: canon.responseReceivedAt != null ? String(canon.responseReceivedAt) : null,
    responseFromEmail: canon.responseFromEmail,
    responseFromName: canon.responseFromName,
    responseBody: canon.responseBody,
    responseHtmlBody: canon.responseHtmlBody,
    responseHasAttachments: canon.responseHasAttachments,
    webConfirmedAt: canon.webConfirmedAt != null ? String(canon.webConfirmedAt) : null,
    respondentQueryJson: canon.respondentQueryJson,
    msmeHasCertificate: r.msmeHasCertificate,
    documentDate: r.documentDate,
    documentNumber: r.documentNumber,
    currencyValue: r.currencyValue,
    remarks: r.remarks,
  };
}

// Column definitions for advanced filter
interface ColDef {
  key: keyof ApiReportRecord | 'followupCount_range' | 'responsesCount';
  label: string;
  type: 'text' | 'select' | 'date' | 'number';
}

const FILTER_COLS: ColDef[] = [
  { key: 'entityName', label: 'Entity Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'select' },
  { key: 'bankName', label: 'Bank / Party', type: 'text' },
  { key: 'emailTo', label: 'Email To', type: 'text' },
  { key: 'status', label: 'Row status', type: 'select' },
  { key: 'sentAt', label: 'Sent After', type: 'date' },
  { key: 'followupCount', label: 'Follow-ups ≥', type: 'number' },
];

interface ActiveFilter {
  id: string;
  col: string;
  value: string;
}

const ALL_CATEGORIES = [
  'Bank Balances and FDs',
  'Borrowings',
  'Trade Receivables',
  'Trade Payables',
  'Other Receivables',
  'Other Payables',
];

function coerceEnriched(api: ApiReportRecord): EnrichedReportRecord<ReportFlatRecord> {
  return api as unknown as EnrichedReportRecord<ReportFlatRecord>;
}

export default function ReportsClient() {
  const [records, setRecords] = useState<ApiReportRecord[]>([]);
  const [threadsApi, setThreadsApi] = useState<ThreadWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'executive' | 'lines'>('executive');
  const [expandedExecutive, setExpandedExecutive] = useState<Set<string>>(new Set());
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [sentFrom, setSentFrom] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showNotSent, setShowNotSent] = useState(false);
  const [viewDrawerRecord, setViewDrawerRecord] = useState<ConfirmationRecord | null>(null);
  const [showAdvancedExport, setShowAdvancedExport] = useState(false);
  const nextFilterId = useRef(1);

  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d: { records?: ApiReportRecord[]; threads?: ThreadWire[] }) => {
        setRecords(d.records ?? []);
        setThreadsApi(d.threads ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const addFilter = () => setActiveFilters((f) => [...f, { id: String(nextFilterId.current++), col: 'entityName', value: '' }]);

  const removeFilter = (id: string) => setActiveFilters((f) => f.filter((x) => x.id !== id));

  const updateFilter = (id: string, patch: Partial<ActiveFilter>) =>
    setActiveFilters((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const toggleStatus = useCallback((s: string) => {
    setSelectedStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }, []);

  const clearFilters = () => {
    setSelectedStatuses([]);
    setSentFrom('');
    setSentTo('');
    setGlobalSearch('');
    setActiveFilters([]);
    setShowNotSent(false);
  };

  const hasActiveFilters =
    selectedStatuses.length > 0 ||
    !!sentFrom ||
    !!sentTo ||
    !!globalSearch.trim() ||
    activeFilters.length > 0 ||
    showNotSent;

  const filteredRecords = useMemo(() => {
    let result = [...records];
    if (!showNotSent) {
      result = result.filter((x) => isAttemptedOutbound(x));
    }

    if (selectedStatuses.length > 0) {
      result = result.filter((x) =>
        selectedStatuses.includes(x.canonicalComm?.status ?? x.status) ||
        selectedStatuses.includes(x.status),
      );
    }

    if (sentFrom) {
      const from = new Date(sentFrom);
      result = result.filter((x) => {
        const at = x.canonicalComm.sentAt ?? x.sentAt;
        return at && new Date(String(at)) >= from;
      });
    }
    if (sentTo) {
      const to = new Date(sentTo + 'T23:59:59');
      result = result.filter((x) => {
        const at = x.canonicalComm.sentAt ?? x.sentAt;
        return at && new Date(String(at)) <= to;
      });
    }

    if (globalSearch.trim()) {
      const q = globalSearch.toLowerCase();
      result = result.filter(
        (x) =>
          x.entityName.toLowerCase().includes(q) ||
          x.category.toLowerCase().includes(q) ||
          (x.bankName ?? '').toLowerCase().includes(q) ||
          x.emailTo.toLowerCase().includes(q) ||
          (x.remarks ?? '').toLowerCase().includes(q) ||
          (x.custId ?? '').toLowerCase().includes(q) ||
          x.threadRootId.toLowerCase().includes(q) ||
          (x.webResponseSummary ?? '').toLowerCase().includes(q) ||
          (x.effectiveConversationIds ?? []).some((cid) => cid.toLowerCase().includes(q)),
      );
    }

    for (const f of activeFilters) {
      if (!f.value.trim()) continue;
      const val = f.value.toLowerCase().trim();
      result = result.filter((x) => {
        const raw = (x as unknown as Record<string, unknown>)[f.col];
        if (f.col === 'sentAt') {
          const at = x.canonicalComm.sentAt ?? x.sentAt;
          return at && new Date(String(at)) >= new Date(f.value);
        }
        if (f.col === 'followupCount')
          return (x.effectiveOutboundFollowupCount ?? x.followupCount ?? 0) >= Number(f.value);
        return String(raw ?? '').toLowerCase().includes(val);
      });
    }

    return result;
  }, [records, showNotSent, selectedStatuses, sentFrom, sentTo, globalSearch, activeFilters]);

  const threadsFilteredSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRecords) s.add(`${r.module}:${r.threadRootId}`);
    return s;
  }, [filteredRecords]);

  /** Full rollup objects from authoritative workspace — filtered by intersect with current facet */
  const displayThreadsExecutive = useMemo(() => {
    const built = threadsApi.filter((t) => threadsFilteredSet.has(t.threadKey));
    return built.slice().sort((a, b) => {
      const en = a.entityName.localeCompare(b.entityName);
      if (en !== 0) return en;
      return a.threadRootId.localeCompare(b.threadRootId);
    });
  }, [threadsApi, threadsFilteredSet]);

  const csvDeps = useMemo(
    () => ({
      fmtDt: fmtReportDate,
      stripHtml: stripReportHtml,
      buildWebSummary: buildReportWebSummary,
    }),
    [],
  );

  const exportDetailFiltered = () => {
    const rows = enrichReportRecords(
      filteredRecords as unknown as ReportFlatRecord[],
    );
    const csv = stringifyDetailCsvRows(rows, csvDeps);
    downloadCsv('detail-lines-report-filtered', csv);
  };

  const exportBusinessFiltered = () => {
    const enrichedAll = records.map(coerceEnriched);
    const threadsBuilt = buildExecutiveThreads(enrichedAll);
    const idSet = new Set(filteredRecords.map((x) => x.id));
    const threadsOut = threadsBuilt.filter((t) => t.lineIds.some((id) => idSet.has(id)));
    const csv = stringifyBusinessThreadCsvRows(threadsOut, csvDeps);
    downloadCsv('outreach-threads-report', csv);
  };

  const exportExecutiveFiltered = () => {
    const enrichedAll = records.map(coerceEnriched);
    const threadsBuilt = buildExecutiveThreads(enrichedAll);
    const idSet = new Set(filteredRecords.map((x) => x.id));
    const threadsOut = threadsBuilt.filter((t) => t.lineIds.some((id) => idSet.has(id)));
    const csv = stringifyExecutiveCsvRows(threadsOut, csvDeps);
    downloadCsv('executive-threads-report-audit', csv);
  };

  const kpisExecutive = useMemo(() => {
    const tlist = displayThreadsExecutive;
    return {
      attempted: tlist.length,
      awaiting: tlist.filter(
        (x) =>
          (x.canonicalComm.status === 'sent' || x.canonicalComm.status === 'followup_sent') &&
          !x.hasEmailInbound &&
          !x.hasWebConfirmed,
      ).length,
      responded: tlist.filter(
        (x) => x.canonicalComm.status === 'response_received' || x.hasWebConfirmed,
      ).length,
      overdue: tlist.filter(
        (x) => !x.hasEmailInbound && (x.daysSinceSent ?? 0) > 14 && !!(x.canonicalComm.sentAt),
      ).length,
      followups: tlist.reduce((sum, x) => sum + (x.effectiveFollowupCount ?? 0), 0),
    };
  }, [displayThreadsExecutive]);

  const kpisLines = useMemo(() => {
    const agg = filteredRecords;
    const totalInbound = agg.reduce((sum, x) => sum + (x.effectiveInboundCount ?? 0), 0);
    return {
      rows: agg.length,
      awaiting: agg.filter(
        (x) =>
          (x.canonicalComm.status === 'sent' || x.canonicalComm.status === 'followup_sent') &&
          !(x.effectiveInboundCount > 0),
      ).length,
      totalInbound,
    };
  }, [filteredRecords]);

  const toggleExecExpand = (k: string) =>
    setExpandedExecutive((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const toggleLineExpand = (id: string) =>
    setExpandedLines((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const openViewThread = useCallback(
    (tw: ThreadWire) => {
      const anchor =
        records.find((r) => r.id === tw.canonicalRecordId) ??
        records.find((r) => r.threadRootId === tw.threadRootId && r.module === tw.module);
      if (anchor) setViewDrawerRecord(apiRecordToDrawerRecord(anchor));
    },
    [records],
  );

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-zinc-100 via-zinc-50 to-white text-zinc-900">
      <header className="border-b border-zinc-200/80 bg-white/90 backdrop-blur-md px-8 py-6 flex-shrink-0">
        <div className="max-w-[1800px] mx-auto flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Outreach</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 mt-1">Reports</h1>
            <p className="text-sm text-zinc-600 mt-2 max-w-2xl leading-relaxed">
              Counterparties where a confirmation email was attempted. Track status, proof channels, and follow-up effort.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <div className="inline-flex rounded-xl bg-zinc-100 p-1 ring-1 ring-zinc-200/70">
              <button
                type="button"
                onClick={() => setViewMode('executive')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'executive'
                    ? 'bg-white shadow-sm text-zinc-950'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                By counterparty
              </button>
              <button
                type="button"
                onClick={() => setViewMode('lines')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'lines'
                    ? 'bg-white shadow-sm text-zinc-950'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                By line
              </button>
            </div>
            <button
              type="button"
              onClick={() => exportBusinessFiltered()}
              className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
            >
              Export CSV ({displayThreadsExecutive.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedExport((v) => !v)}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              {showAdvancedExport ? 'Hide audit exports' : 'Audit exports'}
            </button>
            {showAdvancedExport && (
              <>
                <button
                  type="button"
                  onClick={() => exportDetailFiltered()}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Detail lines ({filteredRecords.length})
                </button>
                <button
                  type="button"
                  onClick={() => exportExecutiveFiltered()}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Full threads ({displayThreadsExecutive.length})
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="px-8 py-4 border-b border-zinc-200/60 bg-white/70">
        <div className="max-w-[1800px] mx-auto grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {viewMode === 'executive' ?
            <>
              <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500">Attempted</p>
                <p className="text-3xl font-bold tabular-nums text-zinc-950">{kpisExecutive.attempted}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-900">Awaiting reply</p>
                <p className="text-3xl font-bold tabular-nums text-amber-950">{kpisExecutive.awaiting}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-800">Responded</p>
                <p className="text-3xl font-bold tabular-nums text-emerald-950">{kpisExecutive.responded}</p>
              </div>
              <div className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-red-900">Overdue &gt;14d</p>
                <p className="text-3xl font-bold tabular-nums text-red-950">{kpisExecutive.overdue}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-sky-900">Follow-ups sent</p>
                <p className="text-3xl font-bold tabular-nums text-sky-950">{kpisExecutive.followups}</p>
              </div>
            </>
          : <>
              <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[10px] uppercase font-semibold text-zinc-500">Exposure lines</p>
                <p className="text-3xl font-bold">{kpisLines.rows}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 sm:col-span-2 lg:col-span-3">
                <p className="text-[10px] uppercase font-semibold text-amber-900">Rows still awaiting verifiable counterpart signal</p>
                <p className="text-3xl font-bold">{kpisLines.awaiting}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 sm:col-span-2 lg:col-span-2">
                <p className="text-[10px] uppercase font-semibold text-zinc-500">Captured email exchanges (canonical)</p>
                <p className="text-3xl font-bold">{kpisLines.totalInbound}</p>
              </div>
            </>
          }
        </div>
      </section>

      <section className="px-8 py-3 border-b border-zinc-200/60 bg-zinc-50/60">
        <div className="max-w-[1800px] mx-auto flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search counterparties, identifiers, invoices, inbox conversation ids…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="flex-1 min-w-[260px] rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-950/30"
            />
            <button
              type="button"
              onClick={() => setShowFilterPanel((p) => !p)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                activeFilters.length > 0
                  ? 'border-zinc-400 bg-white text-zinc-900 shadow-sm'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
              }`}
            >
              Advanced filters {activeFilters.length > 0 && `(${activeFilters.length})`}
            </button>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="text-sm font-semibold text-red-600 hover:text-red-700">
                Clear all
              </button>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showNotSent}
              onChange={(e) => setShowNotSent(e.target.checked)}
              className="rounded border-zinc-300"
            />
            Show not sent (never attempted)
          </label>
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[11px] font-semibold text-zinc-500 mr-2">Status</span>
            {(['not_sent', 'sent', 'followup_sent', 'response_received'] as const)
              .filter((code) => showNotSent || code !== 'not_sent')
              .map((code) => {
              const cfg = STATUS_UI[code] ?? STATUS_UI.sent;
              const active = selectedStatuses.includes(code);
              return (
                <button
                  type="button"
                  key={code}
                  onClick={() => toggleStatus(code)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? `ring-1 ring-offset-2 ring-offset-transparent ${cfg.pill}`
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 bg-white'
                  }`}
                >
                  <span className={`inline-block size-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                  {active && <span>×</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 items-center text-xs text-zinc-600">
            <span className="font-semibold text-zinc-500">Sent anchor date</span>
            <input
              type="date"
              value={sentFrom}
              onChange={(e) => setSentFrom(e.target.value)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs bg-white"
            />
            <span className="text-zinc-400">to</span>
            <input
              type="date"
              value={sentTo}
              onChange={(e) => setSentTo(e.target.value)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs bg-white"
            />
          </div>
          {showFilterPanel && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-2 shadow-inner">
              {activeFilters.map((f) => {
                const colDef = FILTER_COLS.find((c) => c.key === f.col) ?? FILTER_COLS[0];
                return (
                  <div key={f.id} className="flex flex-wrap gap-2 items-center">
                    <select
                      value={f.col}
                      onChange={(e) => updateFilter(f.id, { col: e.target.value, value: '' })}
                      className="rounded-lg border px-3 py-1.5 text-xs bg-white border-zinc-200"
                    >
                      {FILTER_COLS.map((c) => (
                        <option key={String(c.key)} value={String(c.key)}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {colDef.type === 'select' && f.col === 'status' ?
                      <select
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        className="flex-1 min-w-[200px] rounded-lg border px-3 py-1.5 text-xs bg-white border-zinc-200"
                      >
                        <option value="">Any</option>
                        <option value="not_sent">not_sent</option>
                        <option value="sent">sent</option>
                        <option value="followup_sent">followup_sent</option>
                        <option value="response_received">response_received</option>
                      </select>
                    : colDef.type === 'select' && f.col === 'category' ?
                      <select
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        className="flex-1 min-w-[200px] rounded-lg border px-3 py-1.5 text-xs bg-white border-zinc-200"
                      >
                        <option value="">Any</option>
                        {ALL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    : (
                      <input
                        type={colDef.type === 'date' ? 'date' : colDef.type === 'number' ? 'number' : 'text'}
                        placeholder={`Match ${colDef.label}`}
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        className="flex-1 rounded-lg border px-3 py-1.5 text-xs bg-white border-zinc-200"
                      />
                    )}
                    <button type="button" onClick={() => removeFilter(f.id)} className="text-zinc-400 hover:text-red-500 font-bold px-2">
                      ×
                    </button>
                  </div>
                );
              })}
              <button type="button" className="text-xs font-semibold text-zinc-800" onClick={addFilter}>
                + Add criterion
              </button>
            </div>
          )}
        </div>
      </section>

      <main className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-[1800px] mx-auto">
          {viewMode === 'executive' ?
            <ExecutiveTableBlock
              loading={loading}
              threads={displayThreadsExecutive}
              recordsAll={records}
              expandedExecutive={expandedExecutive}
              onToggleExpand={toggleExecExpand}
              onViewThread={openViewThread}
            />
          : <LinesTableBlock
              loading={loading}
              records={filteredRecords}
              expandedLines={expandedLines}
              toggleLineExpand={toggleLineExpand}
            />
          }
          {viewDrawerRecord && (
            <EmailViewDrawer record={viewDrawerRecord} onClose={() => setViewDrawerRecord(null)} />
          )}
          <footer className="mt-10 text-[11px] text-zinc-400 text-center">
            {filteredRecords.length.toLocaleString()} of {records.length.toLocaleString()} rows shown
            {!showNotSent ? ' (attempted outreach only)' : ''}.
          </footer>
        </div>
      </main>
    </div>
  );
}

function ExecutiveTableBlock({
  loading,
  threads,
  recordsAll,
  expandedExecutive,
  onToggleExpand,
  onViewThread,
}: {
  loading: boolean;
  threads: ThreadWire[];
  /** Full workspace enrichment — ensures expanded threads list every routed invoice line */
  recordsAll: ApiReportRecord[];
  expandedExecutive: Set<string>;
  onToggleExpand: (k: string) => void;
  onViewThread: (t: ThreadWire) => void;
}) {
  const linesOf = (tw: ThreadWire) =>
    recordsAll.filter((x) => x.threadRootId === tw.threadRootId && x.module === tw.module).sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt)),
    );

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-x-auto">
      <table className="min-w-[1100px] w-full text-left text-sm border-collapse">
        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider font-semibold text-zinc-500 rounded-t-xl">
          <tr>
            <th className="w-10 px-3 py-3" aria-label="expand" />
            <th className="px-3 py-3">Counterparty</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Module</th>
            <th className="px-3 py-3 hidden lg:table-cell">Recipient</th>
            <th className="px-3 py-3 whitespace-nowrap">Sent</th>
            <th className="px-3 py-3 whitespace-nowrap">Days</th>
            <th className="px-3 py-3 whitespace-nowrap">F/U</th>
            <th className="px-3 py-3 hidden md:table-cell">Proof</th>
            <th className="px-3 py-3 text-right whitespace-nowrap">Amount</th>
            <th className="px-3 py-3 text-right whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ?
            <tr>
              <td colSpan={11} className="text-center py-20 text-zinc-400 animate-pulse">
                Loading…
              </td>
            </tr>
          : threads.length === 0 ?
            <tr>
              <td colSpan={11} className="py-24 text-center text-zinc-500">
                No attempted outreach matches your filters.
              </td>
            </tr>
          : threads.flatMap((tw) => {
              const cx = STATUS_UI[tw.canonicalComm.status] ?? STATUS_UI.sent;
              const open = expandedExecutive.has(tw.threadKey);
              const execRows = [
                <tr
                  key={tw.threadKey}
                  className={`border-t border-zinc-100 hover:bg-zinc-50 transition-colors cursor-pointer ${
                    open ? 'bg-zinc-50/80' : ''
                  }`}
                  onClick={() => onToggleExpand(tw.threadKey)}
                >
                  <td className="px-3 py-4 text-xs text-zinc-400">{open ? '▼' : '▶'}</td>
                  <td className="px-3 py-4">
                    <div className="font-semibold text-zinc-900">{tw.entityName}</div>
                    {tw.custId && <div className="mt-0.5 text-xs text-zinc-500">{tw.custId}</div>}
                  </td>
                  <td className="px-3 py-4 align-top">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cx.pill}`}>
                      <span className={`size-1.5 rounded-full ${cx.dot}`} />
                      {cx.label}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-xs text-zinc-700">
                    {MODULE_LABELS[tw.module] ?? tw.module}
                    <div className="text-[11px] text-zinc-500 mt-0.5">{tw.category}</div>
                  </td>
                  <td className="px-3 py-4 hidden lg:table-cell align-top text-xs text-zinc-700 max-w-[200px] truncate" title={tw.emailTo}>
                    {tw.emailTo}
                  </td>
                  <td className="px-3 py-4 text-xs tabular-nums whitespace-nowrap">
                    {fmtDtShort(tw.canonicalComm.sentAt)}
                  </td>
                  <td className="px-3 py-4 text-xs tabular-nums font-medium">{tw.daysSinceSent ?? '—'}</td>
                  <td className="px-3 py-4 text-xs tabular-nums">{tw.effectiveFollowupCount}</td>
                  <td className="px-3 py-4 hidden md:table-cell align-top">
                    <ChannelBadgesExec thread={tw} />
                  </td>
                  <td className="px-3 py-4 text-right text-xs tabular-nums font-medium whitespace-nowrap">
                    {tw.totalAmountDisplay || '—'}
                  </td>
                  <td className="px-3 py-4 align-top text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onViewThread(tw)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                    >
                      View thread
                    </button>
                  </td>
                </tr>,
              ];
              const subRows = open ?
                [<tr key={`${tw.threadKey}-sub`}>
                    <td colSpan={11} className="bg-zinc-50/95 border-y border-zinc-100 px-6 py-4">
                      <div className="overflow-x-auto">
                        <table className="min-w-[800px] w-full text-[12px]">
                          <thead className="text-[10px] uppercase font-semibold text-zinc-500">
                            <tr>
                              <th className="text-left py-2">Document</th>
                              <th className="text-right py-2">Amount</th>
                              <th className="text-left py-2">Status</th>
                              <th className="text-left py-2">Summary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linesOf(tw).map((ln) => {
                              const su = ln.webResponseSummary ?? '';
                              return (
                                <tr key={ln.id} className="border-t border-zinc-200/70">
                                  <td className="py-2 pr-4">
                                    <div className="font-medium">{ln.bankName ?? ln.documentNumber ?? '—'}</div>
                                    <div className="text-[11px] text-zinc-500">
                                      {ln.documentNumber ? `#${ln.documentNumber}` : ''}
                                      {ln.documentDate ? ` · ${ln.documentDate}` : ''}
                                    </div>
                                  </td>
                                  <td className="py-2 text-right font-mono">{ln.currencyValue ?? '—'}</td>
                                  <td className="py-2 text-[11px]">
                                    {STATUS_UI[ln.canonicalComm.status]?.label ?? ln.canonicalComm.status}
                                  </td>
                                  <td className="py-2 text-[11px] text-zinc-600 max-w-md truncate" title={su}>
                                    {su || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>]
              : [];
              return [...execRows, ...subRows];
            })}
        </tbody>
      </table>
    </div>
  );
}

function LinesTableBlock({
  loading,
  records,
  expandedLines,
  toggleLineExpand,
}: {
  loading: boolean;
  records: ApiReportRecord[];
  expandedLines: Set<string>;
  toggleLineExpand: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-x-auto">
      <table className="min-w-[1280px] w-full text-left text-sm border-collapse">
        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider font-semibold text-zinc-500">
          <tr>
            <th className="px-3 py-3 w-8 " />
            <th className="px-3 py-3">Entity</th>
            <th className="px-3 py-3">Module</th>
            <th className="px-3 py-3 hidden md:table-cell">Document</th>
            <th className="px-3 py-3">Recipient</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Proof</th>
            <th className="px-3 py-3 whitespace-nowrap">Sent</th>
            <th className="px-3 py-3 whitespace-nowrap">Summary</th>
          </tr>
        </thead>
        <tbody>
          {loading ?
            <tr>
              <td colSpan={9} className="text-center py-20 text-zinc-400 animate-pulse">
                Hydrating granular ledger rows…
              </td>
            </tr>
          : records.map((record) => {
              const canon = record.canonicalComm;
              const st = STATUS_UI[canon.status] ?? STATUS_UI.sent;
              const open = expandedLines.has(record.id);
              const webOk = !!(
                canon.webConfirmedAt ??
                record.webConfirmedAt ??
                canon.emailActionConsumedAt ??
                record.emailActionConsumedAt
              );
              const rawQ =
                canon.respondentQueryJson ?? record.respondentQueryJson;
              const qOk = !!(rawQ?.trim() && rawQ !== '[]');
              const inboxCount = record.effectiveInboundCount ?? 0;
              const recipient = displayEmailForRecord(record);
              const sumPreview =
                stripReportHtml(record.webResponseSummary ?? '').slice(0, 140);
              return (
                <Fragment key={record.id}>
                  <tr
                    className={`border-t border-zinc-100 cursor-pointer hover:bg-zinc-50/80 transition-colors ${open ? 'bg-zinc-50' : ''}`}
                    onClick={() => toggleLineExpand(record.id)}
                  >
                    <td className="px-3 py-3 align-top text-[11px] text-zinc-400">{open ? '▼' : '▶'}</td>
                    <td className="px-3 py-3 align-top font-semibold text-zinc-900">
                      {record.entityName}
                      {record.threadRole === 'invoice_line' && (
                        <span className="ml-2 text-[10px] font-normal text-zinc-400">line</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-zinc-700">
                      {MODULE_LABELS[record.module] ?? record.module}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell text-xs align-top text-zinc-700">
                      {record.bankName || record.documentNumber ?
                        <>
                          {record.bankName ?? ''}
                          {record.documentNumber ? ` #${record.documentNumber}` : ''}
                        </>
                      : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-700 max-w-[220px] truncate" title={recipient}>
                      {recipient}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${st.pill}`}>
                        <span className={`size-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center align-middle text-[11px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-center gap-1 flex-wrap">
                        <Badge tiny active={inboxCount > 0} tone="success">Inbox</Badge>
                        <Badge tiny active={webOk} tone="violet">Web</Badge>
                        <Badge tiny active={qOk} tone="orange">Query</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-xs whitespace-nowrap">
                      {fmtDtShort(canon.sentAt ?? record.sentAt)}
                    </td>
                    <td className="px-3 py-3 text-[11px] text-zinc-600 max-w-[220px] truncate" title={sumPreview}>
                      {sumPreview || '—'}
                    </td>
                  </tr>
                  {open ?
                    <tr key={`${record.id}-x`}>
                      <td colSpan={9} className="bg-zinc-50 border-y border-zinc-100 px-6 py-4">
                        <LineExpandedPanel record={record} />
                      </td>
                    </tr>
                  : null}
                </Fragment>
              );
            })}
        </tbody>
      </table>
      {records.length === 0 && !loading && (
        <div className="py-24 text-center text-zinc-500 text-sm border-t border-zinc-100">Ledger empty for supplied filters.</div>
      )}
    </div>
  );
}

function Badge({
  tiny,
  active,
  tone,
  children,
}: {
  tiny?: boolean;
  active: boolean;
  tone: 'success' | 'violet' | 'orange';
  children: React.ReactNode;
}) {
  const cmap = {
    success: active ?
        'bg-emerald-600 text-white'
      : 'bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200',
    violet: active ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200',
    orange: active ? 'bg-orange-600 text-white' : 'bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200',
  };
  return (
    <span className={`${tiny ? 'px-2 py-[2px] text-[10px]' : 'px-2 py-1 text-xs'} font-semibold rounded-full ${cmap[tone]}`}>{children}</span>
  );
}

function LineExpandedPanel({ record }: { record: ApiReportRecord }) {
  const canon = record.canonicalComm;
  const recipient = displayEmailForRecord(record);

  let followups: FollowupEntry[] = [];
  let responses: ResponseEntry[] = [];
  try {
    followups = canon.followupsJson ? JSON.parse(canon.followupsJson) : [];
  } catch {
    followups = [];
  }
  try {
    responses = canon.responsesJson ? JSON.parse(canon.responsesJson) : [];
  } catch {
    responses = [];
  }

  const activitySummary = buildReportWebSummary({
    webConfirmedAt: canon.webConfirmedAt ?? record.webConfirmedAt,
    respondentQueryJson: canon.respondentQueryJson ?? record.respondentQueryJson,
    emailActionConsumedAt: canon.emailActionConsumedAt ?? record.emailActionConsumedAt,
  });

  const legacyReply =
    responses.length === 0 && canon.responseReceivedAt ?
      {
        subject: 'Email reply',
        receivedAt: String(canon.responseReceivedAt),
        fromName: canon.responseFromName ?? '',
        fromEmail: canon.responseFromEmail ?? '',
        preview: stripReportHtml(canon.responseHtmlBody ?? canon.responseBody ?? '').slice(0, 500),
      }
    : null;

  return (
    <div className="max-w-3xl space-y-4 text-sm text-zinc-800">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-600">
        <span>
          <span className="font-semibold text-zinc-500">Recipient:</span> {recipient}
        </span>
        {(canon.sentAt ?? record.sentAt) && (
          <span>
            <span className="font-semibold text-zinc-500">Sent:</span>{' '}
            {fmtDtShort(canon.sentAt ?? record.sentAt)}
          </span>
        )}
      </div>

      {activitySummary && (
        <p className="text-sm text-zinc-700 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">
          {activitySummary}
        </p>
      )}

      {followups.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-zinc-500 mb-2">Follow-ups sent</h4>
          <ul className="space-y-2">
            {followups.map((fu) => (
              <li key={`${fu.followupNumber}-${fu.sentAt}`} className="border-l-2 border-zinc-300 pl-3">
                <div className="font-medium text-zinc-900">{fu.subject || `Follow-up #${fu.followupNumber}`}</div>
                <div className="text-xs text-zinc-500">{fmtReportDate(fu.sentAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-[11px] font-semibold uppercase text-zinc-500 mb-2">Email replies</h4>
        {responses.length > 0 ?
          <ul className="space-y-3">
            {responses.map((rve, idx) => {
              const preview = stripReportHtml(rve.htmlBody ?? rve.body ?? '').slice(0, 400);
              return (
                <li key={rve.messageId ?? idx} className="border-l-2 border-emerald-400 pl-3">
                  <div className="font-medium text-zinc-900">{rve.subject || '(no subject)'}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{fmtReportDate(rve.receivedAt)}</div>
                  <div className="text-xs text-zinc-600">
                    {rve.fromName || 'Sender'}
                    {rve.fromEmail ? ` · ${rve.fromEmail}` : ''}
                  </div>
                  {preview && <p className="text-xs text-zinc-600 mt-1 line-clamp-3">{preview}</p>}
                </li>
              );
            })}
          </ul>
        : legacyReply ?
          <div className="border-l-2 border-emerald-400 pl-3">
            <div className="font-medium">{legacyReply.subject}</div>
            <div className="text-xs text-zinc-500">{fmtReportDate(legacyReply.receivedAt)}</div>
            <div className="text-xs text-zinc-600">
              {legacyReply.fromName}
              {legacyReply.fromEmail ? ` · ${legacyReply.fromEmail}` : ''}
            </div>
            {legacyReply.preview && (
              <p className="text-xs text-zinc-600 mt-1 line-clamp-3">{legacyReply.preview}</p>
            )}
          </div>
        : <p className="text-zinc-500 text-xs">No inbox reply captured yet.</p>}
      </div>

      {(canon.webConfirmedAt ?? record.webConfirmedAt) && (
        <p className="text-xs text-zinc-600">
          Confirmed via web: <strong>{fmtDtShort(canon.webConfirmedAt ?? record.webConfirmedAt)}</strong>
        </p>
      )}
      {(canon.emailActionConsumedAt ?? record.emailActionConsumedAt) && !(canon.webConfirmedAt ?? record.webConfirmedAt) && (
        <p className="text-xs text-zinc-600">
          Link used: <strong>{fmtDtShort(canon.emailActionConsumedAt ?? record.emailActionConsumedAt)}</strong>
        </p>
      )}
    </div>
  );
}
