#!/usr/bin/env bash
# SPFF P0 safe Orange Pi staging validation.
# Runs as the repository owner (typically spff) in a separate git worktree.
# Never modifies /opt/spff source, environment files, database, firmware, or systemd units.
set -Eeuo pipefail
umask 077

LIVE_DIR="${SPFF_LIVE_DIR:-/opt/spff}"
BRANCH="integration/p0-fertigation-20261022"
# Pinned to the integration code reviewed on 2026-10-22, before this script was added.
# Only this exact version is accepted for validation; newer commits require re-review.
CODE_SHA="bd07d327a6fae62b65623b018151427a72db6d38"
LOG="/var/tmp/spff-p0-preflight-$(date -u +%Y%m%dT%H%M%SZ).log"
STAGE=""

echo "[P0] Live checkout: ${LIVE_DIR}"
echo "[P0] Validation commit: ${CODE_SHA}"
echo "[P0] No service restart, DB migration, production file overwrite, or firmware flash."

if [[ ! -e "${LIVE_DIR}/.git" ]]; then
  echo "[BLOCKED] ${LIVE_DIR} is not a git checkout. No changes made." >&2
  exit 1
fi
for executable in git node npm g++; do
  if ! command -v "${executable}" >/dev/null 2>&1; then
    echo "[BLOCKED] Missing executable: ${executable}" >&2
    exit 1
  fi
done
echo "[P0] Node: $(node --version), npm: $(npm --version)"

# Fetch modifies only git objects / remote refs, NOT the live branch, worktree, or services.
git -C "${LIVE_DIR}" fetch --no-tags origin \
  "refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
REMOTE_SHA="$(git -C "${LIVE_DIR}" rev-parse "refs/remotes/origin/${BRANCH}")"
if ! git -C "${LIVE_DIR}" merge-base --is-ancestor "${CODE_SHA}" "${REMOTE_SHA}"; then
  echo "[BLOCKED] Reviewed commit ${CODE_SHA} is not contained in remote branch ${REMOTE_SHA}." >&2
  exit 1
fi

STAGE="$(mktemp -d /var/tmp/spff-p0-XXXXXXXX)"
rmdir "${STAGE}"
git -C "${LIVE_DIR}" worktree add --detach "${STAGE}" "${CODE_SHA}"

echo "[P0] Staging directory: ${STAGE}"
echo "[P0] Log: ${LOG}"
echo "[P0] Testing with dummy localhost-only DB/MQTT URLs; no production secrets are loaded."

# Never load or copy /opt/spff/**/.env. Tests which need a real PostgreSQL instance
# must be run separately in a disposable database; this stage is intentionally offline.
(
  cd "${STAGE}"
  export DATABASE_URL="postgresql://stage:stage@127.0.0.1:59998/spff_stage"
  export MQTT_URL="mqtt://127.0.0.1:59997"
  export SPFF_SOIL_EC_PULSES_ENABLED=false
  export AI_EVALUATION_ENABLED=false
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
  npm run lint
  npm test
) 2>&1 | tee "${LOG}"

echo "[P0] PASS: npm build, lint and test finished."
echo "[P0] Live Orange Pi services are UNCHANGED."
echo "[P0] Firmware full Arduino build, PostgreSQL migrations, real MQTT and ESP32 hardware still unverified."
echo "[P0] Staged checkout retained at: ${STAGE}"
echo "[P0] Log retained at: ${LOG}"
