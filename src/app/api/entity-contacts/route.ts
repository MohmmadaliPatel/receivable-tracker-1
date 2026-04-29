import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { normalizeTradeCustId, TRADE_COMPOSITE_SEP } from '@/lib/trade-composite-cust';
import { normalizeSapCode } from '@/lib/confirmation-repository';
import { pickMatchingPartyMaster } from '@/lib/party-masters';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

type ModuleFilter = 'trade_payable' | 'trade_receivable' | 'all';

// GET /api/entity-contacts?module=trade_payable|trade_receivable|all
export async function GET(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const mod = (request.nextUrl.searchParams.get('module') || 'all') as ModuleFilter;
  if (mod !== 'trade_payable' && mod !== 'trade_receivable' && mod !== 'all') {
    return NextResponse.json({ error: 'Invalid module filter' }, { status: 400 });
  }

  type Meta = { tp: boolean; tr: boolean; sampleName: string };
  const codeToMeta = new Map<string, Meta>();

  const ingest = (rows: { custId: string | null; entityName: string }[], which: 'tp' | 'tr') => {
    for (const r of rows) {
      const raw = r.custId?.trim();
      if (!raw) continue;
      const norm = normalizeTradeCustId(raw);
      let m = codeToMeta.get(norm);
      if (!m) {
        m = { tp: false, tr: false, sampleName: r.entityName };
        codeToMeta.set(norm, m);
      }
      if (which === 'tp') m.tp = true;
      else m.tr = true;
    }
  };

  if (mod === 'all' || mod === 'trade_payable') {
    const tp = await prisma.tradePayableConfirmation.findMany({
      where: { userId: user.userId, emailThreadAnchorId: null },
      select: { custId: true, entityName: true },
    });
    ingest(tp, 'tp');
  }
  if (mod === 'all' || mod === 'trade_receivable') {
    const tr = await prisma.tradeReceivableConfirmation.findMany({
      where: { userId: user.userId, emailThreadAnchorId: null },
      select: { custId: true, entityName: true },
    });
    ingest(tr, 'tr');
  }

  const codes = [...codeToMeta.keys()].sort((a, b) => a.localeCompare(b));
  const contacts = await prisma.entityContact.findMany();
  const idBySapCode = new Map(
    contacts
      .filter((c): c is (typeof contacts)[0] & { sapCustomerCode: string } => !!c.sapCustomerCode?.trim())
      .map((c) => [c.sapCustomerCode, c])
  );

  function resolveContactForCustId(sapKey: string) {
    const full = normalizeTradeCustId(sapKey);
    let row = idBySapCode.get(full);
    if (row) return row;
    const sepIdx = full.indexOf(TRADE_COMPOSITE_SEP);
    if (sepIdx > 0) {
      row = idBySapCode.get(full.slice(0, sepIdx));
      if (row) return row;
    }
    return idBySapCode.get(normalizeSapCode(sapKey));
  }

  const vendors = await prisma.vendorMaster.findMany();
  const suppliers = await prisma.supplierMaster.findMany();

  const rows = codes.map((sapCode) => {
    const meta = codeToMeta.get(sapCode)!;
    const ec = resolveContactForCustId(sapCode) ?? null;
    const vm = pickMatchingPartyMaster(vendors, sapCode);
    const sm = pickMatchingPartyMaster(suppliers, sapCode);

    let emailTo = '';
    let emailCc = '';
    if (mod === 'trade_payable') {
      emailTo = (vm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      emailCc = (vm?.emailCc ?? ec?.emailCc ?? '') || '';
    } else if (mod === 'trade_receivable') {
      emailTo = (sm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      emailCc = (sm?.emailCc ?? ec?.emailCc ?? '') || '';
    } else {
      emailTo = (sm?.emailTo?.trim() || vm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      emailCc = (sm?.emailCc ?? vm?.emailCc ?? ec?.emailCc ?? '') || '';
    }

    let source: string | null = null;
    if (mod === 'trade_payable') {
      if (vm?.emailTo?.trim()) source = vm.source ?? 'vendor_master';
      else source = ec?.source ?? null;
    } else if (mod === 'trade_receivable') {
      if (sm?.emailTo?.trim()) source = sm.source ?? 'supplier_master';
      else source = ec?.source ?? null;
    } else {
      if (sm?.emailTo?.trim()) source = sm.source ?? 'supplier_master';
      else if (vm?.emailTo?.trim()) source = vm.source ?? 'vendor_master';
      else source = ec?.source ?? null;
    }

    return {
      sapCustomerCode: sapCode,
      entityContactId: ec?.id ?? null,
      emailTo,
      emailCc,
      payeeName: ec?.payeeName ?? null,
      personName: ec?.personName ?? null,
      source,
      usedInTradePayable: meta.tp,
      usedInTradeReceivable: meta.tr,
      displayEntityName: meta.sampleName,
    };
  });

  return NextResponse.json({ rows });
}

// POST /api/entity-contacts — upsert party master row + hydrate trade listing emails for this user
export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    sapCustomerCode?: string;
    emailTo?: string;
    emailCc?: string | null;
    payeeName?: string | null;
    personName?: string | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sap = body.sapCustomerCode ? normalizeTradeCustId(body.sapCustomerCode) : '';
  if (!sap) {
    return NextResponse.json({ error: 'sapCustomerCode is required' }, { status: 400 });
  }

  const emailTo = (body.emailTo ?? '').trim();
  const emailCc = body.emailCc?.trim() || null;

  const ec = await prisma.entityContact.upsert({
    where: { sapCustomerCode: sap },
    create: {
      sapCustomerCode: sap,
      emailTo,
      emailCc,
      payeeName: body.payeeName?.trim() || null,
      personName: body.personName?.trim() || null,
      source: 'trade_party_master',
    },
    update: {
      emailTo,
      emailCc,
      payeeName: body.payeeName?.trim() || null,
      personName: body.personName?.trim() || null,
      source: 'trade_party_master',
    },
  });

  const vendors = await prisma.vendorMaster.findMany();
  const suppliers = await prisma.supplierMaster.findMany();
  const vm = pickMatchingPartyMaster(vendors, sap);
  const sm = pickMatchingPartyMaster(suppliers, sap);

  const personName = body.personName?.trim() || null;

  if (vm) {
    await prisma.vendorMaster.update({
      where: { id: vm.id },
      data: {
        emailTo,
        emailCc,
        personName,
      },
    });
  }
  if (sm) {
    await prisma.supplierMaster.update({
      where: { id: sm.id },
      data: {
        emailTo,
        emailCc,
        personName,
      },
    });
  }

  const tpRows = await prisma.tradePayableConfirmation.findMany({
    where: { userId: user.userId },
    select: { id: true, custId: true },
  });
  for (const r of tpRows) {
    if (!r.custId?.trim()) continue;
    if (normalizeTradeCustId(r.custId) !== sap) continue;
    await prisma.tradePayableConfirmation.update({
      where: { id: r.id },
      data: {
        entityContactId: ec.id,
        ...(vm ? { vendorMasterId: vm.id } : {}),
        emailTo: ec.emailTo || '',
        ...(ec.emailCc != null ? { emailCc: ec.emailCc } : {}),
      },
    });
  }

  const trRows = await prisma.tradeReceivableConfirmation.findMany({
    where: { userId: user.userId },
    select: { id: true, custId: true },
  });
  for (const r of trRows) {
    if (!r.custId?.trim()) continue;
    if (normalizeTradeCustId(r.custId) !== sap) continue;
    await prisma.tradeReceivableConfirmation.update({
      where: { id: r.id },
      data: {
        entityContactId: ec.id,
        ...(sm ? { supplierMasterId: sm.id } : {}),
        emailTo: ec.emailTo || '',
        ...(ec.emailCc != null ? { emailCc: ec.emailCc } : {}),
      },
    });
  }

  return NextResponse.json({
    success: true,
    entityContact: {
      id: ec.id,
      sapCustomerCode: ec.sapCustomerCode,
      emailTo: ec.emailTo,
      emailCc: ec.emailCc,
    },
  });
}
