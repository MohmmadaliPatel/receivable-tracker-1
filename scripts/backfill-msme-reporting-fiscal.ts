/**
 * Backfill MSME reportingFiscalYear / reportingFiscalQuarter:
 * - Rows with sentAt but null fiscal → derive from sentAt
 * - Rows still null → copy from linked trade payable/receivable anchor by custId
 */
import { PrismaClient } from '@prisma/client';
import { indiaFiscalYearAndQuarter } from '../src/lib/india-fiscal';
import { normalizeTradeCustId } from '../src/lib/trade-composite-cust';

const prisma = new PrismaClient();

async function main() {
  const msmeRows = await prisma.msmeConfirmation.findMany({
    select: {
      id: true,
      sentAt: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
      custId: true,
    },
  });

  let fromSentAt = 0;
  for (const r of msmeRows) {
    if (r.reportingFiscalYear != null && r.reportingFiscalQuarter != null) continue;
    if (!r.sentAt) continue;
    const f = indiaFiscalYearAndQuarter(new Date(r.sentAt));
    await prisma.msmeConfirmation.update({
      where: { id: r.id },
      data: {
        reportingFiscalYear: f.reportingFiscalYear,
        reportingFiscalQuarter: f.reportingFiscalQuarter,
      },
    });
    fromSentAt++;
  }
  console.log(`MSME from sentAt: ${fromSentAt}`);

  const tpAnchors = await prisma.tradePayableConfirmation.findMany({
    where: { emailThreadAnchorId: null },
    select: {
      custId: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
    },
  });
  const trAnchors = await prisma.tradeReceivableConfirmation.findMany({
    where: { emailThreadAnchorId: null },
    select: {
      custId: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
    },
  });

  const fiscalByCust = new Map<string, { year: number; quarter: number }>();
  for (const a of tpAnchors) {
    const raw = a.custId?.trim();
    if (!raw || a.reportingFiscalYear == null || a.reportingFiscalQuarter == null) continue;
    const k = normalizeTradeCustId(raw);
    if (!k) continue;
    fiscalByCust.set(k, { year: a.reportingFiscalYear, quarter: a.reportingFiscalQuarter });
  }
  for (const a of trAnchors) {
    const raw = a.custId?.trim();
    if (!raw || a.reportingFiscalYear == null || a.reportingFiscalQuarter == null) continue;
    const k = normalizeTradeCustId(raw);
    if (!k) continue;
    fiscalByCust.set(k, { year: a.reportingFiscalYear, quarter: a.reportingFiscalQuarter });
  }

  const remaining = await prisma.msmeConfirmation.findMany({
    where: {
      OR: [{ reportingFiscalYear: null }, { reportingFiscalQuarter: null }],
    },
    select: { id: true, custId: true },
  });

  let fromTrade = 0;
  for (const r of remaining) {
    const raw = r.custId?.trim();
    if (!raw) continue;
    const k = normalizeTradeCustId(raw);
    if (!k) continue;
    const hit = fiscalByCust.get(k);
    if (!hit) continue;
    await prisma.msmeConfirmation.update({
      where: { id: r.id },
      data: {
        reportingFiscalYear: hit.year,
        reportingFiscalQuarter: hit.quarter,
      },
    });
    fromTrade++;
  }
  console.log(`MSME from trade anchors: ${fromTrade}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
