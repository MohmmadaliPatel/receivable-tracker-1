import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/simple-auth';
import {
  getDistinctReportingFiscalYears,
  getLatestReportingFiscalPeriod,
} from '@/lib/confirmation-repository';
import { currentIndiaFiscalAnchor } from '@/lib/listing-upload-fiscal';

// GET /api/fiscal-filter/defaults — latest FY+quarter with data and available years
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [latestPeriod, availableYears] = await Promise.all([
    getLatestReportingFiscalPeriod(session.userId),
    getDistinctReportingFiscalYears(undefined, session.userId),
  ]);

  const fallback = currentIndiaFiscalAnchor();

  return NextResponse.json({
    latestPeriod,
    availableYears,
    fallback: { year: fallback.reportingFiscalYear, quarter: fallback.reportingFiscalQuarter },
  });
}
