import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import type { ModuleKey } from '@/lib/module-types';
import { MODULE_KEYS } from '@/lib/module-types';
import * as fs from 'fs';
import * as path from 'path';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

function isModuleKey(s: string): s is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(s);
}

// POST /api/confirmations/entity-attachment
// Upload an authority letter for all records belonging to a given entity
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const entityName = formData.get('entityName') as string | null;
  const category = formData.get('category') as string | null;
  const moduleStr = formData.get('module') as string | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!entityName && !category) {
    return NextResponse.json({ error: 'entityName or category is required' }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (entityName) where.entityName = entityName;
  if (category) where.category = category;

  const scopes: ModuleKey[] =
    moduleStr && isModuleKey(moduleStr)
      ? [moduleStr]
      : !moduleStr
        ? ['trade_payable', 'trade_receivable', 'confirm_msme']
        : [];

  if (scopes.length === 0) {
    return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  }

  let found = 0;
  for (const mod of scopes) {
    if (mod === 'trade_payable') {
      found += await prisma.tradePayableConfirmation.count({ where });
    } else if (mod === 'trade_receivable') {
      found += await prisma.tradeReceivableConfirmation.count({ where });
    } else {
      found += await prisma.msmeConfirmation.count({ where });
    }
  }

  if (found === 0) {
    const scope = entityName && category
      ? `entity "${entityName}" / category "${category}"`
      : entityName
        ? `entity "${entityName}"`
        : `category "${category}"`;
    const err = `No records found for ${scope}`;
    await auditActivity(request, user, 'ENTITY_ATTACHMENT_UPLOAD', {
      success: false,
      resource: file.name,
      details: {
        entityName,
        category,
        module: moduleStr,
        fileName: file.name,
        error: err,
      },
    });
    return NextResponse.json({ error: err }, { status: 404 });
  }

  const safeEntity = entityName
    ? entityName.replace(/[^a-zA-Z0-9._-\s]/g, '').trim().substring(0, 80)
    : '_all_entities';
  const safeCat = category ? category.replace(/[^a-zA-Z0-9._-\s]/g, '').trim().substring(0, 80) : '';
  const attachmentsDir = safeCat
    ? path.join(process.cwd(), 'attachments', 'entities', safeEntity, safeCat)
    : path.join(process.cwd(), 'attachments', 'entities', safeEntity);
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }

  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(attachmentsDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const data = { attachmentPath: filePath, attachmentName: file.name };
  let updatedCount = 0;
  for (const mod of scopes) {
    if (mod === 'trade_payable') {
      const r = await prisma.tradePayableConfirmation.updateMany({ where, data });
      updatedCount += r.count;
    } else if (mod === 'trade_receivable') {
      const r = await prisma.tradeReceivableConfirmation.updateMany({ where, data });
      updatedCount += r.count;
    } else {
      const r = await prisma.msmeConfirmation.updateMany({ where, data });
      updatedCount += r.count;
    }
  }

  await auditActivity(request, user, 'ENTITY_ATTACHMENT_UPLOAD', {
    success: true,
    resource: file.name,
    details: {
      entityName,
      category,
      module: moduleStr,
      moduleLabel: moduleStr && isModuleKey(moduleStr) ? moduleLabel(moduleStr) : 'All modules',
      fileName: file.name,
      updatedCount,
    },
  });

  return NextResponse.json({
    success: true,
    updatedCount,
    attachmentName: file.name,
    entityName,
  });
}
