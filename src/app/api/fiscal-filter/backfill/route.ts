import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { backfillReportingFiscalForUser } from '@/lib/backfill-reporting-fiscal';

/** POST /api/fiscal-filter/backfill — stamp null fiscal on sent rows for the current user */
export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSession(sessionToken);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await backfillReportingFiscalForUser(user.userId);
  return NextResponse.json({ success: true, ...result });
}
