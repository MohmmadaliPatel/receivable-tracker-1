import type { UnifiedConfirmationRecord } from '@/lib/confirmation-repository';
import { toUnifiedRecord } from '@/lib/confirmation-repository';
import { loadTradeGroupRows } from '@/lib/trade-email-group';

const MAX_GROUP = 200;

/** All invoice rows for the JWT anchor (same custId/email group via emailThreadAnchorId). */
export async function listTradeQueryGroup(anchor: UnifiedConfirmationRecord): Promise<UnifiedConfirmationRecord[]> {
  const mod = anchor.module;
  if (mod !== 'trade_payable' && mod !== 'trade_receivable') {
    return [anchor];
  }

  const raw = await loadTradeGroupRows(anchor.id, mod);
  const sliced = raw.slice(0, MAX_GROUP);
  return sliced.map((r) => toUnifiedRecord(r, mod));
}
