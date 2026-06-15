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
npm audit --audit-level=moderate 2>&1 | tee docs/client-confirmation/evidence/dependency-audit-$(date +%Y-%m-%d).txt
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

## Related

- [04-vulnerability-and-secure-coding-validation.md](04-vulnerability-and-secure-coding-validation.md)
- [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md)
