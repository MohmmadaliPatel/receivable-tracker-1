import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import {
  patchConfirmationRaw,
  findUnifiedById,
  deleteConfirmationRow,
  updateConfirmationRow,
  applyEntityContactToPayload,
  toUnifiedRecord,
} from '@/lib/confirmation-repository';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';
import { loadTradeGroupRows } from '@/lib/trade-email-group';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// GET /api/confirmations/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const includeTradeLines = request.nextUrl.searchParams.get('includeTradeLines') !== 'false';

  let record = gate.record;

  if (includeTradeLines && (record.module === 'trade_payable' || record.module === 'trade_receivable')) {
    const grp = await loadTradeGroupRows(id, record.module);
    const tradeInvoiceLines = grp.map((r) => toUnifiedRecord(r, record.module));
    record = { ...record, tradeInvoiceLines };
  }

  return NextResponse.json({ record });
}

// PUT /api/confirmations/[id]
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const body = await request.json();
  const { entityName, category, bankName, accountNumber, custId, emailTo, emailCc, remarks } = body;

  const patched = await applyEntityContactToPayload(gate.record.module, {
    ...(custId !== undefined ? { custId } : {}),
    entityContactId: gate.record.entityContactId,
  });

  const record = await updateConfirmationRow(gate.record.module, id, {
    ...(entityName !== undefined && { entityName }),
    ...(category !== undefined && { category }),
    ...(bankName !== undefined && { bankName }),
    ...(accountNumber !== undefined && { accountNumber }),
    ...(custId !== undefined && { custId }),
    ...(emailTo !== undefined && { emailTo }),
    ...(emailCc !== undefined && { emailCc }),
    ...(remarks !== undefined && { remarks }),
    ...(patched.entityContactId !== gate.record.entityContactId
      ? { entityContactId: patched.entityContactId ?? null }
      : {}),
  });

  await auditActivity(request, user, 'CONFIRMATION_UPDATE', {
    success: true,
    resource: id,
    details: {
      module: gate.record.module,
      moduleLabel: moduleLabel(gate.record.module),
      entityName: record.entityName,
      emailTo: record.emailTo,
    },
  });

  return NextResponse.json({ record });
}

// PATCH /api/confirmations/[id] — reset response data so reply can be re-checked
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const existing = gate.record;

  const body = await request.json();
  if (body.action === 'reset-response') {
    const newStatus = existing.followupSentAt ? 'followup_sent' : existing.sentAt ? 'sent' : 'not_sent';
    await patchConfirmationRaw(existing.module, id, {
      status: newStatus,
      responseReceivedAt: null,
      responseMessageId: null,
      responseSubject: null,
      responseBody: null,
      responseHtmlBody: null,
      responseFromEmail: null,
      responseFromName: null,
      responseEmailFilePath: null,
      responseHasAttachments: false,
      responseAttachmentsJson: null,
      responsesJson: null,
      webConfirmedAt: null,
      respondentQueryJson: null,
      ...(existing.module === 'confirm_msme'
        ? { msmeHasCertificate: null, msmeCertificateFilesJson: null }
        : {}),
    });
    const record = await findUnifiedById(id);
    await auditActivity(request, user, 'CONFIRMATION_RESET_RESPONSE', {
      success: true,
      resource: id,
      details: {
        module: existing.module,
        moduleLabel: moduleLabel(existing.module),
        entityName: existing.entityName,
      },
    });
    return NextResponse.json({ record });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// DELETE /api/confirmations/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  await deleteConfirmationRow(gate.record.module, id);

  await auditActivity(request, user, 'CONFIRMATION_DELETE', {
    success: true,
    resource: id,
    details: {
      module: gate.record.module,
      moduleLabel: moduleLabel(gate.record.module),
      entityName: gate.record.entityName,
      category: gate.record.category,
    },
  });

  return NextResponse.json({ success: true });
}
