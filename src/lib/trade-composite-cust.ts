/** Company + party composite key for TP/TR (delimiter must not appear in SAP codes). */
export const TRADE_COMPOSITE_SEP = '||';

function normalizeSegment(raw: string): string {
  return String(raw).trim().replace(/\.0+$/, '');
}

/** Normalize full custId: each segment trimmed like SAP codes (matches normalizeSapCode per part). */
export function normalizeTradeCustId(raw: string): string {
  const s = String(raw).trim();
  if (!s) return '';
  if (!s.includes(TRADE_COMPOSITE_SEP)) return normalizeSegment(s);
  return s.split(TRADE_COMPOSITE_SEP).map(normalizeSegment).filter(Boolean).join(TRADE_COMPOSITE_SEP);
}

/** Build stored custId from company code + vendor/customer name; company-only if party empty. */
export function buildTradeCompositeCustId(company: string, party?: string | null): string | undefined {
  const c = normalizeSegment(company);
  if (!c) return undefined;
  const p = party != null && String(party).trim() ? normalizeSegment(String(party)) : '';
  if (!p) return c;
  return `${c}${TRADE_COMPOSITE_SEP}${p}`;
}
