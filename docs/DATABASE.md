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

## Related

- [DEPLOYMENT.md](DEPLOYMENT.md)
- [ENVIRONMENT.md](ENVIRONMENT.md)
