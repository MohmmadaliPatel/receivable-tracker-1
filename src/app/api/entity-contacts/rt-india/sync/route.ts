import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSession } from '@/lib/simple-auth';
import { syncRtIndiaContacts } from '@/lib/rt-india-ingest';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/entity-contacts/rt-india/sync — multipart `file` (.xlsx) required (RT India Sheet1 format)
export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const ct = request.headers.get('content-type') ?? '';
    if (!ct.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Upload an Excel workbook (multipart form with file field). Syncing a default public file is disabled.' },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Expected file field (Excel .xlsx)' }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const tmp = path.join(os.tmpdir(), `rt-india-upload-${Date.now()}.xlsx`);
    fs.writeFileSync(tmp, buf);
    try {
      const result = await syncRtIndiaContacts(tmp);
      return NextResponse.json({ success: true, ...result });
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
