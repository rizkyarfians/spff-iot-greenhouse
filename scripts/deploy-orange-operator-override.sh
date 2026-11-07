#!/usr/bin/env bash
# Install explicit operator override without changing any dispatch gates or plant ledgers.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: run with sudo'; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
ready=$(cd / && runuser -u postgres -- psql -X -qAt -d spff -c "
 SELECT online AND recorded_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds'
  AND raw_payload @> '{\"pumpReadbackValid\":true,\"pumpWaterActualActive\":false,\"pumpFertActualActive\":false}'::jsonb
 FROM spff.device_status_events WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
 ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1;")
[[ "$ready" == t ]] || { echo 'STOP: need fresh readback with both pumps OFF before runtime deployment'; exit 1; }
(
 flock -n 9 || { echo 'STOP: another SPFF deployment is running'; exit 1; }
 backup=$(mktemp -d /mnt/spff-data/backups/operator-override-XXXXXX)
 (cd / && runuser -u postgres -- pg_dump -Fc -d spff) > "$backup/spff-before.dump"
 test -s "$backup/spff-before.dump"
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$repo/infrastructure/postgres/migrations/047_operator_pump_override.sql"
 echo "OPERATOR_OVERRIDE_DATABASE=READY; BACKUP=$backup"
) 9>/run/lock/spff-hst-prod-rollout.lock
bash "$repo/scripts/repair-orange-api.sh"
bash "$repo/scripts/repair-orange-worker.sh"
bash "$repo/scripts/repair-orange-frontend.sh" --ui-theme
echo 'OPERATOR_OVERRIDE_BACKEND=INSTALLED; no START command sent by this script'
echo 'Firmware must advertise operatorOverrideCapable=true before ON override is accepted.'
