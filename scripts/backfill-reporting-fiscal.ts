/**
 * Backfill reportingFiscalYear / reportingFiscalQuarter for MSME + trade (all users).
 * npm run db:backfill-fiscal
 */
import { PrismaClient } from '@prisma/client';
import { backfillReportingFiscalForUser } from '../src/lib/backfill-reporting-fiscal';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let totals = {
    msmeFromSentAt: 0,
    msmeFromTrade: 0,
    tradePayableAnchors: 0,
    tradePayableLines: 0,
    tradeReceivableAnchors: 0,
    tradeReceivableLines: 0,
  };

  for (const u of users) {
    const r = await backfillReportingFiscalForUser(u.id);
    totals.msmeFromSentAt += r.msmeFromSentAt;
    totals.msmeFromTrade += r.msmeFromTrade;
    totals.tradePayableAnchors += r.tradePayableAnchors;
    totals.tradePayableLines += r.tradePayableLines;
    totals.tradeReceivableAnchors += r.tradeReceivableAnchors;
    totals.tradeReceivableLines += r.tradeReceivableLines;
    const n =
      r.msmeFromSentAt +
      r.msmeFromTrade +
      r.tradePayableAnchors +
      r.tradePayableLines +
      r.tradeReceivableAnchors +
      r.tradeReceivableLines;
    if (n > 0) console.log(`${u.email}: ${JSON.stringify(r)}`);
  }

  console.log('Totals:', totals);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
