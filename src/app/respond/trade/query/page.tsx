'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDrCrAmountDisplay, formatNetSignedAsDrCr, parseInrAmountString } from '@/lib/inr-amount';

type Row = {
  id: string;
  entityName: string;
  bankName?: string | null;
  accountNumber?: string | null;
  custId?: string | null;
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
};

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const lines = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([recordId]) => ({
        recordId,
        amountInBooks: amounts[recordId],
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow border p-8 text-center">
          <p className="text-slate-800">
            {error || 'Thank you. Your response has been recorded.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow border border-slate-200 p-6">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Have a query</h1>
        <p className="text-sm text-slate-600 mb-4">
          Select <strong>only</strong> invoice lines where you have a query. Enter the amount per your books (optional) and a note (optional) for those lines.
        </p>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 mb-6 space-y-2">
          <p className="font-medium">Important</p>
          <p>
            Any line you <strong>leave unticked</strong> will be treated as <strong>confirmed</strong> as matching our records when you submit. Only tick lines you need to query.
          </p>
          {totalLines > 0 && (
            <p className="text-amber-900 pt-1 border-t border-amber-200/80 mt-2">
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
        {rows && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-600">
                    <th className="p-3 w-10" />
                    <th className="p-3">Document Date</th>
                    <th className="p-3">Document Number</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3 text-center">Dr / Cr</th>
                    <th className="p-3 min-w-[120px]">Entity</th>
                    <th className="p-3">Bank / party</th>
                    <th className="p-3">Amount in your books</th>
                    <th className="p-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dr = formatDrCrAmountDisplay(r.currencyValue);
                    return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!!selected[r.id]}
                          onChange={() => toggle(r.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="p-3 text-slate-800">{r.documentDate || '—'}</td>
                      <td className="p-3 text-slate-900 font-mono text-xs">{r.documentNumber || '—'}</td>
                      <td className="p-3 text-right text-slate-800 tabular-nums">
                        {dr.amountText}
                      </td>
                      <td className="p-3 text-center text-slate-700 text-xs">
                        {dr.dcLabel}
                      </td>
                      <td className="p-3 text-slate-700 text-xs leading-snug">{r.entityName}</td>
                      <td className="p-3 text-slate-700 text-xs">{r.bankName ?? '—'}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={amounts[r.id] || ''}
                          onChange={(e) => setAmounts((m) => ({ ...m, [r.id]: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                          placeholder="—"
                          disabled={!selected[r.id]}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={notes[r.id] || ''}
                          onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
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
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
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
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <p className="text-slate-600">Loading…</p>
        </div>
      }
    >
      <QueryBody />
    </Suspense>
  );
}
