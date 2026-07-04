'use client';

import {
  fiscalYearSelectOptionsFromApi,
  formatFyOption,
  formatQuarterOption,
  useFiscalFilter,
} from '@/components/FiscalFilterProvider';

const QUARTER_OPTIONS = ['1', '2', '3', '4'] as const;

export default function FiscalFilterBar({ className = '' }: { className?: string }) {
  const { fiscalYear, fiscalQuarter, availableYears, ready, setFiscalYear, setFiscalQuarter } =
    useFiscalFilter();

  const yearOptions = fiscalYearSelectOptionsFromApi(availableYears);

  if (!ready) {
    return (
      <div className={`rounded-xl border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-500 ${className}`}>
        Loading period filter…
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-xl border border-neutral-200/80 bg-white px-4 py-3 shadow-sm ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 w-full sm:w-auto sm:mb-0 mb-1">
        Reporting period
      </p>
      <label className="flex flex-col gap-1 min-w-[140px]">
        <span className="text-[11px] font-medium text-neutral-500">Financial year</span>
        <select
          value={fiscalYear}
          onChange={(e) => setFiscalYear(e.target.value)}
          className="h-10 border border-neutral-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        >
          <option value="">Select FY</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {formatFyOption(y)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 min-w-[140px]">
        <span className="text-[11px] font-medium text-neutral-500">Quarter</span>
        <select
          value={fiscalQuarter}
          onChange={(e) => setFiscalQuarter(e.target.value)}
          className="h-10 border border-neutral-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        >
          <option value="">Select quarter</option>
          {QUARTER_OPTIONS.map((q) => (
            <option key={q} value={q}>
              {formatQuarterOption(q)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
