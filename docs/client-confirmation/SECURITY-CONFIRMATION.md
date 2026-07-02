# Taxteck Email Auto — Client Security Confirmation

**Sections:** 1 Basic Application Information · 2 Authentication & Access Control · 3 Data Security · 5 Server-Level Requirements · 7 Audit & Monitoring (brief)

**Date:** 2026-06-10  
**Application:** Taxteck Email Auto (Next.js 15 / React 19 / TypeScript / Prisma 6 / SQLite)

**Related documentation:**

| Document | Purpose |
|----------|---------|
| [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md) | Entra app registration and EmailConfig credentials |
| [04-vulnerability-and-secure-coding-validation.md](04-vulnerability-and-secure-coding-validation.md) | OWASP alignment, dependency scanning |
| [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md) | Update and patch process |
| [dependency-scan-instructions.md](dependency-scan-instructions.md) | How to run and archive `npm audit` |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Production deployment |
| [../ENVIRONMENT.md](../ENVIRONMENT.md) | Environment variables |
| [../DATABASE.md](../DATABASE.md) | Database setup and backup |

---

## 1. Basic Application Information

**Purpose**  
Automated audit confirmation email workflows for Trade Payables, Trade Receivables, and MSME. The application sends and tracks emails via Microsoft Graph (app-only client credentials), captures public responses through signed links, forwards and threads replies where configured, and records security-relevant actions in an audit trail.

**Deployment model**  
Single Node.js instance on Ubuntu (or equivalent Linux), default port **3002**, behind a TLS-terminating reverse proxy. SQLite database and operational directories (`emails/`, `uploads/`, `logs/`) on a persistent volume. One instance only — background email processing runs in-process.

**Technology (security-relevant)**

| Layer | Technology |
|-------|------------|
| Web framework | Next.js 15 App Router |
| Database | SQLite via Prisma 6 |
| Admin authentication | Username/password, bcrypt, server-side sessions |
| Email integration | Microsoft Graph client-credentials (app-only) |
| Public response links | HS256-signed JWTs with nonce and consume-on-use |
| Audit | SQLite `audit_logs` table + optional fallback file |

**Data processed**  
Usernames, names, email addresses, confirmation content, uploaded files, audit metadata (IP address, user agent, action type). Microsoft Graph credentials are stored per EmailConfig in the database and masked in admin read responses.

**External dependencies**  
Outbound HTTPS to `login.microsoftonline.com` and `graph.microsoft.com` only for email operations. No other third-party data processors in the core workflow.

---

## 2. Authentication & Access Control

### Password policy

Enforced on user creation, self-service change, and administrator password reset.

| Rule | Default |
|------|---------|
| Minimum length | 12 characters |
| Uppercase letter | Required |
| Lowercase letter | Required |
| Digit | Required |
| Special character | Required |

Configurable via environment variables (see [ENVIRONMENT.md](../ENVIRONMENT.md)). Passwords are hashed with **bcrypt cost 12**. Plaintext passwords are never stored or logged.

### Account lockout

| Setting | Default | Behavior |
|---------|---------|----------|
| `LOCKOUT_MAX_ATTEMPTS` | 3 | Failed logins before lockout |
| `LOCKOUT_DURATION_MINUTES` | 15 | Temporary lock duration |

**Flow:**

1. Each failed login increments a per-user failure counter.
2. After **3 consecutive failures**, the account is locked for **15 minutes** (`423 Locked`).
3. After the lockout period expires, the user may attempt login again (counter resets on success).
4. **Escalation:** On the **third lockout event** (lifetime counter), `adminResetRequired` is set. The account cannot be unlocked by time alone — an **administrator must reset the password** via User Management. Admin reset clears all lockout state and invalidates the user's sessions.

**Audit:** All outcomes (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`) are recorded with username, IP, and user agent.

### Session management

| Control | Default | Protection |
|---------|---------|------------|
| Session token | 32-byte random hex | Session fixation / guessing |
| Max session age | 7 days | Long-lived session abuse |
| Idle timeout | 30 minutes | Unattended workstation access |
| Cookie flags | `httpOnly`, `Secure` (TLS), `sameSite=lax` | XSS theft, MITM |

Sessions are stored server-side with `expires` and `lastActivity`. Expired or idle sessions are deleted on access.

**Password change:** Self-service change requires the current password. On success, all other sessions for that user are invalidated. Administrator password reset invalidates **all** sessions for the target user.

### Role-based access control (RBAC)

| Role | Capabilities |
|------|--------------|
| **admin** | User management, EmailConfig, templates, audit export, data truncate, cron control |
| **user** | Module-scoped confirmation workflows per assigned flags |

Module flags: `accessTradePayable`, `accessTradeReceivable`, `accessConfirmMsme`.

Non-administrators cannot access user APIs, EmailConfig, cron endpoints, or audit export.

### Cron and privileged API protection

| Layer | Control |
|-------|---------|
| Middleware | `/api/cron` denied if `CRON_API_SECRET` unset; when set, only exact `Authorization: Bearer` match (no session fallback) |
| Route | Administrator session required (`403` if not admin) |
| Audit | `CRON_START`, `CRON_STOP`, `CRON_RELOAD` logged |

### Startup validation

Before accepting traffic, the application validates:

- `EMAIL_ACTION_JWT_SECRET` present, ≥32 characters, not a placeholder
- Production: `DEMO_MODE` not true; `NEXT_PUBLIC_APP_BASE_URL` set
- Production: warns if `CRON_API_SECRET` absent

Critical misconfiguration causes startup failure (visible in process manager logs).

---

## 3. Data Security

### Encryption in transit

- TLS terminated at reverse proxy (nginx/Caddy).
- All Graph API and token requests over HTTPS.
- Session cookies marked `Secure` when accessed via HTTPS.

### HTTP security headers (all responses)

| Header | Value | Protects against |
|--------|-------|------------------|
| `X-Content-Type-Options` | `nosniff` | MIME sniffing |
| `X-Frame-Options` | `DENY` | Clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer leakage |
| `Permissions-Policy` | camera/mic/geo disabled | Unnecessary browser API access |
| `Content-Security-Policy` | Restrictive default; Graph domains allowed for connect | XSS, unauthorized resource load |

### Secrets and credentials

| Secret | Storage | Exposure control |
|--------|---------|------------------|
| User passwords | bcrypt hash in SQLite | Never returned in APIs |
| `EMAIL_ACTION_JWT_SECRET` | Environment only | Startup validation; min 32 chars |
| `CRON_API_SECRET` | Environment only | Required for cron API |
| Graph `msClientSecret` | EmailConfig row | Masked (`***`) on admin GET; shown once on create |
| Session token | httpOnly cookie + DB row | Not accessible to JavaScript |

Graph uses **client-credentials** flow only — no delegated user tokens or refresh tokens stored.

### Public confirmation links

- Signed with `EMAIL_ACTION_JWT_SECRET` (HS256).
- Claims include nonce; tokens are verified and consumed (one-time use on response).
- Link lifetime defaults to **12 hours**; configurable via `EMAIL_ACTION_LINK_EXPIRY_HOURS`.
- All public actions audited as `PUBLIC_RESPONSE_*` with IP and user agent.

### Data at rest

SQLite file and attachment directories reside on operator-managed storage. Application-layer field encryption is not applied to EmailConfig secrets — protect via filesystem permissions and volume encryption (LUKS, cloud disk encryption). Regular backup of database and `emails/` / `uploads/` is operator responsibility.

### Operational logging

Production logging omits tokens, secrets, and detailed recipient lists unless `DEBUG=true`. Configure log rotation for `logs/`; audit fallback file captures high-risk events if database write fails.

---

## 5. Server-Level Requirements

| Requirement | Specification |
|-------------|---------------|
| OS | Ubuntu 22.04+ or equivalent Linux |
| Node.js | 20+ |
| RAM | 2 GB minimum; 4 GB+ recommended (Puppeteer PDF spikes) |
| Disk | Persistent volume for SQLite, emails, uploads, logs |
| Inbound ports | 443 (proxy) → 3002 (app, localhost only) |
| Outbound | HTTPS to Microsoft identity and Graph endpoints |
| Process model | Single instance (PM2/systemd) |
| Reverse proxy | Required for TLS; must forward `X-Forwarded-*` headers |
| Health endpoint | Not provided — monitor via process manager |
| PDF generation | Chromium runtime libraries (see [DEPLOYMENT.md](../DEPLOYMENT.md)) |

**Database setup:** `npm run db:migrate` on first deploy and after updates. See [DATABASE.md](../DATABASE.md).

**Build-time URL:** `NEXT_PUBLIC_APP_BASE_URL` is embedded at build time. Public confirmation links use this value.

---

## 7. Audit & Monitoring (Brief)

**Capability:** Yes — structured audit logging with administrator export.

### Audit action catalog

`LOGIN_SUCCESS` · `LOGIN_FAILED` · `LOGIN_LOCKED` · `LOGOUT` · `PASSWORD_CHANGE` · `USER_CREATE` · `USER_UPDATE` · `USER_DELETE` · `DATA_TRUNCATE` · `EMAIL_CONFIG_CREATE` · `EMAIL_CONFIG_UPDATE` · `EMAIL_CONFIG_DELETE` · `EMAIL_CONFIG_ACTIVATE` · `EMAIL_CONFIG_VALIDATE` · `SETTINGS_UPDATE` · `EMAIL_TEMPLATE_CREATE` · `EMAIL_TEMPLATE_UPDATE` · `EMAIL_TEMPLATE_DELETE` · `PUBLIC_RESPONSE_CONFIRM` · `PUBLIC_RESPONSE_QUERY` · `PUBLIC_RESPONSE_DECLINE` · `PUBLIC_RESPONSE_UPLOAD` · `CRON_START` · `CRON_STOP` · `CRON_RELOAD` · `AUDIT_LOG_VIEW` · `AUDIT_LOG_EXPORT`

Each entry includes timestamp, action, success flag, user identity (if applicable), IP, user agent, resource identifier, and optional JSON details.

### Retention and export

- Default retention: **90 days** (`AUDIT_LOG_RETENTION_DAYS`); purged daily by housekeeping job.
- Export: Administrators access `/api/admin/audit-logs` (JSON paginated or NDJSON stream). View and export actions are self-audited.
- SIEM: No built-in forwarder — export or ship `audit_logs` table and `logs/audit-fallback.log` via operator tooling.

### High-risk fallback

If database audit write fails for high-risk actions (authentication, user management, configuration, cron, public responses, audit access), the event is logged to console and appended to `logs/audit-fallback.log`.

---

## Security Controls Matrix

Each row maps a **threat** to the **control** implemented and **how to verify** it in a deployed environment.

| Threat | Control | Verification |
|--------|---------|--------------|
| Brute-force password guessing | 3-attempt lockout, 15-minute lock; third lifetime lockout requires admin reset | Fail login 3 times → 423; after third lockout cycle → admin reset message persists |
| Weak passwords | Policy: 12+ chars, upper, lower, digit, special | Create user with weak password → rejected |
| Credential stuffing / session hijack | httpOnly Secure cookies; idle 30m + max 7d session | Inspect `Set-Cookie`; wait idle → session ends |
| Unauthorized API access | Middleware session check on all non-public `/api/*` | Call protected API without cookie → 401 |
| Privilege escalation (user → admin) | `requireAdminSession` on admin routes | Non-admin POST to `/api/users` → 403 |
| Unauthorized cron manipulation | `CRON_API_SECRET` Bearer + admin session | POST `/api/cron` without secret → 401; as user → 403 |
| Self-service password change without proof | Current password required | Omit current password → 400 |
| Stale sessions after password change | Other sessions deleted on pw change | Change password; old cookie invalid |
| Secret exposure via admin API | Graph client secret masked on GET | List EmailConfig → secret shows `***` |
| Forged public confirmation links | HS256 JWT with secret ≥32 chars; nonce consume | Tamper with link token → rejected |
| Replay of public responses | JWT nonce consumed after use | Submit same link twice → second fails |
| Graph token theft from logs | Production debug logging disabled | No tokens in logs with `DEBUG` unset |
| Clickjacking | `X-Frame-Options: DENY` | `curl -I` response headers |
| XSS / MIME confusion | CSP + `X-Content-Type-Options: nosniff` | Inspect response headers |
| Misconfiguration in production | Startup `validateEnv()` | Start with placeholder JWT → process exits |
| Undetected admin actions | Audit log with IP/UA | Perform action → visible in audit export |
| Audit log loss on DB failure | Fallback append to `logs/audit-fallback.log` | Simulated DB failure on audit write → fallback line |
| Unauthorized email sending | Graph app-only; credentials per EmailConfig; admin-only config UI | Non-admin cannot create EmailConfig |
| Mail relay abuse via Graph | Least-privilege Entra permissions (Mail.Send/Read/ReadWrite, User.Read) | Entra portal shows only four app permissions |

---

## Residual risks and operator responsibilities

| Area | Responsibility |
|------|----------------|
| SQLite encryption at rest | Operator — volume/filesystem encryption |
| EmailConfig secrets in DB | Operator — file permissions, backup protection |
| Log PII | Operator — logrotate, SIEM redaction; do not set `DEBUG=true` in production |
| Entra secret rotation | Operator — per [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md) |
| WAF / DDoS | Operator — reverse proxy or cloud edge |
| Single-instance availability | Operator — process manager, backup/restore |
| Dependency CVEs | Operator — [dependency-scan-instructions.md](dependency-scan-instructions.md) |

---

## Deployment verification checklist

After production deployment (see [DEPLOYMENT.md](../DEPLOYMENT.md)):

1. Application starts without environment validation errors.
2. Admin login and mandatory password change work.
3. Three failed logins trigger lockout (423).
4. EmailConfig Validate succeeds with Entra credentials.
5. Test confirmation sends; public link completes; audit entries appear.
6. Audit export returns expected actions.
7. Security headers present on HTTP responses.
8. Cron API denied without Bearer secret.

---

*End of client security confirmation (sections 1, 2, 3, 5, 7).*
