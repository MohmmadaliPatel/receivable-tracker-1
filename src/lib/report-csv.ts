import type { EnrichedReportRecord, ExecutiveReportThread, ReportFlatRecord } from '@/lib/report-thread-resolver';

export function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

/** Shared column order for browser + API detail CSV (executive-aligned communication fields use canonical blob). */

export type BuildWebSummary = (input: {
  webConfirmedAt: Date | string | null | undefined;
  respondentQueryJson?: string | null;
  emailActionConsumedAt: Date | string | null | undefined;
}) => string;

function fmtIsoOrEmpty(
  d: Date | string | null | undefined,
  fmt: (dt: Date) => string
): string {
  if (d === null || d === undefined || d === '') return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return fmt(dt);
}

export function buildDetailCsvRow(
  r: EnrichedReportRecord | (ReportFlatRecord & EnrichedReportRecord<ReportFlatRecord>),
  deps: {
    fmtDt: (d: Date | string | null | undefined) => string;
    stripHtml: (s: string) => string;
    buildWebSummary: BuildWebSummary;
  }
): string[] {
  const c = r.canonicalComm;
  const fromCanon = deps
    .stripHtml(c.responseBody ?? c.responseHtmlBody ?? '')
    .trim();
  const fromRow = deps
    .stripHtml(r.responseBody ?? r.responseHtmlBody ?? '')
    .trim();
  const respText = (fromCanon || fromRow).slice(0, 4000);

  const webSum = deps.buildWebSummary({
    webConfirmedAt: c.webConfirmedAt ?? r.webConfirmedAt,
    respondentQueryJson: c.respondentQueryJson ?? r.respondentQueryJson,
    emailActionConsumedAt: c.emailActionConsumedAt ?? r.emailActionConsumedAt,
  });

  const isTrade =
    r.module === 'trade_payable' || r.module === 'trade_receivable';
  const docDateRaw = isTrade && r.documentDate ? r.documentDate : '';
  const docNo = isTrade && r.documentNumber ? String(r.documentNumber) : '';
  const currVal = isTrade && r.currencyValue ? String(r.currencyValue) : '';

  return [
    r.entityName,
    r.category,
    r.bankName ?? '',
    r.displayEmailTo || r.emailTo,
    r.displayEmailCc || r.emailCc || '',
    r.displayRemarks || r.remarks || '',
    r.status,
    r.effectiveOutboundFollowupCount,
    r.effectiveInboundCount,
    deps.fmtDt(c.sentAt ?? r.sentAt ?? null),
    c.followupCount ?? r.followupCount,
    deps.fmtDt(c.followupSentAt ?? r.followupSentAt ?? null),
    deps.fmtDt(c.responseReceivedAt ?? r.responseReceivedAt ?? null),
    (c.responseFromName ?? r.responseFromName ?? '') ||
      '',
    (c.responseFromEmail ?? r.responseFromEmail ?? '') || '',
    respText.slice(0, 4000),
    (c.responseHasAttachments ?? r.responseHasAttachments) ? 'Yes' : 'No',
    deps.fmtDt(c.webConfirmedAt ?? r.webConfirmedAt ?? null),
    deps.fmtDt(c.emailActionConsumedAt ?? r.emailActionConsumedAt ?? null),
    webSum,
    docDateRaw || '',
    docNo,
    currVal,
    deps.fmtDt(r.createdAt ?? null),
  ].map(String);
}

export const DETAIL_CSV_HEADERS = [
  'Entity Name',
  'Category',
  'Bank Party Row',
  'Email To',
  'Email CC',
  'Remarks',
  'Row Status',
  'Outbound Followup Count',
  'Inbound Response Count',
  'Effective Sent At',
  'Follow Up Count From Thread',
  'Last Follow Up At',
  'Response Received At',
  'Response From Name',
  'Response From Email',
  'Response Text Plain',
  'Has Attachments',
  'Web Confirmed At',
  'Link Used At',
  'Web Query Summary',
  'Document Date',
  'Document Number',
  'Currency Value Row',
  'Created At',
];

export function buildExecutiveCsvRow(
  row: ExecutiveReportThread,
  deps: {
    fmtDt: (d: Date | string | null | undefined) => string;
    stripHtml: (s: string) => string;
    buildWebSummary: BuildWebSummary;
  }
): string[] {
  const c = row.canonicalComm;
  const summaryText = deps.buildWebSummary({
    webConfirmedAt: c.webConfirmedAt,
    respondentQueryJson: c.respondentQueryJson,
    emailActionConsumedAt: c.emailActionConsumedAt,
  });

  let responseFlattened = '';
  if (c.responseBody) responseFlattened = deps.stripHtml(c.responseBody);
  else if (c.responseHtmlBody) responseFlattened = deps.stripHtml(c.responseHtmlBody);

  const lastReply =
    !!c.responsesJson && c.responsesJson.trim()
      ? (() => {
          try {
            const arr = JSON.parse(c.responsesJson) as Array<{ body?: string; htmlBody?: string }>;
            if (!Array.isArray(arr) || arr.length === 0) return '';
            const last = arr[arr.length - 1];
            return deps.stripHtml(last.htmlBody ?? last.body ?? '').slice(0, 2500);
          } catch {
            return '';
          }
        })()
      : '';

  return [
    row.threadKey,
    row.module,
    row.threadRootId,
    row.canonicalRecordId,
    row.invoiceLineCount,
    row.entityName,
    row.category,
    row.custId ?? '',
    row.bankPartyDisplay,
    row.emailTo,
    row.emailCc ?? '',
    row.remarks ?? '',
    row.distinctStatuses.join(' | ') || '',
    row.rollupStatusSummary,
    row.hasEmailInbound ? 'Yes' : 'No',
    row.hasWebConfirmed ? 'Yes' : 'No',
    row.hasRespondentQuery ? 'Yes' : 'No',
    row.effectiveFollowupCount,
    row.effectiveInboundCount,
    row.totalAmountDisplay ?? '',
    row.effectiveConversationIds.join(' | ') || '',
    row.daysSinceSent ?? '',
    row.lastActivityAt ? deps.fmtDt(row.lastActivityAt) : '',
    deps.fmtDt(c.sentAt ?? null),
    deps.fmtDt(c.followupSentAt ?? null),
    deps.fmtDt(c.responseReceivedAt ?? null),
    c.responseFromName ?? '',
    c.responseFromEmail ?? '',
    responseFlattened.slice(0, 3000),
    lastReply.slice(0, 3000),
    c.responseHasAttachments ? 'Yes' : 'No',
    deps.fmtDt(c.webConfirmedAt ?? null),
    deps.fmtDt(c.emailActionConsumedAt ?? null),
    summaryText,
    c.followupsJson ?? '',
    c.responsesJson ?? '',
    c.respondentQueryJson ?? '',
    row.lineIds.join('|'),
    row.firstLineCreatedAt ? deps.fmtDt(row.firstLineCreatedAt) : '',
  ].map(String);
}

export const EXECUTIVE_CSV_HEADERS = [
  'Thread Key',
  'Module',
  'Thread Root Id',
  'Canonical Comm Record Id',
  'Invoice Line Count',
  'Entity Name',
  'Category',
  'Customer Id',
  'Bank Or Party Display',
  'Email To',
  'Email CC',
  'Remarks',
  'Distinct Row Statuses',
  'Rollup Status Summary',
  'Channel Email Inbound',
  'Channel Web Or Link',
  'Channel Query',
  'Outbound Followup Count',
  'Inbound Response Count',
  'Trade Total Value Display',
  'Outlook Conversation Ids',
  'Days Since Sent',
  'Last Activity At',
  'Canonical Sent At',
  'Last Follow Up At',
  'Last Response Received At',
  'Last Response From Name',
  'Last Response From Email',
  'Latest Response Text Plain',
  'Last Response In Array Plain',
  'Has Response Attachments',
  'Web Confirmed At',
  'Link Used At',
  'Web Query Summary',
  'Followups Json Anchor Full',
  'Responses Json Anchor Full',
  'Respondent Query Json Anchor Full',
  'Contained Line Record Ids',
  'First Line Created At',
];

export function stringifyDetailCsvRows(
  rows: EnrichedReportRecord[],
  deps: {
    fmtDt: (d: Date | string | null | undefined) => string;
    stripHtml: (s: string) => string;
    buildWebSummary: BuildWebSummary;
  }
): string {
  const header = DETAIL_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',');
  const body = rows.map((r) =>
    buildDetailCsvRow(r, deps).map(escapeCsvCell).join(','),
  );
  return [header, ...body].join('\n');
}

export function stringifyExecutiveCsvRows(
  threads: ExecutiveReportThread[],
  deps: Parameters<typeof buildExecutiveCsvRow>[1]
): string {
  const header = EXECUTIVE_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',');
  const body = threads.map((t) =>
    buildExecutiveCsvRow(t, deps).map(escapeCsvCell).join(','),
  );
  return [header, ...body].join('\n');
}

/** Lean business export — one row per counterparty thread (attempted outreach only). */
export const BUSINESS_THREAD_CSV_HEADERS = [
  'Entity Name',
  'Category',
  'Email To',
  'Email CC',
  'Remarks',
  'Mailbox Status',
  'Sent At',
  'Follow Up Count',
  'Inbound Replies',
  'Web Or Link',
  'Query Logged',
  'Trade Total INR',
  'Invoice Lines',
  'Last Activity At',
  'Response Summary',
];

export function buildBusinessThreadCsvRow(
  row: ExecutiveReportThread,
  deps: {
    fmtDt: (d: Date | string | null | undefined) => string;
    stripHtml: (s: string) => string;
    buildWebSummary: BuildWebSummary;
  }
): string[] {
  const c = row.canonicalComm;
  const summaryText = deps.buildWebSummary({
    webConfirmedAt: c.webConfirmedAt,
    respondentQueryJson: c.respondentQueryJson,
    emailActionConsumedAt: c.emailActionConsumedAt,
  });
  let responseSnippet = '';
  if (c.responseBody) responseSnippet = deps.stripHtml(c.responseBody);
  else if (c.responseHtmlBody) responseSnippet = deps.stripHtml(c.responseHtmlBody);
  const responseSummary = (summaryText || responseSnippet).slice(0, 250);

  const statusLabel =
    c.status === 'sent' ? 'Sent · awaiting reply'
    : c.status === 'followup_sent' ? 'Follow-up sent'
    : c.status === 'response_received' ? 'Email response captured'
    : c.status === 'not_sent' ? 'Not sent'
    : c.status;

  return [
    row.entityName,
    row.category,
    row.emailTo,
    row.emailCc ?? '',
    row.remarks ?? '',
    statusLabel,
    deps.fmtDt(c.sentAt ?? null),
    row.effectiveFollowupCount,
    row.effectiveInboundCount,
    row.hasWebConfirmed ? 'Yes' : 'No',
    row.hasRespondentQuery ? 'Yes' : 'No',
    row.totalAmountDisplay ?? '',
    row.invoiceLineCount,
    row.lastActivityAt ? deps.fmtDt(row.lastActivityAt) : '',
    responseSummary,
  ].map(String);
}

export function stringifyBusinessThreadCsvRows(
  threads: ExecutiveReportThread[],
  deps: Parameters<typeof buildBusinessThreadCsvRow>[1]
): string {
  const header = BUSINESS_THREAD_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',');
  const body = threads.map((t) =>
    buildBusinessThreadCsvRow(t, deps).map(escapeCsvCell).join(','),
  );
  return [header, ...body].join('\n');
}
