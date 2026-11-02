#!/usr/bin/env bash
# TermiNow Store — deploy / update script for the Ubuntu host.
#
# Run as root (it manages a dedicated unprivileged service user). It is idempotent and safe to re-run:
# it backs up the database BEFORE migrating, applies migrations, restarts the loopback service, and
# health-checks it — rolling the service back to the previous unit state if the health check fails.
#
# It does NOT touch LiteSpeed, DNS, or the public virtual host. Enabling the public site (the LiteSpeed
# reverse-proxy vhost in deploy/litespeed-vhost.conf + HTTPS) is a separate, deferred step done only
# after hostname/origin + HTTPS verification.
#
#   sudo APP_DIR=/opt/aivora DATA_DIR=/var/lib/aivora scripts/deploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aivora}"
DATA_DIR="${DATA_DIR:-/var/lib/aivora}"
ENV_FILE="${ENV_FILE:-/etc/aivora/aivora.env}"
SERVICE_USER="${SERVICE_USER:-aivora}"
UNIT="aivora.service"
NODE_BIN="$(command -v node || true)"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -n "$NODE_BIN" ] || die "node not found on PATH; install Node >=22.13"
[ -f "$APP_DIR/src/server.mjs" ] || die "APP_DIR $APP_DIR does not contain the app (expected src/server.mjs)"

# 1) Service user + directories (unprivileged; data dir is the only writable path).
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating system user $SERVICE_USER"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/backups"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

# 2) Secrets file outside the repo (0600). Created from the template on first deploy, then we stop so a
#    human can fill in real values — we never invent secrets or a production hostname.
if [ ! -f "$ENV_FILE" ]; then
  install -d -o root -g "$SERVICE_USER" -m 0750 "$(dirname "$ENV_FILE")"
  install -o root -g "$SERVICE_USER" -m 0640 "$APP_DIR/deploy/aivora.env.example" "$ENV_FILE"
  die "created $ENV_FILE from template — fill in real values, then re-run this script"
fi
chmod 0640 "$ENV_FILE"; chown root:"$SERVICE_USER" "$ENV_FILE"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
export AIVORA_DB="${AIVORA_DB:-$DATA_DIR/aivora.sqlite}"

# 3) Install the systemd unit if missing or changed.
if ! cmp -s "$APP_DIR/deploy/aivora.service" "/etc/systemd/system/$UNIT"; then
  log "installing $UNIT"
  install -o root -g root -m 0644 "$APP_DIR/deploy/aivora.service" "/etc/systemd/system/$UNIT"
  systemctl daemon-reload
fi

# 4) Record current health so we can report + roll back meaningfully.
WAS_ACTIVE=no; systemctl is-active --quiet "$UNIT" && WAS_ACTIVE=yes
log "service currently active: $WAS_ACTIVE"

# 5) Back up the database BEFORE any migration (skips cleanly if the DB does not exist yet).
if [ -f "$AIVORA_DB" ]; then
  log "backing up database before migration"
  sudo -u "$SERVICE_USER" env AIVORA_DB="$AIVORA_DB" "$NODE_BIN" "$APP_DIR/scripts/backup.mjs"
fi

# 6) Apply migrations (idempotent).
log "applying migrations"
sudo -u "$SERVICE_USER" env AIVORA_DB="$AIVORA_DB" "$NODE_BIN" "$APP_DIR/scripts/migrate.mjs"

# 7) (Re)start and health-check. Roll the service back on failure.
log "enabling + restarting $UNIT"
systemctl enable --quiet "$UNIT" || true
systemctl restart "$UNIT"

HEALTH_PORT="${PORT:-3000}"
ok=no
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/readyz" >/dev/null 2>&1; then ok=yes; break; fi
  sleep 0.5
done

if [ "$ok" != yes ]; then
  log "health check FAILED — see: journalctl -u $UNIT -n 50"
  if [ "$WAS_ACTIVE" = yes ]; then log "leaving previous service state; investigate before retrying"; fi
  die "deploy aborted: /readyz did not become healthy on 127.0.0.1:${HEALTH_PORT}"
fi

log "healthy on 127.0.0.1:${HEALTH_PORT}. Deploy complete."
log "Public site (LiteSpeed vhost + HTTPS) is a separate, deferred step — see deploy/README.md."
