import { prisma } from '@/lib/prisma';
import {
  indiaFiscalYearAndQuarter,
  reportingFiscalFromDocumentDateString,
} from '@/lib/india-fiscal';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';

export type BackfillReportingFiscalResult = {
  msmeFromSentAt: number;
  msmeFromTrade: number;
  tradePayableAnchors: number;
  tradePayableLines: number;
  tradeReceivableAnchors: number;
  tradeReceivableLines: number;
};

async function buildTradeFiscalByCust(userId: string): Promise<Map<string, { year: number; quarter: number }>> {
  const fiscalByCust = new Map<string, { year: number; quarter: number }>();

  const ingest = (rows: { custId: string | null; reportingFiscalYear: number | null; reportingFiscalQuarter: number | null }[]) => {
    for (const r of rows) {
      const raw = r.custId?.trim();
      if (!raw || r.reportingFiscalYear == null || r.reportingFiscalQuarter == null) continue;
      const k = normalizeTradeCustId(raw);
      if (!k) continue;
      fiscalByCust.set(k, { year: r.reportingFiscalYear, quarter: r.reportingFiscalQuarter });
    }
  };

  const [tp, tr] = await Promise.all([
    prisma.tradePayableConfirmation.findMany({
      where: { userId, emailThreadAnchorId: null },
      select: { custId: true, reportingFiscalYear: true, reportingFiscalQuarter: true },
    }),
    prisma.tradeReceivableConfirmation.findMany({
      where: { userId, emailThreadAnchorId: null },
      select: { custId: true, reportingFiscalYear: true, reportingFiscalQuarter: true },
    }),
  ]);
  ingest(tp);
  ingest(tr);
  return fiscalByCust;
}

/** Backfill null reportingFiscalYear/Quarter for sent rows across MSME + trade. */
export async function backfillReportingFiscalForUser(userId: string): Promise<BackfillReportingFiscalResult> {
  const result: BackfillReportingFiscalResult = {
    msmeFromSentAt: 0,
    msmeFromTrade: 0,
    tradePayableAnchors: 0,
    tradePayableLines: 0,
    tradeReceivableAnchors: 0,
    tradeReceivableLines: 0,
  };

  const fiscalByCust = await buildTradeFiscalByCust(userId);

  const msmeRows = await prisma.msmeConfirmation.findMany({
    where: {
      userId,
      OR: [{ reportingFiscalYear: null }, { reportingFiscalQuarter: null }],
    },
    select: { id: true, sentAt: true, custId: true },
  });

  for (const r of msmeRows) {
    if (r.sentAt) {
      const f = indiaFiscalYearAndQuarter(new Date(r.sentAt));
      await prisma.msmeConfirmation.update({
        where: { id: r.id },
        data: { reportingFiscalYear: f.reportingFiscalYear, reportingFiscalQuarter: f.reportingFiscalQuarter },
      });
      result.msmeFromSentAt++;
      continue;
    }
    const raw = r.custId?.trim();
    if (!raw) continue;
    const k = normalizeTradeCustId(raw);
    const hit = k ? fiscalByCust.get(k) : undefined;
    if (!hit) continue;
    await prisma.msmeConfirmation.update({
      where: { id: r.id },
      data: { reportingFiscalYear: hit.year, reportingFiscalQuarter: hit.quarter },
    });
    result.msmeFromTrade++;
  }

  async function backfillTradeAnchorsAndLines(kind: 'trade_payable' | 'trade_receivable') {
    if (kind === 'trade_payable') {
      const rows = await prisma.tradePayableConfirmation.findMany({
        where: {
          userId,
          OR: [{ reportingFiscalYear: null }, { reportingFiscalQuarter: null }],
        },
        select: {
          id: true,
          sentAt: true,
          documentDate: true,
          emailThreadAnchorId: true,
        },
      });
      for (const r of rows) {
        let fy: number | null = null;
        let fq: number | null = null;
        if (r.sentAt) {
          const f = indiaFiscalYearAndQuarter(new Date(r.sentAt));
          fy = f.reportingFiscalYear;
          fq = f.reportingFiscalQuarter;
        } else {
          const fromDoc = reportingFiscalFromDocumentDateString(r.documentDate);
          if (fromDoc) {
            fy = fromDoc.reportingFiscalYear;
            fq = fromDoc.reportingFiscalQuarter;
          }
        }
        if (fy == null || fq == null) continue;
        await prisma.tradePayableConfirmation.update({
          where: { id: r.id },
          data: { reportingFiscalYear: fy, reportingFiscalQuarter: fq },
        });
        if (r.emailThreadAnchorId == null) result.tradePayableAnchors++;
        else result.tradePayableLines++;
      }
      return;
    }

    const rows = await prisma.tradeReceivableConfirmation.findMany({
      where: {
        userId,
        OR: [{ reportingFiscalYear: null }, { reportingFiscalQuarter: null }],
      },
      select: {
        id: true,
        sentAt: true,
        documentDate: true,
        emailThreadAnchorId: true,
      },
    });
    for (const r of rows) {
      let fy: number | null = null;
      let fq: number | null = null;
      if (r.sentAt) {
        const f = indiaFiscalYearAndQuarter(new Date(r.sentAt));
        fy = f.reportingFiscalYear;
        fq = f.reportingFiscalQuarter;
      } else {
        const fromDoc = reportingFiscalFromDocumentDateString(r.documentDate);
        if (fromDoc) {
          fy = fromDoc.reportingFiscalYear;
          fq = fromDoc.reportingFiscalQuarter;
        }
      }
      if (fy == null || fq == null) continue;
      await prisma.tradeReceivableConfirmation.update({
        where: { id: r.id },
        data: { reportingFiscalYear: fy, reportingFiscalQuarter: fq },
      });
      if (r.emailThreadAnchorId == null) result.tradeReceivableAnchors++;
      else result.tradeReceivableLines++;
    }
  }

  await backfillTradeAnchorsAndLines('trade_payable');
  await backfillTradeAnchorsAndLines('trade_receivable');

  return result;
}
