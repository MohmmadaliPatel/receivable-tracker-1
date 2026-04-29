/**
 * Parse free-form INR amounts from SAP/Excel cells (commas, ₹, Cr/Lakh suffixes).
 * Returns null if nothing numeric can be extracted.
 */
export function parseInrAmountString(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  }

  s = s.replace(/₹/g, '');
  s = s.replace(/,/g, '');
  s = s.replace(/^(rs\.?|inr)\s*/i, '').trim();

  const lower = s.toLowerCase();
  let mult = 1;
  if (/(^|\s)(crore|crores)(\s|$)/.test(lower) || /\d[\d.,]*\s*cr(?:ore)?s?\b/.test(lower) || /\bcr\b/.test(lower)) {
    mult = 1e7;
    s = s.replace(/\b(crore|crores)\b/gi, '').replace(/\bcr(?:ore)?s?\b/gi, '');
  } else if (/(^|\s)(lakh|lakhs|lac|lacs)(\s|$)/.test(lower) || /\blakh\b/.test(lower) || /\blacs?\b/.test(lower)) {
    mult = 1e5;
    s = s.replace(/\b(lakh|lakhs|lac|lacs)\b/gi, '');
  }

  s = s.replace(/\s+/g, ' ').trim();
  const numMatch = s.match(/-?[\d.]+/);
  if (!numMatch) return null;
  const n = parseFloat(numMatch[0]);
  if (!Number.isFinite(n)) return null;
  const out = (negative ? -1 : 1) * n * mult;
  return out;
}

/** 100 crore (10^9) rupees and above: extended grouping + ₹ */
export const LARGE_AMOUNT_RUPEE_THRESHOLD = 1_000_000_000;

function formatIntegerIndianExtended(absRounded: number): string {
  const s = String(Math.abs(Math.trunc(absRounded)));
  if (s.length <= 3) return s;
  const parts: string[] = [s.slice(-3)];
  let rest = s.slice(0, -3);
  while (rest.length > 3) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) {
    parts.unshift(rest);
  }
  return parts.join(',');
}

/** Above 100 cr: extended grouping with ₹ for consistency with smaller INR amounts. */
function formatRupeeLarge(n: number): string {
  const rounded = Math.round(n);
  const neg = rounded < 0;
  const core = formatIntegerIndianExtended(rounded);
  return `${neg ? '-' : ''}₹${core}`;
}

const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatInrAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return '—';
  }
  if (Math.abs(Math.round(n)) >= LARGE_AMOUNT_RUPEE_THRESHOLD) {
    return formatRupeeLarge(n);
  }
  return inrFmt.format(Math.round(n));
}

const inrPlainFmt = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

export function formatIndianNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return '—';
  }
  const rounded = Math.round(n);
  if (Math.abs(rounded) >= LARGE_AMOUNT_RUPEE_THRESHOLD) {
    const neg = rounded < 0;
    return `${neg ? '-' : ''}${formatIntegerIndianExtended(rounded)}`;
  }
  return inrPlainFmt.format(rounded);
}

export function formatCurrencyCellDisplay(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return '—';
  const v = parseInrAmountString(raw);
  if (v !== null) return formatInrAmount(v);
  return String(raw).trim();
}

/** Parsed SAP-style line: non-negative → Debit, negative → Credit. */
export function debitCreditLabel(signed: number): 'Debit' | 'Credit' {
  return signed >= 0 ? 'Debit' : 'Credit';
}

export function formatDrCrAmountDisplay(raw: string | null | undefined): {
  amountText: string;
  dcLabel: string;
} {
  if (raw == null || !String(raw).trim()) return { amountText: '—', dcLabel: '—' };
  const v = parseInrAmountString(raw);
  if (v === null) return { amountText: String(raw).trim(), dcLabel: '—' };
  return {
    amountText: formatInrAmount(Math.abs(v)),
    dcLabel: debitCreditLabel(v),
  };
}

/** Net balance for display: absolute amount + Debit/Credit (no minus sign). */
export function formatNetSignedAsDrCr(net: number | null): string {
  if (net == null || !Number.isFinite(net)) return '—';
  if (net === 0) return `${formatInrAmount(0)} Debit`;
  const dc = debitCreditLabel(net);
  return `${formatInrAmount(Math.abs(net))} ${dc}`;
}

/**
 * Trade query page: the Amount column shows Dr/Cr with no minus sign (credit = negative in data).
 * User enters the magnitude on that same side: e.g. 2000 on a credit line is stored as -2000.
 * If the amount cannot be parsed, returns the trimmed input unchanged.
 */
export function signedBooksAmountStringForLine(
  userInput: string | undefined,
  lineCurrencyRaw: string | null | undefined
): string | undefined {
  const t = userInput?.trim();
  if (!t) return undefined;
  const mag = parseInrAmountString(t);
  if (mag === null) return t;
  const magnitude = Math.abs(mag);
  const lineVal = parseInrAmountString(lineCurrencyRaw);
  const isCreditLine = lineVal !== null && lineVal < 0;
  const signed = isCreditLine ? -magnitude : magnitude;
  return String(signed);
}
