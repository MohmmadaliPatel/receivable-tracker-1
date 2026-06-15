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
7. **Verify** `.env` against [ENVIRONMENT.md](../ENVIRONMENT.md) for any new variables.
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

Archive audit output to `docs/client-confirmation/evidence/dependency-audit-YYYY-MM-DD.txt`.

---

## Entra secret rotation

1. Create a new client secret in Microsoft Entra admin center.
2. Update the EmailConfig in the application UI with the new secret value.
3. Click **Validate** to confirm token acquisition.
4. Delete the old secret in Entra.
5. Record rotation date in your credential register.

See [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md).

---

## Emergency security response

On critical vulnerability notification:

1. Assess exposure (internet-facing, data sensitivity).
2. Apply vendor patch or mitigating configuration immediately.
3. Rotate affected secrets (`EMAIL_ACTION_JWT_SECRET`, `CRON_API_SECRET`, Entra secret) if compromise is possible.
4. Review audit logs for anomalous activity.
5. Document incident and remediation.

---

## Related

- [dependency-scan-instructions.md](dependency-scan-instructions.md)
- [DEPLOYMENT.md](../DEPLOYMENT.md)
