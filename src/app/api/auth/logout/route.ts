import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';
import { getAuthPublicOrigin } from '@/lib/auth-public-url';

export async function POST(request: NextRequest) {
  const loginUrl = new URL('/login', `${getAuthPublicOrigin(request)}/`);

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('session_token')?.value;

    if (sessionToken) {
      await deleteSession(sessionToken);
    }

    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('session_token');

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('session_token');
    return response;
  }
}
