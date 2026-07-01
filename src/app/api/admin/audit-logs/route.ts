import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { prisma } from '@/lib/prisma';
import { exportAuditLogsJson, writeAuditLog, requestMeta } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const meta = requestMeta(request);

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');
  const action = searchParams.get('action') || undefined;
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 5000);
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);
  const skip = (page - 1) * limit;

  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  if (format === 'ndjson') {
    const body = await exportAuditLogsJson({ from, to, action, limit });
    await writeAuditLog({
      action: 'AUDIT_LOG_EXPORT',
      success: true,
      userId: admin.userId,
      username: admin.username,
      ...meta,
      details: { format: 'ndjson', from: fromStr, to: toStr, actionFilter: action, limit },
    });
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="audit-logs.ndjson"',
      },
    });
  }

  const where: {
    createdAt?: { gte?: Date; lte?: Date };
    action?: string;
  } = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  if (action) where.action = action;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    logs,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
