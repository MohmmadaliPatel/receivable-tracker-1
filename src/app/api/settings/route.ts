import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { getOrCreateSettings, updateSettings } from '@/lib/confirmation-service';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// GET /api/settings
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await getOrCreateSettings(user.userId);
  return NextResponse.json({ settings });
}

// PUT /api/settings
export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { autoReplyCheck, replyCheckIntervalMinutes, emailSaveBasePath, companyDisplayName } = body;

  const clampedInterval = replyCheckIntervalMinutes !== undefined
    ? Math.max(30, Math.min(360, Number(replyCheckIntervalMinutes) || 30))
    : undefined;

  let normalizedCompany: string | null | undefined;
  if (companyDisplayName !== undefined) {
    const t = typeof companyDisplayName === 'string' ? companyDisplayName.trim() : '';
    normalizedCompany = t.length ? t : null;
  }

  const settings = await updateSettings(user.userId, {
    ...(autoReplyCheck !== undefined && { autoReplyCheck }),
    ...(clampedInterval !== undefined && { replyCheckIntervalMinutes: clampedInterval }),
    ...(emailSaveBasePath !== undefined && { emailSaveBasePath }),
    ...(normalizedCompany !== undefined && { companyDisplayName: normalizedCompany }),
  });

  return NextResponse.json({ settings });
}
