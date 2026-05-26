import { parseInrAmountString, formatInrAmount } from '@/lib/inr-amount';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';

export type TradeModuleForReport = 'trade_payable' | 'trade_receivable';

/** Minimal shape shared by prisma confirmation rows attached with `module` in reports API. */
export type ReportFlatRecord = {
  id: string;
  module: string;
  emailThreadAnchorId: string | null;
  entityName: string;
  category: string;
  bankName: string | null;
  custId: string | null;
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
  emailTo: string;
  emailCc: string | null;
  remarks: string | null;
  status: string;
  sentAt: Date | null;
  sentMessageId: string | null;
  sentEmailFilePath: string | null;
  followupSentAt: Date | null;
  followupMessageId: string | null;
  followupCount: number;
  followupsJson: string | null;
  responseReceivedAt: Date | null;
  responseFromName: string | null;
  responseFromEmail: string | null;
  responseBody: string | null;
  responseHtmlBody: string | null;
  responseHasAttachments: boolean;
  responsesJson: string | null;
  webConfirmedAt: Date | null;
  emailActionConsumedAt: Date | null;
  respondentQueryJson: string | null;
  msmeHasCertificate?: boolean | null;
  createdAt: Date;
  updatedAt?: Date;
};

export type ThreadRole = 'anchor' | 'invoice_line' | 'standalone';

/** Parse "messageId::conversationId" or legacy conversation-only id */
export function parseMessageIdStored(value: string | null | undefined): {
  messageId: string;
  conversationId: string | null;
} {
  if (!value?.trim()) return { messageId: '', conversationId: null };
  if (value.includes('::')) {
    const [messageId, conversationId] = value.split('::');
    return {
      messageId: messageId || '',
      conversationId: conversationId?.trim() || null,
    };
  }
  return { messageId: '', conversationId: value.trim() || null };
}

export function computeThreadRootId(r: ReportFlatRecord): string {
  const isTrade =
    r.module === 'trade_payable' ||
    r.module === 'trade_receivable';
  if (!isTrade) return r.id;
  return r.emailThreadAnchorId ?? r.id;
}

function isTradeAnchor(r: ReportFlatRecord): boolean {
  const isTrade =
    r.module === 'trade_payable' ||
    r.module === 'trade_receivable';
  return isTrade && r.emailThreadAnchorId === null;
}

function canonicalCommPick(r: ReportFlatRecord): {
  sentMessageId: string | null;
  sentAt: Date | null;
  sentEmailFilePath: string | null;
  followupSentAt: Date | null;
  followupMessageId: string | null;
  followupCount: number;
  followupsJson: string | null;
  responseReceivedAt: Date | null;
  responseFromName: string | null;
  responseFromEmail: string | null;
  responseBody: string | null;
  responseHtmlBody: string | null;
  responseHasAttachments: boolean;
  responsesJson: string | null;
  webConfirmedAt: Date | null;
  emailActionConsumedAt: Date | null;
  respondentQueryJson: string | null;
  status: string;
  emailConfigId?: string | null;
} {
  return {
    sentMessageId: r.sentMessageId,
    sentAt: r.sentAt,
    sentEmailFilePath: r.sentEmailFilePath,
    followupSentAt: r.followupSentAt,
    followupMessageId: r.followupMessageId,
    followupCount: r.followupCount,
    followupsJson: r.followupsJson,
    responseReceivedAt: r.responseReceivedAt,
    responseFromName: r.responseFromName,
    responseFromEmail: r.responseFromEmail,
    responseBody: r.responseBody,
    responseHtmlBody: r.responseHtmlBody,
    responseHasAttachments: r.responseHasAttachments,
    responsesJson: r.responsesJson,
    webConfirmedAt: r.webConfirmedAt,
    emailActionConsumedAt: r.emailActionConsumedAt,
    respondentQueryJson: r.respondentQueryJson,
    status: r.status,
    emailConfigId: 'emailConfigId' in r ? (r as { emailConfigId?: string | null }).emailConfigId : undefined,
  };
}

/** Merge outbound thread ids for reply matching / reporting (dual conversation heuristic). */
export function collectOutlookConversationIds(comm: {
  sentMessageId: string | null;
  followupMessageId: string | null;
}): Set<string> {
  const out = new Set<string>();
  for (const v of [comm.sentMessageId, comm.followupMessageId]) {
    const parsed = parseMessageIdStored(v);
    if (parsed.conversationId) out.add(parsed.conversationId);
  }
  return out;
}

/** Count inbound responses from legacy single fields + responsesJson history */
export function inboundResponseCount(record: Pick<ReportFlatRecord, 'responseReceivedAt' | 'responsesJson'>): number {
  let n = 0;
  if (record.responsesJson?.trim()) {
    try {
      const arr = JSON.parse(record.responsesJson) as unknown[];
      if (Array.isArray(arr)) n += arr.filter(Boolean).length;
    } catch {
      if (record.responseReceivedAt) n = 1;
    }
  } else if (record.responseReceivedAt) {
    n = 1;
  }
  return n;
}

/** Count outbound follow-ups from JSON + followupCount */
export function outboundFollowupCount(record: Pick<ReportFlatRecord, 'followupsJson' | 'followupCount'>): number {
  if (record.followupsJson?.trim()) {
    try {
      const arr = JSON.parse(record.followupsJson) as unknown[];
      if (Array.isArray(arr) && arr.length > 0) return arr.length;
    } catch {
      /* fall through */
    }
  }
  return record.followupCount ?? 0;
}

export function maxTimestamp(
  ds: Array<Date | string | null | undefined>
): Date | null {
  let max: Date | null = null;
  for (const d of ds) {
    if (d == null) continue;
    const t = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(t.getTime())) continue;
    if (!max || t > max) max = t;
  }
  return max;
}

function sumTradeAmounts(rows: ReportFlatRecord[]): { sumRupee: number | null; display: string } {
  let sum = 0;
  let any = false;
  for (const r of rows) {
    if (
      r.module !== 'trade_payable' &&
      r.module !== 'trade_receivable'
    )
      continue;
    const v = parseInrAmountString(r.currencyValue ?? null);
    if (v !== null) {
      sum += v;
      any = true;
    }
  }
  return { sumRupee: any ? sum : null, display: any ? formatInrAmount(sum) : '' };
}

export type EnrichedReportRecord<T extends ReportFlatRecord = ReportFlatRecord> = T & {
  /** Recipient for display (invoice lines inherit anchor contact fields when row is empty). */
  displayEmailTo: string;
  displayEmailCc: string;
  displayRemarks: string;
  threadRootId: string;
  threadRole: ThreadRole;
  isThreadCanonical: boolean;
  canonicalRecordId: string;
  canonicalComm: ReturnType<typeof canonicalCommPick>;
  effectiveConversationIds: string[];
  effectiveInboundCount: number;
  effectiveOutboundFollowupCount: number;
};

export function enrichReportRecords<T extends ReportFlatRecord>(records: T[]): EnrichedReportRecord<T>[] {
  const anchorsByTradeId = new Map<string, T>();
  const anchorsByCustId = new Map<string, T>();
  for (const r of records) {
    if (isTradeAnchor(r)) {
      anchorsByTradeId.set(r.id, r);
      if (r.custId?.trim()) {
        const key = normalizeTradeCustId(r.custId);
        const existing = anchorsByCustId.get(key);
        if (!existing || new Date(r.createdAt).getTime() < new Date(existing.createdAt).getTime()) {
          anchorsByCustId.set(key, r);
        }
      }
    }
  }

  function tradeAnchorForLine(r: T): T | undefined {
    if (r.emailThreadAnchorId) {
      const byFk = anchorsByTradeId.get(r.emailThreadAnchorId);
      if (byFk) return byFk;
    }
    const byRoot = anchorsByTradeId.get(computeThreadRootId(r));
    if (byRoot) return byRoot;
    if (r.custId?.trim()) {
      return anchorsByCustId.get(normalizeTradeCustId(r.custId));
    }
    return undefined;
  }

  function resolveCanonical(
    r: T
  ): { sourceId: string; comm: ReturnType<typeof canonicalCommPick> } {
    const isTrade =
      r.module === 'trade_payable' || r.module === 'trade_receivable';
    if (!isTrade) {
      return { sourceId: r.id, comm: canonicalCommPick(r) };
    }
    const root = r.emailThreadAnchorId ?? r.id;
    const anchor = anchorsByTradeId.get(root);
    if (!anchor) {
      return { sourceId: r.id, comm: canonicalCommPick(r) };
    }
    return { sourceId: anchor.id, comm: canonicalCommPick(anchor) };
  }

  return records.map((r) => {
    const threadRootId = computeThreadRootId(r);
    const isTrade =
      r.module === 'trade_payable' || r.module === 'trade_receivable';

    let threadRole: ThreadRole = 'standalone';
    if (isTrade) {
      threadRole = r.emailThreadAnchorId === null ? 'anchor' : 'invoice_line';
    }

    const { sourceId, comm: canonicalComm } = resolveCanonical(r);

    const cidSet = collectOutlookConversationIds({
      sentMessageId: canonicalComm.sentMessageId,
      followupMessageId: canonicalComm.followupMessageId,
    });
    const effectiveConversationIds = [...cidSet];

    const effectiveInboundCount = inboundResponseCount(canonicalComm);
    const effectiveOutboundFollowupCount = outboundFollowupCount(canonicalComm);

    let displayEmailTo = r.emailTo?.trim() ?? '';
    let displayEmailCc = r.emailCc?.trim() ?? '';
    let displayRemarks = r.remarks?.trim() ?? '';
    if (isTrade) {
      const anchor = tradeAnchorForLine(r);
      if (!displayEmailTo) displayEmailTo = anchor?.emailTo?.trim() ?? '';
      if (!displayEmailCc) displayEmailCc = anchor?.emailCc?.trim() ?? '';
      if (!displayRemarks) displayRemarks = anchor?.remarks?.trim() ?? '';
    }

    return {
      ...r,
      displayEmailTo,
      displayEmailCc,
      displayRemarks,
      threadRootId,
      threadRole,
      isThreadCanonical: sourceId === r.id,
      canonicalRecordId: sourceId,
      canonicalComm,
      effectiveConversationIds,
      effectiveInboundCount,
      effectiveOutboundFollowupCount,
    };
  });
}

export type ExecutiveReportThread<T extends ReportFlatRecord = ReportFlatRecord> = {
  threadKey: string;
  threadRootId: string;
  module: string;
  canonicalRecordId: string;
  lineIds: string[];
  invoiceLineCount: number;
  /** Trade only: summed parsed INR when possible */
  totalAmountRupee: number | null;
  totalAmountDisplay: string;
  entityName: string;
  category: string;
  custId: string | null;
  bankPartyDisplay: string;
  emailTo: string;
  emailCc: string | null;
  remarks: string | null;
  /** Unique statuses appearing in rows (anchor + lines) */
  distinctStatuses: string[];
  rollupStatusSummary: string;
  hasEmailInbound: boolean;
  hasWebConfirmed: boolean;
  hasRespondentQuery: boolean;
  hasMagicLinkConsumed: boolean;
  effectiveFollowupCount: number;
  effectiveInboundCount: number;
  canonicalComm: ReturnType<typeof canonicalCommPick>;
  effectiveConversationIds: string[];
  lastActivityAt: Date | null;
  daysSinceSent: number | null;
  /** Earliest invoice / row timestamp in cluster */
  firstLineCreatedAt: Date | null;
  enrichedLines: EnrichedReportRecord<T>[];
};

function firstNonEmptyContactField(
  lines: EnrichedReportRecord<ReportFlatRecord>[],
  pick: (l: EnrichedReportRecord<ReportFlatRecord>) => string | null | undefined
): string {
  for (const line of lines) {
    const value = pick(line)?.trim();
    if (value) return value;
  }
  return '';
}

function rollupLabels(statuses: string[]): string {
  const u = [...new Set(statuses)].sort();
  if (u.length === 0) return '—';
  if (u.length === 1) return u[0];
  return `Mixed (${u.length} statuses)`;
}

export function daysSince(from: Date | null | undefined): number | null {
  if (!from || Number.isNaN(new Date(from).getTime())) return null;
  const d0 = new Date(from);
  const now = Date.now();
  return Math.floor((now - d0.getTime()) / (24 * 60 * 60 * 1000));
}

export function buildExecutiveThreads<T extends ReportFlatRecord>(
  enriched: EnrichedReportRecord<T>[]
): ExecutiveReportThread<T>[] {
  const groups = new Map<string, EnrichedReportRecord<T>[]>();
  for (const r of enriched) {
    const key = `${r.module}:${r.threadRootId}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(r);
  }

  const out: ExecutiveReportThread<T>[] = [];
  for (const [threadKey, lines] of groups) {
    const anchorLine =
      lines.find((l) => l.threadRole === 'anchor') ??
      lines.find((l) => l.canonicalRecordId === l.threadRootId) ??
      lines[0];
    const mod = anchorLine.module;

    /** Communication trail always lives on the anchor row inside the workspace */
    const canonicalRow =
      lines.find((l) => l.id === anchorLine.canonicalRecordId) ?? anchorLine;
    const comm = canonicalCommPick(canonicalRow);

    const hasWebConfirmed = !!comm.webConfirmedAt || !!comm.emailActionConsumedAt;
    const hasMagicLinkConsumed = !!comm.emailActionConsumedAt;
    const rawQ = comm.respondentQueryJson?.trim();
    const hasRespondentQuery =
      !!rawQ && rawQ !== '[]';

    let hasEmailInbound = inboundResponseCount(comm) > 0;
    if (!hasEmailInbound && comm.responseReceivedAt) hasEmailInbound = true;

    const distinctStatuses = [...new Set(lines.map((l) => l.status))];
    const { sumRupee, display } = sumTradeAmounts(lines as ReportFlatRecord[]);

    const earliestCreat = lines.reduce<Date | null>((acc, ln) => {
      const dt = ln.createdAt ? new Date(ln.createdAt) : null;
      if (!dt || Number.isNaN(dt.getTime())) return acc;
      if (!acc || dt < acc) return dt;
      return acc;
    }, null);

    const lastActivityAt = maxTimestamp([
      comm.sentAt,
      comm.followupSentAt,
      comm.responseReceivedAt,
      comm.webConfirmedAt,
      comm.emailActionConsumedAt,
    ]);

    const effFollowupCount = outboundFollowupCount(comm);
    const effInboundCount = inboundResponseCount(comm);
    const convIds = collectOutlookConversationIds({
      sentMessageId: comm.sentMessageId,
      followupMessageId: comm.followupMessageId,
    });

    /** Display bank/party — prefer anchor bankName first non-empty among lines */
    const bankParty =
      lines.map((l) => l.bankName).find((b) => b?.trim()) ?? anchorLine.bankName ?? null;

    out.push({
      threadKey,
      threadRootId: anchorLine.threadRootId,
      module: mod,
      canonicalRecordId: anchorLine.canonicalRecordId,
      lineIds: lines.map((l) => l.id),
      invoiceLineCount: lines.length,
      totalAmountRupee: sumRupee,
      totalAmountDisplay: display,
      entityName: anchorLine.entityName,
      category: anchorLine.category,
      custId: anchorLine.custId,
      bankPartyDisplay: bankParty ?? '',
      emailTo:
        firstNonEmptyContactField(lines, (l) => l.displayEmailTo || l.emailTo) ||
        anchorLine.displayEmailTo ||
        anchorLine.emailTo ||
        '',
      emailCc:
        firstNonEmptyContactField(lines, (l) => l.displayEmailCc || l.emailCc) ||
        anchorLine.displayEmailCc ||
        anchorLine.emailCc ||
        null,
      remarks:
        firstNonEmptyContactField(lines, (l) => l.displayRemarks || l.remarks) ||
        anchorLine.displayRemarks ||
        anchorLine.remarks ||
        null,
      distinctStatuses,
      rollupStatusSummary: rollupLabels(distinctStatuses),
      hasEmailInbound,
      hasWebConfirmed,
      hasRespondentQuery,
      hasMagicLinkConsumed,
      effectiveFollowupCount: effFollowupCount,
      effectiveInboundCount: effInboundCount,
      canonicalComm: comm,
      effectiveConversationIds: [...convIds],
      lastActivityAt,
      daysSinceSent: daysSince(comm.sentAt),
      firstLineCreatedAt: earliestCreat,
      enrichedLines: lines.slice().sort((a, b) => {
        const ad = new Date(a.createdAt).getTime();
        const bd = new Date(b.createdAt).getTime();
        return ad - bd;
      }),
    });
  }

  out.sort((a, b) => {
    const en = a.entityName.localeCompare(b.entityName);
    if (en !== 0) return en;
    const cat = a.category.localeCompare(b.category);
    if (cat !== 0) return cat;
    return a.threadRootId.localeCompare(b.threadRootId);
  });

  return out;
}
