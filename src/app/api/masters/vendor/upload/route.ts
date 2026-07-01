import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { mapTradePayableExcelRow } from '@/lib/module-excel-maps';
import {
  buildEntityContactFkMap,
  importTradeListingFromMapped,
  parseTradeListingFile,
} from '@/lib/trade-listing-import';
import { maybeHydrateMsmeFromPartyMasters } from '@/lib/masters-msme-hook';
import { parseListingUploadFiscal } from '@/lib/listing-upload-fiscal';
import { prisma } from '@/lib/prisma';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

async function auth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return getSession(token);
}

/** POST /api/masters/vendor/upload — same TP listing Excel/CSV as Trade Payables (masters + TP rows). */
export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userCanAccessModule(user, 'trade_payable')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const mode = (formData.get('mode') as string) === 'replace' ? 'replace' : 'append';
  const key = 'trade_payable' as const;

  const auditFail = async (error: string, extra?: Record<string, unknown>) => {
    await auditActivity(request, user, 'LISTING_UPLOAD', {
      success: false,
      resource: file?.name ?? null,
      details: {
        module: key,
        moduleLabel: moduleLabel(key),
        source: 'vendor_master',
        fileName: file?.name,
        mode,
        error,
        ...extra,
      },
    });
  };

  if (!file) {
    await auditFail('No file provided');
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const name = file.name.toLowerCase();

  let rows: Record<string, string>[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = parseTradeListingFile(buffer, name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await auditFail(`Failed to parse: ${msg}`);
    return NextResponse.json({ error: `Failed to parse: ${msg}` }, { status: 400 });
  }

  if (rows.length === 0) {
    await auditFail('File is empty or has no data rows', { totalRows: 0 });
    return NextResponse.json({ error: 'File is empty or has no data rows' }, { status: 400 });
  }

  const mapped = rows.map(mapTradePayableExcelRow).filter((m) => m.entityName && m.entityName !== 'Unknown');
  if (mapped.length === 0) {
    const err = 'No valid rows. Ensure the file matches the Trade Payables listing format.';
    await auditFail(err, { totalRows: rows.length, validRows: 0 });
    return NextResponse.json({ error: err }, { status: 400 });
  }

  const fkMap = await buildEntityContactFkMap();

  const fiscalParsed = parseListingUploadFiscal(formData);
  if (!fiscalParsed.ok) {
    await auditFail(fiscalParsed.error);
    return NextResponse.json({ error: fiscalParsed.error }, { status: 400 });
  }

  const upload = await prisma.tradeListingUpload.create({
    data: {
      userId: user.userId,
      moduleKey: 'trade_payable',
      originalFileName: file.name,
      mode,
      reportingFiscalYear: fiscalParsed.reportingFiscalYear,
      reportingFiscalQuarter: fiscalParsed.reportingFiscalQuarter,
      rowCountImported: 0,
    },
  });

  let imported = 0;
  try {
    const result = await importTradeListingFromMapped({
      moduleKey: 'trade_payable',
      userId: user.userId,
      mapped,
      mode,
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
    const msg = e instanceof Error ? e.message : String(e);
    await auditFail(msg || 'Import failed', { listingUploadId: upload.id });
    throw e;
  }

  const msmeHydrated = await maybeHydrateMsmeFromPartyMasters(user);

  await auditActivity(request, user, 'LISTING_UPLOAD', {
    success: true,
    resource: upload.id,
    details: {
      module: key,
      moduleLabel: moduleLabel(key),
      source: 'vendor_master',
      fileName: file.name,
      mode,
      imported,
      totalRows: rows.length,
      skipped: rows.length - mapped.length,
      listingUploadId: upload.id,
      msmeHydrated,
    },
  });

  return NextResponse.json({
    success: true,
    imported,
    listingUploadId: upload.id,
    skipped: rows.length - mapped.length,
    totalRows: rows.length,
    msmeHydrated,
  });
}
