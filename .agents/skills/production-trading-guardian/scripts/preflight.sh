#!/bin/bash
# Local, read-only pre-flight checks — safe to run any time, never touches
# production. Confirms the tree is clean (or shows what would deploy), that
# the build actually passes, and flags any DB migration that isn't obviously
# idempotent (a non-idempotent migration is the #1 way a redeploy corrupts
# production state — see db.server.ts's own additive-migration pattern,
# which always checks table_info/column existence before ALTERing).
set -euo pipefail
cd "$(dirname "$0")/../../../.."

echo "=== git status ==="
git status --short || true
echo

echo "=== uncommitted diff (file list only) ==="
git diff --name-only HEAD || true
echo

echo "=== build ==="
if command -v npm >/dev/null; then
  npm run build
else
  echo "npm not found — run the project's build manually before deploying."
fi
echo

echo "=== migration idempotency scan (src/lib/db.server.ts) ==="
# A CREATE TABLE without IF NOT EXISTS is fine ONLY if it's recreating a table
# just renamed away in the same block (a guarded, one-time rename-migration
# pattern already used in this file for bot_state) — anything else without
# IF NOT EXISTS will error on a redeploy against an existing DB.
bare_creates=$(grep -n "CREATE TABLE" src/lib/db.server.ts | grep -v "IF NOT EXISTS" | cut -d: -f1)
flagged=0
for line in $bare_creates; do
  if sed -n "$((line - 8)),${line}p" src/lib/db.server.ts | grep -q "RENAME TO"; then
    echo "✓ line $line: bare CREATE TABLE, but preceded by a RENAME TO in the same block — expected (rename-migration pattern), not a bug."
  else
    echo "✗ line $line: CREATE TABLE without IF NOT EXISTS and no preceding RENAME TO — will fail on a redeploy against an existing DB:"
    sed -n "${line}p" src/lib/db.server.ts
    flagged=1
  fi
done
if [ -z "$bare_creates" ]; then
  echo "✓ every CREATE TABLE uses IF NOT EXISTS."
elif [ "$flagged" -eq 0 ]; then
  echo "✓ no unexplained bare CREATE TABLE found."
fi
if grep -n "ADD COLUMN" src/lib/db.server.ts | grep -vB2 "table_info\|has(" >/dev/null 2>&1; then
  echo "⚠ found an ADD COLUMN — confirm manually it's guarded by a table_info/column-existence check nearby (grep the surrounding ~10 lines)."
fi
echo "Pre-flight done — this only checked what's SAFE to check locally. Deploy, restart, and rollback steps in SKILL.md still need a human at the keyboard."
