#!/usr/bin/env bash
# Nightly backup: Postgres dump + encrypted media objects (already encrypted at rest). Keeps 14 days.
set -e
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${BACKUP_DIR:-/home/Debz/Host/missyou-backups}"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
URL=$(grep '^MISSYOU_DATABASE_URL=' "$APP_DIR/missyou.env" | cut -d= -f2- | sed 's/+asyncpg//')
pg_dump "$URL" -Fc -f "$DEST/db-$STAMP.dump"
tar -C "$APP_DIR/storage" -czf "$DEST/objects-$STAMP.tgz" objects
find "$DEST" -type f -mtime +14 -delete
echo "$(date -Is) backup ok $STAMP"
