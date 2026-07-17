import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncTpFromVendorMaster } from '@/lib/tp-sync-from-vendor';
import { backfillReportingFiscalForUser } from '@/lib/backfill-reporting-fiscal';
import {
  cloneTradePayablesFromUser,
  cloneTradeReceivablesFromUser,
} from '@/lib/tp-workspace-provision';
import { prisma } from '@/lib/prisma';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

/**
 * POST /api/modules/trade-payables/hydrate-from-vendors — TP anchors from Vendor master / clone
 * POST /api/modules/trade-receivables/hydrate-from-vendors — TR workspace clone when empty
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;

  if (segment === 'trade-payables') {
    if (!userCanAccessModule(user, 'trade_payable')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ownCount = await prisma.tradePayableConfirmation.count({ where: { userId: user.userId } });
    let clonedFrom: string | null = null;

    if (ownCount === 0) {
      const richest = await prisma.tradePayableConfirmation.groupBy({
        by: ['userId'],
        where: { userId: { not: user.userId } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      });
      const sourceUserId = richest[0]?.userId;
      if (sourceUserId && (richest[0]?._count.id ?? 0) > 0) {
        const { cloned } = await cloneTradePayablesFromUser(sourceUserId, user.userId);
        if (cloned > 0) clonedFrom = sourceUserId;
      }
    }

    const result = clonedFrom
      ? { upserted: await prisma.tradePayableConfirmation.count({ where: { userId: user.userId } }) }
      : await syncTpFromVendorMaster(user.userId);
    const fiscalBackfill = await backfillReportingFiscalForUser(user.userId);
    return NextResponse.json({ success: true, ...result, clonedFrom, fiscalBackfill });
  }

  if (segment === 'trade-receivables') {
    if (!userCanAccessModule(user, 'trade_receivable')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ownCount = await prisma.tradeReceivableConfirmation.count({
      where: { userId: user.userId },
    });
    let clonedFrom: string | null = null;
    let upserted = ownCount;

    if (ownCount === 0) {
      const richest = await prisma.tradeReceivableConfirmation.groupBy({
        by: ['userId'],
        where: { userId: { not: user.userId } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      });
      const sourceUserId = richest[0]?.userId;
      if (sourceUserId && (richest[0]?._count.id ?? 0) > 0) {
        const { cloned } = await cloneTradeReceivablesFromUser(sourceUserId, user.userId);
        if (cloned > 0) {
          clonedFrom = sourceUserId;
          upserted = cloned;
        }
      }
    }

    const fiscalBackfill = await backfillReportingFiscalForUser(user.userId);
    return NextResponse.json({ success: true, upserted, clonedFrom, fiscalBackfill });
  }

  return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
}
