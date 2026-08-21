#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${SPFF_BACKUP_DIR:-/var/backups/spff/postgres}"
RETENTION_DAYS="${SPFF_BACKUP_RETENTION_DAYS:-14}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"

umask 077
mkdir -p "$BACKUP_DIR"
filename="$BACKUP_DIR/spff-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="${filename}.tmp"
trap 'rm -f "$tmp"' EXIT

pg_dump --format=custom --no-owner --no-privileges --file="$tmp" "$DATABASE_URL"
mv "$tmp" "$filename"
trap - EXIT
find "$BACKUP_DIR" -type f -name 'spff-*.dump' -mtime "+$RETENTION_DAYS" -delete
printf 'Backup created: %s\n' "$filename"
