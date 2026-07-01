import { validateEnv } from '@/lib/validate-env';

export async function register() {
  // Run env validation as early as possible on Node startup (before cron/housekeeping or accepting requests).
  // Critical secrets and prod guards are enforced here (see lib/validate-env.ts for details + error messages).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    validateEnv();
    const { validateLicenseAtStartup } = await import('@/lib/validate-env');
    await validateLicenseAtStartup();

    const { cronService } = await import('@/lib/cron-service');
    const { startSecurityHousekeepingDaily } = await import('@/lib/security-housekeeping');

    console.log('🚀 [Instrumentation] Starting cron service...');
    cronService.start();

    startSecurityHousekeepingDaily();
  }
}

