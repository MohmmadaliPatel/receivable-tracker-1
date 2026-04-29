import type { SessionData } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncMsmeFromPartyMasters } from '@/lib/msme-sync-from-tr';

/** After vendor/supplier master mutations, refresh Confirm MSME for this user when they have access. */
export async function maybeHydrateMsmeFromPartyMasters(
  user: SessionData
): Promise<{ upserted: number; fromVendors: number } | null> {
  if (!userCanAccessModule(user, 'confirm_msme')) return null;
  return syncMsmeFromPartyMasters(user.userId);
}
