import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

const LOGS_DIR = path.join(process.cwd(), 'logs');
const SAFE_FILENAME = /^[a-zA-Z0-9._-]+\.(log|txt|ndjson)$/;

function resolveLogFile(name: string): string | null {
  if (!SAFE_FILENAME.test(name)) return null;
  const resolved = path.resolve(LOGS_DIR, name);
  if (!resolved.startsWith(path.resolve(LOGS_DIR) + path.sep) && resolved !== path.resolve(LOGS_DIR, name)) {
    return null;
  }
  return resolved;
}

function readTail(filePath: string, maxLines: number): string {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) return content;
  return lines.slice(-maxLines).join('\n');
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const meta = requestMeta(request);
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');
  const download = searchParams.get('download') === '1';
  const lines = Math.min(parseInt(searchParams.get('lines') || '200', 10) || 200, 2000);

  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  if (!file) {
    const entries = fs
      .readdirSync(LOGS_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && SAFE_FILENAME.test(e.name))
      .map((e) => {
        const full = path.join(LOGS_DIR, e.name);
        const stat = fs.statSync(full);
        return {
          name: e.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    return NextResponse.json({ files: entries, logsDirectory: 'logs/' });
  }

  const filePath = resolveLogFile(file);
  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
  }

  const stat = fs.statSync(filePath);

  if (download) {
    const body = fs.readFileSync(filePath, 'utf8');
    await writeAuditLog({
      action: 'LOG_FILE_DOWNLOAD',
      success: true,
      userId: admin.userId,
      username: admin.username,
      resource: file,
      ...meta,
      details: { file, size: stat.size },
    });
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
      },
    });
  }

  const content = readTail(filePath, lines);
  const totalLines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;

  await writeAuditLog({
    action: 'LOG_FILE_VIEW',
    success: true,
    userId: admin.userId,
    username: admin.username,
    resource: file,
    ...meta,
    details: { file, linesShown: Math.min(lines, totalLines), totalLines, size: stat.size },
  });

  return NextResponse.json({
    file,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    totalLines,
    linesShown: Math.min(lines, totalLines),
    content,
    truncated: totalLines > lines,
  });
}
