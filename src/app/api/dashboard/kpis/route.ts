import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import type { ModuleKey } from '@/lib/module-types';
import { formatInrAmount, parseInrAmountString } from '@/lib/inr-amount';

type TradeRowLite = {
  id: string;
  currencyValue: string | null;
  sentAt: Date | null;
  webConfirmedAt: Date | null;
  emailThreadAnchorId: string | null;
  respondentQueryJson: string | null;
};

export type DashboardTradeKpiBlock = {
  totalPortfolioAmount: number;
  confirmationSentAmount: number;
  confirmedByPartyAmount: number;
  pendingConfirmationAmount: number;
  queriedInvoiceAmount: number;
  queriedAmountInBooks: number;
  /** Lines left unticked on query submit — treated as confirmed (same response as partial query). */
  implicitConfirmFromQueryAmount: number;
  implicitConfirmFromQueryLines: number;
  unparsedCurrencyLines: number;
  formatted: {
    totalPortfolioAmount: string;
    confirmationSentAmount: string;
    confirmedByPartyAmount: string;
    pendingConfirmationAmount: string;
    queriedInvoiceAmount: string;
    queriedAmountInBooks: string;
    implicitConfirmFromQueryAmount: string;
  };
};

export type DashboardMsmeKpiBlock = {
  total: number;
  pending: number;
  confirmedWithCertificate: number;
  confirmedWithoutCertificate: number;
  confirmedClassificationUnknown: number;
};

function aggregateTradeKpis(rows: TradeRowLite[]): DashboardTradeKpiBlock {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let unparsedCurrencyLines = 0;

  /** anchorId → recordIds flagged in respondent query JSON */
  const anchorToQueriedIds = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.emailThreadAnchorId != null) continue;
    const qjson = r.respondentQueryJson?.trim();
    if (!qjson || qjson === '[]') continue;
    try {
      const arr = JSON.parse(qjson) as Array<{ recordId?: string }>;
      if (!Array.isArray(arr)) continue;
      const set = new Set<string>();
      for (const line of arr) {
        if (line.recordId) set.add(line.recordId);
      }
      if (set.size > 0) anchorToQueriedIds.set(r.id, set);
    } catch {
      /* ignore */
    }
  }

  let totalPortfolioAmount = 0;
  let confirmationSentAmount = 0;
  let confirmedByPartyAmount = 0;
  let pendingConfirmationAmount = 0;

  for (const r of rows) {
    const raw = r.currencyValue;
    const v = parseInrAmountString(raw);
    if (raw?.trim() && v === null) unparsedCurrencyLines++;
    if (v === null) continue;

    totalPortfolioAmount += v;
    if (r.sentAt != null) confirmationSentAmount += v;
    if (r.webConfirmedAt != null) confirmedByPartyAmount += v;

    const anchorKey = r.emailThreadAnchorId ?? r.id;
    const queriedIds = anchorToQueriedIds.get(anchorKey);
    const isQueriedLine = queriedIds?.has(r.id) ?? false;
    if (r.sentAt != null && r.webConfirmedAt == null && !isQueriedLine) {
      pendingConfirmationAmount += v;
    }
  }

  let queriedInvoiceAmount = 0;
  let queriedAmountInBooks = 0;

  let implicitConfirmFromQueryAmount = 0;
  let implicitConfirmFromQueryLines = 0;
  for (const r of rows) {
    const anchorKey = r.emailThreadAnchorId ?? r.id;
    const queriedIds = anchorToQueriedIds.get(anchorKey);
    if (!queriedIds) continue;
    if (r.webConfirmedAt == null) continue;
    if (queriedIds.has(r.id)) continue;
    const iv = parseInrAmountString(r.currencyValue);
    if (iv !== null) implicitConfirmFromQueryAmount += iv;
    implicitConfirmFromQueryLines += 1;
  }

  for (const r of rows) {
    if (r.emailThreadAnchorId != null) continue;
    const qjson = r.respondentQueryJson?.trim();
    if (!qjson || qjson === '[]') continue;
    try {
      const arr = JSON.parse(qjson) as Array<{ recordId?: string; amountInBooks?: string }>;
      if (!Array.isArray(arr)) continue;
      for (const line of arr) {
        const rid = line.recordId;
        if (!rid) continue;
        const rowForId = byId.get(rid);
        if (!rowForId) continue;
        const inv = parseInrAmountString(rowForId.currencyValue);
        if (inv !== null) queriedInvoiceAmount += inv;
        const books = parseInrAmountString(line.amountInBooks);
        if (books !== null) queriedAmountInBooks += books;
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return {
    totalPortfolioAmount,
    confirmationSentAmount,
    confirmedByPartyAmount,
    pendingConfirmationAmount,
    queriedInvoiceAmount,
    queriedAmountInBooks,
    implicitConfirmFromQueryAmount,
    implicitConfirmFromQueryLines,
    unparsedCurrencyLines,
    formatted: {
      totalPortfolioAmount: formatInrAmount(totalPortfolioAmount),
      confirmationSentAmount: formatInrAmount(confirmationSentAmount),
      confirmedByPartyAmount: formatInrAmount(confirmedByPartyAmount),
      pendingConfirmationAmount: formatInrAmount(pendingConfirmationAmount),
      queriedInvoiceAmount: formatInrAmount(queriedInvoiceAmount),
      queriedAmountInBooks: formatInrAmount(queriedAmountInBooks),
      implicitConfirmFromQueryAmount: formatInrAmount(implicitConfirmFromQueryAmount),
    },
  };
}

async function aggregateMsmeKpis(): Promise<DashboardMsmeKpiBlock> {
  const rows = await prisma.msmeConfirmation.findMany({
    select: {
      webConfirmedAt: true,
      msmeHasCertificate: true,
    },
  });

  let pending = 0;
  let confirmedWithCertificate = 0;
  let confirmedWithoutCertificate = 0;
  let confirmedClassificationUnknown = 0;

  for (const r of rows) {
    const confirmed = r.webConfirmedAt != null;
    if (!confirmed) {
      pending++;
      continue;
    }
    if (r.msmeHasCertificate === true) confirmedWithCertificate++;
    else if (r.msmeHasCertificate === false) confirmedWithoutCertificate++;
    else confirmedClassificationUnknown++;
  }

  return {
    total: rows.length,
    pending,
    confirmedWithCertificate,
    confirmedWithoutCertificate,
    confirmedClassificationUnknown,
  };
}

// GET /api/dashboard/kpis — module-scoped confirmation KPIs (org-wide rows in permitted modules)
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tpKey: ModuleKey = 'trade_payable';
  const trKey: ModuleKey = 'trade_receivable';
  const msmeKey: ModuleKey = 'confirm_msme';

  const sel = {
    id: true,
    currencyValue: true,
    sentAt: true,
    webConfirmedAt: true,
    emailThreadAnchorId: true,
    respondentQueryJson: true,
  };

  type OutPayload = {
    tradePayable?: DashboardTradeKpiBlock;
    tradeReceivable?: DashboardTradeKpiBlock;
    msme?: DashboardMsmeKpiBlock;
  };

  const out: OutPayload = {};

  if (userCanAccessModule(session, tpKey)) {
    const rows = await prisma.tradePayableConfirmation.findMany({ select: sel });
    out.tradePayable = aggregateTradeKpis(rows as TradeRowLite[]);
  }

  if (userCanAccessModule(session, trKey)) {
    const rows = await prisma.tradeReceivableConfirmation.findMany({ select: sel });
    out.tradeReceivable = aggregateTradeKpis(rows as TradeRowLite[]);
  }

  if (userCanAccessModule(session, msmeKey)) {
    out.msme = await aggregateMsmeKpis();
  }

  return NextResponse.json(out);
}
