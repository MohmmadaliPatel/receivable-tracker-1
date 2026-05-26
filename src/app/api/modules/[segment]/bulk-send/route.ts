import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { countSentTodayAllModules } from '@/lib/confirmation-repository';
import { userCanAccessModule } from '@/lib/module-access';
import { sendConfirmation, CONFIRMATION_STATUSES, isEmailBodyTemplateAllowedForPurpose } from '@/lib/confirmation-service';
import { resolveTradeAnchorId } from '@/lib/trade-email-group';

import { parseModuleSegment } from '../../_utils';

const DAILY_EMAIL_LIMIT = 100;

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/modules/[segment]/bulk-send — MSME + trade payables/receivables; global daily send cap
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  const key = parseModuleSegment(segment);
  if (!key) {
    return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  }
  if (key !== 'confirm_msme' && key !== 'trade_payable' && key !== 'trade_receivable') {
    return NextResponse.json({ error: 'Bulk send is not available for this module' }, { status: 415 });
  }

  if (!userCanAccessModule(user, key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { recordIds?: string[]; includeNotSentOnly?: boolean; emailBodyTemplateId?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const templateId =
    typeof body.emailBodyTemplateId === 'string' && body.emailBodyTemplateId.trim()
      ? body.emailBodyTemplateId.trim()
      : null;
  if (templateId && !(await isEmailBodyTemplateAllowedForPurpose(templateId, key, 'initial'))) {
    return NextResponse.json({ error: 'Invalid email template for this module or purpose' }, { status: 400 });
  }
  const sendOpts = templateId ? { emailBodyTemplateId: templateId } : undefined;

  const includeOnlyNotSent = body.includeNotSentOnly !== false;

  const idFilter =
    Array.isArray(body.recordIds) && body.recordIds.length > 0
      ? ({ id: { in: body.recordIds } } as const)
      : {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sentToday = await countSentTodayAllModules(todayStart);
  let remaining = Math.max(0, DAILY_EMAIL_LIMIT - sentToday);

  let sent = 0;
  const errors: { id: string; error: string }[] = [];

  if (key === 'confirm_msme') {
    const candidates = await prisma.msmeConfirmation.findMany({
      where: {
        userId: user.userId,
        ...idFilter,
        ...(includeOnlyNotSent ? { status: CONFIRMATION_STATUSES.NOT_SENT } : {}),
      },
      orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
    });

    for (const rec of candidates) {
      if (remaining <= 0) break;

      const result = await sendConfirmation(rec.id, user.userId, undefined, undefined, sendOpts);

      if (result.success) {
        sent++;
        remaining--;
      } else {
        errors.push({ id: rec.id, error: result.error || 'Send failed' });
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

  const tradeMod = key === 'trade_payable' ? 'trade_payable' : 'trade_receivable';
  const candidates =
    key === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findMany({
          where: {
            userId: user.userId,
            ...idFilter,
            ...(includeOnlyNotSent ? { status: CONFIRMATION_STATUSES.NOT_SENT } : {}),
          },
          orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
        })
      : await prisma.tradeReceivableConfirmation.findMany({
          where: {
            userId: user.userId,
            ...idFilter,
            ...(includeOnlyNotSent ? { status: CONFIRMATION_STATUSES.NOT_SENT } : {}),
          },
          orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
        });

  const seenAnchors = new Set<string>();
  const anchorQueue: string[] = [];
  for (const rec of candidates) {
    const aid = await resolveTradeAnchorId(rec.id, tradeMod);
    if (seenAnchors.has(aid)) continue;
    seenAnchors.add(aid);
    anchorQueue.push(aid);
  }

  for (const anchorId of anchorQueue) {
    if (remaining <= 0) break;

    const result = await sendConfirmation(anchorId, user.userId, undefined, undefined, sendOpts);

    if (result.success) {
      sent++;
      remaining--;
    } else {
      errors.push({ id: anchorId, error: result.error || 'Send failed' });
    }
  }

  return NextResponse.json({
    success: true,
    sent,
    attempted: anchorQueue.length,
    failed: errors.length,
    errors,
    remainingDailyEmails: remaining,
    dailyLimit: DAILY_EMAIL_LIMIT,
  });
}
