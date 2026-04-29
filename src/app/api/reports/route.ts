import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/simple-auth';

async function getAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return await getSession(token);
}

function fmtDt(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function stripHtml(raw: string): string {
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

type ReportRow =
  | (Awaited<ReturnType<typeof prisma.tradePayableConfirmation.findMany>>[0] & { module: string })
  | (Awaited<ReturnType<typeof prisma.tradeReceivableConfirmation.findMany>>[0] & { module: string })
  | (Awaited<ReturnType<typeof prisma.msmeConfirmation.findMany>>[0] & { module: string });

/** One-line summary from existing columns (no new DB fields). */
function buildWebResponseSummary(r: ReportRow): string {
  const parts: string[] = [];
  if (r.webConfirmedAt) {
    parts.push(`Confirmed via web ${fmtDt(r.webConfirmedAt)}`);
  }
  const q = r.respondentQueryJson?.trim();
  if (q && q !== '[]') {
    try {
      const arr = JSON.parse(q) as Array<{ recordId?: string; amountInBooks?: string; note?: string }>;
      if (Array.isArray(arr) && arr.length > 0) {
        const n = arr.filter((x) => x.recordId).length || arr.length;
        const hints = arr.slice(0, 4).map((line) => {
          const bits = [line.amountInBooks?.trim(), line.note?.trim()?.slice(0, 48)].filter(Boolean);
          return bits.join(': ') || null;
        }).filter(Boolean) as string[];
        parts.push(
          `Query: ${n} line(s)${hints.length > 0 ? ` — ${hints.join(' | ')}` : ''}`
        );
      } else {
        parts.push('Query submitted');
      }
    } catch {
      parts.push('Query submitted');
    }
  }
  if (r.emailActionConsumedAt) {
    parts.push(`Magic link used ${fmtDt(r.emailActionConsumedAt)}`);
  }
  return parts.join(' · ');
}

async function loadReportRecords(user: { role: string; accessTradePayable: boolean; accessTradeReceivable: boolean; accessConfirmMsme: boolean }): Promise<ReportRow[]> {
  const orderBy = [
    { entityName: 'asc' as const },
    { category: 'asc' as const },
    { createdAt: 'asc' as const },
  ];

  async function unionAll(include: Set<string>): Promise<ReportRow[]> {
    const out: ReportRow[] = [];
    if (include.has('trade_payable')) {
      const rows = await prisma.tradePayableConfirmation.findMany({ orderBy });
      out.push(...rows.map((r) => ({ ...r, module: 'trade_payable' as const }) as ReportRow));
    }
    if (include.has('trade_receivable')) {
      const rows = await prisma.tradeReceivableConfirmation.findMany({ orderBy });
      out.push(...rows.map((r) => ({ ...r, module: 'trade_receivable' as const }) as ReportRow));
    }
    if (include.has('confirm_msme')) {
      const rows = await prisma.msmeConfirmation.findMany({ orderBy });
      out.push(...rows.map((r) => ({ ...r, module: 'confirm_msme' as const }) as ReportRow));
    }
    return out;
  }

  if (user.role === 'admin') {
    return unionAll(new Set(['trade_payable', 'trade_receivable', 'confirm_msme']));
  }
  const include = new Set<string>();
  if (user.accessTradePayable) include.add('trade_payable');
  if (user.accessTradeReceivable) include.add('trade_receivable');
  if (user.accessConfirmMsme) include.add('confirm_msme');
  if (include.size === 0) return [];
  return unionAll(include);
}

// GET /api/reports  →  all confirmation records with full detail for the logged-in user
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format');

  const records = await loadReportRecords(user);

  if (format === 'csv') {
    const cols = [
      'Entity Name',
      'Category',
      'Module',
      'Bank/Party',
      'Account Number',
      'Customer ID',
      'Email To',
      'Email CC',
      'Remarks',
      'Status',
      'Sent At',
      'Follow-up Count',
      'Last Follow-up At',
      'Response Received At',
      'Response From Name',
      'Response From Email',
      'Response',
      'Has Attachments',
      'Web Confirmed At',
      'Magic Link Used At',
      'Web / Query Summary',
      'Document Date',
      'Document No.',
      'Currency Value',
      'Created At',
    ];

    function esc(v: unknown): string {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }

    const rows = records.map((r) => {
      const responseText = r.responseBody
        ? stripHtml(r.responseBody)
        : r.responseHtmlBody
          ? stripHtml(r.responseHtmlBody)
          : '';
      const webSum = buildWebResponseSummary(r);
      const isTrade = r.module === 'trade_payable' || r.module === 'trade_receivable';
      const docDate =
        isTrade && 'documentDate' in r && r.documentDate ? fmtDt(r.documentDate) : '';
      const docNo = isTrade && 'documentNumber' in r ? String(r.documentNumber ?? '') : '';
      const currVal = isTrade && 'currencyValue' in r ? String(r.currencyValue ?? '') : '';
      return [
        r.entityName,
        r.category,
        r.module,
        r.bankName ?? '',
        r.accountNumber ?? '',
        r.custId ?? '',
        r.emailTo,
        r.emailCc ?? '',
        r.remarks ?? '',
        r.status,
        fmtDt(r.sentAt),
        r.followupCount,
        fmtDt(r.followupSentAt),
        fmtDt(r.responseReceivedAt),
        r.responseFromName ?? '',
        r.responseFromEmail ?? '',
        responseText.slice(0, 2000),
        r.responseHasAttachments ? 'Yes' : 'No',
        r.webConfirmedAt ? fmtDt(r.webConfirmedAt) : '',
        r.emailActionConsumedAt ? fmtDt(r.emailActionConsumedAt) : '',
        webSum,
        docDate,
        docNo,
        currVal,
        fmtDt(r.createdAt),
      ]
        .map(esc)
        .join(',');
    });

    const csv = [cols.map(esc).join(','), ...rows].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="confirmation-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const jsonRecords = records.map((r) => ({
    ...r,
    responseBody: r.responseBody ?? null,
    responseHtmlBody: r.responseHtmlBody ?? null,
    webResponseSummary: buildWebResponseSummary(r),
  }));

  return NextResponse.json({ records: jsonRecords });
}
