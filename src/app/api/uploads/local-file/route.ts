import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

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

  const absolute = path.join(process.cwd(), rel);
  if (!absolute.startsWith(UPLOAD_ROOT) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const ct =
    ext === '.pdf'
      ? 'application/pdf'
      : ext.match(/\.(jpg|jpeg)$/)
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : 'application/octet-stream';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': ct,
      'Content-Disposition': `inline; filename="${path.basename(absolute)}"`,
    },
  });
}
