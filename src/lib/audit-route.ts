import { NextRequest } from 'next/server';
import type { SessionData } from './simple-auth';
import { writeAuditLog, requestMeta, type AuditAction } from './audit-log';

export function moduleLabel(module: string | null | undefined): string {
  switch (module) {
    case 'trade_payable':
      return 'Trade Payables';
    case 'trade_receivable':
      return 'Trade Receivables';
    case 'confirm_msme':
      return 'Confirm MSME';
    default:
      return module || 'Unknown';
  }
}

export async function auditActivity(
  request: NextRequest,
  user: Pick<SessionData, 'userId' | 'username'>,
  action: AuditAction | string,
  opts: {
    success?: boolean;
    resource?: string | null;
    details?: Record<string, unknown> | null;
  } = {}
): Promise<void> {
  await writeAuditLog({
    action,
    success: opts.success ?? true,
    userId: user.userId,
    username: user.username,
    resource: opts.resource ?? null,
    ...requestMeta(request),
    details: opts.details ?? null,
  });
}

/** Actions that clutter the activity feed when admins browse logs themselves. */
export const META_AUDIT_ACTIONS = new Set([
  'AUDIT_LOG_VIEW',
  'LOG_FILE_VIEW',
]);
