import { findUnifiedByModuleClaim } from '@/lib/confirmation-repository';
import { verifyEmailActionToken, type EmailActionTokenTyp } from '@/lib/email-action-jwt';
import type { UnifiedConfirmationRecord } from '@/lib/confirmation-repository';
import type { ModuleKey } from '@/lib/module-types';

export type VerifiedPublicGate =
  | {
      ok: true;
      record: UnifiedConfirmationRecord;
      consumed: boolean;
    }
  | { ok: false; status: number; message: string };

export async function verifyPublicConfirmationToken(
  token: string | null | undefined,
  expectedTyp: EmailActionTokenTyp
): Promise<VerifiedPublicGate> {
  if (!token || typeof token !== 'string') {
    return { ok: false, status: 400, message: 'Missing token' };
  }
  try {
    const claims = await verifyEmailActionToken(token);
    if (claims.typ !== expectedTyp) {
      return { ok: false, status: 403, message: 'Invalid link' };
    }

    const mod = claims.mod as ModuleKey;
    const record = await findUnifiedByModuleClaim(claims.sub!, mod);

    if (!record) {
      return { ok: false, status: 404, message: 'Not found' };
    }

    if (record.emailActionNonce !== claims.nonce) {
      return { ok: false, status: 403, message: 'This link is no longer valid' };
    }

    return { ok: true, record, consumed: !!record.emailActionConsumedAt };
  } catch {
    return { ok: false, status: 401, message: 'Invalid or expired link' };
  }
}
