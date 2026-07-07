import { prisma } from '@/lib/prisma';
import type { TradePayableConfirmation } from '@prisma/client';
import { syncTpFromVendorMaster } from '@/lib/tp-sync-from-vendor';
import { syncMsmeFromPartyMasters } from '@/lib/msme-sync-from-tr';

async function tpEligibleUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { OR: [{ accessTradePayable: true }, { role: 'admin' }] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function msmeEligibleUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { OR: [{ accessConfirmMsme: true }, { role: 'admin' }] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

function tpRowCreatePayload(
  row: TradePayableConfirmation,
  targetUserId: string,
  emailThreadAnchorId: string | null
) {
  return {
    entityContactId: row.entityContactId,
    vendorMasterId: row.vendorMasterId,
    entityName: row.entityName,
    category: row.category,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    custId: row.custId,
    documentDate: row.documentDate,
    documentNumber: row.documentNumber,
    currencyValue: row.currencyValue,
    reportingFiscalYear: row.reportingFiscalYear,
    reportingFiscalQuarter: row.reportingFiscalQuarter,
    listingUploadId: null,
    emailThreadAnchorId,
    emailTo: row.emailTo,
    emailCc: row.emailCc,
    status: 'not_sent',
    userId: targetUserId,
  };
}

/** Copy one user's TP listing workspace (anchors + invoice lines) to another user. */
export async function cloneTradePayablesFromUser(
  sourceUserId: string,
  targetUserId: string
): Promise<{ cloned: number }> {
  if (sourceUserId === targetUserId) return { cloned: 0 };

  const sourceRows = await prisma.tradePayableConfirmation.findMany({
    where: { userId: sourceUserId },
    orderBy: [{ createdAt: 'asc' }],
  });
  if (sourceRows.length === 0) return { cloned: 0 };

  await prisma.tradePayableConfirmation.deleteMany({ where: { userId: targetUserId } });

  const anchors = sourceRows.filter((r) => r.emailThreadAnchorId == null);
  const lines = sourceRows.filter((r) => r.emailThreadAnchorId != null);
  const idMap = new Map<string, string>();
  let cloned = 0;

  for (const row of anchors) {
    const created = await prisma.tradePayableConfirmation.create({
      data: tpRowCreatePayload(row, targetUserId, null),
    });
    idMap.set(row.id, created.id);
    cloned++;
  }

  for (const row of lines) {
    const anchorId = row.emailThreadAnchorId ? idMap.get(row.emailThreadAnchorId) ?? null : null;
    await prisma.tradePayableConfirmation.create({
      data: tpRowCreatePayload(row, targetUserId, anchorId),
    });
    cloned++;
  }

  return { cloned };
}

export type ProvisionTradePayablesResult = {
  tpUsers: number;
  tpRowsCloned: number;
  tpVendorSynced: number;
  msmeUsers: number;
};

/**
 * After admin (or any user) uploads vendor/listing data, ensure every TP+MSME user
 * has their own workspace rows — vendor master alone is not enough for TP tab.
 */
export async function provisionWorkspacesForAllEligibleUsers(
  sourceUserId: string,
  strategy: 'clone_listing' | 'vendor_sync'
): Promise<ProvisionTradePayablesResult> {
  const result: ProvisionTradePayablesResult = {
    tpUsers: 0,
    tpRowsCloned: 0,
    tpVendorSynced: 0,
    msmeUsers: 0,
  };

  const tpUsers = await tpEligibleUserIds();
  const sourceRowCount = await prisma.tradePayableConfirmation.count({ where: { userId: sourceUserId } });

  for (const userId of tpUsers) {
    if (strategy === 'clone_listing' && sourceRowCount > 0) {
      const { cloned } = await cloneTradePayablesFromUser(sourceUserId, userId);
      if (cloned > 0) {
        result.tpUsers++;
        result.tpRowsCloned += cloned;
      }
      continue;
    }

    const { upserted } = await syncTpFromVendorMaster(userId);
    if (upserted > 0) {
      result.tpUsers++;
      result.tpVendorSynced += upserted;
    }
  }

  for (const userId of await msmeEligibleUserIds()) {
    const { upserted } = await syncMsmeFromPartyMasters(userId);
    if (upserted > 0) result.msmeUsers++;
  }

  return result;
}
