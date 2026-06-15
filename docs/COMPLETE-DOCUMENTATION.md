# Taxteck Email Auto — Complete Documentation

Complete documentation for Taxteck Email Auto.

## Table of contents

1. [Database](#database--taxteck-email-auto)
2. [Production Deployment](#production-deployment--taxteck-email-auto)
3. [Environment Variables](#environment-variables--taxteck-email-auto)
4. [Client Security Confirmation](#taxteck-email-auto--client-security-confirmation)
5. [Microsoft Entra Admin Center Steps](#microsoft-entra-admin-center--app-registration--credential-steps-for-taxteck-email-auto)
6. [Vulnerability & Secure Coding Validation](#vulnerability--secure-coding-validation)
7. [Patch Management Process](#patch-management-process)
8. [Dependency Vulnerability Scan Instructions](#dependency-vulnerability-scan-instructions)

---

# Database — Taxteck Email Auto

The application uses **SQLite** via Prisma. The database file path is set by `DATABASE_URL` (default `file:./dev.db`).

---

## First-time setup

```bash
npm run db:migrate
```

This applies all migrations in `prisma/migrations/` including:

- User accounts with role-based access and lockout fields
- Sessions with idle tracking
- Audit logs with indexes
- Email configuration, confirmations, tracking, templates, and related operational tables

### First administrator

On a new installation, create the initial admin account once:

```bash
FORCE_SEED=1 npm run db:seed
```

The command prints a random password **once**. Sign in and change it immediately. The seed refuses to run in production without `FORCE_SEED=1` to prevent accidental overwrites.

The seed does **not** create EmailConfig, Senders, or templates — configure those through the admin UI after login.

---

## Schema updates

When upgrading to a new application version:

```bash
npm run db:migrate
```

Then restart the application.

---

## Backup and restore

**Backup** (stop the app or ensure no writes during copy for consistency):

```bash
cp dev.db dev.db.backup-$(date +%Y%m%d)
```

Also back up:

- `emails/` — archived message files
- `uploads/` — public response attachments
- `logs/` — operational and audit fallback logs

**Restore:** Stop the application, replace `dev.db`, restore file directories, restart.

Protect the database file with appropriate filesystem permissions (e.g. owned by the service account, mode `600`).

---

## Encryption at rest

The application does not encrypt the SQLite file or EmailConfig secrets at the application layer. Use volume-level encryption (LUKS, cloud disk encryption) and restrict file access on the host.

---

# Production Deployment — Taxteck Email Auto

This guide covers deploying the application on Ubuntu (or equivalent Linux) as a single Node.js instance behind a reverse proxy.

**Default port:** 3002

---

## Prerequisites

- **Node.js 20+**
- **Persistent disk** for SQLite database, `emails/`, `uploads/`, and `logs/`
- **Outbound HTTPS** to `login.microsoftonline.com` and `graph.microsoft.com`
- **Reverse proxy** (nginx or Caddy) for TLS termination
- **Puppeteer/Chromium libraries** (for confirmation PDF generation):

```bash
sudo apt-get update
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2
```

---

## Deployment steps

### 1. Install the application

Extract or copy the application package to your server, for example `/opt/taxteck-email-auto`.

```bash
cd /opt/taxteck-email-auto
```

Install production dependencies (if not already bundled):

```bash
npm ci --omit=dev
```

The Prisma client is generated automatically via the postinstall script.

### 2. Configure environment

```bash
cp env.ubuntu-server.example .env
```

Edit `.env` with production values. See the [Environment Variables](#environment-variables--taxteck-email-auto) for the full variable reference.

Minimum production settings:

- `NODE_ENV=production`
- `DATABASE_URL="file:./dev.db"`
- `EMAIL_ACTION_JWT_SECRET` — 32+ character random value
- `NEXT_PUBLIC_APP_BASE_URL` — your public HTTPS URL (must match the value used at build time)
- `CRON_API_SECRET` — long random value
- `DEMO_MODE=false` (or omit)

### 3. Initialize the database

First deploy only:

```bash
npm run db:migrate
```

For a fresh installation, bootstrap the first administrator (controlled one-time operation):

```bash
FORCE_SEED=1 npm run db:seed
```

The seed command prints a **one-time random password** to the console. Sign in immediately and change the password. Do not run seed again in production unless intentionally resetting the admin account.

See the [Database](#database--taxteck-email-auto) for migration and backup details.

### 4. Start the application

```bash
npm start
```

For production, use a process manager (PM2, systemd):

```bash
# PM2 example
pm2 start npm --name taxteck-email-auto -- start
pm2 save
```

**Important:** Run a **single instance** only. Background email processing (cron) and security housekeeping run inside the same Node process.

### 5. Configure reverse proxy

Example nginx location block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### 6. First login and EmailConfig

1. Open the public URL in a browser and sign in with the seeded admin credentials.
2. **Immediately change the password** (Settings → Change Password).
3. Go to **Email Config** and add a Microsoft Entra configuration. Follow the [Microsoft Entra Admin Center Steps](#microsoft-entra-admin-center--app-registration--credential-steps-for-taxteck-email-auto).
4. **Validate** → **Activate** the configuration.
5. Create at least one **Sender**, then send a test confirmation.

### 7. Ongoing operations

- **Backups:** Back up the SQLite file, `emails/`, and `uploads/` regularly.
- **Logs:** Rotate `logs/` (may contain operational metadata). Configure logrotate or ship to SIEM.
- **Audit export:** Administrators can export audit logs from the admin UI or via `/api/admin/audit-logs`.
- **Secrets rotation:** Rotate `CRON_API_SECRET`, `EMAIL_ACTION_JWT_SECRET`, and Entra client secrets per your policy. Entra secret rotation steps are in the Entra guide.
- **Updates:** Apply application updates by replacing the package, running migrations, and restarting. See the [Patch Management Process] section in this document.

---

## Verification checklist

After deployment, confirm:

- [ ] Application starts without environment validation errors
- [ ] Login works; password change requires current password
- [ ] Three failed logins trigger temporary lockout (423)
- [ ] EmailConfig Validate succeeds with Entra credentials
- [ ] Test confirmation email sends and public link works
- [ ] Audit logs record login and configuration events
- [ ] Response headers include `X-Content-Type-Options`, `X-Frame-Options`, CSP
- [ ] `POST /api/cron` returns 401 without `CRON_API_SECRET` Bearer token

---

# Environment Variables — Taxteck Email Auto

Copy `env.ubuntu-server.example` to `.env` in the application directory on the server. Do not commit `.env` to version control.

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

Graph credentials are **not** environment variables. They are entered by an administrator in the application UI under **Email Config** after Entra app registration. See the [Microsoft Entra Admin Center Steps] section in this document.

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

**Lockout escalation:** After three lockout events for the same account, the account requires an **administrator password reset** before login is allowed again (even after the 15-minute window).

---

## Operational

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | unset | If `true`, enables verbose diagnostic logging. Leave unset or `false` in production. |
| `FORCE_SEED` | unset | Only for controlled first-time admin bootstrap. See the [Database] section in this document. |

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


---

# Taxteck Email Auto — Client Security Confirmation

**Sections:** 1 Basic Application Information · 2 Authentication & Access Control · 3 Data Security · 5 Server-Level Requirements · 7 Audit & Monitoring (brief)

**Date:** 2026-06-10  
**Application:** Taxteck Email Auto (Next.js 15 / React 19 / TypeScript / Prisma 6 / SQLite)

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

Configurable via environment variables (see the [Environment Variables](#environment-variables--taxteck-email-auto)). Passwords are hashed with **bcrypt cost 12**. Plaintext passwords are never stored or logged.

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
- Claims include nonce; tokens are verified and consumed (one-time use).
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
| PDF generation | Chromium runtime libraries (see the [Production Deployment](#production-deployment--taxteck-email-auto)) |

**Database setup:** `npm run db:migrate` on first deploy and after updates. See the [Database] section in this document.

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
| Entra secret rotation | Operator — per the [Microsoft Entra Admin Center Steps](#microsoft-entra-admin-center--app-registration--credential-steps-for-taxteck-email-auto) |
| WAF / DDoS | Operator — reverse proxy or cloud edge |
| Single-instance availability | Operator — process manager, backup/restore |
| Dependency CVEs | Operator — see [Dependency Vulnerability Scan Instructions](#dependency-vulnerability-scan-instructions) |

---

## Automated DAST / ZAP note (production builds)
Production-mode ZAP scans (against `npm run build && npm start` or the prepared release) have shown:
- 0 High, 0 Medium, 0 Low findings.
- Only a small number of Informational items remain (framework-internal "Suspicious Comments" in minified Next.js chunks and occasional "Content-Type Header Missing" on ZAP's own trailing-slash probes against `/_next/static/...` paths).

These are documented with exact mitigations (middleware hardening for static paths, CSP tightening, no source maps, framework upgrade, etc.) in the dedicated subsection under [Vulnerability & Secure Coding Validation](#automated-security-scanning-zap-dast--production-build-results-june-2026).

## Deployment verification checklist

After production deployment (see the [Production Deployment](#production-deployment--taxteck-email-auto)):

1. Application starts without environment validation errors.
2. Admin login and mandatory password change work.
3. Three failed logins trigger lockout (423).
4. EmailConfig Validate succeeds with Entra credentials.
5. Test confirmation sends; public link completes; audit entries appear.
6. Audit export returns expected actions.
7. Security headers present on HTTP responses.
8. Cron API denied without Bearer secret.
9. (Recommended for client confirmation) Production ZAP scan shows 0 High / 0 Medium / 0 Low. Only accepted Informational items are framework-typical "Suspicious Comments" in client bundles and occasional Content-Type probes on malformed static paths (both documented with mitigations in the Vulnerability & Secure Coding Validation section).

---

*End of client security confirmation (sections 1, 2, 3, 5, 7).*

---

# Microsoft Entra Admin Center — App Registration & Credential Steps for Taxteck Email Auto

**Purpose**  
The application sends, fetches, replies to, and forwards email **exclusively via Microsoft Graph using the client credentials (app-only) flow**. No delegated user login or interactive OAuth is used for the core confirmation workflows. Each `EmailConfig` row stores its own `msTenantId`, `msClientId`, and `msClientSecret`; the app obtains short-lived access tokens at runtime and never stores Graph refresh tokens.

**Exact permissions required**

| Permission | Purpose |
|------------|---------|
| `Mail.Send` | Send confirmation emails and threaded replies |
| `Mail.Read` | Read inbox messages, MIME content, and conversation threading |
| `Mail.ReadWrite` | Create reply drafts and modify messages in the reply workflow |
| `User.Read` | Resolve the configured mailbox (`fromEmail`) in Graph API calls |

All flows use OAuth2 **client credentials** with scope `https://graph.microsoft.com/.default`. The registered app must be granted **Application (app-only)** permissions, and an administrator must click **Grant admin consent** for the tenant.

**Token request (app-only flow):**

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={clientId}
&client_secret={clientSecret}
&scope=https://graph.microsoft.com/.default
&grant_type=client_credentials
```

**Send mail (example Graph endpoint):**

```
POST https://graph.microsoft.com/v1.0/users/{fromEmail}/sendMail
Authorization: Bearer {access_token}
```

## 10-Step Guide (Entra Admin Center)

1. **Sign in**  
   Go to https://entra.microsoft.com (or https://portal.azure.com → Microsoft Entra ID). Sign in with a Global Administrator or Privileged Role Administrator account for the target tenant.

2. **Navigate to App Registrations**  
   Left nav: **Applications** → **App registrations** → **+ New registration**.

3. **Register the application**  
   - Name: e.g. `Taxteck-Email-Auto-Prod` (or per-environment).  
   - Supported account types: **Accounts in this organizational directory only (Single tenant)** — recommended for least privilege.  
   - Redirect URI: leave blank (this is app-only; no user-facing sign-in redirect).  
   Click **Register**.  
   On the Overview page, note:  
   - **Application (client) ID** → `msClientId`  
   - **Directory (tenant) ID** → `msTenantId`

4. **Add Microsoft Graph Application permissions**  
   Left nav on the app: **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Application permissions** (not Delegated).  
   Search and select exactly:  
   - `Mail.Send`  
   - `Mail.Read`  
   - `Mail.ReadWrite`  
   - `User.Read`  
   Click **Add permissions**.  
   The list should show "Application" type for all four.

5. **Grant admin consent**  
   Still on **API permissions**, click **Grant admin consent for <Your Tenant Name>** (big blue button at the top).  
   Confirm. All four permissions should now show a green "Granted" checkmark under Status.  
   (Without consent the client credentials grant will fail with AADSTS65001 or similar.)

6. **Create a client secret**  
   Left nav: **Certificates & secrets** → **+ New client secret**.  
   - Description: e.g. `Taxteck-Email-Auto-2026-06` (include date/rotation cycle).  
   - Expires: choose per your policy (90/180/365 days; shorter is better).  
   Click **Add**.  
   **Immediately copy the Value** (the long secret string). It will never be shown again.  
   The Secret ID is just metadata; you need the **Value**.

7. **Create the EmailConfig in the application**  
   Log into Taxteck Email Auto as an administrator → **Email Config** (or `/email-config`).  
   - **Add new** (or edit an existing).  
   - Tenant ID: paste the Directory (tenant) ID from step 3.  
   - Client ID: paste the Application (client) ID from step 3.  
   - Client Secret: paste the **Value** you copied in step 6 (it will be echoed back once in the create response for you to copy locally if needed; subsequent GETs return `***`).  
   - From Email: the **exact UPN** (or primary SMTP address) of the mailbox the app should send as / read from. This must be a valid mailbox in the tenant that the app has been granted the Mail.* permissions on (usually the same account or a shared mailbox for which the app has Send As / Full Access via Entra or Exchange).  
   - (Optional) Display name / description for the config.  
   Save. The create response will return the config (with the secret visible **only this once** for immediate copy). After that, list and detail views mask it.

8. **Validate the configuration**  
   In the EmailConfig row, click **Validate**.  
   - Success: `{ valid: true }` (green). An `EMAIL_CONFIG_VALIDATE` audit entry with success=true is written.  
   - Failure: error message (e.g., "AADSTS70002: ... invalid client secret", "The user or administrator has not consented...", "invalid_grant", "fromEmail not found or insufficient privileges", etc.). The audit entry records success=false + the error detail.  
   Fix the Entra app or the values and re-validate until green.

9. **Activate + Test end-to-end**  
   - Toggle **Active** (and optionally **Cron Enabled**) on the config.  
   - Create at least one **Sender** (the from addresses you expect to process).  
   - Use the UI to send a test confirmation (Trade or MSME) to a known recipient.  
   - Verify delivery in the recipient mailbox.  
   - Click the public confirmation link (or reply to the email) and complete the flow (confirm/decline/upload).  
   - Check that replies are fetched/forwarded (if forwarders configured) and that threaded replies (if used) appear correctly.  
   - As admin, go to Audit Logs and confirm the `EMAIL_CONFIG_VALIDATE`, `EMAIL_CONFIG_ACTIVATE`, `PUBLIC_RESPONSE_*`, and any `CRON_*` entries appear with correct IP/UA/resource.

10. **Rotation, monitoring, and decommissioning**  
    - **Rotation cadence**: per your secret policy (e.g., every 90 days or on suspected exposure). In Entra: create a *new* client secret (step 6), update the EmailConfig in the app with the new Value, Validate (step 8), confirm success, then delete the old secret in Entra.  
    - **Monitor**: In Entra → Monitoring → Sign-in logs (filter by the App ID or Service Principal). Look for successful client credentials tokens and any failures (bad secrets, consent issues, etc.).  
    - **Decommission**: Remove the EmailConfig in the app (or set inactive), then delete the app registration in Entra (or at minimum remove its permissions and secrets). Revoke any consents if the app is no longer needed.  
    - **Least privilege reminder**: Do not add broader permissions unless a specific requirement justifies it. The four permissions above are the minimum required for send, fetch, reply, and forward operations.

---

## Common Errors & Troubleshooting

- **"AADSTS70002: Invalid client secret" or "Invalid client secret provided"**  
  You pasted the Secret *ID* instead of the *Value*, or the secret has expired / been deleted. Create a fresh one and paste the new Value.

- **"AADSTS65001: The user or administrator has not consented..."**  
  Admin consent was not granted (step 5). Go back to API permissions and click the consent button for the whole tenant.

- **"The mailbox is either inactive, soft-deleted, or ... fromEmail not valid" / 404 on sendMail**  
  The `fromEmail` value in the EmailConfig must be the exact UPN (usually `user@tenant.onmicrosoft.com` or custom domain) of a mailbox that exists and for which the app has Send As rights. Test by sending a simple message from that mailbox in Outlook/Exchange first.

- **"Access denied" or 403 on Graph calls after token success**  
  Consent was granted but the specific mailbox permissions (Send As / Full Access) may be missing at the Exchange level, or the mailbox is in a different tenant/region. Verify the service principal has the required Exchange Online permissions for the target mailbox.

- **Token request fails with "invalid_grant" or "unauthorized_client"**  
  App registration may have "Accounts in any organizational directory" selected while the mailbox is in a different tenant, or the app is disabled. Use single-tenant + correct tenant ID.

- **Validation passes but no mail arrives / replies not seen**  
  Check the Sender list for the config, the "from" address on the template, spam/junk filters, and that the mailbox actually has a license/Exchange plan. Use Graph Explorer (with the same app credentials) to test `/users/{fromEmail}/messages` and `/users/{fromEmail}/sendMail` directly.

- **"Insufficient privileges to complete the operation" on createReply / MIME**  
  The app needs `Mail.ReadWrite` for drafts/replies and `Mail.Read` for MIME download. Re-check the exact four permissions and re-grant consent after adding any missing one.

- **Production logging:** Client ID and tenant ID may appear in diagnostic logs when `DEBUG=true`. Client secret values must never appear in logs. If a secret is logged, rotate it immediately.

---

## Security Notes (Summary)

- Treat the client secret like a high-value credential: store it only in the app's EmailConfig (masked on read), rotate on schedule or incident, never commit to git or share in tickets.  
- The Entra app should have **no user-facing sign-in** (no redirect URIs, no implicit/flow for users). It is purely for client_credentials.  
- Monitor sign-in logs and Graph throttles.  
- If you ever need to support multiple environments (dev/staging/prod), create separate app registrations (or separate secrets + separate EmailConfig rows) rather than sharing one secret across environments.  
- The application uses **app-only** tokens only — no delegated user login for email operations.

---

*End of Entra steps.*  
After completing these steps you will have a working `EmailConfig` that the application can use for all send/fetch/reply/forward operations via Microsoft Graph app-only.

---

# Vulnerability & Secure Coding Validation

**Application:** Taxteck Email Auto  
**Scope:** Runtime security controls, dependency management, secure coding practices

---

## OWASP-aligned controls (summary)

| Category | Control | Implementation |
|----------|---------|----------------|
| Authentication | Username/password with bcrypt (cost 12), lockout, session idle/max timeout | Enforced on all admin login paths |
| Access control | Role-based (admin/user) + module flags; admin-only APIs | Middleware + per-route authorization |
| Cryptography | bcrypt for passwords; HS256 JWT for public links; TLS via reverse proxy | No plaintext passwords stored |
| Input validation | Password policy enforced server-side; Prisma ORM (parameterized queries) | No raw SQL with user input |
| Logging & monitoring | Audit log for high-risk actions; export to NDJSON | See section 7 in client confirmation |
| Configuration | Startup env validation; secrets not echoed in admin API responses | Fail-fast on misconfiguration |
| Transport | Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy) | Applied to all HTTP responses |

---

## Dependency vulnerability management

Third-party packages are tracked via `package.json` and `package-lock.json`.

**Scan command** (run during maintenance windows):

```bash
npm audit --audit-level=moderate
```

**Process:**

1. Run `npm audit` after each application update.
2. Review findings; apply `npm audit fix` where non-breaking.
3. Document exceptions with business justification.
4. Re-scan after fixes.

See the [Dependency Vulnerability Scan Instructions] and [Patch Management Process] sections in this document.

**Runtime surface:** Active flows use Next.js, Prisma, bcrypt, jose (JWT), and Microsoft Graph SDK. Legacy authentication dependencies remain in the package but are not used by the main application login or email workflows.

---

## Secure coding practices

| Practice | Detail |
|----------|--------|
| Parameterized database access | All data access via Prisma ORM |
| Password handling | bcrypt cost 12; never logged or returned in API responses |
| Secret masking | Microsoft Graph client secrets masked (`***`) on admin read APIs |
| Session cookies | `httpOnly`, `Secure` (when behind TLS), `sameSite=lax` |
| Public endpoints | Limited to `/api/public/confirmation/*` with signed JWT verification |
| Debug output | Verbose logging and debug file writes disabled in production unless `DEBUG=true` |
| Cron endpoints | Require Bearer token (`CRON_API_SECRET`) and administrator session |
| File uploads | Stored under `uploads/` with application validation on public response routes |

---

## Evidence

Dependency scan output can be archived under `evidence/` with date stamp, for example:

`dependency-audit-YYYY-MM-DD.txt`

---

## Automated security scanning (ZAP DAST) – production build results (June 2026)

Production builds were scanned with OWASP ZAP 2.17 (active + passive rules) against the standalone server (`npm run build && npm start`, or the prepared client release package). Scans targeted the full application surface including public confirmation endpoints, admin UI, and static assets.

**Summary of the production scan (report generated 2026-06-11 ~13:00):**
- High: 0
- Medium: 0
- Low: 0
- Informational: 2 (total of 7 individual alerts)

**Findings and resolution status:**

- **Content-Type Header Missing** (Informational, CWE-345, 1 instance)
  - Triggered on a scanner probe: `GET /_next/static/chunks/node_modules_48de47ca._.js/` (note the trailing slash).
  - This is an artifact of ZAP (and similar tools) appending `/` to discovered static file paths to test for directory browsing or misconfigured file serving.
  - Real clients and Next.js never request built chunks with a trailing slash.
  - **Mitigation applied:** `src/middleware.ts` intercepts all `/_next/static/*` paths. Any request ending in `/` under this prefix now receives an explicit 404 JSON response with `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`. The matcher was extended to cover these paths so the rule applies in both development and the production standalone server.
  - Rebuild (`npm run build`) confirmed the updated middleware is included in the production bundle.

- **Information Disclosure – Suspicious Comments** (Informational, CWE-615, 6 instances)
  - Detected in a minified production chunk (`/_next/static/chunks/4f748dba2d106a49.js` and similar).
  - Example pattern flagged: references to Next.js internal error messages containing the substring "BUG" in the scanner's regex (e.g. `next-dynamic-api-wrong-context`, `__NEXT_ERROR_CODE`, `E251`).
  - These strings are part of the React/Next.js client runtime for error handling and development messaging. They are not application source, secrets, PII, or business logic.
  - **Mitigation / residual risk:** 
    - `productionBrowserSourceMaps: false` and minification already applied (via `next.config.ts`).
    - The volume is low (6 instances) in a production build compared with dev/turbopack scans (which contained many more React dev warning strings).
    - No practical, maintainable way exists to strip these framework-internal identifiers without forking or heavily post-processing Next.js bundles (which would risk breaking RSC, error boundaries, and dynamic imports).
    - Accepted as standard residual Informational noise for any modern Next.js application. The risk is negligible because the data is public framework metadata and the application already ships strong security headers (CSP with object-src 'none' / base-uri 'self' / frame-ancestors 'none' / form-action 'self', X-Frame-Options: DENY, X-Content-Type-Options: nosniff, etc.).

**Other observations from the production scan:**
- The earlier High "Remote Code Execution (React2Shell)" (CVE-2025-55182) was absent (resolved by the framework upgrade to Next 15.5.18 + React 19.1.7).
- All previous Medium CSP findings ("Failure to Define Directive with No Fallback" and "Wildcard Directive") were absent thanks to the explicit secure CSP and other headers in `next.config.ts`.
- No "Directory Browsing" (CWE-548) Medium appeared on the static asset probes (the middleware + explicit 404 prevented content disclosure on malformed paths).
- All global security headers (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options) were present and correctly set on responses.
- Cache headers on static assets were strong (`public, max-age=31536000, immutable`).

**Recommendations for future scans and evidence:**
- Always run the "official" ZAP scan for client confirmation / vulnerability validation against a **production build** (`npm run build && npm start` on the target port, or the tarball produced by `npm run client:prepare`), never the development server (`npm run dev` / turbopack). Dev builds contain far more React/Next internal strings and different serving behavior.
- Keep distinct report files (the HTML report tends to overwrite `public/2026-06-11-ZAP-Report-.html`). Suggested naming: `public/zap-prod-YYYY-MM-DD.html` + copy into `docs/client-confirmation/evidence/`.
- Re-scan after any material change to headers, middleware, Next.js version, or static asset handling.
- Archive alongside dependency audit output and the patch log.

**Cross-references:**
- Detailed mitigation notes and re-scan guidance: `public/2026-06-11-ZAP-POSTFIX-verification.txt`
- Follow-up scan evidence: `docs/client-confirmation/evidence/zap-followup-2026-06-11-mediums-addressed.txt` (covers the prior dev scan Medium that was also closed)
- Client confirmation residual risks section (below) and deployment verification checklist.

These results (combined with the earlier dev-mode scans) demonstrate that the application, when run in its intended production configuration, has no High or Medium findings from automated DAST and only low-volume, framework-typical Informational items.

---

# Patch Management Process

**Application:** Taxteck Email Auto

---

## Scope

| Component | Patch source | Frequency |
|-----------|--------------|-----------|
| Application (Node.js) | Vendor releases | Per release schedule or security advisory |
| npm dependencies | `npm audit`, vendor advisories | Monthly or on critical CVE |
| Operating system (Ubuntu) | `apt upgrade` | Monthly |
| Microsoft Entra client secret | Entra admin center | Per secret expiry policy (recommended ≤ 12 months) |
| Chromium (Puppeteer) | OS package updates + app dependency updates | With OS or app updates |

---

## Application update procedure

1. **Receive** updated application package from vendor.
2. **Review** release notes for migration or environment changes.
3. **Backup** SQLite database, `emails/`, `uploads/`, and `.env` (securely).
4. **Stop** the running instance (single instance only).
5. **Replace** application files with the new package.
6. **Run** database migrations: `npm run db:migrate`
7. **Verify** `.env` against the [Environment Variables](#environment-variables--taxteck-email-auto) for any new variables.
8. **Start** the application and confirm startup validation passes.
9. **Test** login, EmailConfig validate, and a test confirmation send.
10. **Run** `npm audit --audit-level=moderate` and address findings.
11. **Document** the update (date, version, operator, test results).

---

## Dependency patching

```bash
npm audit --audit-level=moderate
npm audit fix          # non-breaking fixes
```

For breaking dependency updates, coordinate with the application vendor before applying.

Archive audit output to `evidence/dependency-audit-YYYY-MM-DD.txt`.

---

## Entra secret rotation

1. Create a new client secret in Microsoft Entra admin center.
2. Update the EmailConfig in the application UI with the new secret value.
3. Click **Validate** to confirm token acquisition.
4. Delete the old secret in Entra.
5. Record rotation date in your credential register.

See the [Microsoft Entra Admin Center Steps] section in this document.

---

## Emergency security response

On critical vulnerability notification:

1. Assess exposure (internet-facing, data sensitivity).
2. Apply vendor patch or mitigating configuration immediately.
3. Rotate affected secrets (`EMAIL_ACTION_JWT_SECRET`, `CRON_API_SECRET`, Entra secret) if compromise is possible.
4. Review audit logs for anomalous activity.
5. Document incident and remediation.

---

# Dependency Vulnerability Scan Instructions

**Application:** Taxteck Email Auto

---

## Purpose

Document how operators run and archive dependency vulnerability scans for compliance and patch management.

---

## Prerequisites

- Node.js 20+ installed on the server or a maintenance workstation with access to the application directory
- Application dependencies installed (`npm ci`)

---

## Run a scan

From the application root directory:

```bash
npm audit --audit-level=moderate
```

This reports known vulnerabilities at **moderate severity and above** in the dependency tree.

For JSON output (automation):

```bash
npm audit --audit-level=moderate --json > audit-report.json
```

---

## Archive evidence

Save output for audit records:

```bash
npm audit --audit-level=moderate 2>&1 | tee evidence/dependency-audit-$(date +%Y-%m-%d).txt
```

Recommended frequency: **monthly**, and **after every application update**.

---

## Remediation

| Severity | Action |
|----------|--------|
| Critical / High | Remediate within vendor SLA or 30 days; escalate if exploit available |
| Moderate | Schedule in next maintenance window |
| Low | Track; fix when convenient |

Apply non-breaking fixes:

```bash
npm audit fix
```

Review breaking changes before:

```bash
npm audit fix --force
```

Re-run the scan after fixes to confirm resolution.

---

## Scope note

The active runtime uses Next.js, Prisma, bcrypt, jose, and Microsoft Graph client libraries for authentication, database, and email operations. Scan results may include transitive dependencies from unused legacy modules; prioritize findings in packages exercised by login, API, Graph, and public confirmation flows.

---

