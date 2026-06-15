import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { EmailConfigService } from '@/lib/email-config-service';
import { GraphMailService } from '@/lib/graph-mail-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminSession();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const meta = requestMeta(request);
  try {
    const { id } = await params;
    const config = await EmailConfigService.getConfigById(id);

    if (!config) {
      return NextResponse.json({ error: 'Configuration not found' }, { status: 404 });
    }

    const validation = await GraphMailService.validateConfig(config);

    await writeAuditLog({
      action: 'EMAIL_CONFIG_VALIDATE',
      success: validation.valid,
      userId: admin.userId,
      username: admin.username,
      resource: id,
      ...meta,
      details: validation.valid ? undefined : { error: validation.error },
    });

    return NextResponse.json(validation);
  } catch (error) {
    console.error('Error validating email config:', error);
    await writeAuditLog({
      action: 'EMAIL_CONFIG_VALIDATE',
      success: false,
      userId: admin.userId,
      username: admin.username,
      resource: (await params).id,
      ...meta,
    });
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
