#!/usr/bin/env bash
# Explicit operator restart of the current HST phase, preserving its delivery ledger.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: run with sudo'; exit 1; }
[[ "${1:-}" == '--same-batch' ]] || { echo 'Usage: sudo bash scripts/resume-orange-hst.sh --same-batch'; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'STOP: another SPFF deployment is running'; exit 1; }
systemctl is-active --quiet spff-mqtt-worker.service || { echo 'STOP: MQTT worker is not active'; exit 1; }
systemctl show spff-mqtt-worker.service -p Environment --value | tr ' ' '\n' |
 grep -qx 'SPFF_HST_SCHEDULE_DISPATCH_ENABLED=true' || { echo 'STOP: HST dispatch is disabled'; exit 1; }
echo 'Resuming the same fertilizer batch. Both pumps can start after the ESP schedule ACK.'
(cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -P pager=off) < "$repo/scripts/sql/resume-hst-cycle.sql"
echo 'HST_RESUME=QUEUED; existing grams preserved; a new cycle runtime limit applies.'
