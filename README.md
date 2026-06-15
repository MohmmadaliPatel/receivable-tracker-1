# Taxteck Email Auto — Audit Confirmation Management

Next.js application for audit confirmation email workflows: Trade Payables, Trade Receivables, and MSME confirmations. Sends and tracks mail via Microsoft Graph, with role-based access and security audit logging.

**Default port:** 3002

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Production deployment** — install, configure, start, verify |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | **Environment variables** — full reference |
| [docs/DATABASE.md](docs/DATABASE.md) | Database migrations, seed, backup |
| [docs/client-confirmation/CLIENT-SECURITY-CONFIRMATION-SECTIONS-1-2-3-5-7.md](docs/client-confirmation/CLIENT-SECURITY-CONFIRMATION-SECTIONS-1-2-3-5-7.md) | Client security questionnaire (sections 1, 2, 3, 5, 7) + controls matrix |
| [docs/client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](docs/client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md) | Microsoft Entra setup for EmailConfig |
| [docs/client-confirmation/04-vulnerability-and-secure-coding-validation.md](docs/client-confirmation/04-vulnerability-and-secure-coding-validation.md) | OWASP alignment, secure coding |
| [docs/client-confirmation/PATCH-MANAGEMENT.md](docs/client-confirmation/PATCH-MANAGEMENT.md) | Patch and update process |
| [docs/client-confirmation/dependency-scan-instructions.md](docs/client-confirmation/dependency-scan-instructions.md) | Dependency scan (`npm audit`) |

Configuration template: [`env.ubuntu-server.example`](env.ubuntu-server.example)

---

## Quick start (production)

```bash
cd /opt/taxteck-email-auto          # application directory
cp env.ubuntu-server.example .env   # edit with production values (see below)
npm ci --omit=dev                   # if dependencies not bundled
npm run db:migrate                  # first deploy / after updates
FORCE_SEED=1 npm run db:seed        # first admin only — note the printed password
npm start                           # or PM2 / systemd
```

Sign in at your public URL, **change the password immediately**, then configure EmailConfig using the [Entra guide](docs/client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md).

Full steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## Environment variables

Copy [`env.ubuntu-server.example`](env.ubuntu-server.example) to `.env`. Full reference: [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

### Required (production)

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Runtime mode | `production` |
| `DATABASE_URL` | SQLite path (persistent volume) | `file:./dev.db` |
| `EMAIL_ACTION_JWT_SECRET` | Public link signing key (≥32 random chars) | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_BASE_URL` | Public app URL (embedded at build time) | `https://confirm.example.com` |
| `CRON_API_SECRET` | Protects cron API (Bearer token) | `openssl rand -base64 32` |

### Security policy (defaults shown)

| Variable | Default |
|----------|---------|
| `PASSWORD_MIN_LENGTH` | `12` |
| `PASSWORD_REQUIRE_UPPERCASE` | `true` |
| `PASSWORD_REQUIRE_LOWERCASE` | `true` |
| `PASSWORD_REQUIRE_DIGIT` | `true` |
| `PASSWORD_REQUIRE_SPECIAL_CHAR` | `true` |
| `LOCKOUT_MAX_ATTEMPTS` | `3` |
| `LOCKOUT_DURATION_MINUTES` | `15` |
| `SESSION_MAX_AGE_DAYS` | `7` |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` |
| `AUDIT_LOG_RETENTION_DAYS` | `90` |

**Lockout:** 3 failed logins → 15-minute lock. On the **third lockout event**, an administrator must reset the password before login is allowed again.

### Microsoft Graph credentials

Graph tenant ID, client ID, and client secret are **not** environment variables. Enter them in the admin UI under **Email Config** after Entra app registration.

### Reverse proxy headers

When TLS terminates at nginx or Caddy, forward `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` so session cookies and audit IP logging work correctly.

### Startup validation

The application validates critical environment values on start. Missing or placeholder secrets, `DEMO_MODE=true` in production, or missing `NEXT_PUBLIC_APP_BASE_URL` cause startup to fail with an error in the process logs.

---

## Production deployment checklist

1. Ubuntu (or Linux) with Node 20+ and Puppeteer/Chromium libraries ([DEPLOYMENT.md](docs/DEPLOYMENT.md))
2. Persistent volume for SQLite, `emails/`, `uploads/`, `logs/`
3. Configure `.env` from `env.ubuntu-server.example`
4. `npm ci --omit=dev` (if needed)
5. `npm run db:migrate`
6. First admin: `FORCE_SEED=1 npm run db:seed` (one time)
7. `npm start` or process manager — **single instance only**
8. Reverse proxy with TLS and forwarded headers
9. Admin login → change password → EmailConfig (Entra) → Validate → Activate
10. Create Sender → send test confirmation → verify audit logs
11. Configure logrotate for `logs/`; schedule database backup

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run production server (port 3002) |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Bootstrap first admin (`FORCE_SEED=1` in production) |
| `npm audit --audit-level=moderate` | Dependency vulnerability scan |

---

## Technology

- Next.js 15, React 19, TypeScript, Prisma 6, SQLite
- Authentication: username/password sessions with bcrypt, lockout, RBAC
- Email: Microsoft Graph client-credentials (app-only)

---

## Security summary

- Password policy enforced (12+ chars, complexity, bcrypt cost 12)
- Account lockout with admin-reset escalation on third lockout
- Session idle timeout (30 min) and max age (7 days)
- RBAC: admin vs user with module-level access flags
- Audit logging for authentication, configuration, and public responses
- HTTP security headers (CSP, X-Frame-Options, nosniff)
- Cron API protected by secret + admin role
- Graph secrets masked in admin API responses
- Public links signed with HS256 JWT

Details: [client security confirmation](docs/client-confirmation/CLIENT-SECURITY-CONFIRMATION-SECTIONS-1-2-3-5-7.md)
