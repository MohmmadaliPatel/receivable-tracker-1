import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminSession } from '@/lib/require-admin';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  const meta = requestMeta(request);

  try {
    const admin = await requireAdminSession();

    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    if (body.confirm !== 'DELETE_ALL_DATA') {
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": "DELETE_ALL_DATA" }' },
        { status: 400 }
      );
    }

    console.log('🗑️  [Truncate] Starting data truncation...');

    const deletedReplies = await prisma.emailReply.deleteMany({});
    const deletedTrackings = await prisma.emailTracking.deleteMany({});
    const deletedRules = await prisma.forwardingRule.deleteMany({});
    const deletedSenders = await prisma.sender.deleteMany({});
    const deletedForwarders = await prisma.forwarder.deleteMany({});
    const deletedEmails = await prisma.email.deleteMany({});

    const summary = {
      emailReplies: deletedReplies.count,
      emailTrackings: deletedTrackings.count,
      forwardingRules: deletedRules.count,
      senders: deletedSenders.count,
      forwarders: deletedForwarders.count,
      emails: deletedEmails.count,
    };

    await writeAuditLog({
      action: 'DATA_TRUNCATE',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: 'operational_data',
      ...meta,
      details: summary,
    });

    console.log('✅ [Truncate] Data truncation completed:', summary);

    return NextResponse.json({
      success: true,
      message: 'Data truncated successfully',
      deleted: summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('❌ [Truncate] Error truncating data:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
