import type { SessionData } from '@/lib/simple-auth';
import { userCanAccessModule } from '@/lib/module-access';
import { syncTpFromVendorMaster } from '@/lib/tp-sync-from-vendor';

/** After vendor master mutations, refresh Trade Payable anchors for this user when they have access. */
export async function maybeHydrateTpFromPartyMasters(
  user: SessionData
): Promise<{ upserted: number } | null> {
  if (!userCanAccessModule(user, 'trade_payable')) return null;
  return syncTpFromVendorMaster(user.userId);
}
