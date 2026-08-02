#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
BUILD_DIR="${BUILD_DIR:-/home/ubuntu/app-build}"
RELEASES_DIR="${RELEASES_DIR:-/home/ubuntu/releases}"
BACKUPS_DIR="${BACKUPS_DIR:-/home/ubuntu/backups}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/deploy-logs}"
LOCK_FILE="${LOCK_FILE:-/home/ubuntu/.lio23-deploy.lock}"
REMOTE="${REMOTE:-github-lio23:nludoviic-alt/lio23-vortex.git}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-lio23}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-15}"
KEEP_RELEASES="${KEEP_RELEASES:-10}"
KEEP_DB_BACKUPS="${KEEP_DB_BACKUPS:-20}"
MODE="${1:-deploy}"
SOURCE_ARCHIVE="${2:-}"
UPLOAD_BUILD_DIR="${UPLOAD_BUILD_DIR:-/home/ubuntu/app-build-upload}"

mkdir -p "$RELEASES_DIR" "$BACKUPS_DIR" "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy] another deployment or rollback is already running" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file="$LOG_DIR/deploy-$timestamp.log"
exec > >(tee -a "$log_file") 2>&1

log() {
  printf '[deploy] %s\n' "$*"
}

read_db_path() {
  sed -n 's/^DB_PATH=//p' "$APP_DIR/.env" | tail -1
}

check_database() {
  local db_path="$1"
  [ -f "$db_path" ] && [ "$(sqlite3 "$db_path" "PRAGMA quick_check;" 2>/dev/null)" = "ok" ]
}

backup_database() {
  local db_path="$1"
  local backup_path="$BACKUPS_DIR/lio23-$timestamp.db"
  log "backing up SQLite to $backup_path"
  sqlite3 "$db_path" ".timeout 10000" ".backup '$backup_path'"
  check_database "$backup_path"
  find "$BACKUPS_DIR" -maxdepth 1 -type f -name 'lio23-*.db' -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n "+$((KEEP_DB_BACKUPS + 1))" \
    | cut -d' ' -f2- \
    | xargs -r rm -f
}

activate_release() {
  local output_dir="$1"
  local next_link="$APP_DIR/.output.next"
  rm -f "$next_link"
  ln -s "$output_dir" "$next_link"
  mv -Tf "$next_link" "$APP_DIR/.output"
}

ensure_release_layout() {
  if [ -L "$APP_DIR/.output" ]; then
    return
  fi
  if [ ! -d "$APP_DIR/.output" ]; then
    log "no active .output directory found" >&2
    exit 1
  fi

  local bootstrap="$RELEASES_DIR/$timestamp-bootstrap"
  log "adopting current build as $bootstrap"
  mkdir -p "$bootstrap"
  mv "$APP_DIR/.output" "$bootstrap/.output"
  activate_release "$bootstrap/.output"
  printf '%s\n' "bootstrap from pre-rollback deployment" > "$bootstrap/manifest.txt"
}

health_check() {
  local db_path="$1"
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if systemctl is-active --quiet "$SERVICE" \
      && curl -fsS --max-time 3 "$HEALTH_URL" | grep -q '"ok":true' \
      && check_database "$db_path"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

restore_previous() {
  local previous_output="$1"
  local db_path="$2"
  log "health check failed; restoring $previous_output"
  activate_release "$previous_output"
  sudo systemctl restart "$SERVICE"
  if health_check "$db_path"; then
    log "rollback successful"
    return 0
  fi
  log "CRITICAL: previous release did not recover" >&2
  sudo journalctl -u "$SERVICE" -n 80 --no-pager || true
  return 1
}

prune_releases() {
  local active
  active="$(readlink -f "$APP_DIR/.output")"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n "+$((KEEP_RELEASES + 1))" \
    | cut -d' ' -f2- \
    | while IFS= read -r release; do
        [ -n "$release" ] || continue
        if [ "$(readlink -f "$release/.output" 2>/dev/null || true)" != "$active" ]; then
          rm -rf "$release"
        fi
      done
}

ensure_release_layout
previous_output="$(readlink -f "$APP_DIR/.output")"
db_path="$(read_db_path)"
if [ -z "$db_path" ]; then
  log "DB_PATH is missing from $APP_DIR/.env" >&2
  exit 1
fi
check_database "$db_path"

if [ "$MODE" = "--bootstrap-only" ]; then
  log "release layout ready; active output is $previous_output"
  exit 0
fi

backup_database "$db_path"

if [ "$MODE" = "--self-test-failure" ]; then
  HEALTH_ATTEMPTS=3
  release="$RELEASES_DIR/$timestamp-self-test-broken"
  mkdir -p "$release/.output/server"
  printf '%s\n' "intentional broken release used to verify automatic rollback" > "$release/manifest.txt"
elif [ "$MODE" = "--self-test-success" ]; then
  release="$RELEASES_DIR/$timestamp-self-test-healthy"
  mkdir -p "$release"
  cp -a "$previous_output" "$release/.output"
  printf '%s\n' "copy of active release used to verify the healthy activation path" > "$release/manifest.txt"
elif [ "$MODE" = "--source-archive" ]; then
  archive_path="$(readlink -f "$SOURCE_ARCHIVE")"
  case "$archive_path" in
    /home/ubuntu/incoming/*.tgz) ;;
    *)
      log "source archive must be a .tgz file inside /home/ubuntu/incoming" >&2
      exit 2
      ;;
  esac
  if [ ! -f "$archive_path" ]; then
    log "source archive not found: $archive_path" >&2
    exit 2
  fi

  log "extracting uploaded workspace"
  rm -rf "$UPLOAD_BUILD_DIR"
  mkdir -p "$UPLOAD_BUILD_DIR"
  tar -xzf "$archive_path" -C "$UPLOAD_BUILD_DIR"
  cp "$APP_DIR/.env" "$UPLOAD_BUILD_DIR/.env"

  log "installing dependencies for uploaded workspace"
  (cd "$UPLOAD_BUILD_DIR" && npm ci --no-audit --no-fund)

  log "building uploaded workspace while the current release remains live"
  rm -rf "$UPLOAD_BUILD_DIR/.output"
  (cd "$UPLOAD_BUILD_DIR" && npm run build)

  source_hash="$(sha256sum "$archive_path" | cut -c1-12)"
  release="$RELEASES_DIR/$timestamp-local-$source_hash"
  mkdir -p "$release"
  mv "$UPLOAD_BUILD_DIR/.output" "$release/.output"
  {
    printf 'source=uploaded-workspace\n'
    printf 'sha256=%s\n' "$source_hash"
    printf 'created_at=%s\n' "$timestamp"
  } > "$release/manifest.txt"
else
  if [ "$MODE" != "deploy" ]; then
    echo "Usage: $0 [deploy|--bootstrap-only|--self-test-success|--self-test-failure|--source-archive FILE]" >&2
    exit 2
  fi

  log "preparing isolated build checkout"
  if [ ! -d "$BUILD_DIR/.git" ]; then
    git clone "$REMOTE" "$BUILD_DIR"
  fi
  git -C "$BUILD_DIR" fetch origin "$BRANCH"
  git -C "$BUILD_DIR" reset --hard "origin/$BRANCH"
  cp "$APP_DIR/.env" "$BUILD_DIR/.env"

  log "installing dependencies"
  (cd "$BUILD_DIR" && npm ci --no-audit --no-fund)

  log "building while the current release remains live"
  rm -rf "$BUILD_DIR/.output"
  (cd "$BUILD_DIR" && npm run build)

  sha="$(git -C "$BUILD_DIR" rev-parse --short HEAD)"
  release="$RELEASES_DIR/$timestamp-$sha"
  mkdir -p "$release"
  mv "$BUILD_DIR/.output" "$release/.output"
  {
    printf 'commit=%s\n' "$sha"
    printf 'created_at=%s\n' "$timestamp"
    printf 'branch=%s\n' "$BRANCH"
  } > "$release/manifest.txt"
fi

log "activating $release"
activate_release "$release/.output"

interrupted=0
trap 'interrupted=1' INT TERM HUP
sudo systemctl restart "$SERVICE"

if health_check "$db_path"; then
  trap - INT TERM HUP
  if [ "$MODE" = "--self-test-failure" ]; then
    log "self-test unexpectedly became healthy" >&2
    restore_previous "$previous_output" "$db_path"
    exit 1
  fi
  log "health check OK; release is live"
  prune_releases
  exit 0
fi

trap - INT TERM HUP
restore_previous "$previous_output" "$db_path"
rm -rf "$release"

if [ "$MODE" = "--self-test-failure" ]; then
  log "self-test passed: the broken release was rejected and rolled back"
  exit 0
fi

if [ "$interrupted" -eq 1 ]; then
  log "deployment interrupted and rolled back" >&2
else
  log "deployment rejected and rolled back" >&2
fi
exit 1
