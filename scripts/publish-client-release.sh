#!/usr/bin/env bash
# Build client delivery package and push to origin/client-delivery + client repo main.
#
# Usage:
#   npm run client:publish
#   bash scripts/publish-client-release.sh
#
# Optional env vars:
#   NEXT_PUBLIC_APP_BASE_URL  (default: https://confirm.example.com)
#   CLIENT_DELIVERY_DIR         (default: ../email-auto-client-delivery)
#   SKIP_MAIN_PUSH=1            skip commit/push on main
#   SKIP_SMOKE_TEST=1           skip migrate/seed smoke test
#   COMMIT_MSG                  custom client-delivery commit message

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NEXT_PUBLIC_APP_BASE_URL="${NEXT_PUBLIC_APP_BASE_URL:-https://confirm.example.com}"
STAGING="$ROOT/client-release-staging"
CLIENT_REMOTE="${CLIENT_REMOTE:-https://github.com/MohmmadaliPatel/receivable-tracker-1-cl.git}"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-https://github.com/MohmmadaliPatel/receivable-tracker-1.git}"

is_git_repo() {
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

find_client_delivery_worktree() {
  git worktree list --porcelain | awk '
    $1 == "worktree" { path = $2 }
    $1 == "branch" && $2 ~ /client-delivery$/ { print path; exit }
  '
}

resolve_client_delivery_dir() {
  local candidate="${1:-}"

  if [[ -n "$candidate" ]] && is_git_repo "$candidate"; then
    cd "$candidate" && pwd
    return 0
  fi

  local from_worktree
  from_worktree="$(find_client_delivery_worktree || true)"
  if [[ -n "$from_worktree" ]] && is_git_repo "$from_worktree"; then
    cd "$from_worktree" && pwd
    return 0
  fi

  return 1
}

CLIENT_DELIVERY_DIR="${CLIENT_DELIVERY_DIR:-$ROOT/../email-auto-client-delivery}"
if ! CLIENT_DELIVERY_DIR="$(resolve_client_delivery_dir "$CLIENT_DELIVERY_DIR")"; then
  CLIENT_DELIVERY_DIR="${CLIENT_DELIVERY_DIR:-$ROOT/../email-auto-client-delivery}"
fi

echo ""
echo "============================================================"
echo " Publish client delivery package"
echo "============================================================"
echo " Source repo:     $ROOT"
echo " Client worktree: $CLIENT_DELIVERY_DIR"
echo " Build URL:       $NEXT_PUBLIC_APP_BASE_URL"
echo "============================================================"
echo ""

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git not found." >&2; exit 1; }

MAIN_SHA="$(git rev-parse --short HEAD)"

if [[ "${SKIP_MAIN_PUSH:-}" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted source changes detected on main."
  read -r -p "Commit and push to origin/main before client build? [y/N]: " PUSH_MAIN
  if [[ "$PUSH_MAIN" =~ ^[Yy]$ ]]; then
    read -r -p "Commit message for main: " MAIN_MSG
    MAIN_MSG="${MAIN_MSG:-Update source before client delivery build.}"
    git add -A
    git commit -m "$MAIN_MSG"
    git push origin main
    MAIN_SHA="$(git rev-parse --short HEAD)"
    echo "Main branch pushed at $MAIN_SHA"
    echo ""
  fi
fi

echo "==> Building client release package..."
NEXT_PUBLIC_APP_BASE_URL="$NEXT_PUBLIC_APP_BASE_URL" npm run client:prepare

[[ -f "$STAGING/server.js" ]] || { echo "ERROR: $STAGING/server.js not found after build." >&2; exit 1; }

rm -rf "$STAGING/node_modules" "$STAGING/dev.db" "$STAGING/.env" "$STAGING/.DS_Store"

echo "==> Updating package-lock.json in staging..."
(cd "$STAGING" && npm install --omit=dev --no-audit --no-fund --package-lock-only)

if [[ "${SKIP_SMOKE_TEST:-}" != "1" ]]; then
  echo "==> Smoke test: fresh install, migrate, seed..."
  (
    cd "$STAGING"
    cat > .env <<EOF
NODE_ENV=production
DATABASE_URL="file:./dev.db"
EMAIL_ACTION_JWT_SECRET=smoke-test-secret-at-least-32-chars-long
NEXT_PUBLIC_APP_BASE_URL=$NEXT_PUBLIC_APP_BASE_URL
CRON_API_SECRET=smoke-test-cron-secret-long-enough
DEMO_MODE=false
EOF
    npm install --omit=dev --no-audit --no-fund
    npm run db:migrate
    FORCE_SEED=1 npm run db:seed
    rm -rf node_modules dev.db .env
  )
  echo "Smoke test passed."
  echo ""
fi

if ! is_git_repo "$CLIENT_DELIVERY_DIR"; then
  echo "Client delivery git worktree not found."
  echo "  Tried: ${CLIENT_DELIVERY_DIR:-$ROOT/../email-auto-client-delivery}"
  echo ""
  if [[ -e "${CLIENT_DELIVERY_DIR:-$ROOT/../email-auto-client-delivery}" ]]; then
    echo "That path exists but is not a git worktree."
    echo "If this repo already has a worktree, run: git worktree list"
    echo ""
  fi
  read -r -p "Create a new client-delivery worktree at ../email-auto-client-delivery? [y/N]: " ADD_WORKTREE
  if [[ "$ADD_WORKTREE" =~ ^[Yy]$ ]]; then
    TARGET="$ROOT/../email-auto-client-delivery"
    if [[ -e "$TARGET" ]]; then
      echo "ERROR: $TARGET already exists. Remove it or set CLIENT_DELIVERY_DIR to an empty path." >&2
      exit 1
    fi
    git fetch origin client-delivery 2>/dev/null || true
    git worktree add -B client-delivery "$TARGET" origin/client-delivery 2>/dev/null || \
      git worktree add -B client-delivery "$TARGET" client-delivery 2>/dev/null || \
      git worktree add -B client-delivery "$TARGET"
    CLIENT_DELIVERY_DIR="$(cd "$TARGET" && pwd)"
  else
    read -r -p "Clone client-delivery into a new folder? [y/N]: " CLONE_CLIENT
    if [[ "$CLONE_CLIENT" =~ ^[Yy]$ ]]; then
      read -r -p "Clone path: " CLONE_PATH
      CLONE_PATH="${CLONE_PATH:-$ROOT/../receivable-tracker-1-cl-worktree}"
      if [[ -e "$CLONE_PATH" ]]; then
        echo "ERROR: $CLONE_PATH already exists." >&2
        exit 1
      fi
      git clone -b client-delivery "$ORIGIN_REMOTE" "$CLONE_PATH" 2>/dev/null || {
        git clone "$CLIENT_REMOTE" "$CLONE_PATH"
        git -C "$CLONE_PATH" fetch origin client-delivery 2>/dev/null || true
        git -C "$CLONE_PATH" checkout client-delivery 2>/dev/null || git -C "$CLONE_PATH" checkout -b client-delivery
      }
      CLIENT_DELIVERY_DIR="$(cd "$CLONE_PATH" && pwd)"
    else
      echo "Set CLIENT_DELIVERY_DIR to your client-delivery git worktree and re-run." >&2
      exit 1
    fi
  fi
fi

echo "Using client worktree: $CLIENT_DELIVERY_DIR"
BRANCH="$(git -C "$CLIENT_DELIVERY_DIR" branch --show-current)"
if [[ "$BRANCH" != "client-delivery" ]]; then
  echo "WARNING: worktree is on branch '$BRANCH' (expected client-delivery)."
fi
echo ""
echo "==> Syncing staging to client worktree..."
rsync -a --delete --exclude='.git' --exclude='node_modules' "$STAGING/" "$CLIENT_DELIVERY_DIR/"

git -C "$CLIENT_DELIVERY_DIR" remote get-url client >/dev/null 2>&1 || git -C "$CLIENT_DELIVERY_DIR" remote add client "$CLIENT_REMOTE"
git -C "$CLIENT_DELIVERY_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$CLIENT_DELIVERY_DIR" remote add origin "$ORIGIN_REMOTE"

BUILD_LINE=""
[[ -f "$CLIENT_DELIVERY_DIR/BUILD_INFO.txt" ]] && BUILD_LINE="$(grep '^Built:' "$CLIENT_DELIVERY_DIR/BUILD_INFO.txt" || true)"

if [[ -n "$(git -C "$CLIENT_DELIVERY_DIR" status --porcelain)" ]]; then
  CLIENT_MSG="${COMMIT_MSG:-Client delivery package: production standalone rebuild synced from main ($MAIN_SHA).${BUILD_LINE:+ $BUILD_LINE}}"
  git -C "$CLIENT_DELIVERY_DIR" add -A
  git -C "$CLIENT_DELIVERY_DIR" commit -m "$CLIENT_MSG"
else
  echo "No changes in client worktree — skipping commit."
fi

echo "==> Pushing client-delivery to origin..."
git -C "$CLIENT_DELIVERY_DIR" push origin client-delivery

echo "==> Pushing to client repo (main)..."
git -C "$CLIENT_DELIVERY_DIR" push client client-delivery:main

CLIENT_COMMIT="$(git -C "$CLIENT_DELIVERY_DIR" log -1 --oneline)"

echo ""
echo "============================================================"
echo " Done!"
echo "============================================================"
echo " Main SHA:      $MAIN_SHA"
echo " Client commit: $CLIENT_COMMIT"
echo " Client repo:   $CLIENT_REMOTE (branch: main)"
echo " Origin branch: client-delivery"
echo "============================================================"
echo ""
