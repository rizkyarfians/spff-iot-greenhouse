#!/usr/bin/env bash
# HST SHADOW-only production rollout preserving all tracked local source edits.
# Builds an isolated worktree from the live /opt/spff source, inserts only HST
# additions, then swaps compiled artifacts with rollback. No source overwrites.
set -Eeuo pipefail
umask 077
# Root must never refresh the index of the orangepi-owned Git checkouts.
# Git inspections here are read-only and have no need for index write locks.
export GIT_OPTIONAL_LOCKS=0

BASE="219e444a09c92b7400a765e579f72780e71f1899"
AI_SOURCE_SHA="40dfb1a78000d384959367049fd206ed093b40ac"
BACKUP="/mnt/spff-data/backups/hst-prod-preflight-20261104T065115Z"
BACKUP_SHA="79a21d67ab062fbf478dcdeb1a64c93dbd317bf0287771c5f8521c6c8bb3b023"
PROD=/opt/spff
AI=/opt/spff-ai
SRC="$1"
AI_SRC="$2"

if [[ "$EUID" != 0 ]]; then echo "STOP: run via root systemd-run"; exit 2; fi
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo "STOP: another SPFF HST rollout running"; exit 3; }

RUN="$BACKUP/hst-preserve-local-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -p "$RUN"
printf '%s\n' "$RUN" > "$BACKUP/hst-preserve-local-latest.txt"
exec > >(tee -a "$RUN/rollout.log") 2>&1
CHANGED=0
AI_DROPIN=0
API_DROPIN=0
ENV_CREATED=0

restore_dir() {
  local label="$1" dest="$2"
  if [[ -d "$RUN/old/$label" ]]; then
    if [[ -e "$dest" ]]; then mv "$dest" "$RUN/failed-$label" || true; fi
    mv "$RUN/old/$label" "$dest" || true
  fi
}
rollback() {
  echo "=== ROLLBACK START ==="
  systemctl stop spff-ai-engine.service || true
  if [[ "$API_DROPIN" == 1 ]]; then rm -f /etc/systemd/system/spff-api.service.d/95-hst-prod.conf; fi
  if [[ "$AI_DROPIN" == 1 ]]; then rm -f /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf; fi
  if [[ "$ENV_CREATED" == 1 ]]; then
    mv /etc/spff-ai/hst-runtime.env "$RUN/hst-runtime.disabled.env" || true
    chmod 600 "$RUN/hst-runtime.disabled.env" 2>/dev/null || true
  fi
  restore_dir contracts "$PROD/packages/contracts/dist"
  restore_dir api "$PROD/functions/lib"
  restore_dir web "$PROD/frontend/dist"
  systemctl daemon-reload || true
  systemctl restart spff-api.service || true
  systemctl stop spff-ai-engine.service || true
  if curl -fsS -m 8 http://127.0.0.1:3001/api/health >/dev/null; then
    echo "ROLLBACK_API_HEALTH=OK"
  else
    echo "ROLLBACK_API_HEALTH=FAILED — manual inspection required"
  fi
}
finish() {
  local rc="$?"
  trap - EXIT
  if [[ "$rc" -ne 0 && "$CHANGED" == 1 ]]; then rollback || true; fi
  if [[ "$rc" -eq 0 ]]; then
    echo "ROLLOUT=SUCCESS — SHADOW ONLY"
  else
    echo "ROLLOUT=FAILED"
  fi
  echo "$rc" > "$RUN/rollout.exit"
  echo "FINAL EXIT CODE: $rc"
  exit "$rc"
}
trap finish EXIT

echo "=== 1. VERIFY PRODUCTION BASELINE AND PREVIOUS BACKUP ==="
date -Is
test -s "$BACKUP/production-code.tgz" || { echo "STOP: missing backup code"; exit 1; }
test "$(cat "$BACKUP/preflight.exit")" = 0 || { echo "STOP: previous preflight not passed"; exit 1; }
test "$(sha256sum "$BACKUP/production-code.tgz" | cut -d' ' -f1)" = "$BACKUP_SHA" || { echo "STOP: archive digest mismatch"; exit 1; }
test -s "$BACKUP/engine_state.json.gz" || { echo "STOP: AI state backup missing"; exit 1; }
test "$(git -c safe.directory="$PROD" -C "$PROD" rev-parse HEAD)" = "$BASE" || { echo "STOP: production baseline changed"; exit 1; }
test "$(git -c safe.directory="$AI_SRC" -C "$AI_SRC" rev-parse HEAD)" = "$AI_SOURCE_SHA" || { echo "STOP: HST Python source changed"; exit 1; }
test -z "$(git -c safe.directory="$AI_SRC" -C "$AI_SRC" status --porcelain --untracked-files=no)" || { echo "STOP: Python source has local edits"; exit 1; }
test -z "$(git -c safe.directory="$SRC" -C "$SRC" status --porcelain --untracked-files=no)" || { echo "STOP: release source has local edits"; exit 1; }
git -c safe.directory="$SRC" -C "$SRC" merge-base --is-ancestor "$BASE" HEAD || { echo "STOP: HST backport is not derived from production"; exit 1; }
test "$(systemctl is-active spff-api.service)" = active || { echo "STOP: production API is not active"; exit 1; }
test "$(systemctl is-active spff-ai-engine.service || true)" = inactive || { echo "STOP: production Python AI already active"; exit 1; }
test -z "$(ss -ltnH '( sport = :5010 )')" || { echo "STOP: port 5010 busy"; exit 1; }
test ! -e /etc/spff-ai/hst-runtime.env || { echo "STOP: existing HST runtime config"; exit 1; }
test ! -e /etc/systemd/system/spff-api.service.d/95-hst-prod.conf || { echo "STOP: API override already exists"; exit 1; }
test ! -e /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf || { echo "STOP: Python override already exists"; exit 1; }
for dir in "$PROD/functions/lib" "$PROD/frontend/dist" "$PROD/packages/contracts/dist"; do
  test -d "$dir" && test ! -L "$dir" || { echo "STOP: unexpected runtime directory $dir"; exit 1; }
done
curl -fsS -m 8 http://127.0.0.1:3001/api/health >/dev/null
echo "BACKUP=VERIFIED PRODUCTION=STILL_RUNNING"

echo "=== 2. SNAPSHOT USER SOURCE CHANGES; BUILD FROM EXACT PRODUCTION WORKTREE ==="
git -c safe.directory="$PROD" -C "$PROD" diff --binary HEAD > "$RUN/production-tracked-local.patch"
sha256sum "$RUN/production-tracked-local.patch" > "$RUN/local.patch.sha256"
git -c safe.directory="$PROD" -C "$PROD" status --short --untracked-files=no \
  > "$RUN/local-files-before.txt"
echo "TRACKED_LOCAL_EDIT_COUNT=$(wc -l < "$RUN/local-files-before.txt")"
cat "$RUN/local-files-before.txt"
WORK="$RUN/live-source-plus-hst"
mkdir -p "$WORK"
(
  cd "$PROD"
  git -c safe.directory="$PROD" ls-files -z \
    | tar -cf - --null -T -
) | tar -xf - -C "$WORK"
# Ensure deployed tracked modifications were transferred byte for byte.
while IFS= read -r -d '' path; do
  cmp -s "$PROD/$path" "$WORK/$path" || { echo "STOP: source copy mismatch: $path"; exit 1; }
done < <(git -c safe.directory="$PROD" -C "$PROD" diff --name-only -z HEAD)
echo "PRODUCTION_SOURCE_SNAPSHOT=VERIFIED"

echo "=== 2B. INCLUDE LOCAL-ONLY TYPESCRIPT/CSS SOURCE (NEVER SECRETS OR ENV FILES) ==="
: > "$RUN/local-only-source.sha256"
: > "$RUN/local-only-source.txt"
for source_root in frontend/src functions/src edge-gateway/src mqtt-worker/src packages/contracts/src sync-worker/src; do
  [[ -d "$PROD/$source_root" ]] || continue
  while IFS= read -r -d '' source_file; do
    rel="${source_file#"$PROD/"}"
    if [[ -e "$WORK/$rel" || -L "$WORK/$rel" ]]; then continue; fi
    case "$rel" in
      *.ts|*.tsx|*.js|*.jsx|*.mjs|*.css) ;;
      *) continue ;;
    esac
    case "$rel" in
      */.*|*/.env*|*secret*|*credential*|*private*|*service-account*|*password*|*token*) 
        echo "STOP: local-only source suspicious path: $rel"; exit 1 ;;
    esac
    install -D -m 644 -- "$source_file" "$WORK/$rel"
    cmp -s -- "$source_file" "$WORK/$rel" || { echo "STOP: local-only source copy mismatch: $rel"; exit 1; }
    sha256sum -- "$source_file" >> "$RUN/local-only-source.sha256"
    printf '%s\n' "$rel" >> "$RUN/local-only-source.txt"
  done < <(find "$PROD/$source_root" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.css' \) -print0)
done
echo "LOCAL_ONLY_SOURCE_COUNT=$(wc -l < "$RUN/local-only-source.txt")"
cat "$RUN/local-only-source.txt"
for module_name in ConversionTarget AdaptiveDevicePanel; do
  found=0
  for ext in ts tsx js jsx; do
    if [[ -f "$WORK/frontend/src/$module_name.$ext" ]]; then found=1; break; fi
  done
  [[ "$found" -eq 1 ]] || { echo "STOP: production source lacks local module frontend/src/$module_name.*"; exit 1; }
done
echo "LOCAL_ONLY_IMPORTS=VERIFIED"

echo "=== 3. ADD HST COMPONENTS WITHOUT REPLACING ANY LIVE MODIFIED FILE ==="
for path in \
  packages/contracts/src/aiHst.ts \
  packages/contracts/test/ai-hst.test.mjs \
  functions/src/controllers/aiHstController.ts \
  functions/src/services/localAiEndpoint.ts \
  functions/test/localAiEndpoint.test.mjs \
  frontend/src/HstApprovalPanel.tsx \
  frontend/src/HstApprovalPanel.css; do
  test ! -e "$WORK/$path" || { echo "STOP: HST target already exists: $path"; exit 1; }
  install -D -m 644 "$SRC/$path" "$WORK/$path"
done
python3 - "$WORK" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
def insert(path, old, new):
    f=root/path
    s=f.read_text()
    if s.count(old)!=1:
        raise RuntimeError(f"STOP: unexpected anchor in {path}: {s.count(old)} occurrences")
    f.write_text(s.replace(old,new,1))
insert('functions/src/routes/index.ts',
       "import { requireAiEvaluationEnabled } from '../middleware/aiEvaluation.js';",
       "import { requireAiEvaluationEnabled } from '../middleware/aiEvaluation.js';\n"
       "import { getHstProposals, postHstApproval } from '../controllers/aiHstController.js';")
routes=(root/'functions/src/routes/index.ts').read_text()
anchor="apiRouter.get(\n  '/bootstrap',"
auth="apiRouter.use(\n  requireAuth,"
if auth not in routes or anchor not in routes or routes.index(auth)>routes.index(anchor):
    raise RuntimeError("STOP: HST routes would be outside authentication boundary")
insert('functions/src/routes/index.ts',anchor,
       "// Authenticated HST SHADOW; role checks and CSRF mandatory.\n"
       "apiRouter.get('/unified-ai/hst/proposals', requireOperator, getHstProposals);\n"
       "apiRouter.post('/unified-ai/hst/approvals', requireOperator, requireCsrf, postHstApproval);\n\n"
       +anchor)
insert('frontend/src/GuidePage.tsx',
       "import './GuidePage.css'",
       "import './GuidePage.css'\nimport { HstApprovalPanel } from './HstApprovalPanel'")
insert('frontend/src/GuidePage.tsx',
       "    <AutomationMethodNote/>",
       "    <HstApprovalPanel/>\n    <AutomationMethodNote/>")
p=root/'frontend/src/api.ts'
if 'fetchAiHstProposals' in p.read_text():
    raise RuntimeError('STOP: HST frontend API already exists')
with p.open('a') as f:
    f.write("\n// HST operator review is SHADOW-only and never dispatches pumps.\n"
            "export function fetchAiHstProposals(signal?: AbortSignal) {\n"
            "  return request<import('@spff/contracts').AiHstProposals>('/unified-ai/hst/proposals', {signal})\n"
            "}\n"
            "export function reviewAiHstApproval(input: import('@spff/contracts').AiHstApprovalRequest) {\n"
            "  return request<import('@spff/contracts').AiHstApprovalResult>('/unified-ai/hst/approvals', {\n"
            "    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input),\n"
            "  })\n"
            "}\n")
p=root/'packages/contracts/src/index.ts'
if "from './aiHst.js'" in p.read_text():
    raise RuntimeError('STOP: HST contracts already exported')
with p.open('a') as f:
    f.write("\nexport * from './aiHst.js';\n")
PY
echo "HST_SOURCE_INTEGRATION=OK — original /opt/spff source untouched"

echo "=== 3B. ALIGN ISOLATED STALE TEST FIXTURE WITH EXISTING PRODUCTION SAFETY SCHEMA ==="
# This modifies ONLY the disposable WORK/test file, not the live validator,
# not /opt/spff and not the firmware. First prove the expected mismatch
# against the currently running compiled production contract.
LIVE_CONTRACT="$PROD/packages/contracts/dist/index.js" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const contracts = await import(pathToFileURL(process.env.LIVE_CONTRACT).href);
const command = {
  kind:'adaptive_fert_command',schemaVersion:1,
  siteId:'greenhouse-01',deviceId:'esp32-s3-01',
  sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  commandType:'start',
  targetEcUs:2500,ecToleranceUs:100,maxDurationSec:600,
  targetWaterVolumeL:100,targetFertVolumeL:5,
  nominalConcentrationGPerL:10,plantCount:2000,flushDurationSec:30
};
const result = contracts.adaptiveStartCommandSchema.safeParse(command);
if (result.success) throw new Error('STOP: live validator no longer requires the three safety fields');
const fields = result.error.issues
  .filter(x => x.code === 'invalid_type' && x.message.includes('received undefined'))
  .map(x => x.path.join('.')).sort();
assert.deepEqual(fields, ['bootId','expiresAt','issuedAt'],
  'STOP: unexpected live command contract; fixture cannot be aligned automatically');
assert.equal(result.error.issues.length,3,
  'STOP: unrelated live validator failures; do not modify tests automatically');
const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now()+30000).toISOString();
const currentFixture = {...command,
  bootId:'c0ffee123456abcd',
  issuedAt, expiresAt};
const valid = contracts.adaptiveStartCommandSchema.safeParse(currentFixture);
assert.ok(valid.success,
  'STOP: corrected fixture still invalid under running firmware contract: ' +
    JSON.stringify(valid.success ? [] : valid.error.issues));
console.log('LIVE_COMMAND_VALIDATOR=CONFIRMED (3 existing required safety fields)');
console.log('FIXED_FIXTURE_VALIDATED_AGAINST_LIVE_SCHEMA=PASS');
JS
python3 - "$WORK/packages/contracts/test/adaptive-fertigation.test.mjs" <<'PY'
from pathlib import Path
import sys
file = Path(sys.argv[1])
data = file.read_text()
anchor = "commandType:'start',targetEcUs:2500"
if data.count(anchor) != 1:
    raise SystemExit('STOP: adaptive-fertigation test fixture changed unexpectedly')
data = data.replace(anchor,
  "commandType:'start',"
  "bootId:'c0ffee123456abcd',"
  "issuedAt:new Date().toISOString(),"
  "expiresAt:new Date(Date.now()+30000).toISOString(),"
  "targetEcUs:2500",1)
old = "['targetEcUs','ecToleranceUs','maxDurationSec'"
new = "['bootId','issuedAt','expiresAt','targetEcUs','ecToleranceUs','maxDurationSec'"
if data.count(old) != 1:
    raise SystemExit('STOP: expected required-field test assertion missing')
data = data.replace(old,new,1)
old = "for(const patch of [{targetEcUs:8000}"
new = "for(const patch of [{bootId:''},{issuedAt:'invalid'},{expiresAt:'invalid'},{targetEcUs:8000}"
if data.count(old) != 1:
    raise SystemExit('STOP: expected invalid-value test assertion missing')
data = data.replace(old,new,1)
file.write_text(data)
print('ISOLATED_TEST_FIXTURE=UPDATED; live schema remains untouched')
PY
sha256sum "$WORK/packages/contracts/test/adaptive-fertigation.test.mjs" \
  > "$RUN/isolated-adaptive-fixture.sha256"
echo "LIVE_ACTUATOR_VALIDATOR=UNMODIFIED"

echo "=== 4. BUILD, LINT AND TEST PRESERVED PRODUCTION SOURCE ==="
(cd "$WORK" && npm ci --no-audit --no-fund && npm run build && npm run lint \
  && npm run test --workspace @spff/contracts \
  && node --test functions/test/localAiEndpoint.test.mjs)
# Make sure existing production edits did not change while compiling.
git -c safe.directory="$PROD" -C "$PROD" diff --binary HEAD > "$RUN/production-tracked-after.patch"
cmp -s "$RUN/production-tracked-local.patch" "$RUN/production-tracked-after.patch" \
  || { echo "STOP: production local changes changed during build"; exit 1; }
if [[ -s "$RUN/local-only-source.sha256" ]]; then
  sha256sum --check --status "$RUN/local-only-source.sha256" \
    || { echo "STOP: production local-only modules changed during build"; exit 1; }
fi
echo "PRODUCTION_USER_EDIT_PRESERVATION=PASS"

echo "=== 5. PREPARE INDEPENDENT PYTHON AI SHADOW RELEASE ==="
install -d -m 755 "$AI/releases"
AI_RELEASE="$AI/releases/hst-shadow-live-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$AI_RELEASE/standalone-ai"
(cd "$AI_SRC/standalone-ai" && tar --exclude='./.venv' --exclude='./.env' \
  --exclude='./data' --exclude='__pycache__' -cf - .) \
  | tar -xf - -C "$AI_RELEASE/standalone-ai"
python3 -m venv "$AI_RELEASE/venv"
"$AI_RELEASE/venv/bin/python" -m pip install \
  -r "$AI_RELEASE/standalone-ai/requirements.lock.txt"
"$AI_RELEASE/venv/bin/python" -m pip check
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_hst_workflow.py)
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_live_source.py)
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_api.py)
chown -R root:root "$AI_RELEASE"
chmod -R a+rX "$AI_RELEASE"
echo "PYTHON_RELEASE=$AI_RELEASE"

echo "=== 6. PREPARE NEW COMPILED ARTIFACTS ==="
mkdir -p "$RUN/new" "$RUN/old"
cp -a "$WORK/packages/contracts/dist" "$RUN/new/contracts"
cp -a "$WORK/functions/lib" "$RUN/new/api"
cp -a "$WORK/frontend/dist" "$RUN/new/web"
chown -R root:root "$RUN/new"
chmod -R a+rX "$RUN/new"

echo "=== 7. START SHADOW PYTHON ON PRODUCTION LOOPBACK ==="
install -d -m 755 /etc/systemd/system/spff-api.service.d
install -d -m 755 /etc/systemd/system/spff-ai-engine.service.d
KEY="$(openssl rand -hex 32)"
CHANGED=1
ENV_CREATED=1
printf 'AI_HST_BRIDGE_KEY=%s\nAI_POLL_ENABLED=true\nAI_MODE=SHADOW_MODE\nAI_LOCAL_PORT=5010\n' "$KEY" \
  > /etc/spff-ai/hst-runtime.env
chmod 600 /etc/spff-ai/hst-runtime.env
unset KEY
AI_DROPIN=1
cat > /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf <<EOF
[Service]
WorkingDirectory=$AI_RELEASE/standalone-ai
ExecStart=
ExecStart=$AI_RELEASE/venv/bin/python -m app
EnvironmentFile=/etc/spff-ai/hst-runtime.env
EOF
API_DROPIN=1
cat > /etc/systemd/system/spff-api.service.d/95-hst-prod.conf <<'EOF'
[Service]
Environment=AI_LOCAL_PORT=5010
EnvironmentFile=/etc/spff-ai/hst-runtime.env
EOF
chmod 644 /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf \
          /etc/systemd/system/spff-api.service.d/95-hst-prod.conf
systemctl daemon-reload
systemctl start spff-ai-engine.service

echo "=== 8. PYTHON HEALTH, PROPOSALS, UNAUTHORIZED POST ==="
ok=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 http://127.0.0.1:5010/health \
    | python3 -c 'import sys,json; x=json.load(sys.stdin); assert x["mode"]=="SHADOW_MODE" and x["can_dispatch"] is False' 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done
test "$ok" = 1 || { echo "STOP: Python AI health failed"; exit 1; }
curl -fsS -m 8 http://127.0.0.1:5010/status \
  | python3 -c 'import sys,json; x=json.load(sys.stdin); assert x["mode"]=="SHADOW_MODE" and x["source_configured"] is True and x["state_backend"]=="postgresql" and x["polling"]["enabled"] is True and x["can_dispatch"] is False'
curl -fsS -m 12 http://127.0.0.1:5010/source/guide-programs >/dev/null \
  || { echo "STOP: service user cannot read production Guide"; exit 1; }
curl -fsS -m 10 http://127.0.0.1:5010/hst/proposals \
  | python3 -c 'import sys,json; x=json.load(sys.stdin); assert x["schemaVersion"]==1 and x["can_dispatch"] is False and isinstance(x["proposals"],list)'
UNAUTH='{"obligation_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","approval_id":"11111111-1111-4111-8111-111111111111","actor":"unauthorized","expected_remaining_g":1,"confirmation":"REVIEW_HST_SHADOW_SESSION"}'
code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "$UNAUTH" http://127.0.0.1:5010/hst/approvals)"
test "$code" = 403 || { echo "STOP: unauthorized HST Python write status=$code"; exit 1; }

echo "=== 9. SWITCH COMPILED OUTPUT ONLY, PRESERVE ALL LIVE SOURCE EDITS ==="
mv "$PROD/packages/contracts/dist" "$RUN/old/contracts"
mv "$RUN/new/contracts" "$PROD/packages/contracts/dist"
mv "$PROD/functions/lib" "$RUN/old/api"
mv "$RUN/new/api" "$PROD/functions/lib"
mv "$PROD/frontend/dist" "$RUN/old/web"
mv "$RUN/new/web" "$PROD/frontend/dist"
systemctl restart spff-api.service

echo "=== 10. API AUTH BOUNDARY AND HARDWARE SERVICES ==="
ok=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
test "$ok" = 1 || { echo "STOP: operational API health failed"; exit 1; }
code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:3001/api/unified-ai/hst/proposals)"
test "$code" = 401 || { echo "STOP: unauthenticated HST GET returned $code"; exit 1; }
code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:3001/api/unified-ai/hst/approvals)"
test "$code" = 401 || { echo "STOP: unauthenticated HST POST returned $code"; exit 1; }
test -f "$PROD/frontend/dist/index.html"
systemctl is-active --quiet spff-edge-gateway.service
systemctl is-active --quiet spff-mqtt-worker.service
echo "PRODUCTION HST SHADOW VERIFIED — API 3001, AI 5010, panel on Panduan."
echo "MUTATED_SOURCE=/opt/spff NONE; ACTUATION=BLOCKED; MQTT=UNCHANGED."
