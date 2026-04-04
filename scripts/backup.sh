#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <db-path> [backup-dir]" >&2
  exit 1
fi

DB_PATH="$1"
BACKUP_DIR="${2:-./backups}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d%H%M%S)"
TARGET="$BACKUP_DIR/libraxis-$STAMP.db"

cp "$DB_PATH" "$TARGET"
echo "$TARGET"
