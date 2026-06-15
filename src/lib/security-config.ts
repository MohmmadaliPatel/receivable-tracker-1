function parseIntEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

export const securityConfig = {
  passwordMinLength: parseIntEnv('PASSWORD_MIN_LENGTH', 12),
  passwordRequireUppercase: parseBoolEnv('PASSWORD_REQUIRE_UPPERCASE', true),
  passwordRequireLowercase: parseBoolEnv('PASSWORD_REQUIRE_LOWERCASE', true),
  passwordRequireDigit: parseBoolEnv('PASSWORD_REQUIRE_DIGIT', true),
  passwordRequireSpecialChar: parseBoolEnv('PASSWORD_REQUIRE_SPECIAL_CHAR', true),
  lockoutMaxAttempts: parseIntEnv('LOCKOUT_MAX_ATTEMPTS', 3),
  lockoutDurationMinutes: parseIntEnv('LOCKOUT_DURATION_MINUTES', 15),
  sessionMaxAgeDays: parseIntEnv('SESSION_MAX_AGE_DAYS', 7),
  sessionIdleTimeoutMinutes: parseIntEnv('SESSION_IDLE_TIMEOUT_MINUTES', 30),
  auditLogRetentionDays: parseIntEnv('AUDIT_LOG_RETENTION_DAYS', 90),
  cronApiSecret: process.env.CRON_API_SECRET || '',
};

export function sessionMaxAgeSeconds(): number {
  return securityConfig.sessionMaxAgeDays * 24 * 60 * 60;
}

export function sessionIdleTimeoutMs(): number {
  return securityConfig.sessionIdleTimeoutMinutes * 60 * 1000;
}
