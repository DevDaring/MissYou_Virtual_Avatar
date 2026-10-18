#!/usr/bin/env bash
# Miss You watchdog - idempotent (cron: @reboot and */5). Restarts if the API or a worker is gone.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8170}"
[ -x "$APP_DIR/run.sh" ] || exit 0
mkdir -p "$APP_DIR/logs"
ok=1
ss -tln 2>/dev/null | grep -q ":$PORT " || ok=0
for q in cpu gpu; do
  pid=$(cat "$APP_DIR/logs/worker_$q.pid" 2>/dev/null); [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || ok=0
done
[ "$ok" = 1 ] && { "$APP_DIR/voicebox.sh" ensure >> "$APP_DIR/logs/voice_engine.log" 2>&1; exit 0; }
echo "$(date -Is) autostart: (re)starting missyou" >> "$APP_DIR/logs/autostart.log"
"$APP_DIR/run.sh" >> "$APP_DIR/logs/autostart.log" 2>&1
