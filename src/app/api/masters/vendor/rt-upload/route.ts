import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncRtIndiaContacts } from '@/lib/rt-india-ingest';
import { maybeHydrateMsmeFromPartyMasters } from '@/lib/masters-msme-hook';
import { maybeHydrateTpFromPartyMasters } from '@/lib/masters-tp-hook';

async function auth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return getSession(token);
}

/** POST /api/masters/vendor/rt-upload — RT India Sheet1 format; updates entity contacts + vendor master + TP listings only */
export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userCanAccessModule(user, 'trade_payable')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return NextResponse.json({ error: 'Use .xlsx or .xls' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `rt-vendor-master-${Date.now()}.xlsx`);
  fs.writeFileSync(tmp, buf);
  try {
    const result = await syncRtIndiaContacts(tmp, 'vendor_only');
    const tpHydrated = await maybeHydrateTpFromPartyMasters(user);
    const msmeHydrated = await maybeHydrateMsmeFromPartyMasters(user);
    return NextResponse.json({ success: true, ...result, tpHydrated, msmeHydrated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
