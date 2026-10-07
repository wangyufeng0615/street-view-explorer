#!/usr/bin/env bash
# Daily online backup of the production SQLite database.
#
# Runs on the Docker host as root (see scripts/systemd/). Uses SQLite's online
# backup API, so it is safe while the backend is writing in WAL mode, verifies
# the copy with PRAGMA integrity_check, and keeps KEEP_DAYS of gzip snapshots.
# Files are group-readable by BACKUP_GROUP so an off-host machine can pull them
# over SSH through a tar-only forced command (see docs/runbook.md).
set -Eeuo pipefail

VOLUME="${VOLUME:-street-view-explorer_sqlite_data}"
DB_NAME="${DB_NAME:-streetview.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/streetview/daily}"
BACKUP_GROUP="${BACKUP_GROUP:-streetview-backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mountpoint="$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")"
source_db="$mountpoint/$DB_NAME"
[[ -f "$source_db" ]] || { log "database not found: $source_db"; exit 1; }

install -d -m 750 -o root -g "$BACKUP_GROUP" "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/streetview-$stamp.db.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 - "$source_db" "$work/$DB_NAME" <<'PY'
import sqlite3
import sys

src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
result = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close()
src.close()
if result != "ok":
    sys.exit(f"integrity_check failed: {result}")
PY

gzip -9 -c "$work/$DB_NAME" > "$work/out.gz"
install -m 640 -o root -g "$BACKUP_GROUP" "$work/out.gz" "$target.tmp"
mv "$target.tmp" "$target"
log "wrote $target ($(stat -c %s "$target") bytes)"

find "$BACKUP_DIR" -maxdepth 1 -name 'streetview-*.db.gz' -mtime +"$KEEP_DAYS" -print -delete
