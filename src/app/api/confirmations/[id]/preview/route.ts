import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { buildConfirmationPreviewHtml } from '@/lib/confirmation-service';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// GET /api/confirmations/[id]/preview?mode=send|followup
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });
  const record = gate.record;

  const modeParam = request.nextUrl.searchParams.get('mode');
  const mode = modeParam === 'followup' ? 'followup' : 'send';

  const built = await buildConfirmationPreviewHtml({ recordId: id, mode });
  if (!built) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ subject: built.subject, html: built.html, record });
}
