import { NextRequest, NextResponse } from 'next/server';
import { patchConfirmationRaw } from '@/lib/confirmation-repository';
import { verifyPublicConfirmationToken } from '@/lib/public-confirmation-verify';
import { CONFIRMATION_STATUSES } from '@/lib/confirmation-service';
import { loadTradeGroupRows } from '@/lib/trade-email-group';

export async function POST(request: NextRequest) {
  let body: { token?: string };
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

  const mod = record.module;
  const grp = await loadTradeGroupRows(record.id, mod as 'trade_payable' | 'trade_receivable');

  for (const row of grp) {
    await patchConfirmationRaw(mod, row.id, {
      webConfirmedAt: new Date(),
      status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
      responseReceivedAt: new Date(),
      ...(row.id === record.id ? { emailActionConsumedAt: new Date() as Date } : {}),
    });
  }

  return NextResponse.json({ success: true });
}
