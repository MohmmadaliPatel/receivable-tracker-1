# Database notes (development)

For **production deployment**, see [docs/DATABASE.md](docs/DATABASE.md).

## Quick commands

```bash
npm run db:migrate    # apply migrations
npm run db:push       # sync schema (development only)
npm run db:seed       # bootstrap admin (dev; use FORCE_SEED=1 in controlled prod setup)
```

Postinstall runs `prisma generate` automatically.

## Regenerating Prisma client

If the client is out of sync after schema changes:

1. Stop the running server.
2. `npx prisma generate`
3. Restart.

If file-lock errors occur, close editors and retry in a fresh shell.
