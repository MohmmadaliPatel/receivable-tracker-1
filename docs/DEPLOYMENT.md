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

Edit `.env` with production values. See [ENVIRONMENT.md](ENVIRONMENT.md) for the full variable reference.

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

See [DATABASE.md](DATABASE.md) for migration and backup details.

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
3. Go to **Email Config** and add a Microsoft Entra configuration. Follow [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md).
4. **Validate** → **Activate** the configuration.
5. Create at least one **Sender**, then send a test confirmation.

### 7. Ongoing operations

- **Backups:** Back up the SQLite file, `emails/`, and `uploads/` regularly.
- **Logs:** Rotate `logs/` (may contain operational metadata). Configure logrotate or ship to SIEM.
- **Audit export:** Administrators can export audit logs from the admin UI or via `/api/admin/audit-logs`.
- **Secrets rotation:** Rotate `CRON_API_SECRET`, `EMAIL_ACTION_JWT_SECRET`, and Entra client secrets per your policy. Entra secret rotation steps are in the Entra guide.
- **Updates:** Apply application updates by replacing the package, running migrations, and restarting. See [PATCH-MANAGEMENT.md](client-confirmation/PATCH-MANAGEMENT.md).

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

## Related documentation

| Document | Purpose |
|----------|---------|
| [ENVIRONMENT.md](ENVIRONMENT.md) | Full environment variable reference |
| [DATABASE.md](DATABASE.md) | Migrations, seed, backup |
| [client-confirmation/SECURITY-CONFIRMATION.md](client-confirmation/SECURITY-CONFIRMATION.md) | Security controls and proofs |
| [client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](client-confirmation/MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md) | Entra app registration |
