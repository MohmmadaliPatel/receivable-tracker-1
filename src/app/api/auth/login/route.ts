import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials, createSession } from '@/lib/simple-auth';
import { sessionCookieSecure } from '@/lib/auth-public-url';

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

    const response = NextResponse.json({ success: true });
    response.cookies.set('session_token', sessionToken, {
      httpOnly: true,
      secure: sessionCookieSecure(),
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
