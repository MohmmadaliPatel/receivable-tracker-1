import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { patchConfirmationRaw } from '@/lib/confirmation-repository';
import * as fs from 'fs';
import * as path from 'path';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/confirmations/[id]/attachment — upload authority letter
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Shared workspace: one folder per record id
  const attachmentsDir = path.join(process.cwd(), 'attachments', 'records', id);
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }

  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(attachmentsDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  await patchConfirmationRaw(gate.record.module, id, {
    attachmentPath: filePath,
    attachmentName: file.name,
  });

  return NextResponse.json({ success: true, attachmentName: file.name });
}

// DELETE /api/confirmations/[id]/attachment — remove attachment
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });
  const record = gate.record;

  if (record.attachmentPath && fs.existsSync(record.attachmentPath)) {
    fs.unlinkSync(record.attachmentPath);
  }

  await patchConfirmationRaw(gate.record.module, id, { attachmentPath: null, attachmentName: null });

  return NextResponse.json({ success: true });
}
