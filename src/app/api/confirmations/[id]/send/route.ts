import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { sendConfirmation } from '@/lib/confirmation-service';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/confirmations/[id]/send
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const { configId, emailBody, emailBodyTemplateId } = body;
  const templateId =
    typeof emailBodyTemplateId === 'string' && emailBodyTemplateId.trim()
      ? emailBodyTemplateId.trim()
      : null;

  const result = await sendConfirmation(id, user.userId, configId, emailBody || undefined, {
    emailBodyTemplateId: emailBody ? null : templateId,
  });

  const record = gate.record;
  if (!result.success) {
    await auditActivity(request, user, 'EMAIL_SEND', {
      success: false,
      resource: id,
      details: {
        module: record.module,
        moduleLabel: moduleLabel(record.module),
        entityName: record.entityName,
        category: record.category,
        emailTo: record.emailTo,
        error: result.error || 'Send failed',
        templateId,
      },
    });
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await auditActivity(request, user, 'EMAIL_SEND', {
    success: true,
    resource: id,
    details: {
      module: record.module,
      moduleLabel: moduleLabel(record.module),
      entityName: record.entityName,
      category: record.category,
      emailTo: record.emailTo,
      templateId,
      configId: configId || null,
    },
  });

  return NextResponse.json({ success: true });
}
