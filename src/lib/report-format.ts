/** Shared formatting for reports API + ReportsClient (pure, browser-safe). */

/** True when an outbound send was attempted (not purely not_sent with no sent timestamp). */
export function isAttemptedOutbound(r: {
  status: string;
  sentAt?: Date | string | null;
  canonicalComm?: { status?: string; sentAt?: Date | string | null };
}): boolean {
  const status = r.canonicalComm?.status ?? r.status;
  return status !== 'not_sent' || !!(r.canonicalComm?.sentAt ?? r.sentAt);
}

export function fmtReportDate(d: Date | string | null | undefined): string {
  if (d === null || d === undefined || d === '') return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function stripReportHtml(raw: string): string {
  let s = raw.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return s.replace(/\s+/g, ' ').trim();
}

export function buildReportWebSummary(opts: {
  webConfirmedAt?: Date | string | null;
  respondentQueryJson?: string | null;
  emailActionConsumedAt?: Date | string | null;
}): string {
  const parts: string[] = [];
  if (opts.webConfirmedAt)
    parts.push(`Confirmed via web ${fmtReportDate(opts.webConfirmedAt)}`);
  const q = opts.respondentQueryJson?.trim();
  if (q && q !== '[]') {
    try {
      const arr = JSON.parse(q) as Array<{ recordId?: string; amountInBooks?: string; note?: string }>;
      if (Array.isArray(arr) && arr.length > 0) {
        const n = arr.filter((x) => x.recordId).length || arr.length;
        const hints = arr.slice(0, 4).map((line) => {
          const bits = [line.amountInBooks?.trim(), line.note?.trim()?.slice(0, 48)].filter(Boolean);
          return bits.join(': ') || null;
        }).filter(Boolean) as string[];
        parts.push(`Query: ${n} line(s)${hints.length > 0 ? ` — ${hints.join(' | ')}` : ''}`);
      } else {
        parts.push('Query submitted');
      }
    } catch {
      parts.push('Query submitted');
    }
  }
  if (opts.emailActionConsumedAt)
    parts.push(`Link used ${fmtReportDate(opts.emailActionConsumedAt)}`);
  return parts.join(' · ');
}
