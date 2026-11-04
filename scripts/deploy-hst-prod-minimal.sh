#!/usr/bin/env bash
# Production HST SHADOW deployment based on the deployed 219e444 baseline.
# Only compiled contract, API, frontend files, and the independent AI service.
set -Eeuo pipefail
umask 077

BASE="219e444a09c92b7400a765e579f72780e71f1899"
AI_SOURCE_SHA="40dfb1a78000d384959367049fd206ed093b40ac"
BACKUP="/mnt/spff-data/backups/hst-prod-preflight-20261104T065115Z"
BACKUP_SHA="79a21d67ab062fbf478dcdeb1a64c93dbd317bf0287771c5f8521c6c8bb3b023"
PROD=/opt/spff
AI=/opt/spff-ai
SRC="$1"
AI_SRC="$2"

if [[ "$EUID" != 0 ]]; then echo "STOP: must run via root systemd-run"; exit 2; fi
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo "STOP: another rollout still running"; exit 3; }
RUN="$BACKUP/hst-minimal-rollout"
mkdir -m 700 -p "$RUN"
exec > >(tee -a "$RUN/rollout.log") 2>&1
CHANGED=0
AI_DROPIN=0
API_DROPIN=0
ENV_CREATED=0

restore_dir() {
  old="$1"
  target="$2"
  label="$3"
  if [[ -d "$RUN/old/$label" ]]; then
    if [[ -e "$target" ]]; then
      mv "$target" "$RUN/failed-$label-$(date -u +%H%M%S)" || true
    fi
    mv "$RUN/old/$label" "$target" || true
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
  restore_dir contracts "$PROD/packages/contracts/dist" contracts
  restore_dir api "$PROD/functions/lib" api
  restore_dir web "$PROD/frontend/dist" web
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
  rc="$?"
  trap - EXIT
  if [[ "$rc" != 0 && "$CHANGED" == 1 ]]; then rollback || true; fi
  if [[ "$rc" == 0 ]]; then
    echo "ROLLOUT=SUCCESS — HST SHADOW ONLY"
  else
    echo "ROLLOUT=FAILED"
  fi
  echo "$rc" > "$RUN/rollout.exit"
  echo "FINAL EXIT CODE: $rc"
  exit "$rc"
}
trap finish EXIT

echo "=== 1. VALIDATE PRODUCTION BASELINE AND BACKUP ==="
date -Is
test -f "$BACKUP/preflight.exit"
test "$(cat "$BACKUP/preflight.exit")" = 0
test "$(sha256sum "$BACKUP/production-code.tgz" | cut -d' ' -f1)" = "$BACKUP_SHA"
test -s "$BACKUP/engine_state.json.gz"
test -d "$SRC/.git"
test -d "$AI_SRC/.git"
test "$(git -c safe.directory="$PROD" -C "$PROD" rev-parse HEAD)" = "$BASE"
test -z "$(git -c safe.directory="$PROD" -C "$PROD" status --porcelain --untracked-files=no)"
test "$(git -c safe.directory="$AI_SRC" -C "$AI_SRC" rev-parse HEAD)" = "$AI_SOURCE_SHA"
test -z "$(git -c safe.directory="$AI_SRC" -C "$AI_SRC" status --porcelain --untracked-files=no)"
test -z "$(git -c safe.directory="$SRC" -C "$SRC" status --porcelain --untracked-files=no)"
git -c safe.directory="$SRC" -C "$SRC" merge-base --is-ancestor "$BASE" HEAD
git -c safe.directory="$SRC" -C "$SRC" diff --name-only "$BASE" HEAD > "$RUN/changed-paths.txt"
while IFS= read -r path; do
  case "$path" in
    frontend/src/GuidePage.tsx|frontend/src/HstApprovalPanel.css|frontend/src/HstApprovalPanel.tsx|frontend/src/api.ts|functions/src/controllers/aiHstController.ts|functions/src/routes/index.ts|functions/src/services/localAiEndpoint.ts|functions/test/localAiEndpoint.test.mjs|packages/contracts/src/aiHst.ts|packages/contracts/src/index.ts|packages/contracts/test/ai-hst.test.mjs|scripts/deploy-hst-prod-minimal.sh) ;;
    *) echo "STOP: unexpected changed production source: $path"; exit 1 ;;
  esac
done < "$RUN/changed-paths.txt"
test "$(systemctl is-active spff-api.service)" = active
test "$(systemctl is-active spff-ai-engine.service || true)" = inactive
test -z "$(ss -ltnH '( sport = :5010 )')"
test ! -e /etc/spff-ai/hst-runtime.env
test ! -e /etc/systemd/system/spff-api.service.d/95-hst-prod.conf
test ! -e /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf
for dir in "$PROD/functions/lib" "$PROD/frontend/dist" "$PROD/packages/contracts/dist"; do
  test -d "$dir" && test ! -L "$dir"
done
curl -fsS -m 8 http://127.0.0.1:3001/api/health >/dev/null
echo "BASELINE=PASS"

echo "=== 2. BUILD AND TEST MINIMAL BACKPORT WITHOUT TOUCHING PRODUCTION ==="
cd "$SRC"
npm ci --no-audit --no-fund
npm run build
npm run lint
npm run test --workspace @spff/contracts
node --test functions/test/localAiEndpoint.test.mjs

echo "=== 3. BUILD ISOLATED PYTHON AI RELEASE ==="
SHORT_SHA="$(git -c safe.directory="$SRC" -C "$SRC" rev-parse --short HEAD)"
install -d -m 755 "$AI/releases"
AI_RELEASE="$AI/releases/hst-shadow-$SHORT_SHA-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$AI_RELEASE/standalone-ai"
(cd "$AI_SRC/standalone-ai" && tar --exclude='./.venv' --exclude='./.env' --exclude='./data' --exclude='__pycache__' -cf - .) \
  | tar -xf - -C "$AI_RELEASE/standalone-ai"
python3 -m venv "$AI_RELEASE/venv"
"$AI_RELEASE/venv/bin/python" -m pip install --no-cache-dir \
  -r "$AI_RELEASE/standalone-ai/requirements.lock.txt"
"$AI_RELEASE/venv/bin/python" -m pip check
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_hst_workflow.py)
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_live_source.py)
(cd "$AI_RELEASE/standalone-ai" && "$AI_RELEASE/venv/bin/python" -m unittest discover -s tests -p test_api.py)
chown -R root:root "$AI_RELEASE"
chmod -R a+rX "$AI_RELEASE"
echo "PYTHON_RELEASE=$AI_RELEASE"

echo "=== 4. PREPARE RUNTIME BUNDLE ==="
mkdir -p "$RUN/new" "$RUN/old"
cp -a "$SRC/packages/contracts/dist" "$RUN/new/contracts"
cp -a "$SRC/functions/lib" "$RUN/new/api"
cp -a "$SRC/frontend/dist" "$RUN/new/web"
chown -R root:root "$RUN/new"
chmod -R a+rX "$RUN/new"

echo "=== 5. START ISOLATED AI 5010 IN SHADOW MODE ==="
install -d -m 755 /etc/systemd/system/spff-ai-engine.service.d
install -d -m 755 /etc/systemd/system/spff-api.service.d
KEY="$(openssl rand -hex 32)"
CHANGED=1
ENV_CREATED=1
printf 'AI_HST_BRIDGE_KEY=%s\nAI_POLL_ENABLED=true\nAI_MODE=SHADOW_MODE\nAI_LOCAL_PORT=5010\n' "$KEY" > /etc/spff-ai/hst-runtime.env
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
chmod 644 /etc/systemd/system/spff-api.service.d/95-hst-prod.conf
chmod 644 /etc/systemd/system/spff-ai-engine.service.d/95-hst-prod.conf
systemctl daemon-reload
systemctl start spff-ai-engine.service

echo "=== 6. SMOKE TEST PYTHON API, NO AUTH BYPASS ==="
ready=0
for try in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 http://127.0.0.1:5010/health \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mode"]=="SHADOW_MODE" and d["can_dispatch"] is False' 2>/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" = 1
curl -fsS -m 10 http://127.0.0.1:5010/hst/proposals \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["schemaVersion"]==1 and d["can_dispatch"] is False and isinstance(d["proposals"],list)'
UNAUTHORIZED_BODY='{"obligation_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","approval_id":"11111111-1111-4111-8111-111111111111","actor":"unauthorized","expected_remaining_g":1,"confirmation":"REVIEW_HST_SHADOW_SESSION"}'
code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "$UNAUTHORIZED_BODY" http://127.0.0.1:5010/hst/approvals)"
test "$code" = 403

echo "=== 7. SWITCH COMPILED API, CONTRACT AND FRONTEND (NO MQTT/EDGE RESTART) ==="
mv "$PROD/packages/contracts/dist" "$RUN/old/contracts"
mv "$RUN/new/contracts" "$PROD/packages/contracts/dist"
mv "$PROD/functions/lib" "$RUN/old/api"
mv "$RUN/new/api" "$PROD/functions/lib"
mv "$PROD/frontend/dist" "$RUN/old/web"
mv "$RUN/new/web" "$PROD/frontend/dist"
systemctl restart spff-api.service

echo "=== 8. SMOKE TEST PRODUCTION API AND AUTH BOUNDARY ==="
ready=0
for try in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:3001/api/unified-ai/hst/proposals)"
test "$code" = 401
code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:3001/api/unified-ai/hst/approvals)"
test "$code" = 401
test -f "$PROD/frontend/dist/index.html"
systemctl is-active --quiet spff-edge-gateway.service
systemctl is-active --quiet spff-mqtt-worker.service
echo "PRODUCTION HST SHADOW VERIFIED: Python 5010, API 3001, Guide panel compiled."
echo "No firmware, MQTT topics, pump control, operational DB tables or migrations changed."
