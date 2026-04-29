import type { NextRequest } from 'next/server';

/**
 * URL users use in the browser (no trailing slash). Used for redirects after logout, etc.
 * Prefer env so deploys behind a reverse proxy still redirect correctly.
 */
export function getAuthPublicOrigin(request: NextRequest): string {
  const envUrl =
    process.env.NEXTAUTH_URL?.trim().replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_APP_BASE_URL?.trim().replace(/\/$/, '');
  if (envUrl) return envUrl;

  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.split(',')[0]?.trim();
  let proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (!host) {
    try {
      return new URL(request.url).origin;
    } catch {
      return 'http://localhost:3002';
    }
  }
  if (!proto) {
    try {
      proto = new URL(request.url).protocol.replace(':', '') || 'http';
    } catch {
      proto = 'http';
    }
  }
  return `${proto}://${host}`;
}

/**
 * `Secure` cookies are not sent over plain HTTP. Only enable when the public URL is https://.
 */
export function sessionCookieSecure(): boolean {
  const base =
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() ||
    '';
  return base.startsWith('https://');
}

/**
 * Prefer the request's effective scheme (reverse proxy) so session cookies match how the browser
 * reached the app. Falls back to env-based {@link sessionCookieSecure} when proto is unknown.
 */
export function sessionCookieSecureForRequest(request: NextRequest): boolean {
  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwarded === 'https') return true;
  if (forwarded === 'http') return false;
  try {
    const u = new URL(request.url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return false;
  } catch {
    /* ignore */
  }
  return sessionCookieSecure();
}
