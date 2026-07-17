'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultListingFiscalSelection,
  listingUploadYearOptions,
} from '@/lib/listing-upload-fiscal';

type MasterRow = {
  id: string;
  normalizedKey: string;
  companyCode: string;
  partyName: string;
  custId: string | null;
  sapCustomerCode: string | null;
  emailTo: string;
  emailCc: string | null;
  source: string;
  updatedAt: string;
};

type MsmeHydratePayload = {
  upserted: number;
  fromVendors: number;
} | null;

function formatMsmeNote(h: MsmeHydratePayload): string {
  if (!h) return '';
  return `Confirm MSME refreshed: ${h.fromVendors} vendor master entr(ies) processed for your workspace.`;
}

export default function PartyMasterWorkspaceClient({
  variant,
  title,
  description,
  listUrl,
  listingUploadUrl,
  rtUploadUrl,
}: {
  variant: 'vendor' | 'supplier';
  title: string;
  description: string;
  listUrl: string;
  listingUploadUrl: string;
  rtUploadUrl: string;
}) {
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [listingMode, setListingMode] = useState<'append' | 'replace'>('replace');
  const fiscalYearChoices = useMemo(() => listingUploadYearOptions(), []);
  const fiscalDefaults = useMemo(() => defaultListingFiscalSelection(), []);
  const [listingFiscalYear, setListingFiscalYear] = useState(() => fiscalDefaults.reportingFiscalYear);
  const [listingFiscalQuarter, setListingFiscalQuarter] = useState(
    () => fiscalDefaults.reportingFiscalQuarter
  );
  const [busyKind, setBusyKind] = useState<'listing' | 'rt' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const listingRef = useRef<HTMLInputElement>(null);
  const rtRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(listUrl);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Failed to load');
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setErr('Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const appendMsme = (h: unknown) => {
    if (h && typeof h === 'object' && 'fromVendors' in h) {
      return formatMsmeNote(h as MsmeHydratePayload);
    }
    return '';
  };

  const onListingFile = async (f: File) => {
    setBusyKind('listing');
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', listingMode);
      fd.append('reportingFiscalYear', listingFiscalYear);
      fd.append('reportingFiscalQuarter', listingFiscalQuarter);
      const res = await fetch(listingUploadUrl, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Upload failed');
        return;
      }
      const parts = [
        `Listing import: ${data.imported ?? 0} row(s) to ${variant === 'vendor' ? 'Trade Payables' : 'Trade Receivables'}, skipped ${data.skipped ?? 0} of ${data.totalRows ?? '—'}.`,
        appendMsme(data.msmeHydrated),
      ].filter(Boolean);
      setMsg(parts.join(' '));
      await load();
    } catch {
      setErr('Upload failed');
    } finally {
      setBusyKind(null);
    }
  };

  const onRtFile = async (f: File) => {
    setBusyKind('rt');
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(rtUploadUrl, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'RT workbook upload failed');
        return;
      }
      const parts = [
        `RT workbook: ${data.contactsUpserted ?? 0} Sheet1 row(s). TP ${data.tradePayablesUpdated ?? 0} · TR ${data.tradeReceivablesUpdated ?? 0} · MSME listing ${data.msmeUpdated ?? 0} updated.`,
        appendMsme(data.msmeHydrated),
      ].filter(Boolean);
      setMsg(parts.join(' '));
      await load();
    } catch {
      setErr('RT workbook upload failed');
    } finally {
      setBusyKind(null);
    }
  };

  const busy = busyKind !== null;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-600 mt-2 leading-relaxed max-w-3xl">{description}</p>

      <div className="mt-2 text-xs text-gray-500 max-w-3xl">
        RT email workbook format matches{' '}
        <code className="bg-gray-100 px-1 rounded">public/RT India - Email Automation.xlsx</code> (Sheet1: Customer
        Code in SAP, TO, CC, optional Project Name / Region / Person Name).
        {variant === 'vendor' ? (
          <>
            {' '}
            Listing upload is the same file as <strong>Trade Payables</strong> — it updates vendor masters and TP lines.
            Confirm MSME hydrates from <strong>Vendor master</strong> (plus RT / entity contact emails when TO is blank
            on the vendor row).
          </>
        ) : (
          <>
            {' '}
            Listing upload matches <strong>Trade Receivables</strong> — it updates supplier masters and TR lines.
            Confirm MSME still uses <strong>Vendor master</strong> only.
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <p className="text-xs font-medium text-gray-600 w-full">Listing import mode</p>
        {(['append', 'replace'] as const).map((m) => (
          <label
            key={m}
            className={`flex items-center gap-2 cursor-pointer text-sm px-3 py-2 rounded-xl border ${
              listingMode === m ? 'border-neutral-700 bg-neutral-50' : 'border-gray-200 bg-white'
            }`}
          >
            <input
              type="radio"
              name="listingMode"
              className="sr-only"
              checked={listingMode === m}
              onChange={() => setListingMode(m)}
            />
            <span className="font-medium capitalize">{m}</span>
            <span className="text-xs text-gray-500">
              {m === 'append'
                ? 'Add rows'
                : 'Replace existing rows for the selected FY + quarter in this module'}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Listing FY (starts April)</span>
          <select
            value={listingFiscalYear}
            onChange={(e) => setListingFiscalYear(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
          >
            {fiscalYearChoices.map((y) => (
              <option key={y} value={String(y)}>
                FY {y}–{String(y + 1).slice(-2)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Listing quarter</span>
          <select
            value={listingFiscalQuarter}
            onChange={(e) => setListingFiscalQuarter(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
          >
            <option value="1">Q1 (Apr–Jun)</option>
            <option value="2">Q2 (Jul–Sep)</option>
            <option value="3">Q3 (Oct–Dec)</option>
            <option value="4">Q4 (Jan–Mar)</option>
          </select>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => listingRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-300 bg-neutral-50 text-neutral-900 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
        >
          {busyKind === 'listing' ? 'Uploading…' : `Upload ${variant === 'vendor' ? 'TP' : 'TR'} listing (.xlsx / .csv)`}
        </button>
        <input
          ref={listingRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onListingFile(f);
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => rtRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-950 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50"
        >
          {busyKind === 'rt' ? 'Uploading…' : 'Upload RT India email workbook'}
        </button>
        <input
          ref={rtRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onRtFile(f);
          }}
        />

        <button
          type="button"
          disabled={loading || busy}
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh list
        </button>
      </div>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      {msg && (
        <p className="mt-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Master records ({rows.length})</h2>
        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-gray-500 text-sm">No rows yet. Upload a listing file or RT workbook.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto max-h-[min(70vh,720px)] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="text-left text-gray-600 text-xs uppercase tracking-wide border-b border-gray-200">
                  <th className="p-3 font-medium">Key</th>
                  <th className="p-3 font-medium">Company</th>
                  <th className="p-3 font-medium">Party</th>
                  <th className="p-3 font-medium">SAP code</th>
                  <th className="p-3 font-medium">Email TO</th>
                  <th className="p-3 font-medium">CC</th>
                  <th className="p-3 font-medium">Source</th>
                  <th className="p-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/80 align-top">
                    <td className="p-3 font-mono text-xs text-gray-800 max-w-[200px] break-all">{r.normalizedKey}</td>
                    <td className="p-3 text-gray-800 max-w-[120px] break-words">{r.companyCode}</td>
                    <td className="p-3 text-gray-700 max-w-[160px] break-words">{r.partyName || '—'}</td>
                    <td className="p-3 font-mono text-xs text-gray-600">{r.sapCustomerCode || '—'}</td>
                    <td className="p-3 text-xs break-all max-w-[220px]">{r.emailTo || '—'}</td>
                    <td className="p-3 text-xs break-all max-w-[180px] text-gray-600">{r.emailCc || '—'}</td>
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{r.source}</td>
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(r.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
