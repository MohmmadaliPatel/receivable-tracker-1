import { NextResponse } from 'next/server';

/** @deprecated Use POST /api/modules/trade-payables/upload or /api/modules/trade-receivables/upload */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint was removed. Upload listings from Trade Payables or Trade Receivables (POST /api/modules/.../upload).',
    },
    { status: 410 }
  );
}
