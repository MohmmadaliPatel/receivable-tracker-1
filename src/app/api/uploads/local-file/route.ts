import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

function contentTypeForExt(ext: string): string {
  if (ext === '.pdf') return 'application/pdf';
  if (ext.match(/\.(jpg|jpeg)$/)) return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

// GET /api/uploads/local-file?relative= uploads/msme/xyz/file.pdf
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  const session = sessionToken ? await getSession(sessionToken) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rel = request.nextUrl.searchParams.get('relative')?.trim().replace(/^\/+/, '') ?? '';
  if (!rel || rel.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const absolute = path.resolve(process.cwd(), rel);
  const rootWithSep = path.normalize(UPLOAD_ROOT + path.sep);
  const normalizedFile = path.normalize(absolute);

  if (!normalizedFile.startsWith(rootWithSep)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    if (!fs.existsSync(normalizedFile)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const stat = fs.statSync(normalizedFile);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const buf = fs.readFileSync(normalizedFile);
    const ext = path.extname(normalizedFile).toLowerCase();
    const ct = contentTypeForExt(ext);
    const filename = path.basename(normalizedFile);

    return new NextResponse(buf, {
      headers: {
        'Content-Type': ct,
        'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
        'Content-Length': String(buf.length),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read file';
    console.error('[local-file]', msg, rel);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
