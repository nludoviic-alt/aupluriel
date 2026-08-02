#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
RELEASES_DIR="${RELEASES_DIR:-/home/ubuntu/releases}"
BACKUPS_DIR="${BACKUPS_DIR:-/home/ubuntu/backups}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/deploy-logs}"
LOCK_FILE="${LOCK_FILE:-/home/ubuntu/.lio23-deploy.lock}"
SERVICE="${SERVICE:-lio23}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

mkdir -p "$BACKUPS_DIR" "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[rollback] another deployment or rollback is already running" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
exec > >(tee -a "$LOG_DIR/rollback-$timestamp.log") 2>&1

active="$(readlink -f "$APP_DIR/.output")"
requested="${1:-}"

if [ "$requested" = "--list" ]; then
  printf 'ACTIVE  %s\n' "$active"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%TY-%Tm-%Td %TH:%TM  %p\n' | sort -r
  exit 0
fi

if [ -n "$requested" ]; then
  target_release="$(readlink -f "$requested")"
else
  target_release="$(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -rn \
      | cut -d' ' -f2- \
      | while IFS= read -r release; do
          output="$(readlink -f "$release/.output" 2>/dev/null || true)"
          if [ -f "$output/server/index.mjs" ] && [ "$output" != "$active" ]; then
            printf '%s\n' "$release"
            break
          fi
        done
  )"
fi

if [ -z "${target_release:-}" ] || [ ! -f "$target_release/.output/server/index.mjs" ]; then
  echo "[rollback] no valid previous release found" >&2
  exit 1
fi

db_path="$(sed -n 's/^DB_PATH=//p' "$APP_DIR/.env" | tail -1)"
db_backup="$BACKUPS_DIR/lio23-before-manual-rollback-$timestamp.db"
sqlite3 "$db_path" ".timeout 10000" ".backup '$db_backup'"
[ "$(sqlite3 "$db_backup" "PRAGMA quick_check;")" = "ok" ]

activate() {
  local output_dir="$1"
  rm -f "$APP_DIR/.output.next"
  ln -s "$output_dir" "$APP_DIR/.output.next"
  mv -Tf "$APP_DIR/.output.next" "$APP_DIR/.output"
}

healthy() {
  systemctl is-active --quiet "$SERVICE" \
    && curl -fsS --max-time 3 "$HEALTH_URL" | grep -q '"ok":true' \
    && [ "$(sqlite3 "$db_path" "PRAGMA quick_check;" 2>/dev/null)" = "ok" ]
}

echo "[rollback] switching from $active to $target_release/.output"
activate "$target_release/.output"
sudo systemctl restart "$SERVICE"

for _ in $(seq 1 15); do
  if healthy; then
    echo "[rollback] complete"
    exit 0
  fi
  sleep 2
done

echo "[rollback] target failed; restoring original release" >&2
activate "$active"
sudo systemctl restart "$SERVICE"
exit 1
