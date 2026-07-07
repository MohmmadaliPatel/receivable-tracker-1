'use client';

import { useFiscalFilter } from '@/components/FiscalFilterProvider';
import FiscalPeriodSelects from '@/components/FiscalPeriodSelects';

type FiscalFilterBarProps = {
  className?: string;
  /** Inline toolbar mode — no card border, fits beside other filters */
  inline?: boolean;
};

export default function FiscalFilterBar({ className = '', inline = false }: FiscalFilterBarProps) {
  const { fiscalYear, fiscalQuarter, availableYears, ready, setFiscalYear, setFiscalQuarter } =
    useFiscalFilter();

  if (!ready) {
    return (
      <div
        className={`text-sm text-neutral-500 ${inline ? 'h-10 flex items-center' : 'rounded-xl border border-neutral-200/80 bg-white px-4 py-3'} ${className}`}
      >
        Loading period…
      </div>
    );
  }

  if (inline) {
    return (
      <div className={`flex flex-wrap items-end gap-3 ${className}`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 self-center pb-2.5 shrink-0">
          Period
        </span>
        <FiscalPeriodSelects
          compact
          fiscalYear={fiscalYear}
          fiscalQuarter={fiscalQuarter}
          availableYears={availableYears}
          onChange={(fy, fq) => {
            setFiscalYear(fy);
            setFiscalQuarter(fq);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-xl border border-neutral-200/80 bg-neutral-50/80 px-4 py-3 ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 w-full sm:w-auto sm:mb-0 mb-1 shrink-0">
        Reporting period
      </p>
      <FiscalPeriodSelects
        fiscalYear={fiscalYear}
        fiscalQuarter={fiscalQuarter}
        availableYears={availableYears}
        onChange={(fy, fq) => {
          setFiscalYear(fy);
          setFiscalQuarter(fq);
        }}
      />
    </div>
  );
}
