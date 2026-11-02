#!/usr/bin/env bash
# TermiNow Store — rollback script.
#
# Restores the database from a snapshot and/or reverts the code to a previous commit, then restarts and
# health-checks the loopback service. The service is stopped before the database is swapped (restore
# itself keeps a pre-restore safety copy, so this is reversible).
#
#   sudo scripts/rollback.sh --db <backup.sqlite>         # restore database only
#   sudo scripts/rollback.sh --code <git-ref>             # revert code only
#   sudo scripts/rollback.sh --db <backup.sqlite> --code <git-ref>
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aivora}"
DATA_DIR="${DATA_DIR:-/var/lib/aivora}"
ENV_FILE="${ENV_FILE:-/etc/aivora/aivora.env}"
SERVICE_USER="${SERVICE_USER:-aivora}"
UNIT="aivora.service"
NODE_BIN="$(command -v node || true)"
DB_BACKUP=""; CODE_REF=""

log() { printf '[rollback] %s\n' "$*"; }
die() { printf '[rollback] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_BACKUP="${2:-}"; shift 2;;
    --code) CODE_REF="${2:-}"; shift 2;;
    *) die "unknown argument: $1";;
  esac
done
[ -n "$DB_BACKUP$CODE_REF" ] || die "nothing to do: pass --db <backup> and/or --code <ref>"
[ "$(id -u)" -eq 0 ] || die "run as root"
[ -n "$NODE_BIN" ] || die "node not found on PATH"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
export AIVORA_DB="${AIVORA_DB:-$DATA_DIR/aivora.sqlite}"

log "stopping $UNIT"
systemctl stop "$UNIT" || true

if [ -n "$DB_BACKUP" ]; then
  [ -f "$DB_BACKUP" ] || die "backup not found: $DB_BACKUP"
  log "restoring database from $DB_BACKUP (previous DB saved as <db>.pre-restore-*)"
  sudo -u "$SERVICE_USER" env AIVORA_DB="$AIVORA_DB" "$NODE_BIN" "$APP_DIR/scripts/restore.mjs" "$DB_BACKUP"
fi

if [ -n "$CODE_REF" ]; then
  log "reverting code to $CODE_REF"
  git -C "$APP_DIR" fetch --quiet --all || true
  git -C "$APP_DIR" checkout --quiet "$CODE_REF"
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
  log "applying migrations for $CODE_REF"
  sudo -u "$SERVICE_USER" env AIVORA_DB="$AIVORA_DB" "$NODE_BIN" "$APP_DIR/scripts/migrate.mjs"
fi

log "starting $UNIT"
systemctl start "$UNIT"

HEALTH_PORT="${PORT:-3000}"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/readyz" >/dev/null 2>&1; then
    log "healthy on 127.0.0.1:${HEALTH_PORT}. Rollback complete."; exit 0
  fi
  sleep 0.5
done
die "service did not become healthy after rollback — see: journalctl -u $UNIT -n 50"
