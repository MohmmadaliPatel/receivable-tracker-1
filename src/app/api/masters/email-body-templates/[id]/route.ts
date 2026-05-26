import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

async function requireAdmin() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  const session = await getSession(sessionToken);
  if (!session || session.role !== 'admin') return null;
  return session;
}

// PATCH /api/masters/email-body-templates/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (typeof body.slug === 'string' && body.slug.trim()) data.slug = body.slug.trim();
  if (body.purpose === 'followup' || body.purpose === 'initial') data.purpose = body.purpose;
  if ('moduleKey' in body) {
    const mk = body.moduleKey;
    data.moduleKey =
      mk === 'trade_payable' || mk === 'trade_receivable' || mk === 'confirm_msme'
        ? mk
        : null;
  }
  if ('category' in body) {
    data.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
  }
  if (typeof body.subjectTemplate === 'string') {
    data.subjectTemplate = body.subjectTemplate.trim() || null;
  }
  if (typeof body.htmlBody === 'string') data.htmlBody = body.htmlBody;
  if (typeof body.plainBody === 'string') {
    data.plainBody = body.plainBody.trim() || null;
  }
  if (typeof body.isDefault === 'boolean') data.isDefault = body.isDefault;

  try {
    const template = await prisma.emailBodyTemplate.update({
      where: { id },
      data: data as Prisma.EmailBodyTemplateUpdateInput,
    });
    return NextResponse.json({ template });
  } catch {
    return NextResponse.json({ error: 'Not found or invalid data' }, { status: 404 });
  }
}

// DELETE /api/masters/email-body-templates/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { id } = await params;
  try {
    await prisma.emailBodyTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
