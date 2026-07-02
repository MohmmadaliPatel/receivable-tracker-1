import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { countSentTodayAllModules } from '@/lib/confirmation-repository';
import { userCanAccessModule } from '@/lib/module-access';
import { sendFollowup, CONFIRMATION_STATUSES, isEmailBodyTemplateAllowedForPurpose } from '@/lib/confirmation-service';
import { resolveTradeAnchorId } from '@/lib/trade-email-group';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

import { parseModuleSegment } from '../../_utils';

const DAILY_EMAIL_LIMIT = 100;

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/modules/[segment]/bulk-followup — MSME + trade payables/receivables; global daily send cap
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
    return NextResponse.json({ error: 'Bulk follow-up is not available for this module' }, { status: 415 });
  }

  if (!userCanAccessModule(user, key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { recordIds?: string[]; emailBodyTemplateId?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const templateId =
    typeof body.emailBodyTemplateId === 'string' && body.emailBodyTemplateId.trim()
      ? body.emailBodyTemplateId.trim()
      : null;
  if (templateId && !(await isEmailBodyTemplateAllowedForPurpose(templateId, key, 'followup'))) {
    return NextResponse.json({ error: 'Invalid email template for this module or purpose' }, { status: 400 });
  }
  const followupOpts = templateId ? { emailBodyTemplateId: templateId } : undefined;

  const idFilter =
    Array.isArray(body.recordIds) && body.recordIds.length > 0
      ? ({ id: { in: body.recordIds } } as const)
      : {};

  const followupStatuses = [CONFIRMATION_STATUSES.SENT, CONFIRMATION_STATUSES.FOLLOWUP_SENT];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sentToday = await countSentTodayAllModules(todayStart);
  let remaining = Math.max(0, DAILY_EMAIL_LIMIT - sentToday);

  let sent = 0;
  let attempted = 0;
  const errors: { id: string; error: string }[] = [];

  if (key === 'confirm_msme') {
    const candidates = await prisma.msmeConfirmation.findMany({
      where: {
        userId: user.userId,
        ...idFilter,
        status: { in: followupStatuses },
      },
      orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
    });
    attempted = candidates.length;

    for (const rec of candidates) {
      if (remaining <= 0) break;

      const result = await sendFollowup(rec.id, user.userId, undefined, followupOpts);

      if (result.success) {
        sent++;
        remaining--;
      } else {
        errors.push({ id: rec.id, error: result.error || 'Follow-up failed' });
      }
    }
  } else {
    const tradeMod = key === 'trade_payable' ? 'trade_payable' : 'trade_receivable';
    const candidates =
      key === 'trade_payable'
        ? await prisma.tradePayableConfirmation.findMany({
            where: {
              userId: user.userId,
              ...idFilter,
              status: { in: followupStatuses },
            },
            orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
          })
        : await prisma.tradeReceivableConfirmation.findMany({
            where: {
              userId: user.userId,
              ...idFilter,
              status: { in: followupStatuses },
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
    attempted = anchorQueue.length;

    for (const anchorId of anchorQueue) {
      if (remaining <= 0) break;

      const result = await sendFollowup(anchorId, user.userId, undefined, followupOpts);

      if (result.success) {
        sent++;
        remaining--;
      } else {
        errors.push({ id: anchorId, error: result.error || 'Follow-up failed' });
      }
    }
  }

  await auditActivity(request, user, 'EMAIL_BULK_FOLLOWUP', {
    success: sent > 0 || errors.length === 0,
    details: {
      module: key,
      moduleLabel: moduleLabel(key),
      sent,
      attempted,
      failed: errors.length,
      templateId,
      remainingDailyEmails: remaining,
      errors: errors.slice(0, 10),
    },
  });

  return NextResponse.json({
    success: true,
    sent,
    attempted,
    failed: errors.length,
    errors,
    remainingDailyEmails: remaining,
    dailyLimit: DAILY_EMAIL_LIMIT,
  });
}
