#!/usr/bin/env bash
# Update AI calculation/profile plumbing only. No actuator or dispatch settings.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Use sudo'; exit 1; }
SRC="${1:?Expected staging checkout path}"
SERVICE="${2:-spff-ai-engine.service}"
ROOT=/opt/spff-ai
STORE=/mnt/spff-data/backups
[[ "$SERVICE" =~ ^spff-ai(-engine)?\.service$ ]] || { echo 'Unexpected AI service name'; exit 1; }
systemctl is-active --quiet "$SERVICE" || { echo "AI service inactive: $SERVICE"; exit 1; }
curl -fsS --max-time 5 http://127.0.0.1:5010/health >/dev/null
exec 9>/run/lock/spff-ai-production-profile.lock
flock -n 9 || { echo 'AI profile patch lock occupied'; exit 1; }
umask 077
mkdir -p "$STORE"
RUN="$(mktemp -d "$STORE/ai-production-profile-XXXXXXXX")"
APPLIED=0
SUCCESS=0
finish(){
 code=$?
 trap - EXIT
 if [[ "$APPLIED" == 1 && "$SUCCESS" != 1 ]]; then
  python3 "$SRC/scripts/install-ai-profile-patch.py" rollback "$SRC" "$ROOT" "$RUN"
  systemctl restart "$SERVICE"
 fi
 echo "AI_PROFILE_PATCH_EXIT=$code; BACKUP=$RUN"
 exit "$code"
}
trap finish EXIT
python3 "$SRC/scripts/install-ai-profile-patch.py" stage "$SRC" "$ROOT" "$RUN"
# stage never loads or mutates production AI state.
APPLIED=1
python3 "$SRC/scripts/install-ai-profile-patch.py" apply "$SRC" "$ROOT" "$RUN"
systemctl restart "$SERVICE"
for attempt in {1..10}; do
 if curl -fsS --max-time 3 http://127.0.0.1:5010/health >/dev/null; then break; fi
 sleep 1
done
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 20 http://127.0.0.1:5010/dashboard/summary > "$RUN/summary.json"
python3 - "$RUN/summary.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
profile=data["operational_profile"]
assert profile["can_dispatch"] is False and data["can_dispatch"] is False
print("OPERATIONAL_PROFILE="+profile["status"])
print("PROFILE_BLOCKERS="+",".join(profile["blockers"]))
PY
SUCCESS=1
echo "PYTHON_PROFILE_PATCH=SUCCESS; DATABASE=UNCHANGED; DISPATCH_FLAGS=UNCHANGED"

