import { NextRequest, NextResponse } from 'next/server';
import { patchConfirmationRaw } from '@/lib/confirmation-repository';
import { verifyPublicConfirmationToken } from '@/lib/public-confirmation-verify';
import { listTradeQueryGroup } from '@/lib/public-confirmation-queries';
import { CONFIRMATION_STATUSES } from '@/lib/confirmation-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const gate = await verifyPublicConfirmationToken(token, 'trade');
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const { record, consumed } = gate;

  if (record.module !== 'trade_payable' && record.module !== 'trade_receivable') {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  if (consumed) {
    return NextResponse.json(
      { error: 'already_submitted', message: 'A response has already been recorded.', consumed: true },
      { status: 403 }
    );
  }

  const group = await listTradeQueryGroup(record);
  const rows = group.map((r) => ({
    id: r.id,
    entityName: r.entityName,
    bankName: r.bankName,
    custId: r.custId,
    emailTo: r.emailTo,
    documentDate: r.documentDate ?? null,
    documentNumber: r.documentNumber ?? null,
    currencyValue: r.currencyValue ?? null,
  }));

  return NextResponse.json({ rows, anchorId: record.id });
}

export async function POST(request: NextRequest) {
  let body: { token?: string; lines?: Array<{ recordId: string; amountInBooks?: string; note?: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const gate = await verifyPublicConfirmationToken(body.token, 'trade');
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const { record, consumed } = gate;

  if (record.module !== 'trade_payable' && record.module !== 'trade_receivable') {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  if (consumed) {
    return NextResponse.json({ error: 'already_submitted', message: 'A response has already been recorded.' }, { status: 403 });
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    return NextResponse.json({ error: 'Select at least one line' }, { status: 400 });
  }

  const group = await listTradeQueryGroup(record);
  const allowed = new Set(group.map((r) => r.id));
  for (const line of lines) {
    if (!line.recordId || !allowed.has(line.recordId)) {
      return NextResponse.json({ error: 'Invalid line selection' }, { status: 400 });
    }
  }

  const payload = lines.map((l) => ({
    recordId: l.recordId,
    amountInBooks: l.amountInBooks?.trim() || undefined,
    note: l.note?.trim() || undefined,
  }));
  const payloadJson = JSON.stringify(payload);
  const now = new Date();

  const mod = record.module;
  const anchorId = group.find((r) => !r.emailThreadAnchorId)?.id ?? record.id;
  const queriedIds = new Set(lines.map((l) => l.recordId));

  for (const row of group) {
    const isQueried = queriedIds.has(row.id);
    const isAnchor = row.id === anchorId;

    if (isQueried) {
      if (isAnchor) {
        await patchConfirmationRaw(mod, row.id, {
          respondentQueryJson: payloadJson,
          emailActionConsumedAt: now,
          status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
          responseReceivedAt: now,
        });
      }
      continue;
    }

    await patchConfirmationRaw(mod, row.id, {
      webConfirmedAt: now,
      status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
      responseReceivedAt: now,
      ...(isAnchor
        ? {
            respondentQueryJson: payloadJson,
            emailActionConsumedAt: now,
          }
        : {}),
    });
  }

  const meta = requestMeta(request);
  await writeAuditLog({
    action: 'PUBLIC_RESPONSE_QUERY',
    success: true,
    userId: null,
    username: null,
    resource: record.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { module: record.module, lines: lines.length },
  });

  return NextResponse.json({ success: true });
}
