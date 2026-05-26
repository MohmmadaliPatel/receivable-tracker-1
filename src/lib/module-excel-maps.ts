import type { ModuleKey } from '@/lib/module-types';
import { categoryForModule } from '@/lib/module-types';
import { buildTradeCompositeCustId } from '@/lib/trade-composite-cust';
import { reportingFiscalFromDocumentDateString } from '@/lib/india-fiscal';

/** First sheet as header-row objects (for simple MSME CSV-style spreadsheets). */
export function spreadsheetToSimpleRowObjects(buffer: Buffer): Record<string, string>[] {
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  }) as Record<string, unknown>[];
  return raw.map((row) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      o[String(k)] = v != null ? String(v).trim() : '';
    }
    return o;
  });
}

function cellFromRowFlexible(row: Record<string, string>, candidates: string[]): string {
  for (const cand of candidates) {
    const c = cand.trim().toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.trim().toLowerCase() === c && String(v).trim()) return String(v).trim();
    }
  }
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  for (const cand of candidates) {
    const p = flat(cand);
    for (const [k, v] of Object.entries(row)) {
      if (flat(k).includes(p) && String(v).trim()) return String(v).trim();
    }
  }
  return '';
}

/** MSME ingest: Customer Name / Entity Name, Email TO, optional Email CC & Remarks */
export function mapConfirmMsmeCsvRow(r: Record<string, string>): {
  entityName: string;
  emailTo: string;
  emailCc?: string;
  bankName?: string;
  accountNumber?: string;
  custId?: string;
  remarks?: string;
} | null {
  const entityName =
    cellFromRowFlexible(r, ['Customer Name', 'Entity Name', 'customer name']) || '';
  const emailTo =
    cellFromRowFlexible(r, ['Email TO', 'Email To', 'email to', 'Email']) || '';
  const emailCc = cellFromRowFlexible(r, ['Email CC', 'email cc']);
  const remarks = cellFromRowFlexible(r, ['Remarks', 'remarks', 'Query/Remarks']);

  if (!entityName || !emailTo) return null;

  return {
    entityName,
    emailTo,
    emailCc: emailCc || undefined,
    remarks: remarks || undefined,
    bankName: undefined,
    accountNumber: undefined,
    custId: undefined,
  };
}

/** Auto-detect header row (first row containing "Company Code") and return data rows as objects. */
export function excelSheetToRowObjects(buffer: Buffer): Record<string, string>[] {
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });
  const headerIdx = matrix.findIndex(
    (row) =>
      Array.isArray(row) &&
      row.some((c) => String(c ?? '').toLowerCase().includes('company code'))
  );
  if (headerIdx < 0 || headerIdx >= matrix.length - 1) return [];

  const headers = (matrix[headerIdx] as unknown[]).map((c) => String(c ?? '').trim());
  const out: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const rowArr = matrix[i] as unknown[];
    if (!rowArr || rowArr.every((c) => c === '' || c === undefined || c === null)) continue;
    const o: Record<string, string> = {};
    headers.forEach((h, j) => {
      o[h] = rowArr[j] != null ? String(rowArr[j]) : '';
    });
    out.push(o);
  }
  return out;
}

export function mapTradePayableExcelRow(r: Record<string, string>) {
  const company = (r['Company Code'] ?? '').trim();
  const vendorNm = (r['Vendor Account: Name 1'] ?? r['Supplier'] ?? '').trim();
  const entityName = [company, vendorNm].filter(Boolean).join(' · ') || vendorNm || company || 'Unknown';
  const bankName = (r['G/L Account: Long Text'] ?? r['Vendor Account: Name 1'] ?? '').trim();
  const doc = (r['Document Number'] ?? '').trim();
  const recAcct = (r['Reconciliation acct'] ?? '').trim();
  const accountNumber = [doc, recAcct].filter(Boolean).join(' / ');
  const documentDate =
    cellFromRowFlexible(r, ['Document Date', 'Posting Date', 'Doc. Date', 'Document date']) || '';
  const documentNumber = doc || cellFromRowFlexible(r, ['Document Number', 'Doc. No', 'Doc No']) || '';
  const currencyValue =
    cellFromRowFlexible(r, [
      'Amount in Doc. Currency',
      'Currency Value',
      'Amount in LC',
      'Amt in Doc',
      'Amt in Doc. Currency',
      'Amount in document currency',
      'Loc.curr.amount',
    ]) || '';
  return {
    entityName,
    bankName: bankName || undefined,
    accountNumber: accountNumber || undefined,
    custId: buildTradeCompositeCustId(company, vendorNm),
    documentDate: documentDate || undefined,
    documentNumber: documentNumber || undefined,
    currencyValue: currencyValue || undefined,
    emailTo: '',
    emailCc: '' as string | undefined,
  };
}

export function mapTradeReceivableExcelRow(r: Record<string, string>) {
  const company = (r['Company Code'] ?? '').trim();
  const cn = (r['Customer Account: Name 1'] ?? r['Customer'] ?? '').trim();
  const entityName = [company, cn].filter(Boolean).join(' · ') || cn || company || 'Unknown';
  const bankName = (r['G/L Account: Long Text'] ?? r['Name'] ?? '').trim();
  const doc = (r['Document Number'] ?? '').trim();
  const aid = (r['Account ID'] ?? '').trim();
  const accountNumber = [doc, aid].filter(Boolean).join(' / ');
  const documentDate =
    cellFromRowFlexible(r, ['Document Date', 'Posting Date', 'Doc. Date', 'Document date']) || '';
  const documentNumber = doc || cellFromRowFlexible(r, ['Document Number', 'Doc. No', 'Doc No']) || '';
  const currencyValue =
    cellFromRowFlexible(r, [
      'Amount in Doc. Currency',
      'Currency Value',
      'Amount in LC',
      'Amt in Doc',
      'Amt in Doc. Currency',
      'Amount in document currency',
      'Loc.curr.amount',
    ]) || '';
  return {
    entityName,
    bankName: bankName || undefined,
    accountNumber: accountNumber || undefined,
    custId: buildTradeCompositeCustId(company, cn),
    documentDate: documentDate || undefined,
    documentNumber: documentNumber || undefined,
    currencyValue: currencyValue || undefined,
    emailTo: '',
    emailCc: '' as string | undefined,
  };
}

export type ExcelMappedRow = {
  entityName: string;
  bankName?: string;
  accountNumber?: string;
  custId?: string;
  documentDate?: string;
  documentNumber?: string;
  currencyValue?: string;
  emailTo: string;
  emailCc?: string | null;
  remarks?: string | null;
};

/** When set, uploaded rows use this FY/quarter instead of deriving from document date. */
export type ExcelImportFiscalContext = {
  listingUploadId: string;
  reportingFiscalYear: number;
  reportingFiscalQuarter: number;
};

export function baseCreatePayloadForExcel(
  mapped: ExcelMappedRow,
  module: ModuleKey,
  userId: string,
  fiscalCtx?: ExcelImportFiscalContext | null
) {
  const fiscal = reportingFiscalFromDocumentDateString(mapped.documentDate ?? null);
  const useUpload =
    fiscalCtx != null &&
    Number.isFinite(fiscalCtx.reportingFiscalYear) &&
    fiscalCtx.reportingFiscalQuarter >= 1 &&
    fiscalCtx.reportingFiscalQuarter <= 4;
  return {
    entityName: mapped.entityName,
    category: categoryForModule(module),
    bankName: mapped.bankName ?? null,
    accountNumber: mapped.accountNumber ?? null,
    custId: mapped.custId ?? null,
    documentDate: mapped.documentDate ?? null,
    documentNumber: mapped.documentNumber ?? null,
    currencyValue: mapped.currencyValue ?? null,
    reportingFiscalYear: useUpload ? fiscalCtx!.reportingFiscalYear : fiscal?.reportingFiscalYear ?? null,
    reportingFiscalQuarter: useUpload ? fiscalCtx!.reportingFiscalQuarter : fiscal?.reportingFiscalQuarter ?? null,
    listingUploadId: useUpload ? fiscalCtx!.listingUploadId : null,
    emailTo: mapped.emailTo,
    emailCc: mapped.emailCc || null,
    remarks: mapped.remarks ?? null,
    userId,
  };
}
