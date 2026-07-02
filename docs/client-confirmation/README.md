# Client confirmation documentation

Security and compliance documentation for Taxteck Email Auto.

## Primary documents

| Document | Description |
|----------|-------------|
| [SECURITY-CONFIRMATION.md](SECURITY-CONFIRMATION.md) | **Main questionnaire response** and security controls matrix |
| [CLIENT-SECURITY-BRIEF.md](CLIENT-SECURITY-BRIEF.md) | **Client-facing summary** — public links, uploads, logout, and data flow diagrams |
| [pdfs/CLIENT-SECURITY-DATA-FLOW.pdf](pdfs/CLIENT-SECURITY-DATA-FLOW.pdf) | **Data flow diagrams (PDF)** — generate with `npm run docs:security-dataflow-pdf` |
| [MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md](MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md) | Entra app registration for EmailConfig |

## Supporting documents

| Document | Description |
|----------|-------------|
| [04-vulnerability-and-secure-coding-validation.md](04-vulnerability-and-secure-coding-validation.md) | OWASP alignment, secure coding, dependency management |
| [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md) | Application and dependency patch process |
| [dependency-scan-instructions.md](dependency-scan-instructions.md) | How to run and archive `npm audit` |

## Deployment and configuration

| Document | Description |
|----------|-------------|
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Production deployment guide |
| [../ENVIRONMENT.md](../ENVIRONMENT.md) | Environment variable reference |
| [../DATABASE.md](../DATABASE.md) | Database setup and backup |
