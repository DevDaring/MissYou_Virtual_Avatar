# Deploy

## This server (current production)
- Live at **https://missyou.koushikdeb.com** (NameSilo A record `missyou` → 154.12.116.152; TLS by Caddy ACME).
- Code is deployed to **/home/Debz/Host/missyou** by `scripts/deploy.sh` (idempotent: builds the PWA, syncs backend/config/prompts/docs, keeps secrets, runs migrations, restarts, installs the Caddy block into `/home/Debz/Host/saarthi/Caddyfile`, reloads Caddy, installs cron).
- Processes (all loopback): API `uvicorn` ×2 on 127.0.0.1:8170, arq workers `cpu` and `gpu`, local voice engine on 127.0.0.1:17493 (from `vendor/`, models kept out of the host folder).
- Data: PostgreSQL 16 database `missyou` (role `missyou`, pgvector), Redis db 7, encrypted media in `/home/Debz/Host/missyou/storage/objects`.
- Cron: `@reboot` + `*/5` watchdog (`autostart.sh`), nightly `backup.sh` 03:50 UTC → `/home/Debz/Host/missyou-backups` (pg_dump + objects, 14 days).
- Logs: `/home/Debz/Host/missyou/logs/*.log` (JSON lines), Caddy access log `/var/log/caddy/missyou.log` (rotated 50 MiB × 5).

```bash
cd /home/Debz/Hackathon/MissYou_Virtual_Avatar/Codes && scripts/deploy.sh      # deploy / redeploy
/home/Debz/Host/missyou/run.sh | stop.sh | autostart.sh                         # operate
cd backend && .venv/bin/python -m app.seed --content                            # (re)create demo "Ma" (~$0.8 xAI)
```

## Fresh Ubuntu VPS (step by step)
1. `sudo apt install -y python3.12 python3.12-venv g++ ffmpeg redis-server postgresql-16 postgresql-16-pgvector caddy nodejs npm`.
2. Postgres: `sudo -u postgres psql -c "create role missyou login password '…'" -c "create database missyou owner missyou"`, then `sudo -u postgres psql -d missyou -c "create extension vector"`.
3. Copy this repo; put provider keys in `.env` (see `.env.example`) and app settings in `missyou.env` (generate `MISSYOU_JWT_SECRET`, `MISSYOU_URL_SECRET`, and a 32-byte urlsafe-base64 `MISSYOU_MEDIA_KEY` — **back it up; media can't be decrypted without it**).
4. `cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/alembic upgrade head`.
5. `cd web && npm ci && npm run build`.
6. DNS A record → VPS IP; add `deploy/host/Caddyfile.snippet` to your Caddyfile (change the `root` path); `sudo systemctl reload caddy`.
7. Start with `deploy/host/run.sh` (copy the host scripts next to `backend/` and `web/`), add the cron lines from `scripts/deploy.sh`.
8. Optional local voice engine: set up the voice engine in `vendor/`, create a venv with CPU torch, run its backend bound to 127.0.0.1 only (see `vendor/voicebox_run.sh`). Without it, voices fall back to Sarvam cloning/presets.
Alternatively `docker compose -f deploy/docker-compose.yml up` brings up Postgres+pgvector, Redis, API, workers and Caddy (see file; untested on this host).

## Remote GPU worker (for lip-sync / restoration / faster cloning)
Run on any pay-as-you-go GPU box: the same `backend/` + `pip install -r requirements.txt`, then
`MISSYOU_QUEUE=gpu MISSYOU_REDIS_URL=rediss://<tunnel> MISSYOU_DATABASE_URL=… arq app.worker.WorkerSettings`.
Expose Redis/Postgres only through an SSH or WireGuard tunnel (`ssh -N -L 6379:127.0.0.1:6379 -L 5432:127.0.0.1:5432 vps`), never publicly; set `MISSYOU_GPU_WORKER_SECRET` so the registry reports the worker. The worker needs the same `MISSYOU_MEDIA_KEY` and access to `storage/` (mount via sshfs or switch storage to R2/B2).

## Error tracking / uptime
Set `SENTRY_DSN` to enable Sentry (not configured). Uptime: `GET /api/health` returns `{ok, db, redis}`; the watchdog restarts dead processes every 5 min.
