# TermiNow Store — Ubuntu deployment & rollback

The storefront is a single Node service (no external runtime dependencies — it uses `node:sqlite`). It
runs as a dedicated **unprivileged** user bound to a **loopback port**, and is published through the
host's **existing LiteSpeed** server as a reverse proxy. Nothing here installs or replaces another web
server, and nothing touches ports 80/443 directly or any unrelated site or service.

> **Deployment status:** the artifacts in this directory are prepared and validated locally. Turning on
> the public virtual host is **deferred to an explicit checkpoint** and must happen only after the
> hostname/origin and HTTPS are verified. Do not enable checkout on an unverified production hostname.

## Layout on the server

| Path | Purpose | Owner / mode |
|------|---------|--------------|
| `/opt/aivora` | application code (this repo) | `aivora`, read-only to the service |
| `/var/lib/aivora` | SQLite database + `backups/` (only writable path) | `aivora`, `0750` |
| `/etc/aivora/aivora.env` | secrets / config, outside the repo | `root:aivora`, `0640` |
| `/etc/systemd/system/aivora.service` | systemd unit | `root`, `0644` |

## Requirements

- Node `>=22.13` (`command -v node`).
- The host already runs LiteSpeed/CyberPanel on 80/443 (it does).

## First deploy

```bash
sudo mkdir -p /opt/aivora
sudo rsync -a --delete ./ /opt/aivora/        # or: git clone into /opt/aivora
cd /opt/aivora
sudo APP_DIR=/opt/aivora DATA_DIR=/var/lib/aivora scripts/deploy.sh
```

On the first run `deploy.sh` creates the `aivora` user, the data directory, and
`/etc/aivora/aivora.env` from `deploy/aivora.env.example`, then **stops** so you can fill in real values
(canonical origin, port, Devnet mint + recipient token account, delivery settings). Re-run `deploy.sh`
afterwards. It backs up the database, applies migrations, (re)starts the service, and health-checks
`http://127.0.0.1:<PORT>/readyz`, aborting without leaving a broken service if the check fails.

Verify the loopback service directly (no public exposure yet):

```bash
curl -fsS http://127.0.0.1:<PORT>/healthz   # liveness
curl -fsS http://127.0.0.1:<PORT>/readyz    # readiness (touches the DB)
systemctl status aivora
journalctl -u aivora -n 50
```

## Updating

```bash
cd /opt/aivora && sudo git pull    # or rsync the new tree
sudo scripts/deploy.sh             # backup → migrate → restart → health-check
```

## Publishing the site through LiteSpeed (deferred checkpoint)

Only after DNS points the domain at this host and a certificate is in place:

1. Confirm `AIVORA_CANONICAL_ORIGIN=https://<domain>` in `/etc/aivora/aivora.env` and restart the service.
2. Merge the two blocks from `deploy/litespeed-vhost.conf` into the domain's vhost config
   (`/usr/local/lsws/conf/vhosts/<domain>/vhost.conf` on CyberPanel), replacing `__AIVORA_PORT__` with
   the loopback `PORT`. **Keep a backup of the vhost file first.**
3. Issue/attach the Let's Encrypt certificate for the domain in CyberPanel (existing :443 listener).
4. Validate the config and reload LiteSpeed gracefully:
   ```bash
   sudo cp /usr/local/lsws/conf/vhosts/<domain>/vhost.conf{,.bak-$(date +%s)}
   sudo /usr/local/lsws/bin/lswsctrl restart       # graceful; verify both TermiNow Store AND existing sites after
   ```
5. If anything regresses (TermiNow Store or an existing site), restore the `.bak` vhost file and reload again.

## Rollback

```bash
# Database only (service is stopped first; previous DB saved as <db>.pre-restore-*):
sudo scripts/rollback.sh --db /var/lib/aivora/backups/aivora-<timestamp>.sqlite

# Code only, or both:
sudo scripts/rollback.sh --code <git-ref>
sudo scripts/rollback.sh --db <backup.sqlite> --code <git-ref>
```

Manual database restore (equivalent):

```bash
sudo systemctl stop aivora
sudo -u aivora AIVORA_DB=/var/lib/aivora/aivora.sqlite node scripts/restore.mjs <backup.sqlite>
sudo systemctl start aivora
```

## Admin access

Admin roles are assigned **only** out-of-band — there is no API or signup path:

```bash
sudo -u aivora AIVORA_DB=/var/lib/aivora/aivora.sqlite node scripts/admin.mjs grant you@example.com superadmin
sudo -u aivora AIVORA_DB=/var/lib/aivora/aivora.sqlite node scripts/admin.mjs list
```
