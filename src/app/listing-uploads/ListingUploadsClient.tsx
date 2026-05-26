'use client';

import { useCallback, useEffect, useState } from 'react';

type Row = {
  id: string;
  moduleKey: string;
  originalFileName: string;
  mode: string;
  reportingFiscalYear: number;
  reportingFiscalQuarter: number;
  rowCountImported: number;
  createdAt: string;
};

function moduleLabel(key: string): string {
  if (key === 'trade_payable') return 'Trade Payables';
  if (key === 'trade_receivable') return 'Trade Receivables';
  return key;
}

export default function ListingUploadsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/listing-uploads');
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Listing uploads</h1>
      <p className="text-sm text-gray-600 mt-2 max-w-2xl">
        SAP-style Trade Payables / Trade Receivables listing imports with the India FY and quarter you selected at upload
        time. Rows in the module are stamped with these values.
      </p>
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="mt-4 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        Refresh
      </button>
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No listing uploads yet.</p>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600 text-xs uppercase tracking-wide border-b border-gray-200">
              <tr>
                <th className="p-3 font-medium">Uploaded</th>
                <th className="p-3 font-medium">Module</th>
                <th className="p-3 font-medium">File</th>
                <th className="p-3 font-medium">Mode</th>
                <th className="p-3 font-medium">FY</th>
                <th className="p-3 font-medium">Q</th>
                <th className="p-3 font-medium text-right">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/80">
                  <td className="p-3 text-gray-700 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-gray-800">{moduleLabel(r.moduleKey)}</td>
                  <td className="p-3 text-gray-900 max-w-[240px] truncate" title={r.originalFileName}>
                    {r.originalFileName}
                  </td>
                  <td className="p-3 capitalize text-gray-700">{r.mode}</td>
                  <td className="p-3 tabular-nums">
                    FY {r.reportingFiscalYear}–{String(r.reportingFiscalYear + 1).slice(-2)}
                  </td>
                  <td className="p-3">Q{r.reportingFiscalQuarter}</td>
                  <td className="p-3 text-right tabular-nums text-gray-900">{r.rowCountImported}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
