# Taxteck Email Auto – Security Questionnaire Responses

**Application:** Taxteck Email Auto  
**Version / Build date reference:** June 2026 (Next.js 15.5.18, React 19.1.7)  
**Date of this response:** 2026-06-11  
**Purpose of this document:** Self-contained answers to the requested client security questionnaire sections. All information is included directly in this file. Supporting evidence (ZAP scan reports, audit logs, dependency scans) can be provided as separate attachments when sending this document.

---

## 1. Basic Application Information

### Application architecture diagram (textual)

```
[Browser / End User]
        |
        | HTTPS (TLS terminated at reverse proxy)
        v
[Reverse Proxy (nginx / Caddy)]  <-- Forwards X-Forwarded-* headers
        |
        | HTTP (localhost:3002)
        v
[Node.js Standalone Server (Next.js 15 production build)]
        |
        +-- Middleware (auth, cron protection, static asset hardening)
        |
        +-- API Routes (/api/*)
        |     - Public confirmation endpoints (JWT-signed)
        |     - Admin APIs (session + role checks)
        |     - Cron control (Bearer token)
        |
        +-- Server Components + React Client (TipTap rich text, dashboards)
        |
        +-- Background: Cron service (email fetch/reply processing via Microsoft Graph)
        |
        v
[SQLite Database (Prisma ORM)]   <-->  File system: emails/, uploads/, logs/
        |
        v
[Microsoft Graph API]
   (app-only client credentials flow)
        |
        v
[Microsoft 365 / Exchange Online]
```

- Single-instance Node.js application.
- No client-side secrets.
- All persistent state in local SQLite + filesystem directories.

### Purpose and functionality of the application

Taxteck Email Auto is an internal audit confirmation management system. It automates the sending, tracking, and collection of audit confirmation requests for Trade Payables, Trade Receivables, and MSME (Micro, Small & Medium Enterprises) entities.

Core functions:
- Maintain master data (suppliers/vendors, contacts).
- Configure one or more Microsoft 365 email sending identities (via Microsoft Graph).
- Generate and send branded confirmation request emails with secure public response links.
- Receive and process responses (confirm, decline, or upload supporting documents).
- Track status, send reminders, and generate reports/PDFs of confirmations.
- Maintain a full audit trail of high-risk actions.
- Provide role-based access for administrators and limited users.

The application does **not** process financial transactions or store payment card data.

### Technology stack used

- **Framework:** Next.js 15.5.18 (App Router) with Turbopack for development.
- **Runtime:** Node.js 20+ (production runs as a single standalone process).
- **Frontend:** React 19.1.7 + TypeScript, Tailwind CSS 4, TipTap (rich text editor for email templates).
- **Backend / API:** Next.js API routes + Server Actions / Server Components.
- **Authentication:** Custom session-based system (bcrypt-hashed passwords + opaque session tokens stored in database).
- **Authorization:** Role-based (admin / user) + per-module access flags (Trade Payable, Trade Receivable, MSME).
- **Database / ORM:** Prisma + SQLite.
- **Email:** Microsoft Graph API (app-only / client credentials flow). Legacy SMTP path is present in schema but not used in core flows.
- **PDF generation:** Puppeteer (headless Chromium).
- **Other key libraries:** jose (JWT for public confirmation links), archiver (ZIP exports), xlsx (Excel import/export).

### Programming language

TypeScript (primary) + JavaScript (transitive from dependencies). All application source code is written in TypeScript.

### Database

SQLite (file-based, via Prisma ORM).  
The database file location is controlled by the `DATABASE_URL` environment variable (typically `file:./dev.db` or a path on a persistent volume in production).

Key security-related tables:
- `users` (with role, module access flags, failed login counters, lockout fields).
- `sessions` (opaque tokens, expiry, last activity for idle timeout).
- `audit_logs` (immutable high-risk action records).

### Middleware

Custom Next.js middleware (`src/middleware.ts`) that runs on:
- All `/api/:path*` routes.
- All `/_next/static/:path*` asset paths (for hardening).

Responsibilities:
- Public API allow-list (`/api/auth/*`, `/api/public/*`).
- Cron protection: requires exact `Authorization: Bearer <CRON_API_SECRET>` when the secret is configured. Falls back to denial if the secret is not set.
- Session validation for all other protected API routes (cookie-based `session_token`).
- Hardening of static asset paths: any request to `/_next/static/...` that ends with `/` receives an immediate 404 with explicit `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff`. This prevents scanner "directory browsing" probes and related header findings.

### Third-party libraries (security-relevant)

- `bcryptjs` – password hashing (cost 12).
- `jose` – JWT signing/verification for public confirmation magic links.
- `@microsoft/microsoft-graph-client` + `@azure/msal-node` – Microsoft Graph authentication and API calls (app-only).
- `puppeteer` – PDF generation (sandboxed Chromium).
- `next` 15.5.18 / `react` 19.1.7 – core framework (patched for known React Server Components RCE issues as of the June 2026 build).

All dependencies are managed via `package.json` + `package-lock.json`. Production installs use `npm ci --omit=dev`.

### Deployment architecture

- Single Node.js process (Next.js standalone output).
- Typically deployed on Ubuntu Linux behind a reverse proxy (nginx or Caddy) that terminates TLS.
- Persistent volume required for:
  - SQLite database file.
  - `emails/` (archived sent messages).
  - `uploads/` (publicly accessible response attachments).
  - `logs/` (fallback audit logs).
- Outbound internet access required only to Microsoft Graph endpoints (`login.microsoftonline.com` and `graph.microsoft.com`).
- The application is designed as a single instance (no built-in clustering or horizontal scaling).

### Data flow diagram (textual)

1. Administrator configures EmailConfig (Microsoft Entra credentials) via the web UI.
2. Administrator uploads masters or creates confirmation records.
3. System sends email via Microsoft Graph containing a signed JWT link (`EMAIL_ACTION_JWT_SECRET`).
4. Recipient opens the public link (`/respond/...`) → server verifies JWT → renders confirmation form.
5. Recipient submits (confirm/decline/upload) → server validates, stores response + attachment, writes audit log, optionally triggers follow-up.
6. Background cron (protected by `CRON_API_SECRET`) polls Microsoft Graph for replies and updates confirmation status.
7. Administrators view status, export reports, and download PDFs (generated on-demand via Puppeteer).

All sensitive operations (sending email, changing configuration, user management, viewing audit logs) are protected by administrator session + role checks and are recorded in the audit log.

### Internet dependency details

- **Outbound only** (the server initiates connections).
- Required destinations:
  - `https://login.microsoftonline.com` (token acquisition).
  - `https://graph.microsoft.com` (send mail, read replies, user lookup).
- No inbound internet access to the application is required except through the organization's reverse proxy / load balancer for legitimate users.
- No third-party analytics, CDNs for critical functionality, or external SaaS (except Microsoft 365 via Graph).

### Ports and protocols required

**Inbound (to the application server):**
- TCP 3002 (HTTP) – from the reverse proxy only. TLS is terminated at the proxy.
- The application itself listens on HTTP; the reverse proxy is responsible for HTTPS (port 443 externally).

**Outbound (from the application server):**
- TCP 443 (HTTPS) to Microsoft identity and Graph endpoints.

**Typical production listening configuration:**
- Reverse proxy listens on 443 (HTTPS) + 80 (redirect).
- Node.js listens on 127.0.0.1:3002 (or equivalent localhost binding).

---

## 2. Authentication & Access Control

### Role-Based Access Control (RBAC)

Yes. Every user record has a `role` field (`"admin"` or `"user"`) plus three independent boolean module flags:
- `accessTradePayable`
- `accessTradeReceivable`
- `accessConfirmMsme`

These flags are evaluated on every protected operation. Non-admin users can be restricted to specific confirmation modules only.

### Separate admin and user privileges

- **Admin:** Full access to user management, EmailConfig (including secrets), masters, templates, audit logs, cron control, and all modules.
- **User (non-admin):** Limited to the modules granted via the three access flags. Cannot create or modify users, EmailConfig, or view/export full audit logs.

Privilege checks are enforced both in the UI and on the server (middleware + per-route guards). There is no client-side-only authorization.

### Password policy support

Enforced server-side at password creation and change time (via `validatePassword`).

Default policy (configurable via environment variables, shown with current production defaults):

- Minimum length: 12 characters
- Must contain at least one uppercase letter
- Must contain at least one lowercase letter
- Must contain at least one digit
- Must contain at least one special character

All five rules are enabled by default in production configurations. The policy is applied before any bcrypt hashing occurs.

### Session timeout mechanism

Two independent controls (both configurable):

- **Maximum session age:** 7 days (default). After this period the session token is considered expired regardless of activity.
- **Idle timeout:** 30 minutes (default). If no activity is recorded for this duration the session is invalidated on next use.

Both checks are performed on every protected request that uses `getSession()`. Expired or idle sessions are deleted from the database and the user is forced to re-authenticate.

Session tokens are opaque 64-character hex values (generated with `crypto.randomBytes(32)`), never JWTs.

### Account lockout mechanism

Progressive lockout with permanent escalation on repeated abuse:

- After 3 consecutive failed login attempts the account is locked for 15 minutes (both values configurable).
- Each time an account enters the locked state, a `lockoutCount` is incremented.
- On the **third** lockout event, `adminResetRequired` is set to true. From this point the account can **only** be unlocked by an administrator resetting the password. Time-based expiry no longer applies.
- Successful login clears the current failure counter and temporary lock state (but historical `lockoutCount` is retained for audit purposes).
- All lockout and failed-login events are written to the audit log with action types `LOGIN_FAILED` and `LOGIN_LOCKED`.

The lockout logic is implemented in `simple-auth.ts` and called from the login API route before any password comparison.

---

## 3. Data security

### Data encryption

**At rest:**
- The SQLite database file and all files under `emails/`, `uploads/`, and `logs/` reside on the host filesystem.
- The application itself does **not** perform application-layer encryption of the database or files.
- Encryption at rest is the responsibility of the operator (volume-level encryption such as LUKS on Linux, cloud disk encryption, or encrypted filesystems). This is explicitly stated as an operator responsibility in the security documentation.

**In transit:**
- All external traffic is protected by TLS (terminated at the reverse proxy).
- Session cookies are marked `httpOnly` and `Secure` (when the request indicates HTTPS via proxy headers).
- Public confirmation links use signed JWTs (HS256 via `jose`) with a strong per-environment secret (`EMAIL_ACTION_JWT_SECRET`, minimum 32 characters, required in production).
- Microsoft Graph communication uses standard OAuth 2.0 client credentials (short-lived access tokens) over HTTPS.

**Secrets handling:**
- Microsoft Graph client secrets are stored encrypted only by the database at-rest mechanism chosen by the operator. In the application they are masked (`***`) on all admin read APIs.
- The `EMAIL_ACTION_JWT_SECRET` and `CRON_API_SECRET` are environment variables and are never stored in the database.

### Data retention policy

The application does not implement automatic deletion of business records (confirmations, masters, email archives, uploads). Retention of operational data is a business decision and is the responsibility of the operator.

**Audit logs** have a built-in retention policy (default 90 days, configurable via `AUDIT_LOG_RETENTION_DAYS`). Old audit log entries are automatically purged by a daily housekeeping job.

Email archives (`emails/`) and uploaded response attachments (`uploads/`) remain until manually removed by an administrator or via external retention processes.

### Log retention

- **Application / audit logs:** 90 days default for structured audit logs (purged automatically). A fallback plain-text file (`logs/audit-fallback.log`) is appended for high-risk actions if the database write fails.
- **Sent email archives:** Stored indefinitely in `emails/` until manually cleaned.
- **Uploaded attachments:** Stored in `uploads/` (publicly reachable via signed links) until manually removed.
- Log files are not rotated by the application itself; the operator is expected to configure `logrotate` (or equivalent) on the host.

---

## 4. Vulnerability & Secure Coding Validation

### Latest VAPT / Penetration Test report

Automated dynamic application security testing (DAST) has been performed using OWASP ZAP 2.17 (active + passive rules) against both development and production builds.

**Latest production scan (2026-06-11):**
- High: 0
- Medium: 0
- Low: 0
- Informational: 2 types (very low volume)

Key results:
- No Remote Code Execution (React2Shell / CVE-2025-55182) – resolved by framework upgrade to Next.js 15.5.18 + React 19.1.7.
- No Directory Browsing findings on production builds.
- No CSP-related Medium findings.
- Only residual Informational items:
  - One "Content-Type Header Missing" on an artificial ZAP probe that appended `/` to a static chunk path.
  - Six instances of "Information Disclosure – Suspicious Comments" (Next.js internal error message identifiers inside minified client bundles). These do not contain application code, secrets, or sensitive data.

Evidence available as attached file: the ZAP HTML report generated on the production standalone server on 2026-06-11.

Previous dev-mode scans (same day) showed a Medium "Directory Browsing" and some CSP issues; both were addressed before the production scan (middleware hardening for static paths + explicit secure CSP headers).

### Secure code review report

No separate external secure code review report is attached with this response. The following controls have been implemented and verified through code review and automated scanning:

- All database access uses Prisma ORM (parameterized queries; no raw SQL with user input).
- Passwords are hashed with bcrypt (cost 12) before storage; plaintext passwords are never logged or returned.
- All protected API routes enforce server-side authorization (role + module flags).
- Public confirmation endpoints require a valid signed JWT; the secret is required at startup in production.
- Cron control endpoints require a separate long random Bearer token when configured.
- Security headers are set on every response (see section 5).
- Static asset paths are hardened in middleware to return safe 404 responses on malformed requests.
- Audit logging is performed for all high-risk actions (see section 7) with a database + filesystem fallback.

### OWASP Top 10 compliance

The application was assessed against OWASP Top 10 (2021) during the design and recent hardening work. Summary of key mappings:

- A01 Broken Access Control – Enforced via middleware + per-route checks + RBAC + module flags. Public endpoints are JWT-protected.
- A02 Cryptographic Failures – bcrypt for passwords; jose (HS256) for public links; TLS for all external traffic; secrets never returned in API responses.
- A03 Injection – Prisma ORM for all database access; no raw SQL concatenation; input validation on passwords and public response tokens.
- A04 Insecure Design – Least-privilege Microsoft Graph permissions; separate cron secret; explicit startup validation that refuses to start with placeholder secrets in production.
- A05 Security Misconfiguration – Security headers applied globally (CSP, X-Frame-Options: DENY, nosniff, etc.); production builds disable source maps; middleware denies cron without proper secret.
- A06 Vulnerable & Outdated Components – Regular `npm audit --audit-level=moderate` runs; framework upgraded promptly for critical issues (React2Shell RCE addressed in June 2026 build).
- A07 Identification & Authentication Failures – Strong password policy (12+ chars + complexity), progressive lockout with admin-reset escalation, dual session timeouts (max age + idle), bcrypt, opaque session tokens.
- A08 Software & Data Integrity Failures – Signed JWTs for public links; no unsigned or client-controlled state used for authorization decisions.
- A09 Security Logging & Monitoring Failures – Comprehensive audit logging for high-risk actions (see section 7) with retention and fallback.
- A10 Server-Side Request Forgery (SSRF) – Not applicable; the application does not accept arbitrary URLs from users for outbound requests (only pre-configured Microsoft Graph endpoints).

### Dependency vulnerability scan report

Regular scans are performed with:

```bash
npm audit --audit-level=moderate
```

**Latest relevant scan evidence (2026-06-11):** A full `npm audit` was executed as part of the React2Shell emergency patch process. The resulting report was archived as `dependency-audit-2026-06-11-react2shell-patch.txt`.

At the time of the latest production ZAP scan the application was running on Next.js 15.5.18 and React 19.1.7 (both patched releases addressing known critical RCE issues in the React Server Components runtime).

Pre-existing findings in transitive dependencies (e.g. fast-xml-parser via AWS SDK, xlsx, nodemailer) are tracked and addressed according to the normal patch process. None of the critical/high findings in the June 2026 scans were related to the authentication, authorization, or public confirmation paths exercised by the ZAP scans.

### Patch management process

The organization follows a documented Patch Management Process that includes:

- Application updates (vendor releases or security advisories).
- Dependency updates via `npm audit` + `npm audit fix` (non-breaking) or coordinated updates for breaking changes.
- Operating system patching on the Ubuntu host.
- Entra client secret rotation (recommended ≤ 12 months).
- Emergency response procedure for critical vulnerabilities (immediate assessment, patch application, secret rotation if compromise is possible, audit log review, documentation).

A dedicated emergency response was executed for the React2Shell (CVE-2025-55182) vulnerability in June 2026. The framework was upgraded, the application was rebuilt and tested, a full `npm audit` was run, and the update was documented (including a patch log).

---

## 5. Server-Level Requirements

### OS compatibility

Production deployments are supported on Ubuntu Linux (or equivalent distributions) with Node.js 20 or newer.

The application has been tested and is known to run on:
- Ubuntu 22.04 / 24.04 LTS (recommended)
- Other glibc-based Linux distributions with Node.js 20+

Windows and macOS are supported only for development.

### Required services

On the host:
- Node.js 20+ runtime.
- A process manager is strongly recommended for production (PM2, systemd, or equivalent) to keep the single Node.js instance running and to handle restarts.
- Reverse proxy (nginx or Caddy) for TLS termination and header forwarding.
- Optional but recommended: `logrotate` for `logs/`.

No additional services (database server, message queue, etc.) are required because SQLite is embedded.

### Required open ports

**From the external network (through the reverse proxy):**
- TCP 443 (HTTPS) – standard web traffic.

**On the application server itself (localhost only recommended):**
- TCP 3002 (HTTP) – listened to by the Node.js process. Should not be exposed directly to the internet.

Outbound:
- TCP 443 to `login.microsoftonline.com` and `graph.microsoft.com`.

### Internet access requirements

The application server requires **outbound HTTPS access only** to:
- `login.microsoftonline.com`
- `graph.microsoft.com`

No other external services are contacted at runtime.

Inbound internet access is not required except for legitimate user traffic through the organization's reverse proxy / firewall.

### Domain whitelisting requirements

For Microsoft Graph / Entra:
- The Entra App Registration used for each EmailConfig must be granted the minimum required permissions (typically Mail.Send, Mail.ReadWrite, User.Read, and related).
- The tenant must allow the registered application to call Microsoft Graph with application permissions.

No other domain whitelisting is required from the application's perspective.

### CPU / RAM / storage utilization

Typical production utilization (single instance, moderate load):

- **CPU:** Low to moderate. Spikes during PDF generation (Puppeteer) and during bulk email sends or cron reply processing. A modest virtual CPU allocation (1–2 vCPU) is normally sufficient.
- **RAM:** Approximately 150–300 MB resident for the Node.js process under normal load. Puppeteer/Chromium adds temporary memory during PDF rendering.
- **Storage:**
  - Application code + node_modules: ~200–400 MB (standalone build is self-contained).
  - SQLite database: grows with number of confirmations and audit logs (typically tens to low hundreds of MB).
  - `emails/` archive: grows with every sent message (plain text + headers). Can be pruned periodically.
  - `uploads/` (response attachments): grows with user-uploaded files. Should be monitored and cleaned according to business retention policy.
  - `logs/`: small unless fallback audit logging is triggered frequently.

Persistent volume with reasonable IOPS is recommended for the database and attachment directories.

---

## 7. Audit & Monitoring Capability

### Does application generate audit logs?

Yes. A structured audit log is written for every high-risk action.

### Failed login logs?

Yes. Every failed login attempt is recorded with action `LOGIN_FAILED`, including username (if known), IP address, and user agent. When an account becomes locked the action `LOGIN_LOCKED` is also written.

### Admin activity logs?

Yes. All administrative actions are logged, including:
- User creation, update, deletion
- EmailConfig create / update / delete / activate / validate
- Settings changes
- Email template changes
- Data truncation operations
- Audit log viewing and export
- Password changes (by the user themselves or by an admin)

### API logs?

- All protected API calls that perform high-risk actions are logged via the audit system.
- Routine read operations are not logged at the audit level (to avoid log volume) but standard HTTP access logging can be enabled at the reverse proxy level.
- Public confirmation endpoints (`/api/public/...`) write audit entries for confirm, query, decline, and upload actions.

### Can logs integrate with SIEM?

Yes.

- The primary audit log is stored in the SQLite `audit_logs` table and can be exported as NDJSON via the admin UI or API (`/api/admin/audit-logs`).
- A filesystem fallback (`logs/audit-fallback.log`) is appended (as JSON lines) for high-risk actions whenever a database write fails. This file can be tailed by any log shipper (Filebeat, Fluent Bit, rsyslog, etc.).
- The operator can configure a log shipper on the host to forward both the fallback file and reverse-proxy access/error logs to a SIEM.

### Do you have SIEM?

This is an operator decision. The application itself does not include or require a specific SIEM product. It produces structured, exportable audit data and a filesystem fallback that are compatible with common SIEM ingestion methods (NDJSON over file or HTTP, syslog, etc.).

The application includes a daily housekeeping job that purges audit logs older than the configured retention period (default 90 days) and also cleans up expired/idle sessions.

---

**End of Security Questionnaire Responses**

This document is intended to be self-contained. When distributing, attach the latest production ZAP HTML report(s) and the most recent dependency audit output as supporting evidence for the claims made in sections 4 and 7.