#!/usr/bin/env bash
# Local voice engine (127.0.0.1:17493, loopback only). The venv and
# models stay in the source tree's vendor/ folder; this wrapper just starts/checks it.
VENDOR="${VOICE_ENGINE_VENDOR:-/home/Debz/Hackathon/MissYou_Virtual_Avatar/Codes/vendor}"
case "$1" in
  start|ensure) curl -sf http://127.0.0.1:17493/health >/dev/null && exit 0; [ -x "$VENDOR/voicebox_run.sh" ] && exec "$VENDOR/voicebox_run.sh" ;;
  stop) [ -x "$VENDOR/voicebox_stop.sh" ] && exec "$VENDOR/voicebox_stop.sh" ;;
esac
