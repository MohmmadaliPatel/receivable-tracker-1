# Environment Variables — Taxteck Email Auto

Copy [`env.ubuntu-server.example`](../env.ubuntu-server.example) to `.env` in the application directory on the server. Do not commit `.env` to version control.

Generate strong secrets:

```bash
openssl rand -base64 32
```

---

## Required (production)

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` on the server. |
| `DATABASE_URL` | SQLite path, e.g. `file:./dev.db`. Place the database file on a persistent volume. |
| `EMAIL_ACTION_JWT_SECRET` | **Required.** At least 32 random characters. Signs public confirmation magic links (HS256). Validated at startup; placeholder values are rejected. |
| `NEXT_PUBLIC_APP_BASE_URL` | **Required in production.** Public URL of the application (no trailing slash), e.g. `https://confirm.example.com`. Embedded at build time — changing it requires a rebuild. |
| `CRON_API_SECRET` | **Required in production.** Long random string. Protects `POST /api/cron` together with admin session checks. If unset, cron control is denied. |

---

## Microsoft Graph (EmailConfig)

Graph credentials are **not** environment variables. They are entered by an administrator in the application UI under **Email Config** after Entra app registration. See [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md).

---

## Security policy (optional — defaults apply if omitted)

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSWORD_MIN_LENGTH` | `12` | Minimum password length. |
| `PASSWORD_REQUIRE_UPPERCASE` | `true` | Require at least one uppercase letter. |
| `PASSWORD_REQUIRE_LOWERCASE` | `true` | Require at least one lowercase letter. |
| `PASSWORD_REQUIRE_DIGIT` | `true` | Require at least one digit. |
| `PASSWORD_REQUIRE_SPECIAL_CHAR` | `true` | Require at least one special character. |
| `LOCKOUT_MAX_ATTEMPTS` | `3` | Consecutive failed logins before lockout. |
| `LOCKOUT_DURATION_MINUTES` | `15` | Duration of temporary lockout. |
| `SESSION_MAX_AGE_DAYS` | `7` | Maximum session lifetime. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` | Idle timeout; session ends if inactive. |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Audit log retention before automatic purge. |
| `EMAIL_ACTION_LINK_EXPIRY_HOURS` | `12` | Public confirmation link lifetime in hours. Links stop working after this period. |

**Lockout escalation:** After three lockout events for the same account, the account requires an **administrator password reset** before login is allowed again (even after the 15-minute window).

---

## Operational

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | unset | If `true`, enables verbose diagnostic logging. Leave unset or `false` in production. |
| `FORCE_SEED` | unset | Only for controlled first-time admin bootstrap. See [DATABASE.md](DATABASE.md). |

---

## Reverse proxy

When TLS terminates at nginx or Caddy, forward these headers to Node:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For` (or `X-Real-IP`)

This ensures Secure cookies, correct audit IP addresses, and proper absolute URLs for public confirmation links.

---

## Startup validation

On server start, the application validates critical environment values before accepting traffic. Misconfiguration (missing JWT secret, placeholder secrets, `DEMO_MODE=true` in production, missing `NEXT_PUBLIC_APP_BASE_URL`) causes startup to fail with a clear error in the process logs.

See also: [DEPLOYMENT.md](DEPLOYMENT.md), [README.md](../README.md).
