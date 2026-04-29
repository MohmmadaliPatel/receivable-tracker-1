/** Internal module keys used in API and stored on module-specific confirmation rows (unified `module` field where applicable). */
export const MODULE_KEYS = ['trade_payable', 'trade_receivable', 'confirm_msme'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_ROUTE_TRADE_PAYABLE = 'trade-payables' as const;
export const MODULE_ROUTE_TRADE_RECEIVABLE = 'trade-receivables' as const;
export const MODULE_ROUTE_CONFIRM_MSME = 'confirm-msme' as const;
export type ModuleRouteSegment =
  | typeof MODULE_ROUTE_TRADE_PAYABLE
  | typeof MODULE_ROUTE_TRADE_RECEIVABLE
  | typeof MODULE_ROUTE_CONFIRM_MSME;

export const CATEGORY_TRADE_PAYABLES = 'Trade Payables';
export const CATEGORY_TRADE_RECEIVABLES = 'Trade Receivables';
export const CATEGORY_CONFIRM_MSME = 'Confirm MSME';

export function moduleRouteToKey(route: string): ModuleKey {
  switch (route) {
    case MODULE_ROUTE_TRADE_PAYABLE:
      return 'trade_payable';
    case MODULE_ROUTE_TRADE_RECEIVABLE:
      return 'trade_receivable';
    case MODULE_ROUTE_CONFIRM_MSME:
      return 'confirm_msme';
    default:
      throw new Error(`Unknown route: ${route}`);
  }
}

export function moduleKeyToRoute(key: ModuleKey): ModuleRouteSegment {
  if (key === 'trade_payable') return MODULE_ROUTE_TRADE_PAYABLE;
  if (key === 'trade_receivable') return MODULE_ROUTE_TRADE_RECEIVABLE;
  return MODULE_ROUTE_CONFIRM_MSME;
}

export function categoryForModule(key: ModuleKey): string {
  if (key === 'trade_payable') return CATEGORY_TRADE_PAYABLES;
  if (key === 'trade_receivable') return CATEGORY_TRADE_RECEIVABLES;
  return CATEGORY_CONFIRM_MSME;
}
