/**
 * Centralized debug / prod guard for logging and debug file writes.
 * Use to protect against PII leakage in production logs/ and console.
 *
 * - In production (NODE_ENV=production and no DEBUG=true), sensitive details (tokens, full bodies, recipient lists, subjects, previews) should be omitted or guarded.
 * - Operator should rotate/ship or disable logs/ (see client security confirmation docs for retention & PII notes; logs/ may contain email metadata/PII/subjects/recipients/previews — not auto-purged).
 * - fs debug blocks (INSERT_YOUR_CODE etc) are now behind this guard and never run in prod by default.
 * - Recommended: logrotate or external SIEM redaction for prod; set DEBUG=false or omit in prod .env.
 */
export const isDebug = (): boolean => {
  return process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';
};

/**
 * Safe console logger that drops detailed args in prod unless debug.
 * Use for high-volume or PII-bearing logs from Graph/email paths.
 */
export function debugLog(...args: unknown[]): void {
  if (isDebug()) {
    console.log(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebug()) {
    console.warn(...args);
  }
}
