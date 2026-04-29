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

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const name = file.name.toLowerCase();

  let rows: Record<string, string>[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = parseTradeListingFile(buffer, name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to parse: ${msg}` }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'File is empty or has no data rows' }, { status: 400 });
  }

  const mapped = rows.map(mapTradePayableExcelRow).filter((m) => m.entityName && m.entityName !== 'Unknown');
  if (mapped.length === 0) {
    return NextResponse.json(
      { error: 'No valid rows. Ensure the file matches the Trade Payables listing format.' },
      { status: 400 }
    );
  }

  const fkMap = await buildEntityContactFkMap();
  const { imported } = await importTradeListingFromMapped({
    moduleKey: 'trade_payable',
    userId: user.userId,
    mapped,
    mode,
    fkMap,
  });

  const msmeHydrated = await maybeHydrateMsmeFromPartyMasters(user);

  return NextResponse.json({
    success: true,
    imported,
    skipped: rows.length - mapped.length,
    totalRows: rows.length,
    msmeHydrated,
  });
}
