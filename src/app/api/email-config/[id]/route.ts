import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { EmailConfigService } from '@/lib/email-config-service';
import { GraphMailService } from '@/lib/graph-mail-service';
import { cronService } from '@/lib/cron-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const config = await EmailConfigService.getConfigById(id);

    if (!config) {
      return NextResponse.json({ error: 'Configuration not found' }, { status: 404 });
    }

    // Mask secret on read responses (see comment in route.ts list GET). Only create/update POST/PUT responses may return the (new) secret value for admin to copy once.
    const masked = (config as any).msClientSecret ? { ...(config as any), msClientSecret: '***' } : config;
    return NextResponse.json({ config: masked });
  } catch (error) {
    console.error('Error fetching email config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, type, msTenantId, msClientId, msClientSecret, fromEmail, isActive, cronEnabled, cronIntervalMinutes, reminderEnabled, reminderDurationHours, reminderDurationUnit } = body;

    const config = await EmailConfigService.updateConfig(id, {
      ...(name && { name }),
      ...(type && { type }),
      ...(msTenantId && { msTenantId }),
      ...(msClientId && { msClientId }),
      ...(msClientSecret && { msClientSecret }),
      ...(fromEmail && { fromEmail }),
      ...(isActive !== undefined && { isActive }),
      ...(cronEnabled !== undefined && { cronEnabled }),
      ...(cronIntervalMinutes !== undefined && { cronIntervalMinutes }),
      ...(reminderEnabled !== undefined && { reminderEnabled }),
      ...(reminderDurationHours !== undefined && { reminderDurationHours }),
      ...(reminderDurationUnit !== undefined && { reminderDurationUnit }),
    });

    // Reload cron jobs after config update
    try {
      if (config.isActive && config.cronEnabled) {
        await cronService.startJobForConfig(config.id);
      } else {
        cronService.stopJobForConfig(config.id);
      }
    } catch (error) {
      console.error('Error reloading cron job:', error);
    }

    const meta = requestMeta(request);
    await writeAuditLog({
      action: 'EMAIL_CONFIG_UPDATE',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: id,
      ...meta,
      details: { name: config.name },
    });

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error updating email config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    await EmailConfigService.deleteConfig(id);

    const meta = requestMeta(request);
    await writeAuditLog({
      action: 'EMAIL_CONFIG_DELETE',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: id,
      ...meta,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting email config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
