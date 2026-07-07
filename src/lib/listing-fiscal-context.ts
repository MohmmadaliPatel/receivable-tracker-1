import { prisma } from '@/lib/prisma';
import { currentIndiaFiscalAnchor } from '@/lib/listing-upload-fiscal';
import type { TradeListingModuleKey } from '@/lib/trade-listing-import';

export type ResolvedListingFiscal = {
  reportingFiscalYear: number;
  reportingFiscalQuarter: number;
};

/** Latest FY+Q from org listing uploads, then this user's uploads, else today's India fiscal anchor. */
export async function resolveWorkspaceFiscalForUser(
  userId: string,
  moduleKey: TradeListingModuleKey = 'trade_payable'
): Promise<ResolvedListingFiscal> {
  const orgUpload = await prisma.tradeListingUpload.findFirst({
    where: { moduleKey },
    orderBy: { createdAt: 'desc' },
    select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
  });
  if (
    orgUpload?.reportingFiscalYear != null &&
    orgUpload.reportingFiscalQuarter != null &&
    orgUpload.reportingFiscalQuarter >= 1 &&
    orgUpload.reportingFiscalQuarter <= 4
  ) {
    return {
      reportingFiscalYear: orgUpload.reportingFiscalYear,
      reportingFiscalQuarter: orgUpload.reportingFiscalQuarter,
    };
  }

  const userUpload = await prisma.tradeListingUpload.findFirst({
    where: { userId, moduleKey },
    orderBy: { createdAt: 'desc' },
    select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
  });
  if (
    userUpload?.reportingFiscalYear != null &&
    userUpload.reportingFiscalQuarter != null &&
    userUpload.reportingFiscalQuarter >= 1 &&
    userUpload.reportingFiscalQuarter <= 4
  ) {
    return {
      reportingFiscalYear: userUpload.reportingFiscalYear,
      reportingFiscalQuarter: userUpload.reportingFiscalQuarter,
    };
  }
  return currentIndiaFiscalAnchor();
}
