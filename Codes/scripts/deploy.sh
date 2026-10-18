#!/usr/bin/env bash
# Deploy Miss You from this source tree to /home/Debz/Host/missyou and (re)start it.
# Idempotent. Usage: scripts/deploy.sh   (no sudo needed: Caddy runs as this user)
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${MISSYOU_HOST_DIR:-/home/Debz/Host/missyou}"
CADDYFILE="${CADDYFILE:-/home/Debz/Host/saarthi/Caddyfile}"
DOMAIN="missyou.koushikdeb.com"
echo "==> building web"
( cd "$SRC/web" && npm run build --silent )
echo "==> syncing to $DST"
mkdir -p "$DST"/{backend,web,config,prompts,docs,storage,logs}
rsync -a --delete --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.mypy_cache' --exclude '.ruff_cache' "$SRC/backend/" "$DST/backend/"
rsync -a --delete "$SRC/web/dist/" "$DST/web/"
rsync -a "$SRC/config/" "$DST/config/"
rsync -a --delete "$SRC/prompts/" "$DST/prompts/"
rsync -a "$SRC/docs/" "$DST/docs/"
cp "$SRC/deploy/host/"{run.sh,stop.sh,autostart.sh,voicebox.sh,backup.sh} "$DST/"
chmod +x "$DST"/*.sh
echo "==> environment"
install -m 600 "$SRC/.env" "$DST/.env"   # provider keys (AWS/GCP names inside are ignored by the app)
if [ ! -f "$DST/missyou.env" ]; then
  # Same secrets as the source tree so media encrypted there stays readable; production overrides.
  grep -v -E '^(MISSYOU_ENV|MISSYOU_PUBLIC_URL|MISSYOU_SECURE_COOKIES|MISSYOU_STORAGE_DIR)=' "$SRC/missyou.env" > "$DST/missyou.env"
  cat >> "$DST/missyou.env" <<ENV
MISSYOU_ENV=production
MISSYOU_PUBLIC_URL=https://$DOMAIN
MISSYOU_SECURE_COOKIES=true
MISSYOU_STORAGE_DIR=$DST/storage
ENV
  chmod 600 "$DST/missyou.env"
fi
if [ -d "$SRC/storage/objects" ] && [ -z "$(ls -A "$DST/storage/objects" 2>/dev/null)" ]; then
  echo "==> copying existing encrypted media"; rsync -a "$SRC/storage/objects" "$DST/storage/"
fi
echo "==> python env"
if [ ! -x "$DST/backend/.venv/bin/python" ]; then python3.12 -m venv "$DST/backend/.venv"; "$DST/backend/.venv/bin/pip" install -q --upgrade pip wheel; fi
"$DST/backend/.venv/bin/pip" install -q -r "$DST/backend/requirements.txt"
echo "==> start"
"$DST/run.sh"
echo "==> caddy"
if ! grep -q '# >>> missyou' "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak-$(date +%Y%m%d%H%M)"
  printf '\n' >> "$CADDYFILE"; cat "$SRC/deploy/host/Caddyfile.snippet" >> "$CADDYFILE"
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
caddy reload --config "$CADDYFILE" --adapter caddyfile --force
echo "==> cron"
( crontab -l 2>/dev/null | grep -v '# MissYou' ;
  echo "@reboot sleep 65 && $DST/autostart.sh  # MissYou";
  echo "*/5 * * * * $DST/autostart.sh  # MissYou watchdog";
  echo "50 3 * * * flock -n /tmp/missyou_backup.lock $DST/backup.sh >> $DST/logs/backup.log 2>&1  # MissYou backup" ) | crontab -
echo "==> health"
for i in $(seq 1 40); do curl -sf "https://$DOMAIN/api/health" && { echo; echo "deployed: https://$DOMAIN"; exit 0; }; sleep 3; done
echo "warning: https://$DOMAIN/api/health not reachable yet (TLS issuance can take a minute)"
