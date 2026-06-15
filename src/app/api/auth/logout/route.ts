import { NextRequest, NextResponse } from 'next/server';
import { deleteSession, getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';
import { getAuthPublicOrigin } from '@/lib/auth-public-url';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  const loginUrl = new URL('/login', `${getAuthPublicOrigin(request)}/`);
  const meta = requestMeta(request);

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('session_token')?.value;

    if (sessionToken) {
      const session = await getSession(sessionToken);
      if (session) {
        await writeAuditLog({
          action: 'LOGOUT',
          success: true,
          userId: session.userId,
          username: session.username,
          ...meta,
        });
      }
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
