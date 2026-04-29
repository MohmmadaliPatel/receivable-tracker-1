import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import {
  applyEntityContactToPayload,
  toUnifiedRecord,
} from '@/lib/confirmation-repository';
import { listConfirmationRecords, getEntityNames, CATEGORIES } from '@/lib/confirmation-service';
import { userCanAccessModule } from '@/lib/module-access';
import { categoryForModule } from '@/lib/module-types';
import { MODULE_KEYS } from '@/lib/module-types';
import type { ModuleKey } from '@/lib/module-types';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

function isModuleKey(s: string): s is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(s);
}

// GET /api/confirmations — list with filters
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const entityName = searchParams.getAll('entity');
  const category = searchParams.getAll('category');
  const status = searchParams.getAll('status');
  const search = searchParams.get('search') || undefined;
  const includeMetadata = searchParams.get('metadata') === 'true';
  const moduleParam = searchParams.get('module');
  const responseChannelRaw = searchParams.getAll('responseChannel');
  const responseChannel =
    responseChannelRaw.filter(Boolean).length > 0
      ? responseChannelRaw.map((x) =>
          ['all', 'none', 'web', 'email', 'both'].includes(x) ? (x as 'all' | 'none' | 'web' | 'email' | 'both') : 'all'
        )
      : undefined;

  const listMode = searchParams.get('listMode');
  const listModeVal =
    listMode === 'by_code' || listMode === 'flat' ? (listMode as 'by_code' | 'flat') : undefined;
  const pageParam = parseInt(searchParams.get('page') || '', 10);
  const pageSizeParam = parseInt(searchParams.get('pageSize') || '', 10);
  const page = Number.isFinite(pageParam) ? pageParam : undefined;
  const pageSize = Number.isFinite(pageSizeParam) ? pageSizeParam : undefined;
  if (user.role !== 'admin') {
    if (!moduleParam || !isModuleKey(moduleParam)) {
      return NextResponse.json(
        { error: 'module query parameter is required (trade_payable | trade_receivable | confirm_msme)' },
        { status: 400 }
      );
    }
    if (!userCanAccessModule(user, moduleParam)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  if (moduleParam && !isModuleKey(moduleParam)) {
    return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  }

  const result = await listConfirmationRecords({
    ...(user.role !== 'admin' ? { userId: user.userId } : {}),
    entityName: entityName.length ? entityName : undefined,
    category: category.length ? category : undefined,
    module: moduleParam && isModuleKey(moduleParam) ? moduleParam : undefined,
    status: status.length ? status : undefined,
    search,
    responseChannel,
    listMode: listModeVal,
    page,
    pageSize,
  });

  if (includeMetadata) {
    const entityNames = await getEntityNames(
      moduleParam && isModuleKey(moduleParam) ? moduleParam : undefined,
      user.role === 'admin' ? undefined : user.userId
    );
    const categories =
      moduleParam && isModuleKey(moduleParam)
        ? [categoryForModule(moduleParam)]
        : [...CATEGORIES];
    return NextResponse.json({
      records: result.records,
      total: result.total,
      ...(result.stats != null ? { stats: result.stats } : {}),
      entityNames,
      categories,
    });
  }

  return NextResponse.json({
    records: result.records,
    total: result.total,
    ...(result.stats != null ? { stats: result.stats } : {}),
  });
}

// POST /api/confirmations — create single record
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { entityName, bankName, accountNumber, custId, emailTo, emailCc, remarks } = body;
  const categoryIn = body.category as string | undefined;
  const modIn = body.module as string | undefined;

  if (!entityName || !emailTo) {
    return NextResponse.json(
      { error: 'Missing required fields: entityName, emailTo' },
      { status: 400 }
    );
  }

  let moduleVal: string | null = null;
  let category: string;

  if (modIn === 'trade_payable' || modIn === 'trade_receivable' || modIn === 'confirm_msme') {
    if (!userCanAccessModule(user, modIn)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    moduleVal = modIn;
    category = categoryForModule(modIn);
  } else if (user.role === 'admin' && categoryIn) {
    category = categoryIn;
    if (categoryIn === 'Trade Payables') moduleVal = 'trade_payable';
    else if (categoryIn === 'Trade Receivables') moduleVal = 'trade_receivable';
    else if (categoryIn === 'Confirm MSME') moduleVal = 'confirm_msme';
    else moduleVal = null;
  } else {
    return NextResponse.json(
      { error: 'Provide module: trade_payable | trade_receivable | confirm_msme (admin may use category instead)' },
      { status: 400 }
    );
  }

  let modKey: ModuleKey =
    moduleVal === 'trade_payable' ||
    moduleVal === 'trade_receivable' ||
    moduleVal === 'confirm_msme'
      ? moduleVal
      : category === 'Trade Receivables'
        ? 'trade_receivable'
        : category === 'Confirm MSME'
          ? 'confirm_msme'
          : 'trade_payable';

  const fk = await applyEntityContactToPayload(modKey, {
    custId: custId ?? null,
    entityContactId: null,
  });

  const data = {
    entityName,
    category,
    bankName: bankName ?? null,
    accountNumber: accountNumber ?? null,
    custId: custId ?? null,
    emailTo,
    emailCc: emailCc ?? null,
    remarks: remarks ?? null,
    userId: user.userId,
    entityContactId: fk.entityContactId ?? null,
  };

  if (modKey === 'trade_payable') {
    const row = await prisma.tradePayableConfirmation.create({ data });
    return NextResponse.json({ record: toUnifiedRecord(row, 'trade_payable') }, { status: 201 });
  }
  if (modKey === 'trade_receivable') {
    const row = await prisma.tradeReceivableConfirmation.create({ data });
    return NextResponse.json({ record: toUnifiedRecord(row, 'trade_receivable') }, { status: 201 });
  }
  const row = await prisma.msmeConfirmation.create({
    data: { ...data, msmeHasCertificate: null, msmeCertificateFilesJson: null },
  });
  return NextResponse.json({ record: toUnifiedRecord(row, 'confirm_msme') }, { status: 201 });
}
