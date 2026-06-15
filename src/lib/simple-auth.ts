import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { securityConfig, sessionIdleTimeoutMs, sessionMaxAgeSeconds } from './security-config';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SessionData {
  userId: string;
  username: string;
  name?: string;
  role: string;
  accessTradePayable: boolean;
  accessTradeReceivable: boolean;
  accessConfirmMsme: boolean;
}

export type VerifyCredentialsResult =
  | { success: true; userId: string }
  | { success: false; reason: 'invalid' | 'locked' | 'adminResetRequired' };

export function isUserLocked(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil > new Date();
}

export async function checkAccountLock(username: string): Promise<{ locked: boolean; userId?: string; reason?: 'temporary' | 'adminResetRequired' }> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, lockedUntil: true, adminResetRequired: true, lockoutCount: true },
  });
  if (!user) return { locked: false };

  // If admin reset is required, the account is locked regardless of the time-based lockedUntil.
  // This is the "third lockout" permanent state until an admin resets the password.
  if (user.adminResetRequired) {
    return { locked: true, userId: user.id, reason: 'adminResetRequired' };
  }

  if (isUserLocked(user.lockedUntil)) {
    return { locked: true, userId: user.id, reason: 'temporary' };
  }

  // Auto-clear only for time-based temporary locks (not when adminResetRequired).
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
    });
  }
  return { locked: false, userId: user.id };
}

export async function recordFailedLogin(username: string): Promise<{ locked: boolean }> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return { locked: false };

  const attempts = user.failedLoginAttempts + 1;
  const max = securityConfig.lockoutMaxAttempts;
  const data: { failedLoginAttempts: number; lockedUntil?: Date; lockoutCount?: number; adminResetRequired?: boolean } = {
    failedLoginAttempts: attempts,
  };

  if (attempts >= max) {
    const priorLockoutCount = user.lockoutCount ?? 0;
    const thisLockoutCount = priorLockoutCount + 1;
    const requireAdminReset = thisLockoutCount >= 3 || user.adminResetRequired === true;

    data.lockedUntil = new Date(
      Date.now() + securityConfig.lockoutDurationMinutes * 60 * 1000
    );
    data.lockoutCount = thisLockoutCount;
    if (requireAdminReset) {
      data.adminResetRequired = true;
    }

    await prisma.user.update({ where: { id: user.id }, data });
    return { locked: true };
  }

  await prisma.user.update({ where: { id: user.id }, data });
  return { locked: false };
}

export async function resetLoginAttempts(userId: string): Promise<void> {
  // On successful auth, clear the current failure/lock state so the user can proceed.
  // We intentionally leave lockoutCount (historical number of prior lock events) and only
  // clear adminResetRequired (which would have prevented success anyway).
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null, adminResetRequired: false },
  });
}

// Create a session token
export async function createSession(userId: string): Promise<string> {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionMaxAgeSeconds() * 1000);

  await prisma.session.create({
    data: {
      sessionToken,
      userId,
      expires,
      lastActivity: now,
    },
  });

  return sessionToken;
}

// Get session data; enforces max age and idle timeout
export async function getSession(sessionToken: string): Promise<SessionData | null> {
  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!session) return null;

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - sessionIdleTimeoutMs());
  const expired = session.expires < now;
  const idle = session.lastActivity < idleCutoff;

  if (expired || idle) {
    await prisma.session.delete({ where: { sessionToken } });
    return null;
  }

  await prisma.session.update({
    where: { sessionToken },
    data: { lastActivity: now },
  });

  const u = session.user;
  return {
    userId: session.userId,
    username: u.username,
    name: u.name || undefined,
    role: u.role || 'user',
    accessTradePayable: u.accessTradePayable ?? true,
    accessTradeReceivable: u.accessTradeReceivable ?? true,
    accessConfirmMsme: u.accessConfirmMsme ?? true,
  };
}

// Delete session
export async function deleteSession(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { sessionToken },
  });
}

// Verify login credentials (lockout handled by caller via checkAccountLock / recordFailedLogin)
export async function verifyCredentials(
  credentials: LoginCredentials
): Promise<VerifyCredentialsResult> {
  const lockCheck = await checkAccountLock(credentials.username);
  if (lockCheck.locked) {
    const reason = lockCheck.reason === 'adminResetRequired' ? 'adminResetRequired' : 'locked';
    return { success: false, reason };
  }

  const user = await prisma.user.findUnique({
    where: { username: credentials.username },
  });

  if (!user) {
    return { success: false, reason: 'invalid' };
  }

  const isValid = await bcrypt.compare(credentials.password, user.password);

  if (!isValid) {
    return { success: false, reason: 'invalid' };
  }

  await resetLoginAttempts(user.id);
  return { success: true, userId: user.id };
}

// Clean up expired and idle sessions
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - sessionIdleTimeoutMs());
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expires: { lt: now } }, { lastActivity: { lt: idleCutoff } }],
    },
  });
  return result.count;
}
