import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  verifyCredentials,
  createSession,
  recordFailedLogin,
  checkAccountLock,
} from '@/lib/simple-auth';
import { sessionCookieSecureForRequest } from '@/lib/auth-public-url';
import { sessionMaxAgeSeconds } from '@/lib/security-config';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const meta = requestMeta(request);

  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const lockBefore = await checkAccountLock(username);
    if (lockBefore.locked) {
      await writeAuditLog({
        action: 'LOGIN_LOCKED',
        success: false,
        username,
        ...meta,
        details: { reason: lockBefore.reason || 'account_locked' },
      });
      const msg = lockBefore.reason === 'adminResetRequired'
        ? 'Account is locked and requires an administrator to reset the password.'
        : 'Account is temporarily locked. Try again later.';
      return NextResponse.json({ error: msg }, { status: 423 });
    }

    const result = await verifyCredentials({ username, password });

    if (!result.success) {
      if (result.reason === 'locked' || result.reason === 'adminResetRequired') {
        await writeAuditLog({
          action: 'LOGIN_LOCKED',
          success: false,
          username,
          ...meta,
          details: { reason: result.reason },
        });
        const msg = result.reason === 'adminResetRequired'
          ? 'Account is locked and requires an administrator to reset the password.'
          : 'Account is temporarily locked. Try again later.';
        return NextResponse.json({ error: msg }, { status: 423 });
      }

      const { locked } = await recordFailedLogin(username);
      await writeAuditLog({
        action: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        success: false,
        username,
        ...meta,
      });

      return NextResponse.json(
        {
          error: locked
            ? 'Account is temporarily locked due to failed login attempts.'
            : 'Invalid username or password',
        },
        { status: locked ? 423 : 401 }
      );
    }

    const sessionToken = await createSession(result.userId);

    await writeAuditLog({
      action: 'LOGIN_SUCCESS',
      success: true,
      userId: result.userId,
      username,
      ...meta,
    });

    const cookieStore = await cookies();
    cookieStore.set('session_token', sessionToken, {
      httpOnly: true,
      secure: sessionCookieSecureForRequest(request),
      sameSite: 'lax',
      maxAge: sessionMaxAgeSeconds(),
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
