import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  MsmeConfirmation,
  TradePayableConfirmation,
  TradeReceivableConfirmation,
  VendorMaster,
} from '@prisma/client';
import type { IndiaFiscalQuarter } from '@/lib/india-fiscal';
import { dateInIndiaFiscalQuarter, indiaFiscalQuarterDateRange } from '@/lib/india-fiscal';
import type { ModuleKey } from '@/lib/module-types';
import { loadTradeGroupRows } from '@/lib/trade-email-group';
import { normalizeTradeCustId, TRADE_COMPOSITE_SEP } from '@/lib/trade-composite-cust';

export type ConfirmationKind = 'queried' | 'confirmed' | 'none';

/** API + UI shape — same as previous ConfirmationRecord JSON with explicit module */
export type UnifiedConfirmationRecord = {
  id: string;
  module: ModuleKey;
  entityContactId?: string | null;
  entityName: string;
  category: string;
  bankName?: string | null;
  accountNumber?: string | null;
  custId?: string | null;
  emailTo: string;
  emailCc?: string | null;
  status: string;
  sentAt?: Date | string | null;
  sentMessageId?: string | null;
  sentEmailFilePath?: string | null;
  followupSentAt?: Date | string | null;
  followupMessageId?: string | null;
  followupEmailFilePath?: string | null;
  followupCount?: number;
  followupsJson?: string | null;
  responseReceivedAt?: Date | string | null;
  responseMessageId?: string | null;
  responseSubject?: string | null;
  responseBody?: string | null;
  responseHtmlBody?: string | null;
  responseFromEmail?: string | null;
  responseFromName?: string | null;
  responseEmailFilePath?: string | null;
  responseHasAttachments?: boolean;
  responseAttachmentsJson?: string | null;
  responsesJson?: string | null;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  emailsSentFolderPath?: string | null;
  responsesFolderPath?: string | null;
  remarks?: string | null;
  emailActionNonce?: string | null;
  emailActionConsumedAt?: Date | string | null;
  webConfirmedAt?: Date | string | null;
  respondentQueryJson?: string | null;
  msmeHasCertificate?: boolean | null;
  msmeCertificateFilesJson?: string | null;
  userId: string;
  emailConfigId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  /** Derived for filters / table */
  responseChannel?: string;
  /** Confirmed vs queried (magic link / email); see {@link deriveConfirmationKind} */
  confirmationKind?: ConfirmationKind;
  hasWebResponse?: boolean;
  hasEmailResponse?: boolean;
  /** Trade-only: invoice columns from SAP listing */
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
  /** Trade: FK to canonical row managing email thread — null means this row is the anchor */
  emailThreadAnchorId?: string | null;
  /** When listing by custId code — invoice lines belonging to anchor (anchors only); optional */
  tradeInvoiceLines?: UnifiedConfirmationRecord[];
  /** Confirm MSME + joined Vendor master (listing-style columns) */
  vendorMasterNormalizedKey?: string | null;
  vendorMasterCompanyCode?: string | null;
  vendorMasterPartyName?: string | null;
  vendorMasterSapCustomerCode?: string | null;
  vendorMasterSource?: string | null;
  /** India FY start year (April); optional quarter 1–4 */
  reportingFiscalYear?: number | null;
  reportingFiscalQuarter?: number | null;
};

type SourceRow = TradePayableConfirmation | TradeReceivableConfirmation | MsmeConfirmation;

function applyVendorMasterToUnified(
  u: UnifiedConfirmationRecord,
  vm: VendorMaster | null | undefined
): UnifiedConfirmationRecord {
  if (!vm) return u;
  const emailTo = u.emailTo?.trim() ? u.emailTo : vm.emailTo?.trim() || u.emailTo;
  const emailCc = u.emailCc?.trim() ? u.emailCc : vm.emailCc?.trim() || u.emailCc;
  return {
    ...u,
    emailTo: emailTo ?? u.emailTo,
    emailCc: emailCc ?? u.emailCc,
    vendorMasterNormalizedKey: vm.normalizedKey,
    vendorMasterCompanyCode: vm.companyCode,
    vendorMasterPartyName: vm.partyName,
    vendorMasterSapCustomerCode: vm.sapCustomerCode ?? null,
    vendorMasterSource: vm.source,
  };
}

function asJson(r: SourceRow, mod: ModuleKey): UnifiedConfirmationRecord {
  const base: UnifiedConfirmationRecord = {
    id: r.id,
    module: mod,
    entityContactId: r.entityContactId,
    entityName: r.entityName,
    category: r.category,
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    custId: r.custId,
    emailTo: r.emailTo,
    emailCc: r.emailCc,
    status: r.status,
    sentAt: r.sentAt,
    sentMessageId: r.sentMessageId,
    sentEmailFilePath: r.sentEmailFilePath,
    followupSentAt: r.followupSentAt,
    followupMessageId: r.followupMessageId,
    followupEmailFilePath: r.followupEmailFilePath,
    followupCount: r.followupCount,
    followupsJson: r.followupsJson,
    responseReceivedAt: r.responseReceivedAt,
    responseMessageId: r.responseMessageId,
    responseSubject: r.responseSubject,
    responseBody: r.responseBody,
    responseHtmlBody: r.responseHtmlBody,
    responseFromEmail: r.responseFromEmail,
    responseFromName: r.responseFromName,
    responseEmailFilePath: r.responseEmailFilePath,
    responseHasAttachments: r.responseHasAttachments,
    responseAttachmentsJson: r.responseAttachmentsJson,
    responsesJson: r.responsesJson,
    attachmentPath: r.attachmentPath,
    attachmentName: r.attachmentName,
    emailsSentFolderPath: r.emailsSentFolderPath,
    responsesFolderPath: r.responsesFolderPath,
    remarks: r.remarks,
    emailActionNonce: r.emailActionNonce,
    emailActionConsumedAt: r.emailActionConsumedAt,
    webConfirmedAt: r.webConfirmedAt,
    respondentQueryJson: r.respondentQueryJson,
    userId: r.userId,
    emailConfigId: r.emailConfigId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    const t = r as TradePayableConfirmation | TradeReceivableConfirmation;
    base.documentDate = t.documentDate ?? null;
    base.documentNumber = t.documentNumber ?? null;
    base.currencyValue = t.currencyValue ?? null;
    base.emailThreadAnchorId = t.emailThreadAnchorId ?? null;
    base.reportingFiscalYear = t.reportingFiscalYear ?? null;
    base.reportingFiscalQuarter = t.reportingFiscalQuarter ?? null;
  } else {
    base.documentDate = undefined;
    base.documentNumber = undefined;
    base.currencyValue = undefined;
    base.emailThreadAnchorId = undefined;
    const m = r as MsmeConfirmation;
    base.reportingFiscalYear = m.reportingFiscalYear ?? null;
    base.reportingFiscalQuarter = m.reportingFiscalQuarter ?? null;
  }
  if (mod === 'confirm_msme') {
    const m = r as MsmeConfirmation;
    base.msmeHasCertificate = m.msmeHasCertificate;
    base.msmeCertificateFilesJson = m.msmeCertificateFilesJson;
  } else {
    base.msmeHasCertificate = null;
    base.msmeCertificateFilesJson = null;
  }
  const hasWeb = computeHasWebResponse(base);
  const hasEmail = computeHasEmailResponse(base);
  base.hasWebResponse = hasWeb;
  base.hasEmailResponse = hasEmail;
  if (hasWeb && hasEmail) base.responseChannel = 'both';
  else if (hasWeb) base.responseChannel = 'web';
  else if (hasEmail) base.responseChannel = 'email';
  else base.responseChannel = 'none';

  base.confirmationKind = deriveConfirmationKind(base);

  return base;
}

export function toUnifiedRecord(row: SourceRow, mod: ModuleKey): UnifiedConfirmationRecord {
  return asJson(row, mod);
}

export function computeHasWebResponse(r: Pick<UnifiedConfirmationRecord, 'module' | 'webConfirmedAt' | 'respondentQueryJson' | 'msmeHasCertificate' | 'msmeCertificateFilesJson'>): boolean {
  if (r.webConfirmedAt) return true;
  if (r.respondentQueryJson && r.respondentQueryJson.trim() && r.respondentQueryJson !== '[]') {
    try {
      const j = JSON.parse(r.respondentQueryJson) as unknown;
      if (Array.isArray(j) && j.length > 0) return true;
    } catch {
      return true;
    }
  }
  if (r.module === 'confirm_msme') {
    if (r.msmeHasCertificate === true) return true;
    if (r.msmeHasCertificate === false) return true; // declined via web
    if (r.msmeCertificateFilesJson && r.msmeCertificateFilesJson.trim() && r.msmeCertificateFilesJson !== '[]') return true;
  }
  return false;
}

export function computeHasEmailResponse(r: {
  status: string;
  responseReceivedAt?: unknown;
  responsesJson?: string | null;
}): boolean {
  if (r.status === 'response_received') return true;
  if (r.responseReceivedAt) return true;
  if (!r.responsesJson) return false;
  try {
    const arr = JSON.parse(r.responsesJson) as unknown;
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

export function hasNonEmptyRespondentQueryJson(respondentQueryJson: string | null | undefined): boolean {
  const t = respondentQueryJson?.trim();
  if (!t || t === '[]') return false;
  try {
    const j = JSON.parse(t) as unknown;
    return Array.isArray(j) && j.length > 0;
  } catch {
    return true;
  }
}

/** Queried takes precedence; then web confirm / MSME web / email reply. */
export function deriveConfirmationKind(r: {
  module: ModuleKey;
  status: string;
  webConfirmedAt?: Date | string | null;
  respondentQueryJson?: string | null;
  responseReceivedAt?: Date | string | null;
  responsesJson?: string | null;
  msmeHasCertificate?: boolean | null;
  msmeCertificateFilesJson?: string | null;
}): ConfirmationKind {
  if (hasNonEmptyRespondentQueryJson(r.respondentQueryJson)) return 'queried';
  if (r.webConfirmedAt != null && String(r.webConfirmedAt).trim() !== '') return 'confirmed';
  if (r.module === 'confirm_msme') {
    if (r.msmeHasCertificate === true || r.msmeHasCertificate === false) return 'confirmed';
    const cf = r.msmeCertificateFilesJson?.trim();
    if (cf && cf !== '[]') {
      try {
        const j = JSON.parse(cf) as unknown;
        if (Array.isArray(j) && j.length > 0) return 'confirmed';
      } catch {
        return 'confirmed';
      }
    }
  }
  if (computeHasEmailResponse(r)) return 'confirmed';
  return 'none';
}

export async function findConfirmationMetaById(
  recordId: string
): Promise<{ module: ModuleKey; record: SourceRow } | null> {
  const tp = await prisma.tradePayableConfirmation.findUnique({ where: { id: recordId } });
  if (tp) return { module: 'trade_payable', record: tp };
  const tr = await prisma.tradeReceivableConfirmation.findUnique({ where: { id: recordId } });
  if (tr) return { module: 'trade_receivable', record: tr };
  const ms = await prisma.msmeConfirmation.findUnique({ where: { id: recordId } });
  if (ms) return { module: 'confirm_msme', record: ms };
  return null;
}

export async function findUnifiedById(recordId: string): Promise<UnifiedConfirmationRecord | null> {
  const meta = await findConfirmationMetaById(recordId);
  if (!meta) return null;
  if (meta.module === 'confirm_msme') {
    const r = await prisma.msmeConfirmation.findUnique({
      where: { id: recordId },
      include: { vendorMaster: true },
    });
    return r ? applyVendorMasterToUnified(asJson(r, 'confirm_msme'), r.vendorMaster) : null;
  }
  return asJson(meta.record, meta.module);
}

export async function findUnifiedByModuleClaim(
  recordId: string,
  mod: ModuleKey
): Promise<UnifiedConfirmationRecord | null> {
  if (mod === 'trade_payable') {
    const r = await prisma.tradePayableConfirmation.findUnique({ where: { id: recordId } });
    return r ? asJson(r, mod) : null;
  }
  if (mod === 'trade_receivable') {
    const r = await prisma.tradeReceivableConfirmation.findUnique({ where: { id: recordId } });
    return r ? asJson(r, mod) : null;
  }
  const r = await prisma.msmeConfirmation.findUnique({
    where: { id: recordId },
    include: { vendorMaster: true },
  });
  return r ? applyVendorMasterToUnified(asJson(r, 'confirm_msme'), r.vendorMaster) : null;
}

/** Direct DB read for magic-link verification (avoids any mapping layer dropping fields). */
export async function fetchEmailActionGateFields(
  recordId: string,
  mod: ModuleKey
): Promise<{ emailActionNonce: string | null; emailActionConsumedAt: Date | null } | null> {
  const select = { emailActionNonce: true, emailActionConsumedAt: true } as const;
  if (mod === 'trade_payable') {
    const r = await prisma.tradePayableConfirmation.findUnique({ where: { id: recordId }, select });
    return r ?? null;
  }
  if (mod === 'trade_receivable') {
    const r = await prisma.tradeReceivableConfirmation.findUnique({ where: { id: recordId }, select });
    return r ?? null;
  }
  const r = await prisma.msmeConfirmation.findUnique({ where: { id: recordId }, select });
  return r ?? null;
}

async function upsertEntityContactMatchForSap(
  custId?: string | null
): Promise<string | undefined> {
  if (!custId?.trim()) return undefined;
  const normalized = normalizeTradeCustId(custId);
  let ec = await prisma.entityContact.findFirst({
    where: { sapCustomerCode: normalized },
    select: { id: true },
  });
  if (ec?.id) return ec.id;
  /** RT India Sheet1 is often company-only; fall back so legacy contacts still link. */
  const sepIdx = normalized.indexOf('||');
  if (sepIdx > 0) {
    const companyOnly = normalized.slice(0, sepIdx);
    ec = await prisma.entityContact.findFirst({
      where: { sapCustomerCode: companyOnly },
      select: { id: true },
    });
  }
  return ec?.id;
}

export async function applyEntityContactToPayload<T extends Record<string, unknown>>(key: ModuleKey, payload: T): Promise<T & { entityContactId?: string | null }> {
  let entityContactId: string | null = (payload.entityContactId as string | undefined) ?? null;
  const custId = payload.custId as string | null | undefined;
  if (!entityContactId && (key === 'trade_payable' || key === 'confirm_msme' || key === 'trade_receivable')) {
    const id = await upsertEntityContactMatchForSap(custId ?? null);
    entityContactId = id ?? null;
  }
  return { ...payload, entityContactId };
}

/** Normalize SAP company/customer codes for FK join into RT India Sheet1 */
export function normalizeSapCode(raw: string): string {
  return String(raw).trim().replace(/\.0+$/, '');
}

/** Company code from SAP-style entity display (entityName "CODE · Party" or custId "CODE||Party"). */
export function extractTradeCompanyCodeFromEntity(
  entityName: string | null | undefined,
  custId: string | null | undefined
): string | null {
  const en = entityName?.trim() || '';
  if (en.includes(' · ')) {
    return normalizeSapCode(en.slice(0, en.indexOf(' · ')));
  }
  const cid = custId?.trim();
  if (cid && cid.includes(TRADE_COMPOSITE_SEP)) {
    return normalizeSapCode(cid.slice(0, cid.indexOf(TRADE_COMPOSITE_SEP)));
  }
  return null;
}

/** List confirmations with filters; merges module tables when module omitted (admin). */
export type ListConfirmationFilter = {
  userId?: string;
  entityName?: string | string[];
  category?: string | string[];
  module?: string | string[];
  status?: string | string[];
  search?: string;
  /** Filter by confirmation outcome — server-side */
  confirmationKind?: ('all' | ConfirmationKind)[];
  /** India FY start years (April); OR semantics when multiple */
  reportingFiscalYears?: number[];
  /** India fiscal quarters 1–4; OR semantics when multiple */
  reportingFiscalQuarters?: number[];
  /** strict = DB fiscal match only; includeDerivedSent = also match sent rows via sentAt */
  fiscalMatchMode?: 'strict' | 'includeDerivedSent';
  /** Filter by vendor/supplier master or parsed trade company code */
  companyCode?: string[];
  /** Trade module workspace: one row per custId code with nested lines */
  listMode?: 'flat' | 'by_code';
  page?: number;
  pageSize?: number;
  /** Return all matching anchors (by_code) without pagination — for bulk send prep */
  unpaged?: boolean;
  /** Omit loading nested trade invoice lines (by_code) */
  omitTradeLines?: boolean;
};

export type WorkspaceStats = {
  total: number;
  notSent: number;
  sent: number;
  followupSent: number;
  responseReceived: number;
};

export type ListUnifiedConfirmationResult = {
  records: UnifiedConfirmationRecord[];
  total: number;
  /** Populated for trade `listMode: by_code` — counts over the full filtered anchor set, not the current page */
  stats?: WorkspaceStats;
};

type TradeAnchorMinimal = {
  id: string;
  custId: string | null;
  entityName: string;
  createdAt: Date;
  status: string;
  webConfirmedAt: Date | null;
  respondentQueryJson: string | null;
  responseReceivedAt: Date | null;
  responsesJson: string | null;
  vendorMaster?: { companyCode: string } | null;
  supplierMaster?: { companyCode: string } | null;
};

function anchorMatchesCompanyCodes(
  m: TradeAnchorMinimal,
  mod: 'trade_payable' | 'trade_receivable',
  codesNorm: string[]
): boolean {
  if (codesNorm.length === 0) return true;
  const fromMaster =
    mod === 'trade_payable' ? m.vendorMaster?.companyCode : m.supplierMaster?.companyCode;
  if (fromMaster && codesNorm.includes(normalizeSapCode(fromMaster))) return true;
  const extracted = extractTradeCompanyCodeFromEntity(m.entityName, m.custId);
  return extracted != null && codesNorm.includes(extracted);
}

function tradeFlatRowMatchesCompany(
  row: {
    entityName: string;
    custId: string | null;
    vendorMaster?: { companyCode: string } | null;
    supplierMaster?: { companyCode: string } | null;
  },
  mod: 'trade_payable' | 'trade_receivable',
  codesNorm: string[]
): boolean {
  if (codesNorm.length === 0) return true;
  return anchorMatchesCompanyCodes(
    {
      id: '',
      custId: row.custId,
      entityName: row.entityName,
      createdAt: new Date(),
      status: '',
      webConfirmedAt: null,
      respondentQueryJson: null,
      responseReceivedAt: null,
      responsesJson: null,
      vendorMaster: row.vendorMaster,
      supplierMaster: row.supplierMaster,
    },
    mod,
    codesNorm
  );
}

function msmeRowMatchesCompanyCodes(
  row: {
    vendorMaster?: { companyCode: string } | null;
    supplierMaster?: { companyCode: string } | null;
  },
  codesNorm: string[]
): boolean {
  if (codesNorm.length === 0) return true;
  const v = row.vendorMaster?.companyCode;
  const s = row.supplierMaster?.companyCode;
  if (v && codesNorm.includes(normalizeSapCode(v))) return true;
  if (s && codesNorm.includes(normalizeSapCode(s))) return true;
  return false;
}

const TRADE_ANCHOR_CHANNEL_SELECT = {
  id: true,
  custId: true,
  entityName: true,
  createdAt: true,
  status: true,
  webConfirmedAt: true,
  respondentQueryJson: true,
  responseReceivedAt: true,
  responsesJson: true,
} as const;

function tradeAnchorConfirmationKind(
  row: TradeAnchorMinimal,
  mod: 'trade_payable' | 'trade_receivable'
): ConfirmationKind {
  return deriveConfirmationKind({
    module: mod,
    status: row.status,
    webConfirmedAt: row.webConfirmedAt,
    respondentQueryJson: row.respondentQueryJson,
    responseReceivedAt: row.responseReceivedAt,
    responsesJson: row.responsesJson,
    msmeHasCertificate: null,
    msmeCertificateFilesJson: null,
  });
}

function buildWorkspaceStats(rows: TradeAnchorMinimal[]): WorkspaceStats {
  return {
    total: rows.length,
    notSent: rows.filter((r) => r.status === 'not_sent').length,
    sent: rows.filter((r) => r.status === 'sent').length,
    followupSent: rows.filter((r) => r.status === 'followup_sent').length,
    responseReceived: rows.filter((r) => r.status === 'response_received').length,
  };
}

function matchesConfirmationKindFilter(u: UnifiedConfirmationRecord, kinds: ConfirmationKind[]): boolean {
  if (!kinds.length) return true;
  const k = u.confirmationKind ?? deriveConfirmationKind(u);
  return kinds.includes(k);
}

function hasReportingFiscalFilter(filter: ListConfirmationFilter): boolean {
  return (
    (filter.reportingFiscalYears?.length ?? 0) > 0 || (filter.reportingFiscalQuarters?.length ?? 0) > 0
  );
}

function buildFiscalWhereClause(filter: ListConfirmationFilter): Record<string, unknown> | null {
  const years = (filter.reportingFiscalYears ?? []).filter((y) => Number.isFinite(y));
  const quarters = (filter.reportingFiscalQuarters ?? []).filter((q) => q >= 1 && q <= 4);
  if (!years.length && !quarters.length) return null;

  if (
    filter.fiscalMatchMode === 'includeDerivedSent' &&
    years.length === 1 &&
    quarters.length === 1
  ) {
    const { start, end } = indiaFiscalQuarterDateRange(
      years[0],
      quarters[0] as IndiaFiscalQuarter
    );
    return {
      OR: [
        { reportingFiscalYear: years[0], reportingFiscalQuarter: quarters[0] },
        {
          AND: [
            { reportingFiscalYear: null },
            { status: { in: ['sent', 'followup_sent'] } },
            {
              OR: [
                { sentAt: { gte: start, lte: end } },
                { followupSentAt: { gte: start, lte: end } },
              ],
            },
          ],
        },
      ],
    };
  }

  const w: Record<string, unknown> = {};
  if (years.length === 1) w.reportingFiscalYear = years[0];
  else if (years.length > 1) w.reportingFiscalYear = { in: years };
  if (quarters.length === 1) w.reportingFiscalQuarter = quarters[0];
  else if (quarters.length > 1) w.reportingFiscalQuarter = { in: quarters };
  return w;
}

function applyFiscalFilter(w: Record<string, unknown>, filter: ListConfirmationFilter): void {
  const clause = buildFiscalWhereClause(filter);
  if (!clause) return;
  if (clause.OR) {
    const existing = Array.isArray(w.AND) ? (w.AND as unknown[]) : [];
    w.AND = [...existing, clause];
  } else {
    Object.assign(w, clause);
  }
}

export type BulkListDiagnostics = {
  eligible: number;
  sentWithoutFiscalStamp: number;
  sentOtherPeriod: number;
};

function recordInSelectedPeriod(
  r: UnifiedConfirmationRecord,
  fy: number,
  fq: number
): boolean {
  if (r.reportingFiscalYear === fy && r.reportingFiscalQuarter === fq) return true;
  const d = r.followupSentAt || r.sentAt;
  if (!d) return false;
  return dateInIndiaFiscalQuarter(new Date(d), fy, fq as IndiaFiscalQuarter);
}

/** Diagnostic counts for bulk follow-up empty states. */
export async function getBulkListDiagnostics(
  filter: ListConfirmationFilter
): Promise<BulkListDiagnostics> {
  const fy = filter.reportingFiscalYears?.[0];
  const fq = filter.reportingFiscalQuarters?.[0];

  const eligibleResult = await listUnifiedConfirmationRecords({
    ...filter,
    fiscalMatchMode: 'includeDerivedSent',
    unpaged: true,
  });

  const allSentResult = await listUnifiedConfirmationRecords({
    ...filter,
    reportingFiscalYears: undefined,
    reportingFiscalQuarters: undefined,
    fiscalMatchMode: 'strict',
    unpaged: true,
  });

  let sentWithoutFiscalStamp = 0;
  let sentOtherPeriod = 0;

  for (const r of allSentResult.records) {
    if (r.status !== 'sent' && r.status !== 'followup_sent') continue;
    const hasFiscal = r.reportingFiscalYear != null && r.reportingFiscalQuarter != null;
    if (fy == null || fq == null) {
      if (!hasFiscal) sentWithoutFiscalStamp++;
      continue;
    }
    const inPeriod = recordInSelectedPeriod(r, fy, fq);
    if (!hasFiscal && inPeriod) {
      sentWithoutFiscalStamp++;
    } else if (hasFiscal && (r.reportingFiscalYear !== fy || r.reportingFiscalQuarter !== fq)) {
      sentOtherPeriod++;
    } else if (!hasFiscal && !inPeriod) {
      sentOtherPeriod++;
    }
  }

  return {
    eligible: eligibleResult.total,
    sentWithoutFiscalStamp,
    sentOtherPeriod,
  };
}

export async function listUnifiedConfirmationRecords(filter: ListConfirmationFilter): Promise<ListUnifiedConfirmationResult> {
  const mods = filter.module
    ? Array.isArray(filter.module)
      ? (filter.module as ModuleKey[])
      : ([filter.module] as ModuleKey[])
    : (['trade_payable', 'trade_receivable', 'confirm_msme'] as ModuleKey[]);

  const kinds = filter.confirmationKind?.length
    ? (filter.confirmationKind.filter((c) => c !== 'all') as ConfirmationKind[])
    : [];

  const listMode = filter.listMode ?? 'flat';

  const buildWhereSegment = (tradeOnly?: 'tp' | 'tr'): Record<string, unknown> => {
    const w: Record<string, unknown> = {};
    if (filter.userId) w.userId = filter.userId;
    if (filter.entityName) {
      w.entityName = Array.isArray(filter.entityName) ? { in: filter.entityName } : filter.entityName;
    }
    if (filter.category) {
      w.category = Array.isArray(filter.category) ? { in: filter.category } : filter.category;
    }
    if (filter.status) {
      w.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
    }
    if (filter.search) {
      const s = filter.search;
      w.OR = [
        { entityName: { contains: s } },
        { bankName: { contains: s } },
        { emailTo: { contains: s } },
        { custId: { contains: s } },
      ];
    }
    if (listMode === 'flat' && tradeOnly === 'tp') w.emailThreadAnchorId = null;
    if (listMode === 'flat' && tradeOnly === 'tr') w.emailThreadAnchorId = null;
    return w;
  };

  const applyReportingFiscalToWhere = (w: Record<string, unknown>) => {
    applyFiscalFilter(w, filter);
  };

  /** Grouped by SAP code: one anchor per page with nested invoice lines */
  if (
    listMode === 'by_code' &&
    mods.length === 1 &&
    (mods[0] === 'trade_payable' || mods[0] === 'trade_receivable')
  ) {
    const mod = mods[0];
    const page = Math.max(1, filter.page ?? 1);
    const tradeKey = mod === 'trade_payable' ? 'tp' : 'tr';
    const companyNorm = filter.companyCode?.length ? filter.companyCode.map(normalizeSapCode) : [];

    if (mod === 'trade_payable') {
      const segment = buildWhereSegment(tradeKey);
      let anchorIdIn: string[] | undefined;
      if (hasReportingFiscalFilter(filter)) {
        const lineWhere = { ...segment } as Record<string, unknown>;
        applyReportingFiscalToWhere(lineWhere);
        const hits = await prisma.tradePayableConfirmation.findMany({
          where: lineWhere as Prisma.TradePayableConfirmationWhereInput,
          select: { id: true, emailThreadAnchorId: true },
        });
        anchorIdIn = [...new Set(hits.map((h) => h.emailThreadAnchorId ?? h.id))];
        if (anchorIdIn.length === 0) {
          const anchorWhere = { ...segment, emailThreadAnchorId: null } as Record<string, unknown>;
          applyReportingFiscalToWhere(anchorWhere);
          const anchorHits = await prisma.tradePayableConfirmation.findMany({
            where: anchorWhere as Prisma.TradePayableConfirmationWhereInput,
            select: { id: true },
          });
          anchorIdIn = anchorHits.map((h) => h.id);
        }
        if (anchorIdIn.length === 0) {
          const stats = buildWorkspaceStats([]);
          return { records: [], total: 0, stats };
        }
      }
      const where = {
        ...segment,
        emailThreadAnchorId: null,
      } as Prisma.TradePayableConfirmationWhereInput;
      if (anchorIdIn) {
        where.id = { in: anchorIdIn };
      } else {
        applyReportingFiscalToWhere(where as unknown as Record<string, unknown>);
      }
      const minimal = (await prisma.tradePayableConfirmation.findMany({
        where,
        select: {
          ...TRADE_ANCHOR_CHANNEL_SELECT,
          vendorMaster: { select: { companyCode: true } },
        },
        orderBy: [{ custId: 'asc' }, { entityName: 'asc' }, { createdAt: 'asc' }],
      })) as TradeAnchorMinimal[];

      let working =
        kinds.length > 0 ? minimal.filter((m) => kinds.includes(tradeAnchorConfirmationKind(m, 'trade_payable'))) : minimal;
      if (companyNorm.length > 0) {
        working = working.filter((m) => anchorMatchesCompanyCodes(m, 'trade_payable', companyNorm));
      }

      const stats = buildWorkspaceStats(working);
      const total = working.length;
      const pageSizeCap = filter.unpaged ? Math.max(total, 1) : Math.min(200, Math.max(1, filter.pageSize ?? 25));
      const slice = filter.unpaged ? working : working.slice((page - 1) * pageSizeCap, page * pageSizeCap);
      const ids = slice.map((r) => r.id);

      if (ids.length === 0) {
        return { records: [], total: 0, stats };
      }

      const fullRows = await prisma.tradePayableConfirmation.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(fullRows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)!);

      const out: UnifiedConfirmationRecord[] = [];
      const omitLines = filter.omitTradeLines === true;
      for (const anchor of ordered) {
        if (omitLines) {
          out.push({ ...asJson(anchor, mod), tradeInvoiceLines: [] });
          continue;
        }
        const lineFiscal = hasReportingFiscalFilter(filter)
          ? {
              reportingFiscalYears: filter.reportingFiscalYears,
              reportingFiscalQuarters: filter.reportingFiscalQuarters,
            }
          : null;
        const rawLines = await loadTradeGroupRows(anchor.id, 'trade_payable', lineFiscal);
        const lines = rawLines.map((r) => asJson(r, mod));
        out.push({ ...asJson(anchor, mod), tradeInvoiceLines: lines });
      }
      return { records: out, total, stats };
    }

    const segment = buildWhereSegment(tradeKey);
    let anchorIdIn: string[] | undefined;
    if (hasReportingFiscalFilter(filter)) {
      const lineWhere = { ...segment } as Record<string, unknown>;
      applyReportingFiscalToWhere(lineWhere);
      const hits = await prisma.tradeReceivableConfirmation.findMany({
        where: lineWhere as Prisma.TradeReceivableConfirmationWhereInput,
        select: { id: true, emailThreadAnchorId: true },
      });
      anchorIdIn = [...new Set(hits.map((h) => h.emailThreadAnchorId ?? h.id))];
      if (anchorIdIn.length === 0) {
        const anchorWhere = { ...segment, emailThreadAnchorId: null } as Record<string, unknown>;
        applyReportingFiscalToWhere(anchorWhere);
        const anchorHits = await prisma.tradeReceivableConfirmation.findMany({
          where: anchorWhere as Prisma.TradeReceivableConfirmationWhereInput,
          select: { id: true },
        });
        anchorIdIn = anchorHits.map((h) => h.id);
      }
      if (anchorIdIn.length === 0) {
        const stats = buildWorkspaceStats([]);
        return { records: [], total: 0, stats };
      }
    }
    const where = {
      ...segment,
      emailThreadAnchorId: null,
    } as Prisma.TradeReceivableConfirmationWhereInput;
    if (anchorIdIn) {
      where.id = { in: anchorIdIn };
    } else {
      applyReportingFiscalToWhere(where as unknown as Record<string, unknown>);
    }
    const minimal = (await prisma.tradeReceivableConfirmation.findMany({
      where,
      select: {
        ...TRADE_ANCHOR_CHANNEL_SELECT,
        supplierMaster: { select: { companyCode: true } },
      },
      orderBy: [{ custId: 'asc' }, { entityName: 'asc' }, { createdAt: 'asc' }],
    })) as TradeAnchorMinimal[];

    let working =
      kinds.length > 0 ? minimal.filter((m) => kinds.includes(tradeAnchorConfirmationKind(m, 'trade_receivable'))) : minimal;
    if (companyNorm.length > 0) {
      working = working.filter((m) => anchorMatchesCompanyCodes(m, 'trade_receivable', companyNorm));
    }

    const stats = buildWorkspaceStats(working);
    const total = working.length;
    const pageSizeCap = filter.unpaged ? Math.max(total, 1) : Math.min(200, Math.max(1, filter.pageSize ?? 25));
    const slice = filter.unpaged ? working : working.slice((page - 1) * pageSizeCap, page * pageSizeCap);
    const ids = slice.map((r) => r.id);

    if (ids.length === 0) {
      return { records: [], total: 0, stats };
    }

    const fullRows = await prisma.tradeReceivableConfirmation.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(fullRows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)!);

    const out: UnifiedConfirmationRecord[] = [];
    const omitLines = filter.omitTradeLines === true;
    for (const anchor of ordered) {
      if (omitLines) {
        out.push({ ...asJson(anchor, mod), tradeInvoiceLines: [] });
        continue;
      }
      const lineFiscal = hasReportingFiscalFilter(filter)
        ? {
            reportingFiscalYears: filter.reportingFiscalYears,
            reportingFiscalQuarters: filter.reportingFiscalQuarters,
          }
        : null;
      const rawLines = await loadTradeGroupRows(anchor.id, 'trade_receivable', lineFiscal);
      const lines = rawLines.map((r) => asJson(r, mod));
      out.push({ ...asJson(anchor, mod), tradeInvoiceLines: lines });
    }
    return { records: out, total, stats };
  }

  const whereTpRaw = buildWhereSegment('tp') as Prisma.TradePayableConfirmationWhereInput;
  applyReportingFiscalToWhere(whereTpRaw as unknown as Record<string, unknown>);
  const whereTp = whereTpRaw;
  const whereTrRaw = buildWhereSegment('tr') as Prisma.TradeReceivableConfirmationWhereInput;
  applyReportingFiscalToWhere(whereTrRaw as unknown as Record<string, unknown>);
  const whereTr = whereTrRaw;
  const whereMsRaw = buildWhereSegment() as Prisma.MsmeConfirmationWhereInput;
  applyReportingFiscalToWhere(whereMsRaw as unknown as Record<string, unknown>);
  const whereMs = whereMsRaw;

  const orderBy = [{ entityName: 'asc' as const }, { category: 'asc' as const }];

  const out: UnifiedConfirmationRecord[] = [];
  const companyNormFlat = filter.companyCode?.length ? filter.companyCode.map(normalizeSapCode) : [];

  for (const mod of mods) {
    if (mod === 'trade_payable') {
      const r = await prisma.tradePayableConfirmation.findMany({
        where: whereTp,
        orderBy,
        include: { vendorMaster: { select: { companyCode: true } } },
      });
      for (const row of r) {
        if (!tradeFlatRowMatchesCompany(row, 'trade_payable', companyNormFlat)) continue;
        const u = asJson(row, mod);
        if (!kinds.length) out.push(u);
        else if (matchesConfirmationKindFilter(u, kinds)) out.push(u);
      }
      continue;
    }
    if (mod === 'trade_receivable') {
      const r = await prisma.tradeReceivableConfirmation.findMany({
        where: whereTr,
        orderBy,
        include: { supplierMaster: { select: { companyCode: true } } },
      });
      for (const row of r) {
        if (!tradeFlatRowMatchesCompany(row, 'trade_receivable', companyNormFlat)) continue;
        const u = asJson(row, mod);
        if (!kinds.length) out.push(u);
        else if (matchesConfirmationKindFilter(u, kinds)) out.push(u);
      }
      continue;
    }
    const msRows = await prisma.msmeConfirmation.findMany({
      where: whereMs,
      orderBy,
      include: { vendorMaster: true, supplierMaster: { select: { companyCode: true } } },
    });
    for (const row of msRows) {
      if (!msmeRowMatchesCompanyCodes(row, companyNormFlat)) continue;
      const u = applyVendorMasterToUnified(asJson(row, 'confirm_msme'), row.vendorMaster);
      if (!kinds.length) out.push(u);
      else if (matchesConfirmationKindFilter(u, kinds)) out.push(u);
    }
  }

  out.sort((a, b) => {
    const en = String(a.entityName).localeCompare(String(b.entityName));
    if (en !== 0) return en;
    return String(a.category).localeCompare(String(b.category));
  });

  return { records: out, total: out.length };
}

export async function getDistinctReportingFiscalYears(module?: ModuleKey, userId?: string): Promise<number[]> {
  const uw = userId ? { userId } : {};
  const addYears = (rows: { reportingFiscalYear: number | null }[], into: Set<number>) => {
    for (const r of rows) {
      if (r.reportingFiscalYear != null) into.add(r.reportingFiscalYear);
    }
  };
  if (!module) {
    const [a, b, c] = await Promise.all([
      prisma.tradePayableConfirmation.findMany({
        where: uw,
        select: { reportingFiscalYear: true },
        distinct: ['reportingFiscalYear'],
      }),
      prisma.tradeReceivableConfirmation.findMany({
        where: uw,
        select: { reportingFiscalYear: true },
        distinct: ['reportingFiscalYear'],
      }),
      prisma.msmeConfirmation.findMany({
        where: uw,
        select: { reportingFiscalYear: true },
        distinct: ['reportingFiscalYear'],
      }),
    ]);
    const set = new Set<number>();
    addYears(a, set);
    addYears(b, set);
    addYears(c, set);
    return [...set].sort((x, y) => y - x);
  }
  if (module === 'trade_payable') {
    const rows = await prisma.tradePayableConfirmation.findMany({
      where: uw,
      select: { reportingFiscalYear: true },
      distinct: ['reportingFiscalYear'],
    });
    const set = new Set<number>();
    addYears(rows, set);
    return [...set].sort((x, y) => y - x);
  }
  if (module === 'trade_receivable') {
    const rows = await prisma.tradeReceivableConfirmation.findMany({
      where: uw,
      select: { reportingFiscalYear: true },
      distinct: ['reportingFiscalYear'],
    });
    const set = new Set<number>();
    addYears(rows, set);
    return [...set].sort((x, y) => y - x);
  }
  const rows = await prisma.msmeConfirmation.findMany({
    where: uw,
    select: { reportingFiscalYear: true },
    distinct: ['reportingFiscalYear'],
  });
  const set = new Set<number>();
  addYears(rows, set);
  return [...set].sort((x, y) => y - x);
}

/** Latest (year, quarter) pair that has data across TP/TR/MSME for the user (org-wide fallback). */
export async function getLatestReportingFiscalPeriod(
  userId?: string
): Promise<{ year: number; quarter: number } | null> {
  async function collectForScope(scopeUserId?: string): Promise<Array<{ year: number; quarter: number }>> {
    const uw = scopeUserId ? { userId: scopeUserId } : {};
    const pairs: Array<{ year: number; quarter: number }> = [];

    const collect = (rows: { reportingFiscalYear: number | null; reportingFiscalQuarter: number | null }[]) => {
      for (const r of rows) {
        if (r.reportingFiscalYear != null && r.reportingFiscalQuarter != null) {
          pairs.push({ year: r.reportingFiscalYear, quarter: r.reportingFiscalQuarter });
        }
      }
    };

    const [tp, tr, ms, uploads, orgUploads] = await Promise.all([
      prisma.tradePayableConfirmation.findMany({
        where: { ...uw, reportingFiscalYear: { not: null }, reportingFiscalQuarter: { not: null } },
        select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
        distinct: ['reportingFiscalYear', 'reportingFiscalQuarter'],
      }),
      prisma.tradeReceivableConfirmation.findMany({
        where: { ...uw, reportingFiscalYear: { not: null }, reportingFiscalQuarter: { not: null } },
        select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
        distinct: ['reportingFiscalYear', 'reportingFiscalQuarter'],
      }),
      prisma.msmeConfirmation.findMany({
        where: { ...uw, reportingFiscalYear: { not: null }, reportingFiscalQuarter: { not: null } },
        select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
        distinct: ['reportingFiscalYear', 'reportingFiscalQuarter'],
      }),
      scopeUserId
        ? prisma.tradeListingUpload.findMany({
            where: { userId: scopeUserId },
            select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
            distinct: ['reportingFiscalYear', 'reportingFiscalQuarter'],
          })
        : Promise.resolve([]),
      prisma.tradeListingUpload.findMany({
        select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
        distinct: ['reportingFiscalYear', 'reportingFiscalQuarter'],
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    collect(tp);
    collect(tr);
    collect(ms);
    for (const u of uploads) {
      if (u.reportingFiscalYear != null && u.reportingFiscalQuarter != null) {
        pairs.push({ year: u.reportingFiscalYear, quarter: u.reportingFiscalQuarter });
      }
    }
    for (const u of orgUploads) {
      if (u.reportingFiscalYear != null && u.reportingFiscalQuarter != null) {
        pairs.push({ year: u.reportingFiscalYear, quarter: u.reportingFiscalQuarter });
      }
    }
    return pairs;
  }

  function pickLatest(pairs: Array<{ year: number; quarter: number }>) {
    if (pairs.length === 0) return null;
    pairs.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.quarter - a.quarter;
    });
    return pairs[0]!;
  }

  const scoped = pickLatest(await collectForScope(userId));
  if (scoped) return scoped;
  if (userId) return pickLatest(await collectForScope(undefined));
  return null;
}

export async function getDistinctCompanyCodes(module?: ModuleKey, userId?: string): Promise<string[]> {
  const uw = userId ? { userId } : {};
  const set = new Set<string>();
  const add = (s: string | null | undefined) => {
    const t = normalizeSapCode(String(s || ''));
    if (t) set.add(t);
  };

  const ingestTp = async () => {
    const vms = await prisma.vendorMaster.findMany({
      where: { tradePayables: { some: uw } },
      select: { companyCode: true },
      distinct: ['companyCode'],
    });
    vms.forEach((r) => add(r.companyCode));
    const rows = await prisma.tradePayableConfirmation.findMany({
      where: uw,
      select: { entityName: true, custId: true },
    });
    rows.forEach((r) => add(extractTradeCompanyCodeFromEntity(r.entityName, r.custId) ?? undefined));
  };
  const ingestTr = async () => {
    const sms = await prisma.supplierMaster.findMany({
      where: { tradeReceivables: { some: uw } },
      select: { companyCode: true },
      distinct: ['companyCode'],
    });
    sms.forEach((r) => add(r.companyCode));
    const rows = await prisma.tradeReceivableConfirmation.findMany({
      where: uw,
      select: { entityName: true, custId: true },
    });
    rows.forEach((r) => add(extractTradeCompanyCodeFromEntity(r.entityName, r.custId) ?? undefined));
  };
  const ingestMsme = async () => {
    const rows = await prisma.msmeConfirmation.findMany({
      where: uw,
      select: {
        vendorMaster: { select: { companyCode: true } },
        supplierMaster: { select: { companyCode: true } },
      },
    });
    rows.forEach((r) => {
      add(r.vendorMaster?.companyCode);
      add(r.supplierMaster?.companyCode);
    });
  };

  if (!module) {
    await Promise.all([ingestTp(), ingestTr(), ingestMsme()]);
  } else if (module === 'trade_payable') {
    await ingestTp();
  } else if (module === 'trade_receivable') {
    await ingestTr();
  } else {
    await ingestMsme();
  }
  return [...set].sort();
}

export async function getDistinctEntityNames(module?: ModuleKey, userId?: string): Promise<string[]> {
  const uw = userId ? { userId } : {};
  if (!module) {
    const [a, b, c] = await Promise.all([
      prisma.tradePayableConfirmation.findMany({
        where: uw,
        select: { entityName: true },
        distinct: ['entityName'],
      }),
      prisma.tradeReceivableConfirmation.findMany({
        where: uw,
        select: { entityName: true },
        distinct: ['entityName'],
      }),
      prisma.msmeConfirmation.findMany({
        where: uw,
        select: { entityName: true },
        distinct: ['entityName'],
      }),
    ]);
    const set = new Set([...a, ...b, ...c].map((x) => x.entityName));
    return [...set].sort();
  }
  const rows =
    module === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findMany({
          where: uw,
          select: { entityName: true },
          distinct: ['entityName'],
          orderBy: { entityName: 'asc' },
        })
      : module === 'trade_receivable'
      ? await prisma.tradeReceivableConfirmation.findMany({
          where: uw,
          select: { entityName: true },
          distinct: ['entityName'],
          orderBy: { entityName: 'asc' },
        })
      : await prisma.msmeConfirmation.findMany({
          where: uw,
          select: { entityName: true },
          distinct: ['entityName'],
          orderBy: { entityName: 'asc' },
        });
  return rows.map((r) => r.entityName);
}

export async function countSentTodayAllModules(since: Date): Promise<number> {
  const [a, b, c] = await Promise.all([
    prisma.tradePayableConfirmation.count({ where: { sentAt: { gte: since } } }),
    prisma.tradeReceivableConfirmation.count({ where: { sentAt: { gte: since } } }),
    prisma.msmeConfirmation.count({ where: { sentAt: { gte: since } } }),
  ]);
  return a + b + c;
}

/** Typed updates for outbound send / inbound reply pipelines */
export async function patchConfirmationRaw(
  module: ModuleKey,
  id: string,
  data: Prisma.TradePayableConfirmationUncheckedUpdateInput |
    Prisma.TradeReceivableConfirmationUncheckedUpdateInput |
    Prisma.MsmeConfirmationUncheckedUpdateInput
): Promise<void> {
  if (module === 'trade_payable') {
    await prisma.tradePayableConfirmation.update({ where: { id }, data: data as Prisma.TradePayableConfirmationUncheckedUpdateInput });
    return;
  }
  if (module === 'trade_receivable') {
    await prisma.tradeReceivableConfirmation.update({
      where: { id },
      data: data as Prisma.TradeReceivableConfirmationUncheckedUpdateInput,
    });
    return;
  }
  await prisma.msmeConfirmation.update({
    where: { id },
    data: data as Prisma.MsmeConfirmationUncheckedUpdateInput,
  });
}

export type UpdateConfirmationData = Partial<
  Omit<
    UnifiedConfirmationRecord,
    | 'id'
    | 'module'
    | 'responseChannel'
    | 'confirmationKind'
    | 'hasWebResponse'
    | 'hasEmailResponse'
    | 'tradeInvoiceLines'
    | 'reportingFiscalYear'
    | 'reportingFiscalQuarter'
  >
>;

export async function updateConfirmationRow(
  module: ModuleKey,
  id: string,
  data: UpdateConfirmationData
): Promise<UnifiedConfirmationRecord> {
  const strip = { ...data };
  delete (strip as Record<string, unknown>).module;
  delete (strip as Record<string, unknown>).responseChannel;
  delete (strip as Record<string, unknown>).confirmationKind;
  delete (strip as Record<string, unknown>).reportingFiscalYear;
  delete (strip as Record<string, unknown>).reportingFiscalQuarter;
  delete (strip as Record<string, unknown>).listingUploadId;
  delete (strip as Record<string, unknown>).hasWebResponse;
  delete (strip as Record<string, unknown>).hasEmailResponse;
  delete (strip as Record<string, unknown>).tradeInvoiceLines;

  if (module === 'trade_payable') {
    const r = await prisma.tradePayableConfirmation.update({
      where: { id },
      data: strip as Prisma.TradePayableConfirmationUpdateInput,
    });
    return asJson(r, module);
  }
  if (module === 'trade_receivable') {
    const r = await prisma.tradeReceivableConfirmation.update({
      where: { id },
      data: strip as Prisma.TradeReceivableConfirmationUpdateInput,
    });
    return asJson(r, module);
  }
  const r = await prisma.msmeConfirmation.update({ where: { id }, data: strip as Prisma.MsmeConfirmationUpdateInput });
  return asJson(r, 'confirm_msme');
}

export async function deleteConfirmationRow(module: ModuleKey, id: string): Promise<void> {
  if (module === 'trade_payable') await prisma.tradePayableConfirmation.delete({ where: { id } });
  else if (module === 'trade_receivable') await prisma.tradeReceivableConfirmation.delete({ where: { id } });
  else await prisma.msmeConfirmation.delete({ where: { id } });
}
