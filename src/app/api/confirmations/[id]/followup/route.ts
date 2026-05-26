import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { sendFollowup } from '@/lib/confirmation-service';
import { fetchConfirmationOrForbidden } from '@/lib/confirmation-record-auth';

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

// POST /api/confirmations/[id]/followup
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const gate = await fetchConfirmationOrForbidden(user, id);
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'Not found' : 'Forbidden' }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const { emailBody, emailBodyTemplateId } = body;
  const templateId =
    typeof emailBodyTemplateId === 'string' && emailBodyTemplateId.trim()
      ? emailBodyTemplateId.trim()
      : null;
  const result = await sendFollowup(id, user.userId, emailBody || undefined, {
    emailBodyTemplateId: emailBody ? null : templateId,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
