#!/usr/bin/env bash
# Voicebox internal voice service (127.0.0.1:17493, loopback only). The 8 GB venv and
# models stay in the source tree's vendor/ folder; this wrapper just starts/checks it.
VENDOR="${VOICEBOX_VENDOR:-/home/Debz/Hackathon/MissYou_Virtual_Avatar/Codes/vendor}"
case "$1" in
  start|ensure) curl -sf http://127.0.0.1:17493/health >/dev/null && exit 0; [ -x "$VENDOR/voicebox_run.sh" ] && exec "$VENDOR/voicebox_run.sh" ;;
  stop) [ -x "$VENDOR/voicebox_stop.sh" ] && exec "$VENDOR/voicebox_stop.sh" ;;
esac
