import type { ModuleKey } from '@/lib/module-types';

/** URL segment under /api/modules/:segment/... */
export function parseModuleSegment(segment: string): ModuleKey | null {
  if (segment === 'trade-payables') return 'trade_payable';
  if (segment === 'trade-receivables') return 'trade_receivable';
  if (segment === 'confirm-msme') return 'confirm_msme';
  return null;
}
