import { NextRequest, NextResponse } from 'next/server';
import { patchConfirmationRaw } from '@/lib/confirmation-repository';
import { verifyPublicConfirmationToken } from '@/lib/public-confirmation-verify';
import { CONFIRMATION_STATUSES } from '@/lib/confirmation-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const gate = await verifyPublicConfirmationToken(body.token, 'msme');
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const { record, consumed } = gate;

  if (record.module !== 'confirm_msme') {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  if (consumed) {
    return NextResponse.json({ error: 'already_submitted', message: 'A response has already been recorded.' }, { status: 403 });
  }

  await patchConfirmationRaw('confirm_msme', record.id, {
    msmeHasCertificate: false,
    emailActionConsumedAt: new Date(),
    status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
    responseReceivedAt: new Date(),
  });

  const meta = requestMeta(request);
  await writeAuditLog({
    action: 'PUBLIC_RESPONSE_DECLINE',
    success: true,
    userId: null,
    username: null,
    resource: record.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { module: record.module },
  });

  return NextResponse.json({ success: true });
}
