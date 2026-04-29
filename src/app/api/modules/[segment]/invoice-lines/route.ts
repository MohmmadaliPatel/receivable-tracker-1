import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { userCanAccessModule } from '@/lib/module-access';
import { moduleRouteToKey } from '@/lib/module-types';
import {
  formatCurrencyCellDisplay,
  parseInrAmountString,
  formatDrCrAmountDisplay,
  debitCreditLabel,
  formatInrAmount,
} from '@/lib/inr-amount';
import type { ModuleKey } from '@/lib/module-types';

export type TradeInvoiceLinesSummary = {
  entityLabel: string;
  outstandingAmount: string;
  outstandingDebitCredit: string;
};

export type TradeInvoiceLineRow = {
  id: string;
  entityName: string;
  documentDate: string | null;
  documentNumber: string | null;
  currencyRaw: string | null;
  amountAbsDisplay: string;
  debitCredit: string;
  anchorId: string;
  lineStatus: 'confirmed' | 'queried_no_confirm' | 'open';
  amountInBooksDisplay: string | null;
};

/** Net outstanding: only parseable currencyRaw values contribute; unparseable lines add 0. */
function buildSummary(
  lines: Array<{ entityName: string; currencyRaw: string | null }>
): TradeInvoiceLinesSummary {
  const names = new Set(lines.map((l) => l.entityName.trim()).filter(Boolean));
  const entityLabel =
    names.size === 0 ? '—' : names.size === 1 ? [...names][0]! : 'Multiple entities';

  let sum = 0;
  let anyParsed = false;
  for (const line of lines) {
    const v = parseInrAmountString(line.currencyRaw);
    if (v !== null) {
      anyParsed = true;
      sum += v;
    }
  }
  if (!anyParsed) {
    return {
      entityLabel,
      outstandingAmount: '—',
      outstandingDebitCredit: '—',
    };
  }
  return {
    entityLabel,
    outstandingAmount: formatInrAmount(Math.abs(sum)),
    outstandingDebitCredit: debitCreditLabel(sum),
  };
}

// GET /api/modules/[segment]/invoice-lines — all TP/TR invoice rows with line-level status (trade segments only).
// Optional ?anchorId= — limit to one supplier/customer cluster (anchor row id).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  let mod: ModuleKey;
  try {
    mod = moduleRouteToKey(segment);
  } catch {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }
  if (mod !== 'trade_payable' && mod !== 'trade_receivable') {
    return NextResponse.json({ error: 'Invoice lines only for trade modules' }, { status: 400 });
  }
  if (!userCanAccessModule(session, mod)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filterAnchorId = request.nextUrl.searchParams.get('anchorId')?.trim() || null;

  const sel = {
    id: true,
    entityName: true,
    documentDate: true,
    documentNumber: true,
    currencyValue: true,
    webConfirmedAt: true,
    emailThreadAnchorId: true,
    respondentQueryJson: true,
  };

  const rows =
    mod === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findMany({
          select: sel,
          orderBy: [{ custId: 'asc' }, { createdAt: 'asc' }],
        })
      : await prisma.tradeReceivableConfirmation.findMany({
          select: sel,
          orderBy: [{ custId: 'asc' }, { createdAt: 'asc' }],
        });

  const anchorQueryDetail = new Map<string, Map<string, { amountInBooks?: string }>>();
  for (const r of rows) {
    if (r.emailThreadAnchorId != null) continue;
    const qjson = r.respondentQueryJson?.trim();
    if (!qjson || qjson === '[]') continue;
    try {
      const arr = JSON.parse(qjson) as Array<{ recordId?: string; amountInBooks?: string }>;
      if (!Array.isArray(arr)) continue;
      const m = new Map<string, { amountInBooks?: string }>();
      for (const line of arr) {
        if (line.recordId) m.set(line.recordId, { amountInBooks: line.amountInBooks });
      }
      if (m.size > 0) anchorQueryDetail.set(r.id, m);
    } catch {
      /* ignore */
    }
  }

  const out: TradeInvoiceLineRow[] = [];

  for (const r of rows) {
    const anchorId = r.emailThreadAnchorId ?? r.id;
    const qmap = anchorQueryDetail.get(anchorId);
    const qdetail = qmap?.get(r.id);
    const isInQueryPayload = qdetail != null;

    let lineStatus: TradeInvoiceLineRow['lineStatus'];
    if (r.webConfirmedAt != null) {
      lineStatus = 'confirmed';
    } else if (isInQueryPayload) {
      lineStatus = 'queried_no_confirm';
    } else {
      lineStatus = 'open';
    }

    const booksRaw = qdetail?.amountInBooks?.trim();
    let amountInBooksDisplay: string | null = null;
    if (booksRaw) {
      const p = parseInrAmountString(booksRaw);
      amountInBooksDisplay = p != null ? formatCurrencyCellDisplay(booksRaw) : booksRaw;
    }

    const rawVal = r.currencyValue ?? null;
    const { amountText, dcLabel } = formatDrCrAmountDisplay(rawVal);

    out.push({
      id: r.id,
      entityName: r.entityName,
      documentDate: r.documentDate ?? null,
      documentNumber: r.documentNumber ?? null,
      currencyRaw: rawVal,
      amountAbsDisplay: amountText,
      debitCredit: dcLabel,
      anchorId,
      lineStatus,
      amountInBooksDisplay,
    });
  }

  if (filterAnchorId) {
    const filtered = out.filter((row) => row.id === filterAnchorId || row.anchorId === filterAnchorId);
    const summary = buildSummary(filtered);
    return NextResponse.json({ lines: filtered, summary });
  }

  const summary = buildSummary(out);
  return NextResponse.json({ lines: out, summary });
}
