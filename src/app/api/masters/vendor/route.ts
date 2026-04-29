import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { prisma } from '@/lib/prisma';

async function auth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return getSession(token);
}

const select = {
  id: true,
  normalizedKey: true,
  companyCode: true,
  partyName: true,
  custId: true,
  emailTo: true,
  emailCc: true,
  sapCustomerCode: true,
  source: true,
  updatedAt: true,
} as const;

/** GET /api/masters/vendor — list vendor masters (recent first) */
export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userCanAccessModule(user, 'trade_payable')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await prisma.vendorMaster.findMany({
    select,
    orderBy: { updatedAt: 'desc' },
    take: 3000,
  });

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}
