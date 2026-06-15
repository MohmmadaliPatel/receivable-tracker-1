import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { EmailConfigService } from '@/lib/email-config-service';
import { cronService } from '@/lib/cron-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const configs = await EmailConfigService.getAllConfigs();

    // Mask secrets on read (never echo msClientSecret in list responses). Secrets are accepted on create/update and echoed back only in the create response for immediate copy by admin; subsequent GETs are masked.
    const masked = configs.map((c: any) => (c.msClientSecret ? { ...c, msClientSecret: '***' } : c));
    return NextResponse.json({ configs: masked });
  } catch (error) {
    console.error('Error fetching email configs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, msTenantId, msClientId, msClientSecret, fromEmail, isActive, cronEnabled, cronIntervalMinutes, reminderEnabled, reminderDurationHours, reminderDurationUnit } = body;

    // Validate required fields
    if (!name || !msTenantId || !msClientId || !msClientSecret || !fromEmail) {
      return NextResponse.json(
        { error: 'Missing required fields: name, msTenantId, msClientId, msClientSecret, fromEmail' },
        { status: 400 }
      );
    }

    const config = await EmailConfigService.createConfig(admin.userId, {
      name,
      type: type || 'graph',
      msTenantId,
      msClientId,
      msClientSecret,
      fromEmail,
      isActive,
      cronEnabled: cronEnabled || false,
      cronIntervalMinutes: cronIntervalMinutes || 10,
      reminderEnabled: reminderEnabled || false,
      reminderDurationHours: reminderDurationHours || 24,
      reminderDurationUnit: reminderDurationUnit || 'hours',
    });

    try {
      if (config.isActive && config.cronEnabled) {
        await cronService.startJobForConfig(config.id);
      }
    } catch (error) {
      console.error('Error starting cron job:', error);
    }

    const meta = requestMeta(request);
    await writeAuditLog({
      action: 'EMAIL_CONFIG_CREATE',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: config.id,
      ...meta,
      details: { name: config.name },
    });

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    console.error('Error creating email config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
