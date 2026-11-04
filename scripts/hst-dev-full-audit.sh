#!/usr/bin/env bash
# Comprehensive NON-DEPLOYING audit for SPFF HST DEV on Orange Pi.
# No service restart, no writes to DEV checkout, no DB migration or MQTT commands.
set -uo pipefail

STAGE="$HOME/spff-hst-stage-20261104"
DEV="$HOME/spff-ai-dashboard-test"
ENV_FILE="$HOME/.config/spff-ai-staging/source.env"
RESULT="$STAGE/hst-dev-full-audit.exit"
BRANCH="feature/hst-approval-workflow-20261104"
PASS=0
FAIL=0
WARN=0

if [[ ! -d "$STAGE/.git" || ! -d "$DEV/.git" ]]; then
  echo "STOP: checkout STAGE atau DEV tidak ada."
  exit 2
fi
exec 9>"$STAGE/.hst-dev-audit.lock"
if ! flock -n 9; then
  echo "STOP: Audit HST lain masih berjalan."
  exit 3
fi
trap 'rc=$?; printf "%s\n" "$rc" > "$RESULT"; echo "FINAL EXIT CODE: $rc"' EXIT

section() { echo; echo "=== $* ==="; }
ok() { echo "PASS: $*"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }
note() { echo "INFO: $*"; WARN=$((WARN+1)); }
run() {
  local label="$1"
  shift
  section "$label"
  if "$@"; then ok "$label"; else bad "$label (exit $?)"; fi
}
service_check() {
  local name="$1" expected="$2" actual
  actual="$(systemctl is-active "$name.service" 2>/dev/null || true)"
  echo "$name: $actual (expected $expected)"
  if [[ "$actual" == "$expected" ]]; then ok "$name"; else bad "$name"; fi
}
http_status() {
  local label="$1" url="$2" code
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  echo "$label: HTTP ${code:-unavailable}"
}

section "SYSTEM / RESOURCES"
date --iso-8601=seconds
hostname
uname -m
node --version || true
npm --version || true
python3 --version || true
free -h
df -h /mnt/spff-data 2>/dev/null || true

section "GIT / WORKTREES"
STAGE_HEAD="$(git -C "$STAGE" rev-parse HEAD 2>/dev/null || true)"
DEV_HEAD="$(git -C "$DEV" rev-parse HEAD 2>/dev/null || true)"
echo "STAGE HEAD: $STAGE_HEAD"
echo "DEV HEAD:   $DEV_HEAD"
echo "STAGE shallow: $(git -C "$STAGE" rev-parse --is-shallow-repository 2>/dev/null || true)"
echo "DEV shallow: $(git -C "$DEV" rev-parse --is-shallow-repository 2>/dev/null || true)"
if [[ -z "$(git -C "$DEV" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  ok "DEV tracked files clean"
else
  bad "DEV has tracked edits: do not merge or overwrite"
  git -C "$DEV" status --short --untracked-files=no
fi
if [[ -z "$(git -C "$STAGE" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  ok "STAGE tracked files clean"
else
  bad "STAGE has tracked edits"
  git -C "$STAGE" status --short --untracked-files=no
fi

if git -C "$STAGE" cat-file -e "${DEV_HEAD}^{commit}" 2>/dev/null; then
  ok "DEV commit object present in STAGE"
else
  note "DEV commit missing in STAGE (likely shallow clone). Fetching deeper history in STAGE only."
  if [[ "$(git -C "$STAGE" rev-parse --is-shallow-repository)" == "true" ]]; then
    if git -C "$STAGE" fetch --no-tags --deepen=160 origin "$BRANCH"; then
      ok "Deeper Git history fetched to STAGE"
    else
      bad "Could not deepen staging history"
    fi
  fi
fi
if git -C "$STAGE" cat-file -e "${DEV_HEAD}^{commit}" 2>/dev/null; then
  if git -C "$STAGE" merge-base --is-ancestor "$DEV_HEAD" HEAD; then
    ok "DEV is ancestor of STAGE: fast-forward possible in principle"
  else
    bad "DEV is not ancestor of STAGE: do not fast-forward"
  fi
else
  bad "Cannot verify DEV ancestry; commit object still unavailable"
fi

section "DEV CONFIGURATION (NO SECRETS)"
if [[ -r "$ENV_FILE" ]]; then
  ok "DEV source.env readable"
  for key in AI_MODE AI_PORT AI_POLL_ENABLED AI_POLL_SECONDS AI_SOURCE_DSN AI_STATE_DSN AI_HST_BRIDGE_KEY; do
    if grep -Eq "^[[:space:]]*${key}=" "$ENV_FILE"; then
      echo "$key: present (value hidden)"
    else
      echo "$key: absent"
    fi
  done
else
  bad "DEV source.env not readable"
fi
for name in spff-ai-dev-python spff-ai-dev-api spff-ai-dev-web spff-api spff-edge-gateway spff-mqtt-worker spff-ai-engine; do
  section "SERVICE $name"
  systemctl show "$name.service" -p WorkingDirectory -p User -p FragmentPath --no-pager 2>/dev/null || true
  expected="active"
  [[ "$name" == "spff-ai-engine" ]] && expected="inactive"
  service_check "$name" "$expected"
done
section "LOCAL PORTS / ENDPOINTS"
ss -lnt | grep -E ':(3001|5002|5010|5011|5174)[[:space:]]' || true
http_status "Python DEV /status" http://127.0.0.1:5011/status
http_status "Node DEV /api/health" http://127.0.0.1:5002/api/health
http_status "Production API /api/health" http://127.0.0.1:3001/api/health
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432 || note "PostgreSQL may listen on UNIX socket only"
fi
if [[ -x "$STAGE/standalone-ai/.venv/bin/python" ]]; then
  ok "STAGE Python virtualenv exists"
else
  bad "STAGE Python virtualenv missing"
fi
if [[ -d "$STAGE/node_modules" ]]; then
  ok "STAGE Node dependencies exist"
else
  bad "STAGE Node dependencies missing"
fi

section "SOURCE CHECKS"
for f in standalone-ai/app/hst_workflow.py functions/src/aiPreviewLocal.ts functions/src/controllers/aiHstController.ts frontend/src/HstApprovalPanel.tsx packages/contracts/src/aiHst.ts; do
  if [[ -f "$STAGE/$f" ]]; then ok "$f"; else bad "$f missing"; fi
done

if [[ -d "$STAGE/node_modules" ]]; then
  run "NPM BUILD" bash -c 'cd "$1" && npm run build' _ "$STAGE"
  run "NPM LINT" bash -c 'cd "$1" && npm run lint' _ "$STAGE"
  run "SHARED CONTRACT TESTS" bash -c 'cd "$1" && npm run test --workspace @spff/contracts' _ "$STAGE"
fi
if [[ -x "$STAGE/standalone-ai/.venv/bin/python" ]]; then
  PY="$STAGE/standalone-ai/.venv/bin/python"
  run "PYTHON PIP CHECK" "$PY" -m pip check
  run "PYTHON HST TESTS" bash -c 'cd "$1/standalone-ai" && "$1/standalone-ai/.venv/bin/python" -m unittest discover -s tests -p test_hst_workflow.py -v' _ "$STAGE"
  run "PYTHON SOURCE TESTS" bash -c 'cd "$1/standalone-ai" && "$1/standalone-ai/.venv/bin/python" -m unittest discover -s tests -p test_live_source.py -v' _ "$STAGE"
  run "PYTHON API TESTS" bash -c 'cd "$1/standalone-ai" && "$1/standalone-ai/.venv/bin/python" -m unittest discover -s tests -p test_api.py -v' _ "$STAGE"
fi

section "AUDIT SUMMARY"
echo "PASS=$PASS FAIL=$FAIL INFO=$WARN"
echo "NO DEPLOYMENT. NO SERVICE RESTART. NO DATABASE OR MQTT WRITE."
if (( FAIL > 0 )); then
  echo "OVERALL: BLOCKED (review failures before deploying)"
  exit 1
fi
echo "OVERALL: PREFLIGHT PASSED (deployment still requires separate approval)"
exit 0
