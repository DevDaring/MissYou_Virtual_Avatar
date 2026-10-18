#!/usr/bin/env bash
# Stop the Voicebox backend started by voicebox_run.sh.
set -uo pipefail

VENDOR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$VENDOR/voicebox.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "No pid file ($PIDFILE); nothing to stop."
  exit 0
fi

PID="$(cat "$PIDFILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID not running; removing stale pid file."
  rm -f "$PIDFILE"
  exit 0
fi

# setsid made PID the process-group leader; signal the whole group.
kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID"
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  echo "Still alive after 10s; sending SIGKILL."
  kill -KILL -- "-$PID" 2>/dev/null || kill -KILL "$PID"
fi
rm -f "$PIDFILE"
echo "Voicebox (pid $PID) stopped."
