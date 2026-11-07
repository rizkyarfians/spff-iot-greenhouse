#!/usr/bin/env bash
# Reconstruct damaged compiled API artifacts; preserve database, .env, units and pump gates.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: run with sudo'; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'STOP: another SPFF deployment is running'; exit 1; }
api=/opt/spff/functions/lib
contracts=/opt/spff/packages/contracts/dist
for path in "$api" "$contracts"; do
 [[ -d "$path" && ! -L "$path" ]] || { echo "STOP: unexpected runtime directory: $path"; exit 1; }
done
owner="$(stat -c '%U' "$repo")"
[[ "$owner" != root && "$owner" != UNKNOWN ]] || { echo 'STOP: source checkout must have a non-root owner'; exit 1; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
record="/mnt/spff-data/backups/api-recovery-$stamp"
install -d -m700 "$record"
failed(){
 code=$?
 if (( code != 0 )); then
  echo "API_RECOVERY=FAILED; DIAGNOSTICS=$record"
  systemctl status spff-api.service --no-pager -l || true
  journalctl -u spff-api.service -n 35 --no-pager -o cat || true
 fi
}
trap failed EXIT
echo '=== Rebuild contracts and API only ==='
runuser -u "$owner" -- bash -s -- "$repo" <<'BUILD'
set -Eeuo pipefail
cd "$1"
npm run build -w @spff/contracts
npm run build -w functions
BUILD
node "$repo/scripts/verify-api-runtime.mjs" contracts "$repo/packages/contracts/dist"
node "$repo/scripts/verify-api-runtime.mjs" api "$repo/functions/lib"
# Stage beside each live directory so the final renames stay on the same filesystem.
staged_api="/opt/spff/functions/.lib-recovery-$stamp"
staged_contracts="/opt/spff/packages/contracts/.dist-recovery-$stamp"
old_api="/opt/spff/functions/.lib-before-recovery-$stamp"
old_contracts="/opt/spff/packages/contracts/.dist-before-recovery-$stamp"
install -d -m755 "$staged_api" "$staged_contracts"
cp -a "$repo/functions/lib/." "$staged_api/"
cp -a "$repo/packages/contracts/dist/." "$staged_contracts/"
chmod -R a+rX "$staged_api" "$staged_contracts"
node "$repo/scripts/verify-api-runtime.mjs" api "$repo/functions/lib" "$staged_api"
node "$repo/scripts/verify-api-runtime.mjs" contracts "$repo/packages/contracts/dist" "$staged_contracts"
printf 'API_BEFORE=%s\nCONTRACTS_BEFORE=%s\n' "$old_api" "$old_contracts" > "$record/paths.txt"
systemctl stop spff-api.service
mv "$api" "$old_api"
mv "$staged_api" "$api"
mv "$contracts" "$old_contracts"
mv "$staged_contracts" "$contracts"
node "$repo/scripts/verify-api-runtime.mjs" api "$repo/functions/lib" "$api"
node "$repo/scripts/verify-api-runtime.mjs" contracts "$repo/packages/contracts/dist" "$contracts"
systemctl reset-failed spff-api.service
systemctl start spff-api.service
ready=false
for attempt in {1..30}; do
 if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health > "$record/health.json" 2>/dev/null; then ready=true; break; fi
 sleep 1
done
[[ "$ready" == true ]] || { echo 'STOP: API still does not listen on port 3001'; exit 1; }
cat "$record/health.json"
printf '\n'
curl -fsS --max-time 10 http://127.0.0.1:3001/api/auth/ready > "$record/auth-ready.json"
cat "$record/auth-ready.json"
node --input-type=module - "$record/health.json" "$record/auth-ready.json" <<'CHECK'
import {readFileSync} from 'node:fs';
const health=JSON.parse(readFileSync(process.argv[2],'utf8'));
const auth=JSON.parse(readFileSync(process.argv[3],'utf8'));
if(health.success!==true||health.data?.service!=='spff-api'||health.data?.status!=='alive')
  throw Error('Unexpected API health response');
if(auth.success!==true||auth.data?.initialized!==true)
  throw Error('API is listening but local authentication is not initialized; database was preserved');
CHECK
printf '\nAPI_RECOVERY=SUCCESS; BACKUP=%s\n' "$record"
