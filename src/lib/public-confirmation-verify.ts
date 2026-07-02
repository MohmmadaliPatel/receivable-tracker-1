import {
  findUnifiedByModuleClaim,
  fetchEmailActionGateFields,
  patchConfirmationRaw,
} from '@/lib/confirmation-repository';
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

  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { ok: false, status: 400, message: 'Missing token' };
  }

  try {
    const claims = await verifyEmailActionToken(normalizedToken);
    if (claims.typ !== expectedTyp) {
      return { ok: false, status: 403, message: 'Invalid link' };
    }

    const mod = claims.mod as ModuleKey;
    const recordId = claims.sub!;
    const gateFields = await fetchEmailActionGateFields(recordId, mod);

    if (!gateFields) {
      return { ok: false, status: 404, message: 'Not found' };
    }

    const storedNonce = gateFields.emailActionNonce?.trim() || null;
    const claimNonce = claims.nonce.trim();
    const consumed = !!gateFields.emailActionConsumedAt;

    if (storedNonce && storedNonce !== claimNonce) {
      return { ok: false, status: 403, message: 'This link is no longer valid' };
    }

    if (!storedNonce && !consumed) {
      // Email was sent with this nonce but DB was not updated (legacy send or failed patch).
      await patchConfirmationRaw(mod, recordId, {
        emailActionNonce: claimNonce,
        emailActionConsumedAt: null,
      });
    }

    const record = await findUnifiedByModuleClaim(recordId, mod);
    if (!record) {
      return { ok: false, status: 404, message: 'Not found' };
    }

    return { ok: true, record, consumed };
  } catch {
    return { ok: false, status: 401, message: 'Invalid or expired link' };
  }
}
