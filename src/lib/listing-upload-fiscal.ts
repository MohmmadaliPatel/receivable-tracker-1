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

export type FiscalStamp = {
  reportingFiscalYear?: number;
  reportingFiscalQuarter?: number;
};

/** Parse optional FY/quarter from API request bodies for send/follow-up stamping. */
export function parseFiscalStampFromBody(body: unknown): FiscalStamp {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const fyRaw = b.reportingFiscalYear;
  const fqRaw = b.reportingFiscalQuarter;
  const fy =
    typeof fyRaw === 'number'
      ? fyRaw
      : typeof fyRaw === 'string'
        ? parseInt(fyRaw.trim(), 10)
        : NaN;
  const fq =
    typeof fqRaw === 'number'
      ? fqRaw
      : typeof fqRaw === 'string'
        ? parseInt(fqRaw.trim(), 10)
        : NaN;
  const out: FiscalStamp = {};
  if (Number.isFinite(fy)) out.reportingFiscalYear = fy;
  if (Number.isFinite(fq) && fq >= 1 && fq <= 4) out.reportingFiscalQuarter = fq;
  return out;
}

export function fiscalStampPatch(stamp: FiscalStamp): FiscalStamp {
  const out: FiscalStamp = {};
  if (stamp.reportingFiscalYear != null) out.reportingFiscalYear = stamp.reportingFiscalYear;
  if (stamp.reportingFiscalQuarter != null) out.reportingFiscalQuarter = stamp.reportingFiscalQuarter;
  return out;
}

type FiscalSourceRow = {
  reportingFiscalYear?: number | null;
  reportingFiscalQuarter?: number | null;
  sentAt?: Date | string | null;
  followupSentAt?: Date | string | null;
};

/** Resolve FY+Q for send/follow-up: explicit options → existing row → activity date. */
export function resolveFiscalStampForSend(
  options: FiscalStamp | undefined,
  record: FiscalSourceRow,
  activityDate: Date
): FiscalStamp {
  const fromOptions = fiscalStampPatch({
    reportingFiscalYear: options?.reportingFiscalYear,
    reportingFiscalQuarter: options?.reportingFiscalQuarter,
  });
  if (fromOptions.reportingFiscalYear != null && fromOptions.reportingFiscalQuarter != null) {
    return fromOptions;
  }

  if (record.reportingFiscalYear != null && record.reportingFiscalQuarter != null) {
    return {
      reportingFiscalYear: record.reportingFiscalYear,
      reportingFiscalQuarter: record.reportingFiscalQuarter,
    };
  }

  const anchor =
    activityDate ||
    (record.sentAt ? new Date(record.sentAt) : null) ||
    (record.followupSentAt ? new Date(record.followupSentAt) : null) ||
    new Date();
  const derived = indiaFiscalYearAndQuarter(anchor);
  return {
    reportingFiscalYear: fromOptions.reportingFiscalYear ?? derived.reportingFiscalYear,
    reportingFiscalQuarter: fromOptions.reportingFiscalQuarter ?? derived.reportingFiscalQuarter,
  };
}
