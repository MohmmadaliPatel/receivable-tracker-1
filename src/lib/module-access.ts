import type { SessionData } from '@/lib/simple-auth';
import type { ModuleKey } from '@/lib/module-types';

export function userCanAccessModule(session: SessionData, key: ModuleKey): boolean {
  if (session.role === 'admin') return true;
  if (key === 'trade_payable') return session.accessTradePayable;
  if (key === 'trade_receivable') return session.accessTradeReceivable;
  if (key === 'confirm_msme') return session.accessConfirmMsme;
  return false;
}

/** First module URL the user may open (TP, then TR, then MSME). */
export function firstAllowedModuleHref(session: SessionData): string | null {
  if (session.role === 'admin' || session.accessTradePayable) return '/trade-payables';
  if (session.accessTradeReceivable) return '/trade-receivables';
  if (session.accessConfirmMsme) return '/confirm-msme';
  return null;
}

export function canMutateRecord(session: SessionData, recordModule: string | null): boolean {
  if (session.role === 'admin') return true;
  if (!recordModule) return false;
  if (recordModule === 'trade_payable') return session.accessTradePayable;
  if (recordModule === 'trade_receivable') return session.accessTradeReceivable;
  if (recordModule === 'confirm_msme') return session.accessConfirmMsme;
  return false;
}
