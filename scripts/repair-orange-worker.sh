#!/usr/bin/env bash
# Restore compiled MQTT worker without changing configuration, database or pump gates.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: run with sudo'; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'STOP: another SPFF deployment is running'; exit 1; }
live=/opt/spff/mqtt-worker/dist
[[ -d "$live" && ! -L "$live" ]] || { echo 'STOP: unexpected worker runtime directory'; exit 1; }
owner="$(stat -c '%U' "$repo")"
[[ "$owner" != root && "$owner" != UNKNOWN ]] || { echo 'STOP: source checkout must have a non-root owner'; exit 1; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
record="/mnt/spff-data/backups/worker-recovery-$stamp"
install -d -m700 "$record"
failed(){
 local code=$?
 if (( code != 0 )); then
  echo "WORKER_RECOVERY=FAILED; DIAGNOSTICS=$record"
  systemctl status spff-mqtt-worker.service --no-pager -l || true
  journalctl -u spff-mqtt-worker.service -n 35 --no-pager -o cat || true
 fi
}
trap failed EXIT
echo '=== Rebuild contracts and MQTT worker only ==='
runuser -u "$owner" -- bash -s -- "$repo" <<'BUILD'
set -Eeuo pipefail
cd "$1"
npm run build -w @spff/contracts
npm run build -w @spff/mqtt-worker
BUILD
node "$repo/scripts/verify-api-runtime.mjs" worker "$repo/mqtt-worker/dist"
# Shared contracts must already match; never replace API dependencies during worker recovery.
node "$repo/scripts/verify-api-runtime.mjs" contracts "$repo/packages/contracts/dist" /opt/spff/packages/contracts/dist
staged="/opt/spff/mqtt-worker/.dist-recovery-$stamp"
before="/opt/spff/mqtt-worker/.dist-before-recovery-$stamp"
install -d -m755 "$staged"
cp -a "$repo/mqtt-worker/dist/." "$staged/"
chmod -R a+rX "$staged"
node "$repo/scripts/verify-api-runtime.mjs" worker "$repo/mqtt-worker/dist" "$staged"
printf 'WORKER_BEFORE=%s\n' "$before" > "$record/paths.txt"
echo 'Restarting worker with existing schedules and configuration.'
systemctl stop spff-mqtt-worker.service
mv "$live" "$before"
mv "$staged" "$live"
node "$repo/scripts/verify-api-runtime.mjs" worker "$repo/mqtt-worker/dist" "$live"
systemctl reset-failed spff-mqtt-worker.service
systemctl start spff-mqtt-worker.service
pid=$(systemctl show -p MainPID --value spff-mqtt-worker.service)
[[ "$pid" != 0 ]] || { echo 'STOP: worker did not start'; exit 1; }
for attempt in {1..12}; do
 sleep 1
 systemctl is-active --quiet spff-mqtt-worker.service || { echo 'STOP: worker exited after start'; exit 1; }
 [[ $(systemctl show -p MainPID --value spff-mqtt-worker.service) == "$pid" ]] ||
  { echo 'STOP: worker restarted during verification'; exit 1; }
done
systemctl status spff-mqtt-worker.service --no-pager -l
journalctl -u spff-mqtt-worker.service --since '30 seconds ago' -n 25 --no-pager -o cat
echo "WORKER_RECOVERY=SUCCESS; BACKUP=$record"
