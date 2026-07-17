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

/** RFC 5987-safe Content-Disposition for inline/attachment downloads. */
function contentDispositionHeader(disposition: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'file';
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// GET /api/uploads/local-file?relative=uploads/msme/xyz/file.pdf
export async function GET(request: NextRequest) {
  const rel = request.nextUrl.searchParams.get('relative')?.trim().replace(/^\/+/, '') ?? '';

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('session_token')?.value;
    const session = sessionToken ? await getSession(sessionToken) : null;
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!rel || rel.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const absolute = path.resolve(process.cwd(), rel);
    const rootWithSep = path.normalize(UPLOAD_ROOT + path.sep);
    const normalizedFile = path.normalize(absolute);

    if (!normalizedFile.startsWith(rootWithSep)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(normalizedFile)) {
      return NextResponse.json(
        { error: 'Certificate file not found on server' },
        { status: 404 }
      );
    }
    const stat = fs.statSync(normalizedFile);
    if (stat.isDirectory()) {
      return NextResponse.json(
        { error: 'Certificate file not found on server' },
        { status: 404 }
      );
    }

    const buf = fs.readFileSync(normalizedFile);
    const ext = path.extname(normalizedFile).toLowerCase();
    const ct = contentTypeForExt(ext);
    const filename = path.basename(normalizedFile);
    const body = new Uint8Array(buf);

    return new NextResponse(body, {
      headers: {
        'Content-Type': ct,
        'Content-Disposition': contentDispositionHeader('inline', filename),
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read file';
    console.error('[local-file]', msg, rel);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
