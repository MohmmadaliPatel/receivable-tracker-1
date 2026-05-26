import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';

async function auth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return getSession(token);
}

/** GET /api/listing-uploads — SAP listing batches with FY/quarter (current user). */
export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await prisma.tradeListingUpload.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      moduleKey: true,
      originalFileName: true,
      mode: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
      rowCountImported: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
