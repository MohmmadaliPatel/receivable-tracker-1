/**
 * Resolve the public app URL from runtime env (not build-time NEXT_PUBLIC_*).
 * Prefer APP_BASE_URL — read from .env at server startup; no rebuild required on client sites.
 */
export function resolvePublicAppUrl(): string | null {
  const runtime = process.env.APP_BASE_URL?.trim();
  if (runtime) return runtime.replace(/\/$/, '');

  // Fallback for local dev; in production client builds this is often baked to confirm.example.com
  const buildTime = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  if (buildTime) return buildTime.replace(/\/$/, '');

  return null;
}

/** Public absolute base URL for magic links in outbound emails (no trailing slash). */
export function getAppBaseUrl(): string {
  const resolved = resolvePublicAppUrl();
  if (resolved) return resolved;

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }

  return 'http://localhost:3002';
}
