import { NextRequest, NextResponse } from 'next/server';
import { cronService } from '@/lib/cron-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';
import { requireAdminSession } from '@/lib/require-admin';

export async function POST(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required for cron control' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { action, configId } = body;

    const meta = requestMeta(request);
    if (action === 'start') {
      if (configId) {
        await cronService.startJobForConfig(configId);
      } else {
        cronService.start();
      }
      await writeAuditLog({
        action: 'CRON_START',
        success: true,
        userId: admin.userId,
        username: admin.username,
        resource: configId || undefined,
        ...meta,
      });
      return NextResponse.json({ success: true, message: configId ? 'Cron job started' : 'Cron service started' });
    } else if (action === 'stop') {
      if (configId) {
        cronService.stopJobForConfig(configId);
      } else {
        cronService.stop();
      }
      await writeAuditLog({
        action: 'CRON_STOP',
        success: true,
        userId: admin.userId,
        username: admin.username,
        resource: configId || undefined,
        ...meta,
      });
      return NextResponse.json({ success: true, message: configId ? 'Cron job stopped' : 'Cron service stopped' });
    } else if (action === 'reload') {
      cronService.stop();
      await cronService.loadAndStartJobs();
      await writeAuditLog({
        action: 'CRON_RELOAD',
        success: true,
        userId: admin.userId,
        username: admin.username,
        ...meta,
      });
      return NextResponse.json({ success: true, message: 'Cron jobs reloaded' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error managing cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

