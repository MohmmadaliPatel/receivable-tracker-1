import { indiaFiscalYearAndQuarter } from '@/lib/india-fiscal';

/** Parse India FY start year + quarter (1–4) from multipart listing upload forms. */
export function parseListingUploadFiscal(formData: FormData):
  | { ok: true; reportingFiscalYear: number; reportingFiscalQuarter: number }
  | { ok: false; error: string } {
  const fyRaw = formData.get('reportingFiscalYear');
  const fqRaw = formData.get('reportingFiscalQuarter');
  const fy = typeof fyRaw === 'string' ? parseInt(fyRaw.trim(), 10) : NaN;
  const fq = typeof fqRaw === 'string' ? parseInt(fqRaw.trim(), 10) : NaN;
  if (!Number.isFinite(fy)) {
    return { ok: false, error: 'Select a valid reporting fiscal year.' };
  }
  if (!Number.isFinite(fq) || fq < 1 || fq > 4) {
    return { ok: false, error: 'Select a fiscal quarter (Q1–Q4).' };
  }
  return { ok: true, reportingFiscalYear: fy, reportingFiscalQuarter: fq };
}

/** Current India FY anchor (April-start year) for "today". */
export function currentIndiaFiscalAnchor(): {
  reportingFiscalYear: number;
  reportingFiscalQuarter: number;
} {
  return indiaFiscalYearAndQuarter(new Date());
}

/** FY start years for dropdowns: current anchor ±5 (11 years, newest first). */
export function listingUploadYearOptions(): number[] {
  const { reportingFiscalYear: anchor } = currentIndiaFiscalAnchor();
  const out: number[] = [];
  for (let x = anchor + 5; x >= anchor - 5; x--) out.push(x);
  return out;
}

/** Default FY + quarter for listing upload selectors. */
export function defaultListingFiscalSelection(): {
  reportingFiscalYear: string;
  reportingFiscalQuarter: string;
} {
  const { reportingFiscalYear, reportingFiscalQuarter } = currentIndiaFiscalAnchor();
  return {
    reportingFiscalYear: String(reportingFiscalYear),
    reportingFiscalQuarter: String(reportingFiscalQuarter),
  };
}
