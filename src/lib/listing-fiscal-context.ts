import { prisma } from '@/lib/prisma';
import { currentIndiaFiscalAnchor } from '@/lib/listing-upload-fiscal';
import type { TradeListingModuleKey } from '@/lib/trade-listing-import';

export type ResolvedListingFiscal = {
  reportingFiscalYear: number;
  reportingFiscalQuarter: number;
};

/** Latest FY+Q from the user's listing uploads, else today's India fiscal anchor. */
export async function resolveWorkspaceFiscalForUser(
  userId: string,
  moduleKey: TradeListingModuleKey = 'trade_payable'
): Promise<ResolvedListingFiscal> {
  const upload = await prisma.tradeListingUpload.findFirst({
    where: { userId, moduleKey },
    orderBy: { createdAt: 'desc' },
    select: { reportingFiscalYear: true, reportingFiscalQuarter: true },
  });
  if (
    upload?.reportingFiscalYear != null &&
    upload.reportingFiscalQuarter != null &&
    upload.reportingFiscalQuarter >= 1 &&
    upload.reportingFiscalQuarter <= 4
  ) {
    return {
      reportingFiscalYear: upload.reportingFiscalYear,
      reportingFiscalQuarter: upload.reportingFiscalQuarter,
    };
  }
  return currentIndiaFiscalAnchor();
}
