import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { ModuleKey } from '@/lib/module-types';
import { securityConfig } from '@/lib/security-config';

const ALG = 'HS256';

export type EmailActionTokenTyp = 'trade' | 'msme';

export interface EmailActionClaims extends JWTPayload {
  nonce: string;
  mod: ModuleKey;
  typ: EmailActionTokenTyp;
}

function secretKey(): Uint8Array {
  const s = process.env.EMAIL_ACTION_JWT_SECRET?.trim();
  if (!s || s.length < 32) {
    throw new Error('EMAIL_ACTION_JWT_SECRET must be set to a string of at least 32 characters');
  }
  return new TextEncoder().encode(s);
}

/** Mint a recipient-facing JWT tied to anchor record id and issuance nonce */
export async function signEmailActionToken(args: {
  recordId: string;
  nonce: string;
  module: ModuleKey;
  typ: EmailActionTokenTyp;
}): Promise<string> {
  const key = secretKey();
  return new SignJWT({
    nonce: args.nonce,
    mod: args.module,
    typ: args.typ,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(args.recordId)
    .setIssuedAt()
    .setExpirationTime(`${securityConfig.emailActionLinkExpiryHours}h`)
    .sign(key);
}

export async function verifyEmailActionToken(token: string): Promise<EmailActionClaims> {
  const key = secretKey();
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
  });
  if (!payload.sub || typeof payload.nonce !== 'string' || typeof payload.mod !== 'string' || typeof payload.typ !== 'string') {
    throw new Error('Invalid token payload');
  }
  return payload as EmailActionClaims;
}
