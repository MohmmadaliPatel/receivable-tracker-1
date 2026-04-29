import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyCredentials, createSession } from '@/lib/simple-auth';
import { sessionCookieSecureForRequest } from '@/lib/auth-public-url';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const result = await verifyCredentials({ username, password });

    if (!result.success || !result.userId) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Create session
    const sessionToken = await createSession(result.userId);

    const cookieStore = await cookies();
    cookieStore.set('session_token', sessionToken, {
      httpOnly: true,
      secure: sessionCookieSecureForRequest(request),
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
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
