#!/usr/bin/env bash
# Assembles a production client delivery folder (standalone build + prisma + docs).
# Usage: NEXT_PUBLIC_APP_BASE_URL=https://your.domain npm run client:prepare
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/client-release-staging}"
BASE_URL="${NEXT_PUBLIC_APP_BASE_URL:-https://confirm.example.com}"

echo "==> Building with NEXT_PUBLIC_APP_BASE_URL=$BASE_URL"
cd "$ROOT"
NEXT_PUBLIC_APP_BASE_URL="$BASE_URL" npm run build

STANDALONE="$ROOT/.next/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "ERROR: .next/standalone/server.js not found after build" >&2
  exit 1
fi

echo "==> Staging client package at $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

cp -R "$STANDALONE/." "$OUT/"
mkdir -p "$OUT/.next"
cp -R "$ROOT/.next/static" "$OUT/.next/static"
rm -rf "$OUT/public"
cp -R "$ROOT/public" "$OUT/public"

mkdir -p "$OUT/prisma"
cp "$ROOT/prisma/schema.prisma" "$OUT/prisma/"
cp "$ROOT/prisma/seed.ts" "$OUT/prisma/"
cp -R "$ROOT/prisma/migrations" "$OUT/prisma/"

mkdir -p "$OUT/docs/client-confirmation/evidence"
cp "$ROOT/README.md" "$OUT/"
cp "$ROOT/docs/DEPLOYMENT.md" "$OUT/docs/"
cp "$ROOT/docs/ENVIRONMENT.md" "$OUT/docs/"
cp "$ROOT/docs/DATABASE.md" "$OUT/docs/"

CLIENT_DOCS=(
  SECURITY-CONFIRMATION.md
  MICROSOFT-ENTRA-ADMIN-CENTER-STEPS.md
  04-vulnerability-and-secure-coding-validation.md
  PATCH-MANAGEMENT.md
  dependency-scan-instructions.md
  README.md
)
for f in "${CLIENT_DOCS[@]}"; do
  if [ -f "$ROOT/docs/client-confirmation/$f" ]; then
    cp "$ROOT/docs/client-confirmation/$f" "$OUT/docs/client-confirmation/"
  else
    echo "WARN: missing docs/client-confirmation/$f — skipped" >&2
  fi
done
if [ -f "$ROOT/docs/client-confirmation/evidence/README.md" ]; then
  cp "$ROOT/docs/client-confirmation/evidence/README.md" "$OUT/docs/client-confirmation/evidence/"
fi

if [ -d "$ROOT/docs/client-confirmation/pdfs" ]; then
  cp -R "$ROOT/docs/client-confirmation/pdfs" "$OUT/docs/client-confirmation/"
fi

cp "$ROOT/env.ubuntu-server.example" "$OUT/"

# Next.js standalone file tracing may copy source and dev files — remove for client delivery.
rm -rf \
  "$OUT/src" \
  "$OUT/scripts" \
  "$OUT/sample" \
  "$OUT/configure.bat" \
  "$OUT/setup-demo.bat" \
  "$OUT/setup-demo.sh" \
  "$OUT/start.bat" \
  "$OUT/setup.bat" \
  "$OUT/env-demo.txt" \
  "$OUT/sample-env.txt" \
  "$OUT/REGENERATE_PRISMA.md" \
  "$OUT/next.config.ts" \
  "$OUT/tsconfig.json" \
  "$OUT/tsconfig.tsbuildinfo" \
  "$OUT/postcss.config.mjs" \
  "$OUT/migrate-recipient-to-sender.sql" \
  "$OUT/dev.db" \
  "$OUT/emails" \
  "$OUT/logs" \
  "$OUT/attachments" \
  "$OUT/uploads" \
  "$OUT/.env" \
  "$OUT/Security-Questionnaire-Responses.md" \
  "$OUT/docs.zip" \
  "$OUT/backups" \
  "$OUT/client-release-staging" \
  "$OUT/public/2026-06-11-ZAP-POSTFIX-verification.txt" \
  "$OUT/public/2026-06-11-ZAP-Report-.html" \
  "$OUT/prisma/dev.db" \
  "$OUT/prisma/dev-smoke.db" \
  "$OUT/prisma/dev-csp-smoke.db" \
  "$OUT/prisma/dev123.db" \
  "$OUT/prisma/backups" \
  2>/dev/null || true

trim_client_package_json() {
  CLIENT_PKG="$1" node -e '
const fs = require("fs");
const path = process.env.CLIENT_PKG;
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.name = "taxteck-email-auto";
pkg.private = true;
pkg.scripts = {
  start: "node server.js",
  postinstall: "prisma generate",
  "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "security:audit": "npm audit --audit-level=moderate",
};
pkg.prisma = { seed: "tsx prisma/seed.ts" };
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies.prisma = pkg.dependencies.prisma || "^6.8.2";
pkg.dependencies.tsx = pkg.dependencies.tsx || "^4.19.2";
delete pkg.devDependencies;
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
'
}

trim_client_package_json "$OUT/package.json"

cat > "$OUT/.gitignore" <<'EOF'
.env
.env.*
!.env.example
node_modules/
node_modules/.cache
*.log
dev.db
prisma/dev.db
emails/
attachments/
uploads/
logs/
.DS_Store
EOF

cat > "$OUT/BUILD_INFO.txt" <<EOF
Taxteck Email Auto — client release package
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
NEXT_PUBLIC_APP_BASE_URL=$BASE_URL
Node: $(node -v)
EOF

echo "==> Installing prisma + tsx in staging package (for migrate/seed)"
cd "$OUT"
npm install prisma@^6.8.2 tsx@^4.19.2 --save --omit=dev --no-audit --no-fund 2>/dev/null || npm install prisma@^6.8.2 tsx@^4.19.2 --save --no-audit --no-fund

trim_client_package_json "$OUT/package.json"

cp "$ROOT/scripts/client-setup.bat" "$OUT/setup.bat"
cp "$ROOT/scripts/client-start.bat" "$OUT/start.bat"

echo "==> Done. Package ready at: $OUT"
echo "    Public URL baked into build: $BASE_URL"
