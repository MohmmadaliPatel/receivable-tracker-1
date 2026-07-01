/**
 * Startup environment validation (called from instrumentation.ts on Node register).
 * Enforces critical security / deploy requirements before the app accepts traffic.
 *
 * - EMAIL_ACTION_JWT_SECRET must be present, >=32 chars, not a placeholder.
 * - LICENSE + LICENSE_SIGNING_SECRET required in production; license must be valid and not expired.
 * - In production: DEMO_MODE must not be true; CRON_API_SECRET should be set (middleware will deny cron otherwise); NEXT_PUBLIC_APP_BASE_URL must be set (and preferably https).
 * - Throws on critical misconfig so deploys fail fast (visible in PM2/docker logs).
 *
 * See env.ubuntu-server.example + sample-env.txt for values and generation (openssl rand -base64 32).
 * Cross-referenced in client security confirmation (sections on secrets, sessions, public links, cron).
 */
export function validateEnv(): void {
  const jwt = (process.env.EMAIL_ACTION_JWT_SECRET || '').trim();
  const isProd = process.env.NODE_ENV === 'production';
  const demo = (process.env.DEMO_MODE || '').toLowerCase() === 'true';
  const cron = (process.env.CRON_API_SECRET || '').trim();
  const base = (process.env.NEXT_PUBLIC_APP_BASE_URL || '').trim();

  const errors: string[] = [];

  if (!jwt || jwt.length < 32) {
    errors.push('EMAIL_ACTION_JWT_SECRET must be set and at least 32 characters (use openssl rand -base64 32)');
  } else if (/replace|at_least|demo|placeholder|your_|change/i.test(jwt)) {
    errors.push('EMAIL_ACTION_JWT_SECRET appears to be a placeholder — replace with a real 32+ char secret');
  }

  if (isProd) {
    if (demo) {
      errors.push('DEMO_MODE must not be true in production (legacy/demo auth paths must be disabled)');
    }
    if (!process.env.LICENSE?.trim()) {
      errors.push('LICENSE must be set in production (generate with scripts/license-generator.html)');
    }
    const licenseSecret = (process.env.LICENSE_SIGNING_SECRET || '').trim();
    if (!licenseSecret || licenseSecret.length < 32) {
      errors.push('LICENSE_SIGNING_SECRET must be set and at least 32 characters (same secret used when generating licenses)');
    }
    if (!cron) {
      // Not fatal (middleware + route now deny), but warn loudly.
      console.warn('⚠️  CRON_API_SECRET is not set — cron control endpoints will be denied (recommended for production).');
    }
    if (!base) {
      errors.push('NEXT_PUBLIC_APP_BASE_URL must be set for production (used for magic links and public confirmations; affects build-time embedding)');
    } else if (base.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(base)) {
      console.warn('⚠️  NEXT_PUBLIC_APP_BASE_URL uses http in production — ensure TLS is terminated by reverse proxy and cookies are correctly flagged.');
    }
  }

  if (errors.length > 0) {
    const msg = 'Environment validation failed:\n  - ' + errors.join('\n  - ');
    console.error(msg);
    throw new Error(msg);
  }

  // Non-fatal but useful startup note
  if (isProd) {
    console.log('✅ [Env] Production environment checks passed (JWT secret length, no demo mode).');
  }
}

/** Async license validation — run after sync validateEnv() on startup. */
export async function validateLicenseAtStartup(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const hasLicense = !!(process.env.LICENSE || '').trim();

  if (!isProd && !hasLicense) {
    console.warn('⚠️  LICENSE is not set — license enforcement is disabled in development.');
    return;
  }

  const { verifyLicense, licenseStatusMessage } = await import('@/lib/license');
  const status = await verifyLicense();
  if (!status.ok) {
    const msg = `License validation failed: ${licenseStatusMessage(status)}`;
    console.error(msg);
    if (isProd || hasLicense) {
      throw new Error(msg);
    }
  } else {
    console.log(`✅ [License] Active for "${status.customer}" until ${status.expiresAt.toISOString().slice(0, 10)}`);
  }
}
