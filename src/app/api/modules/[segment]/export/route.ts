import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { userCanAccessModule } from '@/lib/module-access';
import type { ModuleKey } from '@/lib/module-types';
import { escapeCsvCell } from '@/lib/csv-encoding';
import { ROUND_TRIP_HEADERS } from '@/lib/module-round-trip';
import { auditActivity, moduleLabel } from '@/lib/audit-route';

import { parseModuleSegment } from '../../_utils';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// GET /api/modules/[segment]/export — CSV round-trip template with current data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  const key = parseModuleSegment(segment) as ModuleKey | null;
  if (!key) return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  if (!userCanAccessModule(user, key)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const records =
    key === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findMany({
          orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
        })
      : key === 'trade_receivable'
        ? await prisma.tradeReceivableConfirmation.findMany({
            orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
          })
        : await prisma.msmeConfirmation.findMany({
            orderBy: [{ entityName: 'asc' }, { createdAt: 'asc' }],
          });

  const lines: string[] = [ROUND_TRIP_HEADERS.map((h) => escapeCsvCell(h)).join(',')];
  for (const r of records) {
    lines.push(
      [
        escapeCsvCell(r.id),
        escapeCsvCell(r.entityName),
        escapeCsvCell(r.emailTo),
        escapeCsvCell(r.emailCc ?? ''),
        escapeCsvCell(r.bankName ?? ''),
        escapeCsvCell(r.custId ?? ''),
        escapeCsvCell(r.remarks ?? ''),
      ].join(',')
    );
  }

  const label =
    key === 'trade_payable'
      ? 'trade-payables'
      : key === 'trade_receivable'
        ? 'trade-receivables'
        : 'confirm-msme';
  const csv = lines.join('\n');

  await auditActivity(request, user, 'MODULE_EXPORT', {
    success: true,
    details: {
      module: key,
      moduleLabel: moduleLabel(key),
      recordCount: records.length,
    },
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${label}-entities-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
