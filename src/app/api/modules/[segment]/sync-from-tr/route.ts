import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncMsmeFromTradeAnchors } from '@/lib/msme-sync-from-tr';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/modules/confirm-msme/sync-from-tr — hydrate MSME from TP/TR trade anchors (emails from contacts / rows)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  if (segment !== 'confirm-msme') {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  if (!userCanAccessModule(user, 'confirm_msme')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { upserted } = await syncMsmeFromTradeAnchors(user.userId);
  return NextResponse.json({ success: true, upserted });
}
