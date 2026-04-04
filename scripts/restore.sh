#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <backup-file> <target-db-path>" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="$2"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DB")"
cp "$BACKUP_FILE" "$TARGET_DB"
echo "$TARGET_DB"
