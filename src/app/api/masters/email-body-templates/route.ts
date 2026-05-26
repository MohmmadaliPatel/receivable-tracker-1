import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { userCanAccessModule } from '@/lib/module-access';
import type { ModuleKey } from '@/lib/module-types';

async function getSessionUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

function slugify(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parsePickerParams(searchParams: URLSearchParams): {
  moduleKey: ModuleKey;
  purpose: 'initial' | 'followup';
} | null {
  const mk = searchParams.get('moduleKey');
  const purposeRaw = searchParams.get('purpose');
  if (!mk || (mk !== 'trade_payable' && mk !== 'trade_receivable' && mk !== 'confirm_msme')) {
    return null;
  }
  const purpose = purposeRaw === 'followup' ? 'followup' : 'initial';
  return { moduleKey: mk, purpose };
}

// GET /api/masters/email-body-templates
// - Admin: full templates (all fields)
// - Authenticated + ?moduleKey=&purpose=: metadata for template picker (same module or any-module rows)
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const picker = parsePickerParams(request.nextUrl.searchParams);
  if (picker) {
    if (!userCanAccessModule(user, picker.moduleKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const templates = await prisma.emailBodyTemplate.findMany({
      where: {
        purpose: picker.purpose,
        OR: [{ moduleKey: picker.moduleKey }, { moduleKey: null }],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        moduleKey: true,
        category: true,
        purpose: true,
        isDefault: true,
        subjectTemplate: true,
        updatedAt: true,
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json({ templates });
  }

  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const templates = await prisma.emailBodyTemplate.findMany({
    orderBy: [{ moduleKey: 'asc' }, { purpose: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json({ templates });
}

// POST /api/masters/email-body-templates
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = String(body.name || '').trim();
  const htmlBody = String(body.htmlBody || '').trim();
  if (!name || !htmlBody) {
    return NextResponse.json({ error: 'name and htmlBody are required' }, { status: 400 });
  }

  let slug = String(body.slug || '').trim();
  if (!slug) slug = slugify(name);
  if (!slug) slug = `template-${Date.now()}`;

  const purpose = body.purpose === 'followup' ? 'followup' : 'initial';
  const mk = body.moduleKey;
  const moduleKey =
    mk === 'trade_payable' || mk === 'trade_receivable' || mk === 'confirm_msme' ? mk : null;

  const existingSlug = await prisma.emailBodyTemplate.findUnique({ where: { slug } });
  if (existingSlug) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const categoryRaw = body.category;
  const category =
    typeof categoryRaw === 'string' && categoryRaw.trim() ? categoryRaw.trim() : null;

  const created = await prisma.emailBodyTemplate.create({
    data: {
      name,
      slug,
      moduleKey: moduleKey as string | null,
      category,
      purpose,
      subjectTemplate:
        typeof body.subjectTemplate === 'string' && body.subjectTemplate.trim()
          ? body.subjectTemplate.trim()
          : null,
      htmlBody,
      plainBody:
        typeof body.plainBody === 'string' && body.plainBody.trim() ? body.plainBody.trim() : null,
      isDefault: !!body.isDefault,
    },
  });

  return NextResponse.json({ template: created });
}
