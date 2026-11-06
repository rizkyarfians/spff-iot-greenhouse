#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: run with sudo'; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
store=/mnt/spff-data/backups
api=/opt/spff/functions/lib
unit=spff-api.service
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'STOP: SPFF deployment lock occupied'; exit 1; }

db(){ (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff "$@"); }
[[ "$(db -qAt -c "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] ||
 { echo 'STOP: active or uncertain pump session'; exit 1; }

latest=''
for run in "$store"/hst-backend-*; do
 if [[ -f "$run/deploy.exit" && $(cat "$run/deploy.exit") == 0 &&
       -f "$run/merged-build/frontend/vite.config.ts" && "$run" > "$latest" ]]; then
  latest="$run"
 fi
done
[[ -n "$latest" ]] || { echo 'STOP: no successful frontend build found'; exit 1; }
src="$latest/merged-build/frontend/src"
backup="$(mktemp -d "$store/sensor-settings-XXXXXX")"
owner="$(stat -c %U "$repo")"
frontend=(App.tsx SecondaryPages.tsx SensorSettings.tsx pageConfig.ts dashboardSensors.ts api.ts)
modules=(controllers/dashboardController.js services/postgresRepository.js routes/index.js)

echo '=== Build API only ==='
(cd "$repo" && runuser -u "$owner" -- npm run build -w functions)
mkdir "$backup/web" "$backup/api"
for file in "${frontend[@]}"; do
 if [[ -f "$src/$file" ]]; then cp -a "$src/$file" "$backup/web/$file"; fi
done
for file in "${modules[@]}"; do
 install -D -m 644 "$api/$file" "$backup/api/$file"
done

python3 - "$api/routes/index.js" "$src/api.ts" "$repo/frontend/src/api.ts" "$backup" <<'PY'
import re, sys
from pathlib import Path
router, web_api, source, output = map(Path, sys.argv[1:])
live = router.read_text()
route = "apiRouter.put('/settings/sensors/:sensorKey', requireAdmin, requireCsrf, updateSensorEnabled);"
if route not in live:
    auth = re.search(r'apiRouter\.use\(\s*requireAuth\s*,?\s*\)\s*;', live)
    if not auth:
        raise SystemExit('STOP: authenticated API route anchor missing')
    live = "import { updateSensorEnabled } from '../controllers/dashboardController.js';\n" + live[:auth.end()] + "\n" + route + live[auth.end():]
(output / 'router.js').write_text(live)
pattern = r'^export function saveSensorEnabled\(.*?^}'
entry = re.search(pattern, source.read_text(), re.M | re.S)
if not entry:
    raise SystemExit('STOP: sensor settings API missing from source')
api = web_api.read_text()
api = re.sub(pattern, lambda _: entry[0], api, flags=re.M | re.S) if re.search(pattern, api, re.M | re.S) else api + '\n\n' + entry[0] + '\n'
(output / 'frontend-api.ts').write_text(api)
PY

rollback(){
 local result=$?
 if (( result != 0 )); then
  echo "ROLLBACK: restoring API and frontend source from $backup"
  for file in "${modules[@]}"; do cp -a "$backup/api/$file" "$api/$file"; done
  for file in "${frontend[@]}"; do
   if [[ -f "$backup/web/$file" ]]; then cp -a "$backup/web/$file" "$src/$file"; else rm -f -- "$src/$file"; fi
  done
  systemctl restart "$unit" || true
 fi
}

echo '=== Apply sensor migrations only ==='
db < "$repo/infrastructure/postgres/migrations/042_sensor_settings.sql"
db < "$repo/infrastructure/postgres/migrations/043_sensor_display_groups.sql"
trap rollback EXIT
for file in "${frontend[@]}"; do
 [[ "$file" == api.ts ]] && continue
 install -m 644 "$repo/frontend/src/$file" "$src/$file"
done
install -m 644 "$backup/frontend-api.ts" "$src/api.ts"

echo '=== Install and restart API only ==='
for file in controllers/dashboardController.js services/postgresRepository.js; do
 install -m 644 "$repo/functions/lib/$file" "$api/$file"
done
install -m 644 "$backup/router.js" "$api/routes/index.js"
systemctl restart "$unit"
for ((i=0;i<30;i++)); do
 if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
 sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:3001/api/health >/dev/null
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 -X PUT http://127.0.0.1:3001/api/settings/sensors/water)" == 401 ]] ||
 { echo 'STOP: sensor settings route authentication check failed'; exit 1; }

bash "$repo/scripts/repair-orange-frontend.sh" --lock-held
echo "SENSOR_SETTINGS_DEPLOY=SUCCESS; BACKUP=$backup"
