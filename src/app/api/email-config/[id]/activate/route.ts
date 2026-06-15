import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { EmailConfigService } from '@/lib/email-config-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const config = await EmailConfigService.setActiveConfig(id);

    const meta = requestMeta(request);
    await writeAuditLog({
      action: 'EMAIL_CONFIG_ACTIVATE',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: id,
      ...meta,
      details: { name: config.name },
    });

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error activating email config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
