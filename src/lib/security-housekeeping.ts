import { cleanupExpiredSessions } from './simple-auth';
import { purgeOldAuditLogs } from './audit-log';

let housekeepingInterval: NodeJS.Timeout | null = null;

export async function runSecurityHousekeeping(): Promise<void> {
  const sessions = await cleanupExpiredSessions();
  const audit = await purgeOldAuditLogs();
  console.log(`[Security] Housekeeping: removed ${sessions} sessions, ${audit} audit logs`);
}

export function startSecurityHousekeepingDaily(): void {
  if (housekeepingInterval) return;

  const dayMs = 24 * 60 * 60 * 1000;
  runSecurityHousekeeping().catch((e) =>
    console.error('[Security] Initial housekeeping failed:', e)
  );

  housekeepingInterval = setInterval(() => {
    runSecurityHousekeeping().catch((e) =>
      console.error('[Security] Scheduled housekeeping failed:', e)
    );
  }, dayMs);

  console.log('[Security] Daily housekeeping scheduled');
}
