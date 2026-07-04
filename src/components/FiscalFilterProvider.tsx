'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'taxteck.fiscalFilter';

export type FiscalFilterState = {
  fiscalYear: string;
  fiscalQuarter: string;
};

type FiscalFilterContextValue = {
  fiscalYear: string;
  fiscalQuarter: string;
  availableYears: number[];
  ready: boolean;
  setFiscalYear: (year: string) => void;
  setFiscalQuarter: (quarter: string) => void;
};

const FiscalFilterContext = createContext<FiscalFilterContextValue | null>(null);

function readStoredFilter(): FiscalFilterState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FiscalFilterState;
    if (parsed.fiscalYear && parsed.fiscalQuarter) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredFilter(state: FiscalFilterState) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function FiscalFilterProvider({ children }: { children: ReactNode }) {
  const [fiscalYear, setFiscalYearState] = useState('');
  const [fiscalQuarter, setFiscalQuarterState] = useState('');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/fiscal-filter/defaults');
        const data = (await res.json()) as {
          latestPeriod?: { year: number; quarter: number } | null;
          availableYears?: number[];
          fallback?: { year: number; quarter: number };
        };
        if (cancelled) return;

        const years = Array.isArray(data.availableYears) ? data.availableYears : [];
        setAvailableYears(years);

        const stored = readStoredFilter();
        if (stored) {
          setFiscalYearState(stored.fiscalYear);
          setFiscalQuarterState(stored.fiscalQuarter);
        } else if (data.latestPeriod) {
          setFiscalYearState(String(data.latestPeriod.year));
          setFiscalQuarterState(String(data.latestPeriod.quarter));
        } else if (data.fallback) {
          setFiscalYearState(String(data.fallback.year));
          setFiscalQuarterState(String(data.fallback.quarter));
        }
      } catch {
        /* keep empty until user picks */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFiscalYear = useCallback((year: string) => {
    setFiscalYearState(year);
  }, []);

  const setFiscalQuarter = useCallback((quarter: string) => {
    setFiscalQuarterState(quarter);
  }, []);

  useEffect(() => {
    if (fiscalYear && fiscalQuarter) {
      writeStoredFilter({ fiscalYear, fiscalQuarter });
    }
  }, [fiscalYear, fiscalQuarter]);

  const value = useMemo(
    () => ({
      fiscalYear,
      fiscalQuarter,
      availableYears,
      ready,
      setFiscalYear,
      setFiscalQuarter,
    }),
    [fiscalYear, fiscalQuarter, availableYears, ready, setFiscalYear, setFiscalQuarter]
  );

  return <FiscalFilterContext.Provider value={value}>{children}</FiscalFilterContext.Provider>;
}

export function useFiscalFilter(): FiscalFilterContextValue {
  const ctx = useContext(FiscalFilterContext);
  if (!ctx) {
    throw new Error('useFiscalFilter must be used within FiscalFilterProvider');
  }
  return ctx;
}

/** Fiscal year options for dropdowns (distinct years + fallback range). */
export function fiscalYearSelectOptionsFromApi(availableYears: number[]): string[] {
  const fromApi = [...availableYears].sort((a, b) => b - a);
  const y = new Date().getFullYear();
  const fallback = [y + 1, y, y - 1, y - 2, y - 3];
  return [...new Set([...fromApi, ...fallback])].sort((a, b) => b - a).map(String);
}

export function formatFyOption(opt: string): string {
  const y = parseInt(opt, 10);
  return Number.isFinite(y) ? `FY ${y}–${String(y + 1).slice(-2)}` : opt;
}

export function formatQuarterOption(opt: string): string {
  const labels: Record<string, string> = {
    '1': 'Q1 (Apr–Jun)',
    '2': 'Q2 (Jul–Sep)',
    '3': 'Q3 (Oct–Dec)',
    '4': 'Q4 (Jan–Mar)',
  };
  return labels[opt] ?? `Q${opt}`;
}
