import { NextRequest, NextResponse } from 'next/server';
import { securityConfig } from '@/lib/security-config';

const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/public/'];

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isCronPath(pathname: string): boolean {
  return pathname === '/api/cron' || pathname.startsWith('/api/cron/');
}

async function sessionIsValid(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get('session_token')?.value;
  if (!token) return false;

  const url = new URL('/api/auth/session', request.url);
  const res = await fetch(url, {
    headers: { cookie: `session_token=${token}` },
    cache: 'no-store',
  });

  if (!res.ok) return false;
  const data = await res.json();
  return data.authenticated === true;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Harden Next.js static asset paths (/_next/static/*) against active scanner probes that append
  // a trailing slash to file paths (e.g. /...chunk.js/) in an attempt to discover "directory browsing"
  // or trigger header-related scanner noise. Legitimate browsers and Next.js never request chunk/CSS
  // files with a trailing slash. We return an explicit JSON 404 with Content-Type and nosniff to
  // avoid "Content-Type Header Missing" (and any directory listing) findings on these probes.
  // This applies in both dev (turbopack) and production (standalone server).
  if (pathname.startsWith('/_next/static/')) {
    if (pathname.endsWith('/')) {
      const body = JSON.stringify({ error: 'Not found' });
      return new Response(body, {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.next();
  }

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (isCronPath(pathname)) {
    const secret = securityConfig.cronApiSecret;
    if (secret) {
      const auth = request.headers.get('authorization');
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      if (token === secret) {
        return NextResponse.next();
      }
      // When CRON_API_SECRET is configured, require the Bearer token exclusively.
      // Do not fall back to session cookies (prevents any authenticated user from triggering cron).
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // No CRON_API_SECRET configured: deny cron control (required in production; any-auth would allow non-admins to start/stop email processing).
    return NextResponse.json({ error: 'Unauthorized (CRON_API_SECRET required for cron control)' }, { status: 401 });
  }

  const valid = await sessionIsValid(request);
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware for API routes (auth/cron) and _next/static assets so we can enforce
  // no-directory-browsing behavior on trailing-slash probes against built chunks.
  matcher: ['/api/:path*', '/_next/static/:path*'],
};
