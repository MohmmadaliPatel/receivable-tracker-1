'use client';

import { Suspense, useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  drCrBadgeClassNames,
  formatDrCrAmountDisplay,
  formatNetSignedAsDrCr,
  parseInrAmountString,
  signedBooksAmountStringForLine,
} from '@/lib/inr-amount';

type Row = {
  id: string;
  entityName: string;
  bankName?: string | null;
  custId?: string | null;
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
};

function normalizeHeaderKey(k: string): string {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cellString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function QueryBody() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [excelMessage, setExcelMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing link.');
      return;
    }
    (async () => {
      const res = await fetch(`/api/public/confirmation/trade/query?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.consumed) {
        setConsumed(true);
        setError(data.message || 'A response was already submitted.');
        return;
      }
      if (!res.ok) {
        setError(data.error || data.message || 'Could not load lines.');
        return;
      }
      setRows(data.rows || []);
    })();
  }, [token]);

  const toggle = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const selectedQueryCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );
  const totalLines = rows?.length ?? 0;
  const willImplicitlyConfirm = totalLines - selectedQueryCount;

  const untickedParsedTotal = useMemo(() => {
    if (!rows?.length) return null as number | null;
    let sum = 0;
    let anyParsed = false;
    for (const r of rows) {
      if (selected[r.id]) continue;
      const v = parseInrAmountString(r.currencyValue);
      if (v !== null) {
        sum += v;
        anyParsed = true;
      }
    }
    return anyParsed ? sum : null;
  }, [rows, selected]);

  const handleDownloadExcel = () => {
    if (!rows?.length) return;
    const sheetRows = rows.map((r) => ({
      'Document Date': r.documentDate || '',
      'Document Number': r.documentNumber || '',
      Amount: r.currencyValue || '',
      'Dr / Cr': '',
      Entity: r.entityName,
      'Bank / party': r.bankName ?? '',
      'Amount in your books': '',
      Note: '',
      recordId: r.id,
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Query');
    XLSX.writeFile(wb, `trade-query-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleApplyExcel = async (file: File) => {
    if (!rows?.length) return;
    setExcelMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const wsName = wb.SheetNames[0];
      if (!wsName) {
        setExcelMessage('The workbook has no sheets.');
        return;
      }
      const ws = wb.Sheets[wsName];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (!raw.length) {
        setExcelMessage('No data rows found in the sheet.');
        return;
      }

      const headerMap = new Map<string, string>();
      for (const k of Object.keys(raw[0]!)) {
        headerMap.set(normalizeHeaderKey(k), k);
      }
      const col = (aliases: string[]): string | undefined => {
        for (const a of aliases) {
          const orig = headerMap.get(normalizeHeaderKey(a));
          if (orig) return orig;
        }
        return undefined;
      };

      const cRecord = col(['recordid', 'record id', 'id']);
      const cDocNum = col(['document number', 'doc no', 'document no']);
      const cDocDate = col(['document date', 'doc date']);
      const cAmtBooks = col(['amount in your books', 'amount in books']);
      const cNote = col(['note', 'notes']);

      if (!cRecord && !(cDocNum && cDocDate)) {
        setExcelMessage('Upload must include a recordId column, or both Document number and Document date.');
        return;
      }

      const rowById = new Map(rows.map((r) => [r.id, r]));
      const keyForLine = (docNum: string, docDate: string) => `${docNum.trim()}|${docDate.trim()}`;

      const ambiguousKeys = new Set<string>();
      const lineKeyToId = new Map<string, string>();
      if (!cRecord && cDocNum && cDocDate) {
        for (const r of rows) {
          const k = keyForLine(cellString(r.documentNumber), cellString(r.documentDate));
          if (!k.replace('|', '').length) continue;
          if (lineKeyToId.has(k)) ambiguousKeys.add(k);
          else lineKeyToId.set(k, r.id);
        }
      }

      const nextSel: Record<string, boolean> = { ...selected };
      const nextAmt: Record<string, string> = { ...amounts };
      const nextNotes: Record<string, string> = { ...notes };
      let matched = 0;
      let skipped = 0;

      for (const rec of raw) {
        let id: string | undefined;
        if (cRecord) {
          id = cellString(rec[cRecord]);
        } else if (cDocNum && cDocDate) {
          const k = keyForLine(cellString(rec[cDocNum]), cellString(rec[cDocDate]));
          if (ambiguousKeys.has(k)) {
            skipped++;
            continue;
          }
          id = lineKeyToId.get(k);
        }
        if (!id || !rowById.has(id)) {
          skipped++;
          continue;
        }
        nextSel[id] = true;
        if (cAmtBooks) nextAmt[id] = cellString(rec[cAmtBooks]);
        if (cNote) nextNotes[id] = cellString(rec[cNote]);
        matched++;
      }

      setSelected(nextSel);
      setAmounts(nextAmt);
      setNotes(nextNotes);
      if (skipped > 0) {
        setExcelMessage(
          `Applied ${matched} row(s). ${skipped} row(s) could not be matched (check recordId or document number/date).`
        );
      } else {
        setExcelMessage(`Applied ${matched} row(s) from Excel.`);
      }
    } catch {
      setExcelMessage('Could not read that file. Use an .xlsx export from this page if unsure.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void handleApplyExcel(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const rowById = new Map((rows ?? []).map((r) => [r.id, r]));
    const lines = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([recordId]) => ({
        recordId,
        amountInBooks: signedBooksAmountStringForLine(
          amounts[recordId],
          rowById.get(recordId)?.currencyValue
        ),
        note: notes[recordId],
      }));
    if (lines.length === 0) {
      setError('Select at least one line.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/public/confirmation/trade/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || data.message || 'Submit failed');
        return;
      }
      setConsumed(true);
      setRows([]);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (consumed && !rows?.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow border p-8 text-center">
          <p className="text-neutral-800">
            {error || 'Thank you. Your response has been recorded.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow border border-neutral-200 p-6">
        <h1 className="text-xl font-semibold text-neutral-900 mb-1">Have a query</h1>
        <p className="text-sm text-neutral-600 mb-4">
          Select <strong>only</strong> invoice lines where you have a query. For &quot;Amount in your books&quot;, enter
          the figure on the <strong>same Debit or Credit side</strong> as the Amount column (we store credit as a negative
          value—e.g. enter <strong>2000</strong> when the line is Credit to mean <strong>₹2,000 Credit</strong>).
        </p>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-900 mb-6 space-y-2">
          <p className="font-medium">Important</p>
          <p>
            Any line you <strong>leave unticked</strong> will be treated as <strong>confirmed</strong> as matching our records when you submit. Only tick lines you need to query.
          </p>
          {totalLines > 0 && (
            <p className="text-neutral-800 pt-1 border-t border-neutral-200/80 mt-2">
              With your current selection:{' '}
              <strong>{willImplicitlyConfirm}</strong> of {totalLines} line{totalLines === 1 ? '' : 's'} will be
              confirmed; <strong>{selectedQueryCount}</strong> will remain open for query.
              {untickedParsedTotal != null && willImplicitlyConfirm > 0 && (
                <>
                  {' '}
              Unticked lines total <strong>{formatNetSignedAsDrCr(untickedParsedTotal)}</strong> from the amounts
              shown (parsed from this table).
                </>
              )}
            </p>
          )}
        </div>
        {error && !rows && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={!rows?.length}
            className="px-4 py-2 rounded-xl border border-neutral-300 text-neutral-800 text-sm font-medium hover:bg-neutral-50 disabled:opacity-40"
          >
            Download Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!rows?.length}
            className="px-4 py-2 rounded-xl border border-neutral-300 text-neutral-800 text-sm font-medium hover:bg-neutral-50 disabled:opacity-40"
          >
            Upload Excel to form
          </button>
        </div>
        {excelMessage && <p className="text-sm text-neutral-600 mb-2">{excelMessage}</p>}
        {rows && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="bg-neutral-50 text-left text-neutral-600">
                    <th className="p-3 w-10" />
                    <th className="p-3">Document Date</th>
                    <th className="p-3">Document Number</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3 text-center">Dr / Cr</th>
                    <th className="p-3 min-w-[120px]">Entity</th>
                    <th className="p-3">Bank / party</th>
                    <th className="p-3">
                      Amount in your books
                      <span className="block text-neutral-500 text-xs font-normal mt-0.5">
                        Same Dr/Cr side as Amount; no minus needed
                      </span>
                    </th>
                    <th className="p-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dr = formatDrCrAmountDisplay(r.currencyValue);
                    return (
                    <tr key={r.id} className="border-t border-neutral-100">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!!selected[r.id]}
                          onChange={() => toggle(r.id)}
                          className="rounded border-neutral-300"
                        />
                      </td>
                      <td className="p-3 text-neutral-800">{r.documentDate || '—'}</td>
                      <td className="p-3 text-neutral-900 font-mono text-xs">{r.documentNumber || '—'}</td>
                      <td className="p-3 text-right text-neutral-800 tabular-nums">
                        {dr.amountText}
                      </td>
                      <td className="p-3 text-center text-xs">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-lg font-medium ${drCrBadgeClassNames(dr.dcLabel)}`}
                        >
                          {dr.dcLabel}
                        </span>
                      </td>
                      <td className="p-3 text-neutral-700 text-xs leading-snug">{r.entityName}</td>
                      <td className="p-3 text-neutral-700 text-xs">{r.bankName ?? '—'}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={amounts[r.id] || ''}
                          onChange={(e) => setAmounts((m) => ({ ...m, [r.id]: e.target.value }))}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                          placeholder="e.g. 2000"
                          disabled={!selected[r.id]}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={notes[r.id] || ''}
                          onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                          placeholder="Optional"
                          disabled={!selected[r.id]}
                        />
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function TradeQueryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-neutral-50">
          <p className="text-neutral-600">Loading…</p>
        </div>
      }
    >
      <QueryBody />
    </Suspense>
  );
}
