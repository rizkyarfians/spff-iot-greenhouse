#!/usr/bin/env bash
# Production-only SPFF HST verification and backup.
# Never restarts services, edits runtime code or issues MQTT commands.
set -Eeuo pipefail
umask 077

STAGE="$1"
PROD=/opt/spff
AI=/opt/spff-ai
AI_ENV=/etc/spff-ai/engine.env
NODE_ENV=/opt/spff/functions/.env
NVME=/mnt/spff-data

[[ "$EUID" -eq 0 ]] || { echo "Must run via sudo systemd-run"; exit 2; }
[[ -d "$STAGE/.git" && -f "$STAGE/standalone-ai/app/hst_workflow.py" ]] || { echo "Staging source missing"; exit 2; }
[[ -d "$PROD/functions" && -d "$AI/app" && -f "$AI_ENV" && -f "$NODE_ENV" ]] || { echo "Production installation missing"; exit 2; }
[[ "$(findmnt -rn -o SOURCE -T "$NVME" || true)" == /dev/nvme* ]] || { echo "STOP: NVMe backup volume not mounted"; exit 2; }

BACKUP="$NVME/backups/hst-prod-preflight-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -p "$BACKUP"
echo "$BACKUP" > "$NVME/backups/hst-prod-preflight-latest.txt"
exec > >(tee -a "$BACKUP/preflight.log") 2>&1
trap 'rc=$?; echo "$rc" > "$BACKUP/preflight.exit"; echo "FINAL EXIT CODE: $rc"; echo "BACKUP=$BACKUP"' EXIT

echo "=== MACHINE AND GIT ==="
date -Is
uname -m
free -h
df -h "$NVME"
node --version
npm --version
python3 --version
echo "STAGE_HEAD=$(git -C "$STAGE" rev-parse HEAD)"
[[ -z "$(git -C "$STAGE" status --porcelain --untracked-files=no)" ]] || { echo "STOP: STAGE source modified"; exit 1; }
if [[ -d "$PROD/.git" ]]; then
  PHEAD="$(git -C "$PROD" rev-parse HEAD)"
  echo "PROD_HEAD=$PHEAD"
  echo "PROD_TRACKED_CHANGES=$(git -C "$PROD" status --porcelain --untracked-files=no | wc -l)"
  if git -C "$STAGE" cat-file -e "$PHEAD^{commit}" 2>/dev/null; then
    if git -C "$STAGE" merge-base --is-ancestor "$PHEAD" HEAD; then
      echo "PROD_ANCESTOR_OF_HST=true"
    else
      echo "PROD_ANCESTOR_OF_HST=false"
    fi
  else
    echo "PROD_COMMIT_NOT_IN_STAGING=true"
  fi
else
  echo "PROD_NOT_A_GIT_CHECKOUT=true"
fi

echo "=== PRODUCTION SERVICE CONFIG ==="
for unit in spff-api spff-ai-engine spff-edge-gateway spff-mqtt-worker; do
  echo "-- $unit --"
  systemctl show "$unit.service" -p ActiveState -p User -p WorkingDirectory -p EnvironmentFiles -p FragmentPath --no-pager
done
[[ "$(systemctl show -P WorkingDirectory spff-api.service)" == "$PROD/functions" ]] || { echo "STOP: unexpected production Node working directory"; exit 1; }
[[ "$(systemctl show -P WorkingDirectory spff-ai-engine.service)" == "$AI" ]] || { echo "STOP: unexpected production AI working directory"; exit 1; }
[[ "$(systemctl show -P User spff-api.service)" == spff && "$(systemctl show -P User spff-ai-engine.service)" == spff ]] || { echo "STOP: unexpected production users"; exit 1; }
[[ "$(systemctl is-active spff-api.service || true)" == active ]] || { echo "STOP: production API unavailable"; exit 1; }
[[ "$(systemctl is-active spff-ai-engine.service || true)" == inactive ]] || { echo "STOP: production AI already active; different rollout needed"; exit 1; }

echo "=== PORTS AND API ==="
ss -lnt | grep -E ':(3001|5010|5011|5002)[[:space:]]' || true
curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null
[[ -z "$(ss -ltnH '( sport = :5010 )')" ]] || { echo "STOP: production AI port 5010 busy"; exit 1; }

echo "=== PRODUCTION CODE PATHS ==="
for dir in "$PROD/functions/lib" "$PROD/frontend/dist" "$PROD/packages/contracts/dist" "$AI/app" "$AI/config"; do
  [[ -d "$dir" && ! -L "$dir" ]] || { echo "STOP: missing/symlinked $dir"; exit 1; }
  echo "PRESENT: $dir"
done
for dir in "$PROD/node_modules/@spff/contracts" "$PROD/functions/node_modules/@spff/contracts"; do
  if [[ -e "$dir" ]]; then echo "CONTRACTS_LINK=$(readlink -f "$dir")"; fi
done
echo "=== SAFE RUNTIME FLAGS (NO DSNS OR SECRETS) ==="
for f in "$AI_ENV" "$NODE_ENV"; do
  echo "FILE: $f"
  grep -E '^(AI_MODE|AI_PORT|AI_HOST|AI_POLL_ENABLED|AI_LOCAL_PORT|SPFF_WATER_TRIAL_DISPATCH_ENABLED)=' "$f" || true
  for key in AI_SOURCE_DSN AI_STATE_DSN AI_HST_BRIDGE_KEY; do
    if grep -q "^$key=" "$f"; then echo "$key: defined (hidden)"; else echo "$key: absent"; fi
  done
done

echo "=== BACKUP PRODUCTION CONFIG AND CODE ==="
cp -a /etc/systemd/system/spff-api.service "$BACKUP/spff-api.service"
cp -a /etc/systemd/system/spff-ai-engine.service "$BACKUP/spff-ai-engine.service"
cp -a "$AI_ENV" "$BACKUP/engine.env"
cp -a "$NODE_ENV" "$BACKUP/functions.env"
for unit in spff-api.service spff-ai-engine.service; do
  if [[ -d "/etc/systemd/system/$unit.d" ]]; then cp -a "/etc/systemd/system/$unit.d" "$BACKUP/$unit.d"; fi
done
tar -C / -czf "$BACKUP/production-code.tgz" \
  opt/spff/functions/lib opt/spff/frontend/dist \
  opt/spff/packages/contracts/dist opt/spff-ai/app opt/spff-ai/config
echo "BACKUP_ARCHIVE_SHA256=$(sha256sum "$BACKUP/production-code.tgz" | cut -d' ' -f1)"

echo "=== TEST LATEST SOURCE BEFORE PRODUCTION INSTALL ==="
(cd "$STAGE" && npm run build && npm run lint && npm run test --workspace @spff/contracts)
(cd "$STAGE" && node --test functions/test/localAiEndpoint.test.mjs)
PY="$STAGE/standalone-ai/.venv/bin/python"
[[ -x "$PY" ]] || { echo "STOP: STAGE Python venv missing"; exit 1; }
"$PY" -m pip check
(cd "$STAGE/standalone-ai" && "$PY" -m unittest discover -s tests -p 'test_hst_workflow.py' -v)
(cd "$STAGE/standalone-ai" && "$PY" -m unittest discover -s tests -p 'test_live_source.py' -v)
(cd "$STAGE/standalone-ai" && "$PY" -m unittest discover -s tests -p 'test_api.py' -v)

echo "=== READ-ONLY PRODUCTION DATABASE/GAUGE CHECK ==="
PYTHONPATH="$STAGE/standalone-ai" AI_ENV_FILE="$AI_ENV" AI_STATE_BACKUP="$BACKUP/engine_state.json.gz" "$PY" - <<'PY'
import gzip
import json
import os
from pathlib import Path
import psycopg
from app.settings import Settings
from app.source import SPFFSource

for line in Path(os.environ["AI_ENV_FILE"]).read_text(encoding="utf-8-sig").splitlines():
    value = line.strip()
    if not value or value.startswith("#"):
        continue
    key, sep, raw = value.partition("=")
    if sep:
        os.environ[key.strip()] = raw.strip().strip("\"'")
settings = Settings.load()
assert settings.mode == "SHADOW_MODE", "Production mode must stay SHADOW"
assert settings.port == 5010 and settings.host == "127.0.0.1", "Invalid production loopback port"
assert settings.source_dsn and settings.state_dsn, "Missing PostgreSQL DSNs"
source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id,
                    settings.zone_id, fertilizer_delivery_route=settings.fertilizer_delivery_route)
try:
    guides = source.inspect_guides()
    print("SOURCE_GUIDE_READ_OK=" + type(guides).__name__)
except Exception as exc:
    print("SOURCE_GUIDE_READ_FAILED=" + type(exc).__name__)
    raise SystemExit(1)
try:
    with psycopg.connect(settings.state_dsn, connect_timeout=5) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        assert conn.execute("SELECT to_regclass('spff_ai.engine_state')").fetchone()[0] is not None
        assert conn.execute("SELECT to_regclass('spff_ai.audit_events')").fetchone()[0] is not None
        rows = conn.execute("SELECT scope, payload FROM spff_ai.engine_state").fetchall()
    with gzip.open(os.environ["AI_STATE_BACKUP"], "wt", encoding="utf-8") as stream:
        json.dump([{"scope": scope, "payload": payload} for scope, payload in rows],
                  stream, ensure_ascii=False, separators=(",", ":"))
    print("AI_ENGINE_STATE_BACKUP_ROWS=" + str(len(rows)))
except Exception as exc:
    print("AI_STATE_BACKUP_FAILED=" + type(exc).__name__)
    raise SystemExit(1)
PY

echo "=== RESULT ==="
echo "PRODUCTION PREFLIGHT PASSED — NO DEPLOYMENT OR SERVICE RESTART"
echo "Production-only rollout can use this saved configuration and backup."
