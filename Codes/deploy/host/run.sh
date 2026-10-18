#!/usr/bin/env bash
# Miss You - (re)start API (127.0.0.1:8170) + CPU/GPU workers. Caddy serves web/ and proxies /api.
set -e
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8170}"
cd "$APP_DIR"
"$APP_DIR/stop.sh" >/dev/null 2>&1 || true
mkdir -p logs
"$APP_DIR/voicebox.sh" start >> logs/voicebox.log 2>&1 || echo "voicebox unavailable; app degrades to hosted voices" >> logs/api.log
export MISSYOU_ROOT="$APP_DIR" PYTHONPATH="$APP_DIR/backend" OMP_NUM_THREADS=4
cd "$APP_DIR/backend"
setsid .venv/bin/alembic upgrade head >> "$APP_DIR/logs/api.log" 2>&1 < /dev/null
setsid bash -c "exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $PORT --workers 2 --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 20 --ws-max-size 8388608" \
  >> "$APP_DIR/logs/api.log" 2>&1 < /dev/null &
echo $! > "$APP_DIR/logs/api.pid"
for q in cpu gpu; do
  MISSYOU_QUEUE=$q setsid bash -c "exec .venv/bin/arq app.worker.WorkerSettings" >> "$APP_DIR/logs/worker_$q.log" 2>&1 < /dev/null &
  echo $! > "$APP_DIR/logs/worker_$q.pid"
done
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && { echo "missyou up on 127.0.0.1:$PORT"; exit 0; }; sleep 1; done
echo "missyou did not become healthy; see logs/api.log" >&2; exit 1
