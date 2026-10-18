#!/usr/bin/env bash
# Stop only the Miss You API and workers (matched by this app's venv path).
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$APP_DIR/backend/.venv"
for p in $(ps -eo pid,args | awk -v venv="$VENV" 'index($0, venv"/bin/") && (index($0, "uvicorn app.main:app") || index($0, "arq app.worker")) && !/awk/ {print $1}'); do kill "$p" 2>/dev/null; done
sleep 1
