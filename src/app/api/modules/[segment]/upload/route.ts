import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import type { ModuleKey } from '@/lib/module-types';
import {
  mapTradePayableExcelRow,
  mapTradeReceivableExcelRow,
} from '@/lib/module-excel-maps';
import {
  buildEntityContactFkMap,
  importTradeListingFromMapped,
  parseTradeListingFile,
} from '@/lib/trade-listing-import';
import { maybeHydrateMsmeFromPartyMasters } from '@/lib/masters-msme-hook';
import { parseListingUploadFiscal } from '@/lib/listing-upload-fiscal';
import { prisma } from '@/lib/prisma';

import { parseModuleSegment } from '../../_utils';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/modules/[segment]/upload — Excel or CSV (column layout from listing templates)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  const key = parseModuleSegment(segment) as ModuleKey | null;
  if (!key) return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  if (!userCanAccessModule(user, key)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const mode = (formData.get('mode') as string) || 'append';
  const replaceMode = mode === 'replace' ? 'replace' : 'append';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (key === 'confirm_msme') {
    return NextResponse.json(
      {
        error:
          'Confirm MSME is populated from Vendor master. Upload vendor master / Trade Payables listing (same file updates TP + vendors) or RT India email workbook, then open Confirm MSME.',
      },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name.toLowerCase();

  let rows: Record<string, string>[] = [];
  try {
    rows = parseTradeListingFile(buffer, filename);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to parse file: ${msg}` }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'File is empty or has no data rows' }, { status: 400 });
  }

  const fkMap = await buildEntityContactFkMap();

  const mapper = key === 'trade_payable' ? mapTradePayableExcelRow : mapTradeReceivableExcelRow;

  const mapped = rows.map(mapper).filter((m) => m.entityName && m.entityName !== 'Unknown');

  if (mapped.length === 0) {
    return NextResponse.json(
      {
        error:
          'No valid rows. Ensure the file matches the expected listing format (Company Code row present).',
      },
      { status: 400 }
    );
  }

  if (key !== 'trade_payable' && key !== 'trade_receivable') {
    return NextResponse.json({ error: 'Invalid module for listing import' }, { status: 400 });
  }

  const fiscalParsed = parseListingUploadFiscal(formData);
  if (!fiscalParsed.ok) {
    return NextResponse.json({ error: fiscalParsed.error }, { status: 400 });
  }

  const upload = await prisma.tradeListingUpload.create({
    data: {
      userId: user.userId,
      moduleKey: key,
      originalFileName: file.name,
      mode: replaceMode,
      reportingFiscalYear: fiscalParsed.reportingFiscalYear,
      reportingFiscalQuarter: fiscalParsed.reportingFiscalQuarter,
      rowCountImported: 0,
    },
  });

  let imported = 0;
  try {
    const result = await importTradeListingFromMapped({
      moduleKey: key,
      userId: user.userId,
      mapped,
      mode: replaceMode,
      fkMap,
      listingFiscal: {
        listingUploadId: upload.id,
        reportingFiscalYear: fiscalParsed.reportingFiscalYear,
        reportingFiscalQuarter: fiscalParsed.reportingFiscalQuarter,
      },
    });
    imported = result.imported;
    await prisma.tradeListingUpload.update({
      where: { id: upload.id },
      data: { rowCountImported: imported },
    });
  } catch (e) {
    await prisma.tradeListingUpload.delete({ where: { id: upload.id } }).catch(() => {});
    throw e;
  }

  let msmeHydrated: { upserted: number; fromVendors: number } | null = null;
  if (key === 'trade_payable') {
    msmeHydrated = await maybeHydrateMsmeFromPartyMasters(user);
  }

  return NextResponse.json({
    success: true,
    imported,
    listingUploadId: upload.id,
    total: rows.length,
    skipped: rows.length - mapped.length,
    ...(msmeHydrated ? { msmeHydrated } : {}),
  });
}
