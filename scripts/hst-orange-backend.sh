#!/usr/bin/env bash
# Apply only HST backend modules into copies of production runtime. Keep all
# /opt/spff sources and unrelated compiled modules. Physical START gate OFF.
set -Eeuo pipefail
umask 077
MODE="$1"; SRC="$2"
PROD=/opt/spff
STORE=/mnt/spff-data/backups
API=spff-api.service
WORKER=spff-mqtt-worker.service
APIGATE=/etc/systemd/system/spff-api.service.d/97-hst-real-gate.conf
WORKERGATE=/etc/systemd/system/spff-mqtt-worker.service.d/97-hst-real-gate.conf
RUN=''
SWAPPED=0; SUCCESS=0
fatal(){ echo "STOP: $*" >&2; exit 1; }
say(){ echo "=== $* ==="; }
[[ "$EUID" == 0 ]] || fatal "must use sudo"
[[ "$MODE" =~ ^(deploy|enable|enable-dose-volume|disable|status|diagnose|dose-volume-status)$ ]] || fatal "Expected deploy|enable|enable-dose-volume|disable|status|diagnose|dose-volume-status"
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || fatal "SPFF deployment lock occupied"
# postgres cannot traverse /home/orangepi (0700). Run psql from / instead,
# and feed migration SQL over stdin as root (the postgres user never opens SRC).
db(){ ( cd / && runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 -d spff -c "$1" ); }
gates(){
 local volume="${3:-false}"
 install -d -m 755 /etc/systemd/system/spff-api.service.d /etc/systemd/system/spff-mqtt-worker.service.d
 printf '[Service]\nEnvironment=SPFF_HST_REAL_DISPATCH_ENABLED=%s\nEnvironment=SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=%s\nEnvironment=SPFF_DOSE_VOLUME_DISPATCH_ENABLED=%s\n' "$1" "$1" "$volume" > "$APIGATE"
 printf '[Service]\nEnvironment=SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=%s\nEnvironment=SPFF_DOSE_VOLUME_DISPATCH_ENABLED=%s\n' "$2" "$volume" > "$WORKERGATE"
 chmod 644 "$APIGATE" "$WORKERGATE"
 systemctl daemon-reload
}
healthy(){
 systemctl is-active --quiet "$API" &&
 systemctl is-active --quiet "$WORKER" &&
 systemctl is-active --quiet spff-edge-gateway.service &&
 curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null
}
wait_healthy(){
 local deadline=$((SECONDS+30))
 while (( SECONDS < deadline )); do
  if healthy 2>/dev/null; then return 0; fi
  sleep 1
 done
 healthy
}
# EnvironmentFile can override Environment= in a systemd drop-in.
# Check the actual live process; never report a physical gate state merely
# because a drop-in file was successfully written.
assert_runtime_gate(){
 local svc="$1" key="$2" expected="$3" pid value
 pid="$(systemctl show "$svc" -p MainPID --value)"
 [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 && -r "/proc/$pid/environ" ]] || fatal "Cannot verify runtime environment of $svc"
 value="$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n "s/^$key=//p" | tail -n 1)"
 [[ "$value" == "$expected" ]] || fatal "$svc runtime $key expected $expected, got ${value:-MISSING}. Check EnvironmentFile precedence; NOT armed."
}
restore_gates(){
 if [[ -f "$RUN/old-api-gate" ]]; then cp -a "$RUN/old-api-gate" "$APIGATE"; else rm -f "$APIGATE"; fi
 if [[ -f "$RUN/old-worker-gate" ]]; then cp -a "$RUN/old-worker-gate" "$WORKERGATE"; else rm -f "$WORKERGATE"; fi
 systemctl daemon-reload || true
}
finish(){
 code=$?
 trap - EXIT ERR
 if [[ "$MODE" == deploy ]]; then
  if [[ "$SWAPPED" == 1 && "$SUCCESS" != 1 ]]; then
   say "ROLLBACK: restore old compiled runtime"
   systemctl stop "$API" "$WORKER" || true
   for label in contracts api worker web; do
    case "$label" in
     contracts) live="$PROD/packages/contracts/dist";;
     api) live="$PROD/functions/lib";;
     worker) live="$PROD/mqtt-worker/dist";;
     web) live="$PROD/frontend/dist";;
    esac
    if [[ -d "$RUN/old/$label" ]]; then
      if [[ -e "$live" ]]; then mv "$live" "$RUN/failed-$label" || true; fi
      mv "$RUN/old/$label" "$live" || true
    fi
   done
   restore_gates
   systemctl start "$WORKER" "$API" || true
   systemctl restart spff-edge-gateway.service || true
  fi
  echo "$code" > "$RUN/deploy.exit"
  echo "DEPLOY_EXIT=$code"
 fi
 exit "$code"
}
if [[ "$MODE" == diagnose ]]; then
 say "Read-only PostgreSQL diagnosis; no deployment or settings change"
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -P pager=off -c "SELECT current_database() AS checked_database, current_user AS checked_as, inet_server_addr() AS server_address")
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -P pager=off -c "SELECT name, to_regclass('spff.'||name) IS NOT NULL AS installed FROM (VALUES ('sites'),('devices'),('guide_programs'),('guide_program_revisions'),('guide_program_completions'),('guide_ec_profiles'),('guide_ec_profile_revisions'),('adaptive_fert_sessions'),('adaptive_fert_commands'),('adaptive_fert_events'),('adaptive_fert_reconciliations'),('hst_real_profiles'),('hst_real_sessions'),('hst_execution_modes')) AS x(name)")
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -P pager=off -c "SELECT datname AS available_db FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname")
 echo "=== API service environment file locations (not contents) ==="
 systemctl show spff-api.service -p EnvironmentFiles --value || true
 echo "=== API service working directory ==="
 systemctl show spff-api.service -p WorkingDirectory --value || true
 exit 0
fi
if [[ "$MODE" == deploy ]]; then
 mkdir -p "$STORE"
 RUN="$STORE/hst-backend-$(date -u +%Y%m%dT%H%M%SZ)"
 mkdir -m 700 "$RUN"
 printf '%s\n' "$RUN" > "$STORE/hst-backend-latest.txt"
 exec > >(tee -a "$RUN/deploy.log") 2>&1
 # EXIT fires for every set -e failure; avoid duplicate rollback/log lines.
 trap finish EXIT
 say "Check current production and staging"
 [[ -d "$SRC/.git" && -d "$PROD/.git" ]] || fatal "missing source checkout"
 healthy || fatal "production API/worker/edge unhealthy"
 [[ -z "$(GIT_OPTIONAL_LOCKS=0 git -C "$SRC" -c core.fsmonitor=false status --porcelain --untracked-files=no)" ]] || fatal "staging has local edits"
 git -C "$SRC" log -1 --oneline
 GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$PROD" -C "$PROD" -c core.fsmonitor=false status --short --untracked-files=no > "$RUN/prod-source-edits.txt" || true
 if [[ "$(db "SELECT (to_regclass('spff.adaptive_fert_sessions') IS NOT NULL AND to_regclass('spff.adaptive_fert_commands') IS NOT NULL AND to_regclass('spff.guide_programs') IS NOT NULL)::text")" != true ]]; then
  echo "DB prerequisite tables absent in local PostgreSQL database 'spff'."
  echo "Run: sudo bash scripts/hst-orange-backend.sh diagnose \"$SRC\""
  fatal "migration 034-036 not verified; no runtime change"
 fi
 [[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "active/uncertain adaptive sessions; do not interrupt"
 if [[ "$(db "SELECT (to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == true ]]; then
  [[ "$(db "SELECT shadow_enabled::text FROM spff.hst_execution_modes ORDER BY site_id LIMIT 1")" == true ]] || fatal "Turn SHADOW MODE ON before deployment; no build or runtime change performed"
 fi
 for loc in "$PROD/packages/contracts/dist" "$PROD/functions/lib" "$PROD/mqtt-worker/dist" "$PROD/frontend/dist"; do
  [[ -d "$loc" && ! -L "$loc" ]] || fatal "unexpected runtime directory: $loc"
 done
 say "Build and test staged source as its non-root owner; production remains live"
 STAGING_USER="$(stat -c '%U' "$SRC")"
 [[ "$STAGING_USER" != root && "$STAGING_USER" != UNKNOWN ]] || fatal "staging must be owned by a non-root user"
 # Avoid generating root-owned .git/index, npm cache, dist, tsbuildinfo etc.
 runuser -u "$STAGING_USER" -- bash -s -- "$SRC" <<'STAGING_BUILD'
set -Eeuo pipefail
cd "$1"
npm run build
npm run lint
npm run test --workspace @spff/contracts
npm run test --workspace functions
npm run test --workspace frontend
npm run test --workspace @spff/edge-gateway
# These MQTT Worker unit tests import runtime config but use fake repositories.
# Supply an intentionally unreachable, non-production URL only for the test.
# Never export real DATABASE_URL or connect to the production PostgreSQL.
DATABASE_URL='postgresql://spff_test:invalid@127.0.0.1:1/spff_test' npm run test --workspace @spff/mqtt-worker
STAGING_BUILD
 say "Prepare surgical merged runtime with original production files"
 mkdir -p "$RUN/new" "$RUN/old"
 cp -a "$PROD/packages/contracts/dist" "$RUN/new/contracts"
 cp -a "$PROD/functions/lib" "$RUN/new/api"
 cp -a "$PROD/mqtt-worker/dist" "$RUN/new/worker"
 for module in aiHst adaptiveFertigation unifiedAiDashboard doseVolume hstDosePulse; do
  install -m644 "$SRC/packages/contracts/dist/$module.js" "$RUN/new/contracts/$module.js"
 done
 for module in controllers/aiHstController controllers/unifiedAiDashboardController controllers/doseVolumeController controllers/dashboardController services/postgresRepository services/doseVolumeService services/adaptiveFertigationService services/hstRealExecutionService services/hstExecutionModeService; do
  install -D -m644 "$SRC/functions/lib/$module.js" "$RUN/new/api/$module.js"
 done
 install -m644 "$SRC/mqtt-worker/dist/adaptiveFertigationTransport.js" "$RUN/new/worker/adaptiveFertigationTransport.js"
 install -m644 "$SRC/mqtt-worker/dist/doseVolumeEvidence.js" "$RUN/new/worker/doseVolumeEvidence.js"
 install -m644 "$SRC/mqtt-worker/dist/serverWaterControl.js" "$RUN/new/worker/serverWaterControl.js"
 install -m644 "$SRC/mqtt-worker/dist/soilEcPulseTransport.js" "$RUN/new/worker/soilEcPulseTransport.js"
 [[ -f "$RUN/new/contracts/index.js" ]] || fatal "contracts barrel missing"
 grep -q "aiHst.js" "$RUN/new/contracts/index.js" || fatal "live contracts barrel missing aiHst export"
 grep -q "adaptiveFertigation.js" "$RUN/new/contracts/index.js" || fatal "live contracts barrel missing adaptive export"
 # The production barrel may predate the dashboard summary contract.
 if ! grep -q "unifiedAiDashboard.js" "$RUN/new/contracts/index.js"; then
   printf "\\nexport * from './unifiedAiDashboard.js';\\n" >> "$RUN/new/contracts/index.js"
 fi
 if ! grep -q "doseVolume.js" "$RUN/new/contracts/index.js"; then
   printf "\\nexport * from './doseVolume.js';\\n" >> "$RUN/new/contracts/index.js"
 fi
 if ! grep -q "hstDosePulse.js" "$RUN/new/contracts/index.js"; then
   printf "\\nexport * from './hstDosePulse.js';\\n" >> "$RUN/new/contracts/index.js"
 fi

 # Extend HST-specific routes in the compiled production router. Do not lose
 # any user's unrelated local routes or middleware modifications.
 python3 - "$PROD/functions/lib/routes/index.js" "$SRC/functions/lib/routes/index.js" "$RUN/new/api/routes/index.js" <<'PY'
import sys,re
from pathlib import Path
old,staging,dest=[Path(p) for p in sys.argv[1:]]
live=old.read_text(); new=staging.read_text()
pattern=r"import\s*\{[^}]*\bgetHstProposals\b[^}]*\}\s*from\s*['\"]\.\./controllers/aiHstController\.js['\"];"
imports=re.findall(pattern,new,re.S)
existing=re.findall(pattern,live,re.S)
if len(imports)!=1 or len(existing)!=1: raise SystemExit('STOP: HST route imports not uniquely mergeable')
live=live.replace(existing[0],imports[0],1)
volume_pattern=r"import\s*\{[^}]*\}\s*from\s*['\"]\.\./controllers/doseVolumeController\.js['\"];"
volume_imports=re.findall(volume_pattern,new,re.S)
if len(volume_imports)!=1: raise SystemExit('STOP: staged dose-volume controller import not unique')
volume_import=volume_imports[0]
volume_existing=re.findall(volume_pattern,live,re.S)
if len(volume_existing)>1: raise SystemExit('STOP: duplicate dose-volume imports')
if volume_existing: live=live.replace(volume_existing[0],volume_import,1)
else: live=volume_import+'\n'+live
route_pattern=r"^apiRouter\.(?:get|post|put)\('/unified-ai/hst/[^;\n]+;\s*$"
routes=re.findall(route_pattern,new,re.M)
oldroutes=re.findall(route_pattern,live,re.M)
if len(routes)<8 or len(oldroutes)<2: raise SystemExit('STOP: HST route anchors changed unexpectedly')
for entry in oldroutes:
    live=live.replace(entry,'',1)
# Install the missing read-only dashboard route without replacing local routes.
summary_path='/unified-ai/dashboard'
summary_import=r"""import\s*\{([^}]*)\}\s*from\s*['"]\.\./controllers/unifiedAiDashboardController\.js['"];"""
summary_imports=re.findall(summary_import,live,re.S)
if len(summary_imports)>1: raise SystemExit('STOP: duplicate dashboard controller imports')
if not summary_imports:
    live="import { getUnifiedAiDashboard } from '../controllers/unifiedAiDashboardController.js';\n"+live
elif 'getUnifiedAiDashboard' not in summary_imports[0]:
    raise SystemExit('STOP: dashboard controller binding changed')
summary_routes=list(re.finditer(r"""apiRouter\.get\(\s*['"]/unified-ai/dashboard['"]\s*,[^;]+;""",live,re.S))
if len(summary_routes)>1: raise SystemExit('STOP: duplicate dashboard summary routes')
if summary_routes:
    if 'getUnifiedAiDashboard' not in summary_routes[0].group():
        raise SystemExit('STOP: dashboard route uses an unexpected handler')
else:
    routes.append("apiRouter.get('/unified-ai/dashboard', getUnifiedAiDashboard);")
sensor_route="apiRouter.put('/settings/sensors/:sensorKey', requireAdmin, requireCsrf, updateSensorEnabled);"
if sensor_route not in live:
    live="import { updateSensorEnabled } from '../controllers/dashboardController.js';\n"+live
    routes.append(sensor_route)
anchor="apiRouter.get('/unified-ai/hst/proposals'"
pos=live.find("apiRouter.get(\n  '/bootstrap'")
if pos<0: pos=live.find("apiRouter.get('/bootstrap'")
if pos<0: raise SystemExit('STOP: authenticated bootstrap route anchor not found')
# HST routes must be inserted immediately before the existing authenticated bootstrap.
auth=re.search(r'apiRouter\.use\(\s*requireAuth\s*,?\s*\)\s*;',live)
if auth is None or pos<auth.end(): raise SystemExit('STOP: authentication boundary mismatch')
if summary_routes and summary_routes[0].start()<auth.end():
    raise SystemExit('STOP: dashboard route is outside authentication')
live=live[:pos]+'\n'.join(routes)+'\n\n'+live[pos:]
dest.write_text(live)
print('PRESERVED_LOCAL_API_ROUTES=PASS;',len(routes),'HST/dashboard routes merged')
print('AI_DASHBOARD_ROUTE=INSTALLED; AUTH=REQUIRED')
PY
 say "Merge local frontend TS/CSS in disposable build directory"
 MERGED="$RUN/merged-build"
 mkdir -p "$MERGED"
 (cd "$SRC" && tar --exclude='./node_modules' --exclude='./.git' --exclude='./frontend/dist' --exclude='./functions/lib' --exclude='./mqtt-worker/dist' --exclude='./edge-gateway/dist' --exclude='./.env' --exclude='*/.env' -cf - .) | tar -xf - -C "$MERGED"
 ln -s "$SRC/node_modules" "$MERGED/node_modules"
 [[ -d "$PROD/frontend/src" ]] || fatal "production frontend source missing"
 rm -rf "$MERGED/frontend/src"
 cp -a "$PROD/frontend/src" "$MERGED/frontend/src"
 if [[ -d "$PROD/frontend/public" && -d "$MERGED/frontend/public" ]]; then cp -a "$PROD/frontend/public/." "$MERGED/frontend/public/"; fi
 for hst_file in HstApprovalPanel.tsx HstApprovalPanel.css HstRealExecutionCard.tsx HstDoseVolumeCard.tsx hstExecutionMode.ts AiFertigationOverview.tsx AiFertigationOverview.css dashboardSensors.ts hstIrrigationSummary.ts App.tsx SecondaryPages.tsx SensorSettings.tsx pageConfig.ts; do
   install -m644 "$SRC/frontend/src/$hst_file" "$MERGED/frontend/src/$hst_file"
 done
 python3 - "$MERGED/frontend/src/api.ts" "$SRC/frontend/src/api.ts" "$MERGED/frontend/src/GuidePage.tsx" <<'PY'
from pathlib import Path
import re,sys
local_path,stage_path,guide_path=[Path(x) for x in sys.argv[1:]]
local=local_path.read_text();stage=stage_path.read_text()
mark="// AI HST: observation and one authenticated SHADOW operator review"
if stage.count(mark)!=1: raise SystemExit('STOP: HST source anchor changed')
hst=stage[stage.index(mark):]
api_marker='export function fetchAiHstProposals'
loc=local.find(api_marker)
if loc<0:
 # Older production installed only compiled HST artifacts and intentionally
 # kept its original source untouched. Append the new HST API source.
 local_path.write_text(local.rstrip()+'\n\n'+hst)
else:
 tail=local[loc:]
 exports=re.findall(r'export\s+(?:const|function|type)\s+(\w+)',tail)
 allowed=('fetchAiHst','reviewAiHst','saveAiHst','executeAiHst','stopAiHst','setAiHst','AiHstVolume')
 if any(not name.startswith(allowed) for name in exports):
  raise SystemExit('STOP: unrelated production API exports after HST: '+str(exports))
 local_path.write_text(local[:loc]+'\n'+hst)
guide=guide_path.read_text()
sensor_fn=re.search(r'^export function saveSensorEnabled\(.*?^}',stage,re.M|re.S)
if not sensor_fn: raise SystemExit('STOP: sensor settings API missing from source')
api=local_path.read_text()
if 'export function saveSensorEnabled(' not in api:
 local_path.write_text(sensor_fn[0]+'\n\n'+api)
if 'HstApprovalPanel' not in guide:
 i="import './GuidePage.css'"
 c="    <AutomationMethodNote/>"
 if guide.count(i)!=1 or guide.count(c)!=1: raise SystemExit('STOP: GuidePage anchors changed')
 guide=guide.replace(i,i+"\nimport {HstApprovalPanel} from './HstApprovalPanel'",1)
 guide=guide.replace(c,"    <HstApprovalPanel/>\n"+c,1)
 # Remove the retired informational banner from the preserved production page.
guide=''.join(line for line in guide.splitlines(keepends=True) if line.strip() != '<AutomationMethodNote/>')
guide=guide.replace('AutomationMethod,AutomationMethodNote', 'AutomationMethod')
guide_path.write_text(guide)
print('PRESERVED_PRODUCTION_FRONTEND_SOURCE=PASS')
PY
 # Add the compact drawer while preserving all local sensor/controller UI.
 node "$SRC/scripts/merge-ai-fertigation-overview.cjs" "$SRC" "$MERGED/frontend/src/FloatingAiRecommendation.tsx"
 node "$SRC/scripts/merge-dashboard-sensor-groups.cjs" "$SRC" "$MERGED/frontend/src/App.tsx"
 # npm workspaces may install Vite in frontend/node_modules instead of root.
 # The same frontend package already passed npm run build above; reuse its
 # locally installed binary while building from MERGED/frontend (not SRC).
 if [[ -d "$SRC/frontend/node_modules" && ! -e "$MERGED/frontend/node_modules" ]]; then
   ln -s "$SRC/frontend/node_modules" "$MERGED/frontend/node_modules"
 fi
 VITE_BIN=''
 for candidate in "$SRC/frontend/node_modules/.bin/vite" "$SRC/node_modules/.bin/vite"; do
   if [[ -x "$candidate" ]]; then VITE_BIN="$candidate"; break; fi
 done
 [[ -n "$VITE_BIN" ]] || fatal "Cannot find existing Vite binary in staging workspace; no runtime changes made"
 TSC_BIN=''
 for candidate in "$SRC/frontend/node_modules/.bin/tsc" "$SRC/node_modules/.bin/tsc"; do
   if [[ -x "$candidate" ]]; then TSC_BIN="$candidate"; break; fi
 done
 [[ -n "$TSC_BIN" ]] || fatal "Cannot find TypeScript compiler in staging workspace"
 (cd "$MERGED/frontend" && "$TSC_BIN" -b && "$VITE_BIN" build)
 [[ -s "$MERGED/frontend/dist/index.html" ]] || fatal "merged frontend build output missing"
 cp -a "$MERGED/frontend/dist" "$RUN/new/web"
 say "Verify existing Python AI summary before changing production runtime"
 curl -fsS --max-time 20 http://127.0.0.1:5010/dashboard/summary > "$RUN/ai-dashboard-summary.json" || fatal "Python AI /dashboard/summary unavailable; no runtime changes made"
 node --input-type=module - "$SRC" "$RUN/ai-dashboard-summary.json" <<'SUMMARY_CHECK'
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [source,file]=process.argv.slice(2);
const {unifiedAiDashboardSchema}=await import(pathToFileURL(source+'/packages/contracts/dist/unifiedAiDashboard.js').href);
const parsed=unifiedAiDashboardSchema.safeParse(JSON.parse(readFileSync(file,'utf8')));
if(!parsed.success){console.error('STOP: Python AI dashboard response is incompatible');process.exit(1);}
console.log('AI_SUMMARY_UPSTREAM=PASS; planning='+parsed.data.planning_status);
SUMMARY_CHECK
 say "Back up PostgreSQL before additive migration"
 (cd / && runuser -u postgres -- pg_dump -Fc -d spff) > "$RUN/db-before.dump"
 [[ -s "$RUN/db-before.dump" ]] || fatal "DB backup failed"
 sha256sum "$RUN/db-before.dump" > "$RUN/db-before.sha256"
 if [[ -e "$APIGATE" ]]; then cp -a "$APIGATE" "$RUN/old-api-gate"; fi
 if [[ -e "$WORKERGATE" ]]; then cp -a "$WORKERGATE" "$RUN/old-worker-gate"; fi
 say "Migration 037: HST physical stock binding and session identity"
 tables="$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL)::int::text || ',' || (to_regclass('spff.hst_real_sessions') IS NOT NULL)::int::text")"
 case "$tables" in
  0,0)  (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/037_hst_real_adaptive_binding.sql";;
  1,1) say "Migration 037 already installed; skip";;
  *) fatal "migration 037 only partly installed";;
 esac
 [[ "$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL AND to_regclass('spff.hst_real_sessions') IS NOT NULL)::text")" == true ]] || fatal "migration 037 not installed"
 say "Migration 038: durable SHADOW MODE ON by default"
 if [[ "$(db "SELECT (to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" != true ]]; then
   (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/038_hst_shadow_mode.sql"
 fi
 [[ "$(db "SELECT (to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == true ]] || fatal "migration 038 missing"
 [[ "$(db "SELECT shadow_enabled::text FROM spff.hst_execution_modes ORDER BY site_id LIMIT 1")" == true ]] || fatal "Turn SHADOW MODE ON in the admin dashboard before deployment"
 say "Migration 039: dose-volume plans and measured delivery ledger"
 volume_tables="$(db "SELECT (to_regclass('spff.dose_volume_plans') IS NOT NULL)::int::text || ',' || (to_regclass('spff.dose_volume_bindings') IS NOT NULL)::int::text")"
 case "$volume_tables" in
  0,0) (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/039_dose_volume_backend.sql";;
  1,1) say "Migration 039 already installed; skip";;
  *) fatal "migration 039 only partly installed";;
 esac
 say "Migration 040: server-owned water ON/OFF through normal pump commands"
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/040_server_water_relay.sql"
 say "Migration 041: HST dose pulse outbox"
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/041_hst_dose_pulse_outbox.sql"
 say "Migration 042: sensor display settings"
 (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff) < "$SRC/infrastructure/postgres/migrations/042_sensor_settings.sql"
 say "Swap only compiled HST modules (physical pump command gate remains OFF)"
 chown -R root:root "$RUN/new"
 chmod -R a+rX "$RUN/new"
 SWAPPED=1
 gates false false
 systemctl stop "$API" "$WORKER"
 [[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "session appeared during build; runtime swap cancelled"
 for label in contracts api worker web; do
  case "$label" in
   contracts) live="$PROD/packages/contracts/dist";;
   api) live="$PROD/functions/lib";;
   worker) live="$PROD/mqtt-worker/dist";;
     web) live="$PROD/frontend/dist";;
  esac
  mv "$live" "$RUN/old/$label"
  mv "$RUN/new/$label" "$live"
 done
 systemctl start "$WORKER" "$API"
 # Edge keeps the shared contracts in memory. Restart to load the new typed
 # volume envelopes while retaining its existing serial writer and outbox.
 systemctl restart spff-edge-gateway.service
 for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 3 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
  sleep 2
 done
 healthy || fatal "API/worker/edge smoke failed"
 assert_runtime_gate "$API" SPFF_HST_REAL_DISPATCH_ENABLED false
 assert_runtime_gate "$API" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false
 assert_runtime_gate "$WORKER" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false
 assert_runtime_gate "$API" SPFF_DOSE_VOLUME_DISPATCH_ENABLED false
 assert_runtime_gate "$WORKER" SPFF_DOSE_VOLUME_DISPATCH_ENABLED false
 status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/unified-ai/hst/execution-readiness)"
 [[ "$status" == 401 ]] || fatal "auth boundary failed, expected 401 got $status"
 SUCCESS=1
 echo 0 > "$RUN/deploy.exit"
 trap - EXIT ERR
 echo "BACKEND_APPLY=SUCCESS; PUMP_DISPATCH=OFF; BACKUP=$RUN"
 exit 0
fi
if [[ "$MODE" == disable ]]; then
 gates false false
 systemctl restart "$WORKER" "$API"
 wait_healthy || fatal "service unhealthy after restart"
 assert_runtime_gate "$API" SPFF_HST_REAL_DISPATCH_ENABLED false
 assert_runtime_gate "$API" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false
 assert_runtime_gate "$WORKER" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false
 echo "NEW_REAL_START=DISABLED. This does NOT shut off an already running pump."
 exit 0
fi
if [[ "$MODE" == dose-volume-status ]]; then
 healthy || fatal "production unhealthy"
 db "SELECT jsonb_pretty(jsonb_build_object('backend_installed',to_regclass('spff.dose_volume_plans') IS NOT NULL AND to_regclass('spff.dose_volume_bindings') IS NOT NULL,'required_contract','spff-dose-volume-v1','devices',(SELECT jsonb_agg(x) FROM (SELECT DISTINCT ON(site_id,device_id) site_id,device_id,recorded_at,raw_payload->>'firmwareVersion' AS firmware,raw_payload->'doseVolumeV1' AS volume_capability,raw_payload->'waterUntilLowV1' AS water_until_low_capability,raw_payload->'waterInterlockEnabled' AS water_interlock_enabled FROM spff.device_status_events ORDER BY site_id,device_id,recorded_at DESC,device_status_id DESC LIMIT 5)x)))"
 systemctl show "$API" "$WORKER" -p Environment | grep -E 'SPFF_DOSE_VOLUME_DISPATCH_ENABLED' || true
 exit 0
fi
if [[ "$MODE" == status ]]; then
 healthy || fatal "production unhealthy"
 echo "verified_profiles=$(db 'SELECT count(*) FROM spff.hst_real_profiles')"
 echo "physical_hst_sessions=$(db 'SELECT count(*) FROM spff.hst_real_sessions')"
 systemctl show "$API" "$WORKER" -p Environment | grep -E 'SPFF_(HST_REAL|ADAPTIVE_FERT|DOSE_VOLUME)_DISPATCH_ENABLED' || true
 exit 0
fi
if [[ "$MODE" == enable-dose-volume ]]; then
 healthy || fatal "production unhealthy"
 [[ "$(db "SELECT (to_regclass('spff.dose_volume_plans') IS NOT NULL AND to_regclass('spff.dose_volume_bindings') IS NOT NULL AND to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == true ]] || fatal "deploy dose-volume backend first"
 [[ "$(db "SELECT (count(*) > 0 AND coalesce(bool_and(shadow_enabled),false))::text FROM spff.hst_execution_modes")" == true ]] || fatal "Turn SHADOW MODE ON before enabling the server gate"
 [[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "active/uncertain adaptive session"
 [[ "$(db "SELECT count(*) FROM spff.adaptive_fert_commands WHERE status IN ('pending','dispatching','unknown')")" == 0 ]] || fatal "pending/unknown adaptive command"
 db "SELECT coalesce(jsonb_agg(raw_payload),'[]') FROM (SELECT DISTINCT ON (site_id,device_id) raw_payload,recorded_at,online,mode FROM spff.device_status_events ORDER BY site_id,device_id,recorded_at DESC,device_status_id DESC) d WHERE online AND mode='manual' AND recorded_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds'" |
  node --input-type=module -e '
   import {readFileSync} from "node:fs";
   import {doseVolumeCapabilitySchema,waterUntilLowCapabilitySchema} from "/opt/spff/packages/contracts/dist/doseVolume.js";
   const devices=JSON.parse(readFileSync(0,"utf8"));
   const ready=devices.some(d=>typeof d?.firmwareVersion==="string" && d.firmwareVersion!=="1.5.07-AI-ACC-SESSION" &&
    /^[a-f0-9]{16}$/i.test(d.pulseBootId??"") && d.pumpReadbackValid===true &&
    d.pumpWaterActualActive===false && d.pumpFertActualActive===false && d.aiAccSessionActive===false &&
    d.doseVolumeSessionActive!==true && (doseVolumeCapabilitySchema.safeParse(d.doseVolumeV1).success ||
      (d.waterInterlockEnabled===true && d.aiAccTankGuardHealthy===true &&
       (d.waterInterlockConfigCapable===true||waterUntilLowCapabilitySchema.safeParse(d.waterUntilLowV1).success))));
   if(!ready)process.exitCode=1;
  ' || fatal "no fresh device with verified water protection or commissioned dose-volume and both pumps OFF"
 gates false false true
 if ! systemctl restart "$WORKER" "$API" ||
    ! ( wait_healthy &&
        assert_runtime_gate "$API" SPFF_HST_REAL_DISPATCH_ENABLED false &&
        assert_runtime_gate "$API" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false &&
        assert_runtime_gate "$WORKER" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED false &&
        assert_runtime_gate "$API" SPFF_DOSE_VOLUME_DISPATCH_ENABLED true &&
        assert_runtime_gate "$WORKER" SPFF_DOSE_VOLUME_DISPATCH_ENABLED true ); then
  gates false false
  systemctl restart "$WORKER" "$API" || true
  fatal "enable dose-volume failed; START gates reverted OFF"
 fi
 echo 'DOSE_VOLUME_DISPATCH=ARMED; SHADOW remains ON. To run: SHADOW OFF, review a fresh plan, then ACC.'
 exit 0
fi
# Explicit in-person arming only, never enabled by the deploy phase.
healthy || fatal "production unhealthy"
[[ "$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL AND to_regclass('spff.hst_real_sessions') IS NOT NULL AND to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == true ]] || fatal "migrations 037-038 missing"
[[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "active/uncertain adaptive session"
[[ "$(db "SELECT count(*) FROM spff.adaptive_fert_commands WHERE status IN ('pending','dispatching','unknown')")" == 0 ]] || fatal "pending/unknown adaptive command"
[[ "$(db "SELECT count(*) FROM spff.hst_real_profiles")" -gt 0 ]] || fatal "no verified stock profile. Configure as admin from SHADOW OFF first."
[[ "$(curl -fsS -m 5 http://127.0.0.1:5010/health | python3 -c 'import json,sys;print(json.load(sys.stdin).get("mode",""))')" == SHADOW_MODE ]] || fatal "Python HST AI service unavailable"
echo 'SAFETY: This enables future authenticated REAL ACC for physical WATER and FERTILIZER pumps.'
echo 'Check ESP32 MANUAL selector, pumps/stock isolated for commissioning, EC/flow/level sensors, emergency STOP.'
read -r -p 'Type ENABLE-HST-PHYSICAL while physically present: ' confirmation
[[ "$confirmation" == ENABLE-HST-PHYSICAL ]] || fatal 'not armed'
gates true true
if ! systemctl restart "$WORKER" "$API" ||
   ! ( wait_healthy &&
       assert_runtime_gate "$API" SPFF_HST_REAL_DISPATCH_ENABLED true &&
       assert_runtime_gate "$API" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED true &&
       assert_runtime_gate "$WORKER" SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED true ); then
 gates false false
 systemctl restart "$WORKER" "$API" || true
 fatal 'enable failed; gates reverted OFF'
fi
echo 'REAL_DISPATCH=ARMED; SHADOW OFF + explicit ACC + MCU interlocks still required to run pumps.'
