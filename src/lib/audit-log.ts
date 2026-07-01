import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { securityConfig } from './security-config';

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGOUT'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'DATA_TRUNCATE'
  | 'EMAIL_CONFIG_CREATE'
  | 'EMAIL_CONFIG_UPDATE'
  | 'EMAIL_CONFIG_DELETE'
  | 'EMAIL_CONFIG_ACTIVATE'
  | 'EMAIL_CONFIG_VALIDATE'
  | 'SETTINGS_UPDATE'
  | 'EMAIL_TEMPLATE_CREATE'
  | 'EMAIL_TEMPLATE_UPDATE'
  | 'EMAIL_TEMPLATE_DELETE'
  | 'PUBLIC_RESPONSE_CONFIRM'
  | 'PUBLIC_RESPONSE_QUERY'
  | 'PUBLIC_RESPONSE_DECLINE'
  | 'PUBLIC_RESPONSE_UPLOAD'
  | 'CRON_RELOAD'
  | 'CRON_START'
  | 'CRON_STOP'
  | 'AUDIT_LOG_VIEW'
  | 'AUDIT_LOG_EXPORT'
  | 'LOG_FILE_VIEW'
  | 'LOG_FILE_DOWNLOAD'
  | 'PASSWORD_CHANGE'
  | 'LISTING_UPLOAD'
  | 'CSV_IMPORT'
  | 'RT_MASTER_UPLOAD'
  | 'CONFIRMATION_CREATE'
  | 'CONFIRMATION_UPDATE'
  | 'CONFIRMATION_DELETE'
  | 'CONFIRMATION_RESET_RESPONSE'
  | 'EMAIL_SEND'
  | 'EMAIL_BULK_SEND'
  | 'EMAIL_FOLLOWUP'
  | 'EMAIL_BULK_FOLLOWUP'
  | 'ATTACHMENT_UPLOAD'
  | 'ATTACHMENT_DELETE'
  | 'ENTITY_ATTACHMENT_UPLOAD'
  | 'REPORT_VIEW'
  | 'REPORT_EXPORT'
  | 'MODULE_EXPORT'
  | 'EMAIL_GENERIC_SEND'
  | 'EMAIL_REMINDER'
  | 'EMAIL_FORWARD';

export interface AuditLogInput {
  action: AuditAction | string;
  success?: boolean;
  userId?: string | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  resource?: string | null;
  details?: Record<string, unknown> | null;
}

export function requestMeta(request: NextRequest): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  const userAgent = request.headers.get('user-agent');
  return { ip, userAgent };
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        success: input.success ?? true,
        userId: input.userId ?? null,
        username: input.username ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        resource: input.resource ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  } catch (err) {
    // Fail-open for availability, but for high-risk actions (per client questionnaire section 7) we log loudly
    // and also append to a local fallback file so operator/SIEM can still capture if DB write fails.
    // High-risk: auth, pw, user mgmt, data truncate, email config, templates, cron, public responses, audit access.
    const highRisk = /^(LOGIN_|LOGOUT|PASSWORD_CHANGE|USER_|DATA_TRUNCATE|EMAIL_CONFIG_|EMAIL_TEMPLATE_|PUBLIC_RESPONSE_|CRON_|AUDIT_LOG_|LOG_FILE_)/.test(String(input.action));
    const msg = `[AuditLog] Failed to write action=${input.action} success=${input.success ?? true}: ${err}`;
    console.error(msg);
    if (highRisk) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const fb = path.join(dir, 'audit-fallback.log');
        const line = JSON.stringify({ ts: new Date().toISOString(), action: input.action, err: String(err), input }) + '\n';
        fs.appendFileSync(fb, line, 'utf8');
      } catch {}
      // Note: client 7 requires reliable audit; this fallback + the daily purge in housekeeping provide evidence trail even on transient DB issues.
      // TODO: consider surfacing a health metric or alerting on repeated failures.
    }
  }
}

export async function purgeOldAuditLogs(): Promise<number> {
  const cutoff = new Date(
    Date.now() - securityConfig.auditLogRetentionDays * 24 * 60 * 60 * 1000
  );
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    console.log(`[AuditLog] Purged ${result.count} entries older than ${securityConfig.auditLogRetentionDays} days`);
  }
  return result.count;
}

export async function exportAuditLogsJson(options: {
  from?: Date;
  to?: Date;
  action?: string;
  limit?: number;
}): Promise<string> {
  const where: {
    createdAt?: { gte?: Date; lte?: Date };
    action?: string;
  } = {};
  if (options.from || options.to) {
    where.createdAt = {};
    if (options.from) where.createdAt.gte = options.from;
    if (options.to) where.createdAt.lte = options.to;
  }
  if (options.action) where.action = options.action;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 1000,
  });

  return rows.map((r) => JSON.stringify(r)).join('\n');
}
