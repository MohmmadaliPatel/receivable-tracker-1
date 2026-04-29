import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { countSentTodayAllModules } from '@/lib/confirmation-repository';
import { userCanAccessModule } from '@/lib/module-access';
import { sendFollowup, CONFIRMATION_STATUSES } from '@/lib/confirmation-service';

import { parseModuleSegment } from '../../_utils';

const DAILY_EMAIL_LIMIT = 100;

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/modules/confirm-msme/bulk-followup — MSME only; respects global daily send cap
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  if (segment !== 'confirm-msme') {
    return NextResponse.json({ error: 'Bulk follow-up is only available for Confirm MSME' }, { status: 415 });
  }

  const key = parseModuleSegment(segment);
  if (!key || key !== 'confirm_msme') {
    return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  }

  if (!userCanAccessModule(user, key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { recordIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const idFilter =
    Array.isArray(body.recordIds) && body.recordIds.length > 0
      ? ({ id: { in: body.recordIds } } as const)
      : {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sentToday = await countSentTodayAllModules(todayStart);
  let remaining = Math.max(0, DAILY_EMAIL_LIMIT - sentToday);

  const candidates = await prisma.msmeConfirmation.findMany({
    where: {
      userId: user.userId,
      ...idFilter,
      status: { in: [CONFIRMATION_STATUSES.SENT, CONFIRMATION_STATUSES.FOLLOWUP_SENT] },
    },
    orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
  });

  let sent = 0;
  const errors: { id: string; error: string }[] = [];

  for (const rec of candidates) {
    if (remaining <= 0) break;

    const result = await sendFollowup(rec.id, user.userId);

    if (result.success) {
      sent++;
      remaining--;
    } else {
      errors.push({ id: rec.id, error: result.error || 'Follow-up failed' });
    }
  }

  return NextResponse.json({
    success: true,
    sent,
    attempted: candidates.length,
    failed: errors.length,
    errors,
    remainingDailyEmails: remaining,
    dailyLimit: DAILY_EMAIL_LIMIT,
  });
}
