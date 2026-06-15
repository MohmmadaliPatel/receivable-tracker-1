import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@/lib/password-policy';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const meta = requestMeta(request);
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('session_token')?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = await getSession(sessionToken);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body as { currentPassword?: string; newPassword?: string };

    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'New password is required' }, { status: 400 });
    }

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
      return NextResponse.json({ error: policy.errors.join('; ') }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Current password is REQUIRED for self-service re-authentication before credential change (security & client questionnaire compliance).
    if (!currentPassword) {
      return NextResponse.json({ error: 'Current password is required for verification' }, { status: 400 });
    }
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      await writeAuditLog({
        action: 'PASSWORD_CHANGE',
        success: false,
        userId: session.userId,
        username: session.username,
        ...meta,
        details: { reason: 'incorrect_current_password' },
      });
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    const hashed = await bcrypt.hash(newPassword, 12); // cost 12 (OWASP baseline 2024+; tune for CPU; was 10)
    // On successful self-service pw change, clear any residual lock state (defensive; success path implies it wasn't admin-locked).
    await prisma.user.update({
      where: { id: session.userId },
      data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null, adminResetRequired: false },
    });

    // Invalidate all other sessions for this user (force re-login on other devices/browsers after pw change).
    // Keep the current sessionToken so the user is not logged out of this request.
    await prisma.session.deleteMany({
      where: { userId: session.userId, sessionToken: { not: sessionToken } },
    });

    await writeAuditLog({
      action: 'PASSWORD_CHANGE',
      success: true,
      userId: session.userId,
      username: session.username,
      ...meta,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}