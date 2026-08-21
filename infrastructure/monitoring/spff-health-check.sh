#!/usr/bin/env bash
set -uo pipefail

API_READY_URL="${SPFF_API_READY_URL:-http://127.0.0.1:5001/api/ready}"
DATA_PATH="${SPFF_DATA_PATH:-/opt/spff}"
BACKUP_DIR="${SPFF_BACKUP_DIR:-/var/backups/spff/postgres}"
BACKUP_MAX_AGE_HOURS="${SPFF_BACKUP_MAX_AGE_HOURS:-30}"
DISK_WARN_PERCENT="${SPFF_DISK_WARN_PERCENT:-85}"
OUTBOX_WARN_COUNT="${SPFF_OUTBOX_WARN_COUNT:-1000}"
DATABASE_URL="${DATABASE_URL:-}"
SERVICES="${SPFF_REQUIRED_SERVICES:-postgresql spff-mqtt-broker spff-mqtt-worker spff-edge-gateway spff-api}"

failed=0
log() { printf '%s level=%s check=%s message=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3"; }
fail() { log error "$1" "$2"; failed=1; }
pass() { log info "$1" "$2"; }

if curl --fail --silent --show-error --max-time 5 "$API_READY_URL" >/dev/null; then
  pass api_ready 'API readiness OK'
else
  fail api_ready 'API readiness failed'
fi

if pg_isready --timeout=3 >/dev/null 2>&1; then
  pass postgres 'PostgreSQL accepts connections'
else
  fail postgres 'PostgreSQL is not ready'
fi

for service in $SERVICES; do
  if systemctl is-active --quiet "$service.service"; then
    pass "service:$service" 'service active'
  else
    fail "service:$service" 'service inactive'
  fi
done

if [[ -e "$DATA_PATH" ]]; then
  disk_percent="$(df -P "$DATA_PATH" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  if [[ "$disk_percent" =~ ^[0-9]+$ ]] && (( disk_percent < DISK_WARN_PERCENT )); then
    pass disk "disk usage ${disk_percent}%"
  else
    fail disk "disk usage ${disk_percent:-unknown}% is above threshold ${DISK_WARN_PERCENT}%"
  fi
else
  fail disk "data path $DATA_PATH does not exist"
fi

latest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'spff-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 || true)"
if [[ -n "$latest_backup" ]]; then
  backup_epoch="${latest_backup%% *}"
  now_epoch="$(date +%s)"
  backup_age_hours="$(awk -v now="$now_epoch" -v backup="$backup_epoch" 'BEGIN { printf "%d", (now-backup)/3600 }')"
  if (( backup_age_hours <= BACKUP_MAX_AGE_HOURS )); then
    pass backup "latest backup age ${backup_age_hours}h"
  else
    fail backup "latest backup age ${backup_age_hours}h exceeds ${BACKUP_MAX_AGE_HOURS}h"
  fi
else
  fail backup "no PostgreSQL backup found in $BACKUP_DIR"
fi

if [[ -n "$DATABASE_URL" ]]; then
  if outbox_count="$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM spff.cloud_outbox WHERE status IN ('pending','processing') AND available_at <= now();" 2>/dev/null)"; then
    if [[ "$outbox_count" =~ ^[0-9]+$ ]] && (( outbox_count <= OUTBOX_WARN_COUNT )); then
      pass cloud_outbox "due outbox rows $outbox_count"
    else
      fail cloud_outbox "due outbox rows ${outbox_count:-unknown} exceeds ${OUTBOX_WARN_COUNT}"
    fi
  else
    fail cloud_outbox 'cannot query transactional outbox'
  fi
else
  log warning cloud_outbox 'DATABASE_URL not set; outbox depth check skipped'
fi

exit "$failed"
