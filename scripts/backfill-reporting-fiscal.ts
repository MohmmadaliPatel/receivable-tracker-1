/**
 * One-time backfill: set reportingFiscalYear / reportingFiscalQuarter from documentDate (trade)
 * or leave MSME as-is unless you extend this script.
 */
import { PrismaClient } from '@prisma/client';
import { reportingFiscalFromDocumentDateString } from '../src/lib/india-fiscal';

const prisma = new PrismaClient();

async function main() {
  for (const model of ['tp', 'tr'] as const) {
    const rows =
      model === 'tp'
        ? await prisma.tradePayableConfirmation.findMany({
            select: { id: true, documentDate: true },
          })
        : await prisma.tradeReceivableConfirmation.findMany({
            select: { id: true, documentDate: true },
          });
    let n = 0;
    for (const r of rows) {
      const f = reportingFiscalFromDocumentDateString(r.documentDate);
      if (!f) continue;
      if (model === 'tp') {
        await prisma.tradePayableConfirmation.update({
          where: { id: r.id },
          data: { reportingFiscalYear: f.reportingFiscalYear, reportingFiscalQuarter: f.reportingFiscalQuarter },
        });
      } else {
        await prisma.tradeReceivableConfirmation.update({
          where: { id: r.id },
          data: { reportingFiscalYear: f.reportingFiscalYear, reportingFiscalQuarter: f.reportingFiscalQuarter },
        });
      }
      n++;
    }
    console.log(`${model}: updated ${n} rows`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
