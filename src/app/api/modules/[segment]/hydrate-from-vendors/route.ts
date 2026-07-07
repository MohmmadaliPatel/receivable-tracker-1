import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncTpFromVendorMaster } from '@/lib/tp-sync-from-vendor';
import { backfillReportingFiscalForUser } from '@/lib/backfill-reporting-fiscal';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

/** POST /api/modules/trade-payables/hydrate-from-vendors — TP anchors from Vendor master */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  if (segment !== 'trade-payables') {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  if (!userCanAccessModule(user, 'trade_payable')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await syncTpFromVendorMaster(user.userId);
  const fiscalBackfill = await backfillReportingFiscalForUser(user.userId);
  return NextResponse.json({ success: true, ...result, fiscalBackfill });
}
