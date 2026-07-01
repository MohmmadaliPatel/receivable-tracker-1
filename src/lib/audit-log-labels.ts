export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in attempt',
  LOGIN_LOCKED: 'Account locked (too many failed sign-ins)',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGE: 'Password changed',
  USER_CREATE: 'User account created',
  USER_UPDATE: 'User account updated',
  USER_DELETE: 'User account deleted',
  DATA_TRUNCATE: 'All application data cleared',
  EMAIL_CONFIG_CREATE: 'Email configuration added',
  EMAIL_CONFIG_UPDATE: 'Email configuration updated',
  EMAIL_CONFIG_DELETE: 'Email configuration removed',
  EMAIL_CONFIG_ACTIVATE: 'Email configuration activated',
  EMAIL_CONFIG_VALIDATE: 'Email configuration validated (Microsoft Graph test)',
  SETTINGS_UPDATE: 'Application settings updated',
  EMAIL_TEMPLATE_CREATE: 'Email template created',
  EMAIL_TEMPLATE_UPDATE: 'Email template updated',
  EMAIL_TEMPLATE_DELETE: 'Email template deleted',
  PUBLIC_RESPONSE_CONFIRM: 'External party confirmed (public link)',
  PUBLIC_RESPONSE_QUERY: 'External party submitted a query (public link)',
  PUBLIC_RESPONSE_DECLINE: 'External party declined (public link)',
  PUBLIC_RESPONSE_UPLOAD: 'External party uploaded a document (public link)',
  CRON_RELOAD: 'Scheduled email jobs reloaded',
  CRON_START: 'Scheduled email jobs started',
  CRON_STOP: 'Scheduled email jobs stopped',
  AUDIT_LOG_VIEW: 'Audit log viewed (admin)',
  AUDIT_LOG_EXPORT: 'Audit log exported (admin)',
  LOG_FILE_VIEW: 'Log file viewed (admin)',
  LOG_FILE_DOWNLOAD: 'Log file downloaded (admin)',
  LISTING_UPLOAD: 'Listing file uploaded',
  CSV_IMPORT: 'CSV data imported',
  RT_MASTER_UPLOAD: 'RT India master workbook uploaded',
  CONFIRMATION_CREATE: 'Confirmation record created',
  CONFIRMATION_UPDATE: 'Confirmation record updated',
  CONFIRMATION_DELETE: 'Confirmation record deleted',
  CONFIRMATION_RESET_RESPONSE: 'Confirmation response reset',
  EMAIL_SEND: 'Confirmation email sent',
  EMAIL_BULK_SEND: 'Bulk confirmation emails sent',
  EMAIL_FOLLOWUP: 'Follow-up email sent',
  EMAIL_BULK_FOLLOWUP: 'Bulk follow-up emails sent',
  ATTACHMENT_UPLOAD: 'Authority letter uploaded',
  ATTACHMENT_DELETE: 'Authority letter removed',
  ENTITY_ATTACHMENT_UPLOAD: 'Entity authority letter uploaded',
  REPORT_VIEW: 'Report viewed',
  REPORT_EXPORT: 'Report exported (CSV)',
  MODULE_EXPORT: 'Module data exported (CSV)',
  EMAIL_GENERIC_SEND: 'Email sent',
  EMAIL_REMINDER: 'Reminder email sent',
  EMAIL_FORWARD: 'Email forwarded',
};

export const LOG_FILE_DESCRIPTIONS: Record<string, string> = {
  'audit-fallback.log': 'Backup audit entries when the database write failed (JSON lines)',
  'received-emails.txt': 'Debug trace of incoming emails (only when DEBUG mode is on)',
  'recent-messages-for-replies.txt': 'Debug trace of inbox messages checked for replies (DEBUG mode)',
};

function moduleLabelFromDetails(details: Record<string, unknown>): string | null {
  if (typeof details.moduleLabel === 'string') return details.moduleLabel;
  if (typeof details.module === 'string') {
    switch (details.module) {
      case 'trade_payable':
        return 'Trade Payables';
      case 'trade_receivable':
        return 'Trade Receivables';
      case 'confirm_msme':
        return 'Confirm MSME';
      default:
        return details.module;
    }
  }
  return null;
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function auditActionCategory(action: string): string {
  if (action.startsWith('LOGIN_') || action === 'LOGOUT' || action === 'PASSWORD_CHANGE') return 'Sign-in & security';
  if (action.startsWith('USER_')) return 'Users';
  if (action.startsWith('EMAIL_CONFIG_')) return 'Email configuration';
  if (action.startsWith('EMAIL_TEMPLATE_')) return 'Email templates';
  if (action.startsWith('PUBLIC_RESPONSE_')) return 'Public responses';
  if (action.startsWith('CRON_')) return 'Scheduled jobs';
  if (action.startsWith('AUDIT_LOG_') || action.startsWith('LOG_FILE_')) return 'Logs & audit';
  if (action === 'SETTINGS_UPDATE') return 'Settings';
  if (action === 'DATA_TRUNCATE') return 'Data management';
  if (action.startsWith('LISTING_') || action === 'CSV_IMPORT' || action === 'RT_MASTER_UPLOAD' || action === 'MODULE_EXPORT') {
    return 'Uploads & imports';
  }
  if (action.startsWith('CONFIRMATION_')) return 'Confirmations';
  if (action.startsWith('EMAIL_') || action.startsWith('ATTACHMENT_') || action === 'ENTITY_ATTACHMENT_UPLOAD') {
    return 'Email & attachments';
  }
  if (action.startsWith('REPORT_')) return 'Reports';
  return 'Other';
}

export function formatAuditDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { raw: details };
  }
}

export function summarizeAuditDetails(action: string, details: Record<string, unknown> | null): string {
  if (!details) return '—';
  const parts: string[] = [];
  const mod = moduleLabelFromDetails(details);
  if (mod) parts.push(mod);

  if (typeof details.fileName === 'string') parts.push(`File: ${details.fileName}`);
  if (typeof details.entityName === 'string') parts.push(`Entity: ${details.entityName}`);
  if (typeof details.category === 'string') parts.push(`Category: ${details.category}`);
  if (typeof details.emailTo === 'string') parts.push(`To: ${details.emailTo}`);
  if (typeof details.recipient === 'string') parts.push(`To: ${details.recipient}`);
  if (typeof details.subject === 'string') parts.push(`Subject: ${details.subject}`);
  if (typeof details.configName === 'string') parts.push(`Mailbox: ${details.configName}`);
  if (typeof details.templateName === 'string') parts.push(`Template: ${details.templateName}`);
  if (typeof details.targetUsername === 'string') parts.push(`User: ${details.targetUsername}`);

  if (typeof details.imported === 'number') parts.push(`${details.imported} rows imported`);
  if (typeof details.created === 'number' && typeof details.updated === 'number') {
    parts.push(`${details.created} created, ${details.updated} updated`);
  }
  if (typeof details.sent === 'number') {
    parts.push(`${details.sent} sent`);
    if (typeof details.failed === 'number' && details.failed > 0) parts.push(`${details.failed} failed`);
  }
  if (typeof details.updatedCount === 'number') parts.push(`${details.updatedCount} records updated`);
  if (typeof details.recordCount === 'number') parts.push(`${details.recordCount} records`);
  if (typeof details.variant === 'string') parts.push(`Format: ${details.variant}`);

  if (typeof details.error === 'string') parts.push(`Error: ${details.error}`);
  if (typeof details.reason === 'string') parts.push(String(details.reason));

  if (parts.length === 0) {
    const skip = new Set(['format', 'page', 'limit', 'actionFilter', 'from', 'to']);
    const keys = Object.keys(details).filter((k) => !skip.has(k)).slice(0, 4);
    if (keys.length === 0) return '—';
    return keys.map((k) => `${k}: ${String(details[k])}`).join(' · ');
  }
  return parts.join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLogFileDescription(name: string): string {
  return LOG_FILE_DESCRIPTIONS[name] ?? 'Application log file on the server';
}
