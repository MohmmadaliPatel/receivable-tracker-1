import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { patchConfirmationRaw } from '@/lib/confirmation-repository';
import { verifyPublicConfirmationToken } from '@/lib/public-confirmation-verify';
import { CONFIRMATION_STATUSES } from '@/lib/confirmation-service';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

function safeSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const token = form.get('token');
  const gate = await verifyPublicConfirmationToken(
    typeof token === 'string' ? token : null,
    'msme'
  );
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const { record, consumed } = gate;

  if (record.module !== 'confirm_msme') {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  if (consumed) {
    return NextResponse.json({ error: 'already_submitted', message: 'A response has already been recorded.' }, { status: 403 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Add at least one PDF file' }, { status: 400 });
  }

  for (const file of files) {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    const isPdf = name.endsWith('.pdf') || type === 'application/pdf';
    if (!isPdf) {
      return NextResponse.json(
        { error: 'Only PDF files are allowed for MSME certificates' },
        { status: 400 }
      );
    }
  }

  const dir = path.join(process.cwd(), 'uploads', 'msme', record.id);
  fs.mkdirSync(dir, { recursive: true });

  const saved: Array<{ path: string; originalName: string; uploadedAt: string }> = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    // Reject non-PDF magic bytes even if extension/type was spoofed.
    if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json(
        { error: 'Only PDF files are allowed for MSME certificates' },
        { status: 400 }
      );
    }
    const base = safeSegment(file.name || 'certificate.pdf');
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${base.endsWith('.pdf') ? base : `${base}.pdf`}`;
    const full = path.join(dir, unique);
    fs.writeFileSync(full, buf);
    const rel = path.join('uploads', 'msme', record.id, unique);
    saved.push({
      path: rel.replace(/\\/g, '/'),
      originalName: file.name || 'certificate.pdf',
      uploadedAt: new Date().toISOString(),
    });
  }

  const existing = record.msmeCertificateFilesJson
    ? (JSON.parse(record.msmeCertificateFilesJson) as typeof saved)
    : [];
  const merged = [...existing, ...saved];

  await patchConfirmationRaw('confirm_msme', record.id, {
    msmeHasCertificate: true,
    msmeCertificateFilesJson: JSON.stringify(merged),
    emailActionConsumedAt: new Date(),
    status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
    responseReceivedAt: new Date(),
  });

  const meta = requestMeta(request);
  await writeAuditLog({
    action: 'PUBLIC_RESPONSE_UPLOAD',
    success: true,
    userId: null,
    username: null,
    resource: record.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { module: record.module, files: saved.length },
  });

  return NextResponse.json({ success: true, files: saved.length });
}
