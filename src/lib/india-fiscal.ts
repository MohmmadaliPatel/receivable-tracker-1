/**
 * India financial year: starts 1 April. Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.
 * `reportingFiscalYear` is the calendar year in which FY starts (e.g. FY 2025–26 → 2025).
 */

export type IndiaFiscalQuarter = 1 | 2 | 3 | 4;

/** Parse common SAP / Excel date strings; returns null if not parseable. */
export function parseDocumentDateFlexible(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);

  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m1) {
    let d = parseInt(m1[1], 10);
    let mo = parseInt(m1[2], 10);
    let y = parseInt(m1[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (d > 12 && mo <= 12) {
      const tmp = d;
      d = mo;
      mo = tmp;
    }
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const m2 = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m2) {
    const y = parseInt(m2[1], 10);
    const mo = parseInt(m2[2], 10);
    const d = parseInt(m2[3], 10);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

export function indiaFiscalYearAndQuarter(d: Date): {
  reportingFiscalYear: number;
  reportingFiscalQuarter: IndiaFiscalQuarter;
} {
  const month = d.getMonth();
  const year = d.getFullYear();
  if (month >= 3) {
    const fyStart = year;
    const quarter = (month < 6 ? 1 : month < 9 ? 2 : 3) as IndiaFiscalQuarter;
    return { reportingFiscalYear: fyStart, reportingFiscalQuarter: quarter };
  }
  const fyStart = year - 1;
  return { reportingFiscalYear: fyStart, reportingFiscalQuarter: 4 };
}

export function reportingFiscalFromDocumentDateString(
  documentDate: string | null | undefined
): { reportingFiscalYear: number; reportingFiscalQuarter: IndiaFiscalQuarter } | null {
  const d = parseDocumentDateFlexible(documentDate);
  if (!d) return null;
  return indiaFiscalYearAndQuarter(d);
}
