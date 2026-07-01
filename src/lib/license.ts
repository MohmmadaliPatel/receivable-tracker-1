import { jwtVerify, type JWTPayload } from 'jose';
import { LICENSE_CONTACT, LICENSE_PRODUCT_ID } from '@/lib/license-config';

export type LicenseFailureReason = 'missing' | 'misconfigured' | 'invalid' | 'expired' | 'wrong_product';

export type LicenseStatus =
  | { ok: true; customer: string; expiresAt: Date }
  | { ok: false; reason: LicenseFailureReason; customer?: string; expiresAt?: Date };

interface LicenseClaims extends JWTPayload {
  lic?: string;
}

function signingKey(): Uint8Array | null {
  const secret = process.env.LICENSE_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

function readLicenseToken(token?: string): string {
  return (token ?? process.env.LICENSE ?? '').trim();
}

function claimsToStatus(payload: LicenseClaims, expired: boolean): LicenseStatus {
  if (payload.lic !== LICENSE_PRODUCT_ID) {
    return { ok: false, reason: 'wrong_product' };
  }

  const customer = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : 'Licensed customer';
  const exp = payload.exp;
  if (!exp || !Number.isFinite(exp)) {
    return { ok: false, reason: 'invalid' };
  }

  const expiresAt = new Date(exp * 1000);
  if (expired || expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired', customer, expiresAt };
  }

  return { ok: true, customer, expiresAt };
}

/** Verify the LICENSE env value (or an explicit token). Edge-safe. */
export async function verifyLicense(token?: string): Promise<LicenseStatus> {
  const license = readLicenseToken(token);
  if (!license) {
    return { ok: false, reason: 'missing' };
  }

  const key = signingKey();
  if (!key) {
    return { ok: false, reason: 'misconfigured' };
  }

  try {
    const { payload } = await jwtVerify(license, key, { algorithms: ['HS256'] });
    return claimsToStatus(payload as LicenseClaims, false);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'ERR_JWT_EXPIRED') {
      try {
        const { payload } = await jwtVerify(license, key, {
          algorithms: ['HS256'],
          clockTolerance: 60 * 60 * 24 * 365 * 50,
        });
        return claimsToStatus(payload as LicenseClaims, true);
      } catch {
        return { ok: false, reason: 'expired' };
      }
    }
    return { ok: false, reason: 'invalid' };
  }
}

/** Whether the app should enforce licensing (production always; dev when LICENSE is set). */
export function shouldEnforceLicense(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return !!readLicenseToken();
}

export function licenseContact() {
  return LICENSE_CONTACT;
}

export function formatLicenseExpiry(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function licenseStatusMessage(status: LicenseStatus): string {
  if (status.ok) return 'License active';

  switch (status.reason) {
    case 'missing':
      return 'No license key is configured. Add LICENSE to your environment file.';
    case 'misconfigured':
      return 'License verification is not configured on this server (LICENSE_SIGNING_SECRET missing or too short).';
    case 'expired':
      return status.expiresAt
        ? `Your license expired on ${formatLicenseExpiry(status.expiresAt)}.`
        : 'Your license has expired.';
    case 'wrong_product':
      return 'This license key is not valid for this product.';
    default:
      return 'The license key is invalid or could not be verified.';
  }
}
