import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/simple-auth';
import {
  enrichReportRecords,
  buildExecutiveThreads,
  type ReportFlatRecord,
} from '@/lib/report-thread-resolver';
import {
  stringifyDetailCsvRows,
  stringifyExecutiveCsvRows,
  stringifyBusinessThreadCsvRows,
  type BuildWebSummary,
} from '@/lib/report-csv';
import {
  fmtReportDate,
  stripReportHtml,
  buildReportWebSummary,
  isAttemptedOutbound,
} from '@/lib/report-format';

async function getAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return await getSession(token);
}

const fmtDt = fmtReportDate;
const stripHtml = stripReportHtml;
const webSummaryBinder: BuildWebSummary = buildReportWebSummary;

type ReportRow =
  | (Awaited<ReturnType<typeof prisma.tradePayableConfirmation.findMany>>[0] & { module: string })
  | (Awaited<ReturnType<typeof prisma.tradeReceivableConfirmation.findMany>>[0] & { module: string })
  | (Awaited<ReturnType<typeof prisma.msmeConfirmation.findMany>>[0] & { module: string });

function prismaRowAsFlat(r: ReportRow): ReportFlatRecord {
  const anchor =
    'emailThreadAnchorId' in r ?
      ((r as { emailThreadAnchorId: string | null }).emailThreadAnchorId ?? null)
    : null;
  return {
    ...(r as unknown as ReportFlatRecord),
    emailThreadAnchorId: anchor,
  };
}

async function loadReportRecords(user: {
  role: string;
  accessTradePayable: boolean;
  accessTradeReceivable: boolean;
  accessConfirmMsme: boolean;
}): Promise<ReportRow[]> {
  const orderBy = [
    { entityName: 'asc' as const },
    { category: 'asc' as const },
    { createdAt: 'asc' as const },
  ];

  async function unionAll(include: Set<string>): Promise<ReportRow[]> {
    const out: ReportRow[] = [];
    if (include.has('trade_payable')) {
      const rows = await prisma.tradePayableConfirmation.findMany({ orderBy });
      out.push(...rows.map((x) => ({ ...x, module: 'trade_payable' as const }) as ReportRow));
    }
    if (include.has('trade_receivable')) {
      const rows = await prisma.tradeReceivableConfirmation.findMany({ orderBy });
      out.push(...rows.map((x) => ({ ...x, module: 'trade_receivable' as const }) as ReportRow));
    }
    if (include.has('confirm_msme')) {
      const rows = await prisma.msmeConfirmation.findMany({ orderBy });
      out.push(...rows.map((x) => ({ ...x, module: 'confirm_msme' as const }) as ReportRow));
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

function parseCsvIdSet(raw: string | null): Set<string> | null {
  if (!raw?.trim()) return null;
  const ids = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/** Strip heavy nested payloads for REST JSON */
function threadWireFormat(t: ReturnType<typeof buildExecutiveThreads>[number]) {
  const { enrichedLines: _omit, ...rest } = t;
  return rest;
}

// GET /api/reports  →  enrichment + optional executive rollup for UI and CSV downloads
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format');
  const variant = (req.nextUrl.searchParams.get('variant') || 'business').toLowerCase();
  const attemptedOnly = req.nextUrl.searchParams.get('attemptedOnly') !== '0';

  const recordFilter = parseCsvIdSet(req.nextUrl.searchParams.get('filterIds'));

  const prismaRows = await loadReportRecords(user);
  const flattened = prismaRows.map(prismaRowAsFlat);
  let enrichedAll = enrichReportRecords(flattened);
  if (attemptedOnly) {
    enrichedAll = enrichedAll.filter(isAttemptedOutbound);
  }

  let enrichedForCsv = enrichedAll;
  let threadsAll = buildExecutiveThreads(enrichedAll);
  let threadsForExecutiveCsv = threadsAll;

  if (recordFilter) {
    enrichedForCsv = enrichedAll.filter((r) => recordFilter.has(r.id));
    threadsForExecutiveCsv = threadsAll.filter((thread) =>
      thread.lineIds.some((id) => recordFilter.has(id)),
    );
  }

  if (format === 'csv') {
    const deps = {
      fmtDt,
      stripHtml,
      buildWebSummary: webSummaryBinder,
    };
    const slug =
      variant === 'executive' ? `executive-threads-report`
      : variant === 'detail' ? `detail-lines-report`
      : `outreach-threads-report`;

    const csvBody =
      variant === 'executive' ? stringifyExecutiveCsvRows(threadsForExecutiveCsv, deps)
      : variant === 'detail' ? stringifyDetailCsvRows(enrichedForCsv, deps)
      : stringifyBusinessThreadCsvRows(threadsForExecutiveCsv, deps);

    return new NextResponse(csvBody, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const enrichedJson = enrichedAll.map((rec) => ({
    ...rec,
    webResponseSummary: webSummaryBinder({
      webConfirmedAt: rec.canonicalComm.webConfirmedAt ?? rec.webConfirmedAt,
      respondentQueryJson: rec.canonicalComm.respondentQueryJson ?? rec.respondentQueryJson,
      emailActionConsumedAt: rec.canonicalComm.emailActionConsumedAt ?? rec.emailActionConsumedAt,
    }),
  }));

  const threadsJson = threadsAll.map(threadWireFormat);

  return NextResponse.json({
    records: enrichedJson,
    threads: threadsJson,
    meta: {
      variantPresets: {
        csvBusiness: '?format=csv&variant=business&attemptedOnly=1',
        csvDetail: '?format=csv&variant=detail&attemptedOnly=0',
        csvExecutive: '?format=csv&variant=executive&attemptedOnly=0',
      },
      attemptedOnly,
    },
  });
}
