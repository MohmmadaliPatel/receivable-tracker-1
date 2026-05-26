'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { DashboardMsmeKpiBlock, DashboardTradeKpiBlock } from '@/app/api/dashboard/kpis/route';
import { formatInrAmount } from '@/lib/inr-amount';

interface DashboardKpiPayload {
  tradePayable?: DashboardTradeKpiBlock;
  tradeReceivable?: DashboardTradeKpiBlock;
  msme?: DashboardMsmeKpiBlock;
}

function TradeKpiSection({
  title,
  href,
  block,
}: {
  title: string;
  href: string;
  block: DashboardTradeKpiBlock;
}) {
  const cards = [
    { label: 'Total portfolio', value: formatInrAmount(block.totalPortfolioAmount) },
    { label: 'Confirmation sent (amount)', value: formatInrAmount(block.confirmationSentAmount) },
    { label: 'Confirmed by party', value: formatInrAmount(block.confirmedByPartyAmount) },
    { label: 'Pending confirmation', value: formatInrAmount(block.pendingConfirmationAmount) },
    { label: 'Invoice value under query', value: formatInrAmount(block.queriedInvoiceAmount) },
    { label: "Invoice value in party's books", value: formatInrAmount(block.queriedAmountInBooks) },
  ];

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/90 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-neutral-100 bg-white/80">
        <h3 className="text-lg font-semibold text-neutral-900 tracking-tight">{title}</h3>
        <Link
          href={href}
          className="text-sm font-medium text-neutral-900 hover:text-neutral-950 rounded-lg px-3 py-1.5 hover:bg-neutral-100 transition-colors"
        >
          Open module
        </Link>
      </div>
      <div className="p-6">
     
        {block.unparsedCurrencyLines > 0 && (
          <p className="text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 mb-4">
            {block.unparsedCurrencyLines} line{block.unparsedCurrencyLines === 1 ? '' : 's'} with amounts that could
            not be parsed (excluded from sums).
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-neutral-100 bg-white px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{c.label}</p>
              <p className="text-lg sm:text-xl font-semibold text-neutral-900 mt-1.5 tabular-nums break-words">
                {c.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MsmeKpiSection({ block }: { block: DashboardMsmeKpiBlock }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/90 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-neutral-100 bg-white/80">
        <h3 className="text-lg font-semibold text-neutral-900 tracking-tight">Confirm MSME</h3>
        <Link
          href="/confirm-msme"
          className="text-sm font-medium text-neutral-900 hover:text-neutral-950 rounded-lg px-3 py-1.5 hover:bg-neutral-100 transition-colors"
        >
          Open module
        </Link>
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Total records</p>
          <p className="text-xl font-semibold text-neutral-900 mt-1 tabular-nums">{block.total}</p>
        </div>
        <div className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Pending confirmation</p>
          <p className="text-xl font-semibold text-neutral-900 mt-1 tabular-nums">{block.pending}</p>
        </div>
        <div className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Confirmed with MSME certificate</p>
          <p className="text-xl font-semibold text-neutral-900 mt-1 tabular-nums">{block.confirmedWithCertificate}</p>
        </div>
        <div className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Confirmed not MSME / no certificate
          </p>
          <p className="text-xl font-semibold text-neutral-900 mt-1 tabular-nums">{block.confirmedWithoutCertificate}</p>
        </div>
        {block.confirmedClassificationUnknown > 0 && (
          <div className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Confirmed (classification unclear)</p>
            <p className="text-xl font-semibold text-neutral-900 mt-1 tabular-nums">{block.confirmedClassificationUnknown}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const [kpis, setKpis] = useState<DashboardKpiPayload | null>(null);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setKpiError(null);
      try {
        const kpiRes = await fetch('/api/dashboard/kpis');
        if (!cancelled && kpiRes.ok) {
          setKpis((await kpiRes.json()) as DashboardKpiPayload);
        } else if (!cancelled) {
          setKpiError(kpiRes.status === 401 ? 'Sign in to view KPIs.' : 'Could not load KPIs.');
        }
      } catch {
        if (!cancelled) setKpiError('Could not load KPIs.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasModuleKpis =
    kpis && (kpis.tradePayable != null || kpis.tradeReceivable != null || kpis.msme != null);

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center justify-center py-16 text-neutral-500 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      {kpiError && (
        <div className="rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{kpiError}</div>
      )}
      {!kpiError && !hasModuleKpis && (
        <p className="text-sm text-neutral-500 text-center py-12">No confirmation modules available for your account.</p>
      )}
      {!kpiError && hasModuleKpis && kpis && (
        <div className="space-y-8">
          {kpis.tradePayable && (
            <TradeKpiSection title="Trade payables" href="/trade-payables" block={kpis.tradePayable} />
          )}
          {kpis.tradeReceivable && (
            <TradeKpiSection title="Trade receivables" href="/trade-receivables" block={kpis.tradeReceivable} />
          )}
          {kpis.msme && <MsmeKpiSection block={kpis.msme} />}
        </div>
      )}
    </div>
  );
}
