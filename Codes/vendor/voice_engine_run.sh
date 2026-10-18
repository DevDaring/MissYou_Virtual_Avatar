#!/usr/bin/env bash
# Start the local voice engine backend headless on CPU, bound to 127.0.0.1:17493.
# Idempotent: if already healthy, does nothing. Logs to vendor/engine.log, pid in vendor/engine.pid.
set -euo pipefail

VENDOR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${VOICE_ENGINE_DIR:-$VENDOR/engine}"
PY="$ENGINE/.venv/bin/python"
HOST=127.0.0.1
PORT="${VOICE_ENGINE_PORT:-17493}"
LOG="$VENDOR/engine.log"
PIDFILE="$VENDOR/engine.pid"
DATA_DIR="$VENDOR/engine_data"
ENV_FILE="$VENDOR/../.env"
URL="http://$HOST:$PORT"
TIMEOUT="${VOICE_ENGINE_START_TIMEOUT:-180}"

if curl -fsS -m 3 "$URL/health" >/dev/null 2>&1; then
  echo "Voice engine already healthy at $URL (pid $(cat "$PIDFILE" 2>/dev/null || echo '?'))"
  exit 0
fi

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Voice engine process (pid $(cat "$PIDFILE")) exists but is not healthy yet; waiting..."
else
  mkdir -p "$DATA_DIR" "$VENDOR/hf_cache" "$VENDOR/cache"

  # Keep every model/cache download inside vendor/.
  export HF_HUB_CACHE="$VENDOR/hf_cache"
  export HF_HOME="$VENDOR/hf_home"
  export XDG_CACHE_HOME="$VENDOR/cache"
  export TORCH_HOME="$VENDOR/cache/torch"
  export NUMBA_CACHE_DIR="$VENDOR/cache/numba"
  export HF_HUB_DISABLE_TELEMETRY=1
  export PYTHONUNBUFFERED=1
  # CPU threading: 16 measured fastest for Chatterbox on this 32-core EPYC (32 was ~2.4x slower).
  export OMP_NUM_THREADS="${OMP_NUM_THREADS:-16}"
  export MKL_NUM_THREADS="${MKL_NUM_THREADS:-$OMP_NUM_THREADS}"

  # HuggingFace token from Codes/.env (parsed in Python; never echoed).
  if [ -f "$ENV_FILE" ]; then
    HF_TOKEN="$("$PY" -I - "$ENV_FILE" <<'EOF'
import sys
for line in open(sys.argv[1], encoding="utf-8", errors="ignore"):
    line = line.strip()
    if line.startswith("export "):
        line = line[7:].strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    if k.strip() == "HUGGINGFACE_TOKEN":
        v = v.strip().strip('"').strip("'").strip()
        print(v, end="")
        break
EOF
)"
    if [ -n "$HF_TOKEN" ]; then export HF_TOKEN; fi
  fi

  cd "$ENGINE"
  echo "=== $(date -Is) starting voice engine on $URL ===" >>"$LOG"
  setsid "$PY" -m backend.main --host "$HOST" --port "$PORT" --data-dir "$DATA_DIR" \
    >>"$LOG" 2>&1 < /dev/null &
  echo $! >"$PIDFILE"
  echo "Started voice engine pid $(cat "$PIDFILE"); log: $LOG"
fi

for ((i = 0; i < TIMEOUT; i++)); do
  if curl -fsS -m 3 "$URL/health" >/dev/null 2>&1; then
    echo "Voice engine healthy at $URL after ${i}s"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Voice engine process died; last log lines:" >&2
    tail -n 40 "$LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "Timed out after ${TIMEOUT}s waiting for $URL/health; see $LOG" >&2
exit 1
