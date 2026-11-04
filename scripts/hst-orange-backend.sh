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
[[ "$MODE" =~ ^(deploy|enable|disable|status)$ ]] || fatal "Expected deploy|enable|disable|status"
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || fatal "SPFF deployment lock occupied"
db(){ runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 -d spff -c "$1"; }
gates(){
 install -d -m 755 /etc/systemd/system/spff-api.service.d /etc/systemd/system/spff-mqtt-worker.service.d
 printf '[Service]\nEnvironment=SPFF_HST_REAL_DISPATCH_ENABLED=%s\nEnvironment=SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=%s\n' "$1" "$1" > "$APIGATE"
 printf '[Service]\nEnvironment=SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=%s\n' "$2" > "$WORKERGATE"
 chmod 644 "$APIGATE" "$WORKERGATE"
 systemctl daemon-reload
}
healthy(){
 systemctl is-active --quiet "$API"
 systemctl is-active --quiet "$WORKER"
 systemctl is-active --quiet spff-edge-gateway.service
 curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null
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
  fi
  echo "$code" > "$RUN/deploy.exit"
  echo "DEPLOY_EXIT=$code"
 fi
 exit "$code"
}
if [[ "$MODE" == deploy ]]; then
 mkdir -p "$STORE"
 RUN="$STORE/hst-backend-$(date -u +%Y%m%dT%H%M%SZ)"
 mkdir -m 700 "$RUN"
 printf '%s\n' "$RUN" > "$STORE/hst-backend-latest.txt"
 exec > >(tee -a "$RUN/deploy.log") 2>&1
 trap finish EXIT ERR
 say "Check current production and staging"
 [[ -d "$SRC/.git" && -d "$PROD/.git" ]] || fatal "missing source checkout"
 healthy || fatal "production API/worker/edge unhealthy"
 [[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]] || fatal "staging has local edits"
 git -C "$SRC" log -1 --oneline
 git -c safe.directory="$PROD" -C "$PROD" status --short --untracked-files=no > "$RUN/prod-source-edits.txt" || true
 [[ "$(db "SELECT (to_regclass('spff.adaptive_fert_sessions') IS NOT NULL AND to_regclass('spff.adaptive_fert_commands') IS NOT NULL AND to_regclass('spff.guide_programs') IS NOT NULL)::text")" == t ]] || fatal "migration 034-036 missing"
 [[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "active/uncertain adaptive sessions; do not interrupt"
 for loc in "$PROD/packages/contracts/dist" "$PROD/functions/lib" "$PROD/mqtt-worker/dist" "$PROD/frontend/dist"; do
  [[ -d "$loc" && ! -L "$loc" ]] || fatal "unexpected runtime directory: $loc"
 done
 say "Build and test staged source; production remains live"
 ( cd "$SRC"; npm run build; npm run lint
   npm run test --workspace @spff/contracts
   npm run test --workspace functions
   npm run test --workspace frontend
   npm run test --workspace @spff/edge-gateway
   npm run test --workspace @spff/mqtt-worker
 )
 say "Prepare surgical merged runtime with original production files"
 mkdir -p "$RUN/new" "$RUN/old"
 cp -a "$PROD/packages/contracts/dist" "$RUN/new/contracts"
 cp -a "$PROD/functions/lib" "$RUN/new/api"
 cp -a "$PROD/mqtt-worker/dist" "$RUN/new/worker"
 for module in aiHst adaptiveFertigation; do
  install -m644 "$SRC/packages/contracts/dist/$module.js" "$RUN/new/contracts/$module.js"
 done
 for module in controllers/aiHstController services/adaptiveFertigationService services/hstRealExecutionService services/hstExecutionModeService; do
  install -D -m644 "$SRC/functions/lib/$module.js" "$RUN/new/api/$module.js"
 done
 install -m644 "$SRC/mqtt-worker/dist/adaptiveFertigationTransport.js" "$RUN/new/worker/adaptiveFertigationTransport.js"
 [[ -f "$RUN/new/contracts/index.js" ]] || fatal "contracts barrel missing"
 grep -q "aiHst.js" "$RUN/new/contracts/index.js" || fatal "live contracts barrel missing aiHst export"
 grep -q "adaptiveFertigation.js" "$RUN/new/contracts/index.js" || fatal "live contracts barrel missing adaptive export"
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
route_pattern=r"^apiRouter\.(?:get|post|put)\('/unified-ai/hst/[^;\n]+;\s*$"
routes=re.findall(route_pattern,new,re.M)
oldroutes=re.findall(route_pattern,live,re.M)
if len(routes)<8 or len(oldroutes)<2: raise SystemExit('STOP: HST route anchors changed unexpectedly')
for entry in oldroutes:
    live=live.replace(entry,'',1)
anchor="apiRouter.get('/unified-ai/hst/proposals'"
pos=live.find("apiRouter.get(\n  '/bootstrap'")
if pos<0: pos=live.find("apiRouter.get('/bootstrap'")
if pos<0: raise SystemExit('STOP: authenticated bootstrap route anchor not found')
# HST routes must be inserted immediately before the existing authenticated bootstrap.
auth=live.find('requireAuth')
if auth<0 or pos<auth: raise SystemExit('STOP: authentication boundary mismatch')
live=live[:pos]+'\n'.join(routes)+'\n\n'+live[pos:]
dest.write_text(live)
print('PRESERVED_LOCAL_API_ROUTES=PASS;',len(routes),'HST routes merged')
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
 for hst_file in HstApprovalPanel.tsx HstApprovalPanel.css HstRealExecutionCard.tsx hstExecutionMode.ts; do
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
 allowed=('fetchAiHst','reviewAiHst','saveAiHst','executeAiHst','stopAiHst','setAiHst')
 if any(not name.startswith(allowed) for name in exports):
  raise SystemExit('STOP: unrelated production API exports after HST: '+str(exports))
 local_path.write_text(local[:loc]+'\n'+hst)
guide=guide_path.read_text()
if 'HstApprovalPanel' not in guide:
 i="import './GuidePage.css'"
 c="    <AutomationMethodNote/>"
 if guide.count(i)!=1 or guide.count(c)!=1: raise SystemExit('STOP: GuidePage anchors changed')
 guide=guide.replace(i,i+"\nimport {HstApprovalPanel} from './HstApprovalPanel'",1)
 guide=guide.replace(c,"    <HstApprovalPanel/>\n"+c,1)
 guide_path.write_text(guide)
print('PRESERVED_PRODUCTION_FRONTEND_SOURCE=PASS')
PY
 (cd "$MERGED/frontend" && "$SRC/node_modules/.bin/tsc" -b && "$SRC/node_modules/.bin/vite" build)
 [[ -s "$MERGED/frontend/dist/index.html" ]] || fatal "merged frontend build output missing"
 cp -a "$MERGED/frontend/dist" "$RUN/new/web"
 say "Back up PostgreSQL before additive migration"
 runuser -u postgres -- pg_dump -Fc -d spff > "$RUN/db-before.dump"
 [[ -s "$RUN/db-before.dump" ]] || fatal "DB backup failed"
 sha256sum "$RUN/db-before.dump" > "$RUN/db-before.sha256"
 if [[ -e "$APIGATE" ]]; then cp -a "$APIGATE" "$RUN/old-api-gate"; fi
 if [[ -e "$WORKERGATE" ]]; then cp -a "$WORKERGATE" "$RUN/old-worker-gate"; fi
 say "Migration 037: HST physical stock binding and session identity"
 tables="$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL)::int::text || ',' || (to_regclass('spff.hst_real_sessions') IS NOT NULL)::int::text")"
 case "$tables" in
  0,0) runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -f "$SRC/infrastructure/postgres/migrations/037_hst_real_adaptive_binding.sql";;
  1,1) say "Migration 037 already installed; skip";;
  *) fatal "migration 037 only partly installed";;
 esac
 [[ "$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL AND to_regclass('spff.hst_real_sessions') IS NOT NULL)::text")" == t ]] || fatal "migration 037 not installed"
 say "Migration 038: durable SHADOW MODE ON by default"
 if [[ "$(db "SELECT (to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" != t ]]; then
   runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d spff -f "$SRC/infrastructure/postgres/migrations/038_hst_shadow_mode.sql"
 fi
 [[ "$(db "SELECT (to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == t ]] || fatal "migration 038 missing"
 [[ "$(db "SELECT shadow_enabled::text FROM spff.hst_execution_modes ORDER BY site_id LIMIT 1")" == true ]] || fatal "SHADOW MODE default must be ON at deployment"
 say "Swap only compiled HST modules (physical pump command gate remains OFF)"
 chown -R root:root "$RUN/new"
 chmod -R a+rX "$RUN/new"
 SWAPPED=1
 gates false false
 systemctl stop "$API" "$WORKER"
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
 for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 3 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
  sleep 2
 done
 healthy || fatal "API/worker/edge smoke failed"
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
 healthy || fatal "service unhealthy"
 echo "NEW_REAL_START=DISABLED. This does NOT shut off an already running pump."
 exit 0
fi
if [[ "$MODE" == status ]]; then
 healthy || fatal "production unhealthy"
 echo "verified_profiles=$(db 'SELECT count(*) FROM spff.hst_real_profiles')"
 echo "physical_hst_sessions=$(db 'SELECT count(*) FROM spff.hst_real_sessions')"
 systemctl show "$API" "$WORKER" -p Environment | grep -E 'SPFF_(HST_REAL|ADAPTIVE_FERT)_DISPATCH_ENABLED' || true
 exit 0
fi
# Explicit in-person arming only, never enabled by the deploy phase.
healthy || fatal "production unhealthy"
[[ "$(db "SELECT (to_regclass('spff.hst_real_profiles') IS NOT NULL AND to_regclass('spff.hst_real_sessions') IS NOT NULL AND to_regclass('spff.hst_execution_modes') IS NOT NULL)::text")" == t ]] || fatal "migrations 037-038 missing"
[[ "$(db "SELECT count(*) FROM spff.adaptive_fert_sessions WHERE status NOT IN ('completed','fault')")" == 0 ]] || fatal "active/uncertain adaptive session"
[[ "$(db "SELECT count(*) FROM spff.adaptive_fert_commands WHERE status IN ('pending','dispatching','unknown')")" == 0 ]] || fatal "pending/unknown adaptive command"
[[ "$(db "SELECT count(*) FROM spff.hst_real_profiles")" -gt 0 ]] || fatal "no verified stock profile. Configure as admin from SHADOW OFF first."
[[ "$(curl -fsS -m 5 http://127.0.0.1:5010/health | python3 -c 'import json,sys;print(json.load(sys.stdin).get("mode",""))')" == SHADOW_MODE ]] || fatal "Python HST AI service unavailable"
echo 'SAFETY: This enables future authenticated REAL ACC for physical WATER and FERTILIZER pumps.'
echo 'Check ESP32 MANUAL selector, pumps/stock isolated for commissioning, EC/flow/level sensors, emergency STOP.'
read -r -p 'Type ENABLE-HST-PHYSICAL while physically present: ' confirmation
[[ "$confirmation" == ENABLE-HST-PHYSICAL ]] || fatal 'not armed'
gates true true
if ! systemctl restart "$WORKER" "$API" || ! healthy; then
 gates false false
 systemctl restart "$WORKER" "$API" || true
 fatal 'enable failed; gates reverted OFF'
fi
echo 'REAL_DISPATCH=ARMED; SHADOW OFF + explicit ACC + MCU interlocks still required to run pumps.'
