'use client';

import {
  fiscalYearSelectOptionsFromApi,
  formatFyOption,
  formatQuarterOption,
} from '@/components/FiscalFilterProvider';

const QUARTER_OPTIONS = ['1', '2', '3', '4'] as const;

type FiscalPeriodSelectsProps = {
  fiscalYear: string;
  fiscalQuarter: string;
  availableYears: number[];
  onChange?: (fiscalYear: string, fiscalQuarter: string) => void;
  readOnly?: boolean;
  compact?: boolean;
  className?: string;
};

export default function FiscalPeriodSelects({
  fiscalYear,
  fiscalQuarter,
  availableYears,
  onChange,
  readOnly = false,
  compact = false,
  className = '',
}: FiscalPeriodSelectsProps) {
  const yearOptions = fiscalYearSelectOptionsFromApi(availableYears);
  const labelClass = compact ? 'text-[11px] font-medium text-gray-500' : 'text-[11px] font-medium text-neutral-500';
  const selectClass = compact
    ? 'h-10 border border-gray-200 rounded-xl px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/20 w-full'
    : 'h-10 border border-neutral-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/20 w-full';

  if (readOnly) {
    const fyLabel = fiscalYear ? formatFyOption(fiscalYear) : '—';
    const qLabel = fiscalQuarter ? formatQuarterOption(fiscalQuarter) : '—';
    return (
      <div className={`flex flex-wrap items-center gap-3 ${className}`}>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className={labelClass}>Financial year</span>
          <div className={`${selectClass} flex items-center text-gray-800 bg-neutral-50`}>{fyLabel}</div>
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className={labelClass}>Quarter</span>
          <div className={`${selectClass} flex items-center text-gray-800 bg-neutral-50`}>{qLabel}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-end gap-3 ${className}`}>
      <label className="flex flex-col gap-1 min-w-[140px]">
        <span className={labelClass}>Financial year</span>
        <select
          value={fiscalYear}
          onChange={(e) => onChange?.(e.target.value, fiscalQuarter)}
          className={selectClass}
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
        <span className={labelClass}>Quarter</span>
        <select
          value={fiscalQuarter}
          onChange={(e) => onChange?.(fiscalYear, e.target.value)}
          className={selectClass}
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
