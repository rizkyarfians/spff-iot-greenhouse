#!/usr/bin/env bash
# Dedicated local-only Mosquitto + ephemeral PostgreSQL for AI software transport.
# Never contacts the SPFF production MQTT port 1883 or persistent PostgreSQL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
for tool in pg_virtualenv psql mosquitto mosquitto_pub ss node; do
  command -v "$tool" >/dev/null || { echo "Missing test dependency: $tool" >&2; exit 1; }
done
PORT=18884
if ss -ltn | awk '{print $4}' | grep -Eq "(^|:)($PORT)$"; then
  echo "ABORT: isolated MQTT port $PORT already in use; existing process is not touched." >&2
  exit 1
fi
umask 077
tmp="$(mktemp -d)"
pid=''
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cat > "$tmp/mosquitto.conf" <<'MQTT'
# Test process is unreachable from the LAN and uses a nonproduction port.
listener 18884 127.0.0.1
allow_anonymous true
persistence false
log_dest stdout
MQTT
mosquitto -c "$tmp/mosquitto.conf" >"$tmp/mosquitto.log" 2>&1 &
pid=$!
ready=0
for _ in {1..40}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$tmp/mosquitto.log" >&2
    echo "Isolated broker exited." >&2
    exit 1
  fi
  if mosquitto_pub -h 127.0.0.1 -p "$PORT" -t 'ai-isolated-test/health' -m ok -q 1 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  cat "$tmp/mosquitto.log" >&2
  echo "Isolated broker failed to start." >&2
  exit 1
fi

export SPFF_REPO_ROOT="$ROOT"
echo "[isolated-test] Broker: 127.0.0.1:$PORT (private, temporary)"
echo "[isolated-test] Creating temporary PostgreSQL 14 cluster..."
pg_virtualenv -v 14 bash -euo pipefail -c '
  dir="$(psql -X -A -t -d postgres -c "SHOW data_directory")"
  case "$dir" in
    /tmp/*|/var/tmp/*) ;;
    *) echo "ABORT: database data_directory is not temporary: $dir" >&2; exit 1 ;;
  esac
  echo "[isolated-test] Confirmed temporary PostgreSQL cluster."
  for migration in "$SPFF_REPO_ROOT"/infrastructure/postgres/migrations/*.sql; do
    psql -X -v ON_ERROR_STOP=1 -d postgres -f "$migration" >/dev/null
  done
  export SPFF_TEST_ISOLATED_TRANSPORT=true
  export SPFF_TEST_DB_DIRECTORY="$dir"
  export DATABASE_URL="postgresql://invalid:invalid@127.0.0.1:1/never_used"
  export SPFF_TEST_LIVE_AI_SHADOW=true
  echo "[isolated-test] Running real PostgreSQL + MQTT transport test with live SHADOW AI..."
  cd "$SPFF_REPO_ROOT"
  node --test functions/test/aiVolumeTrialIsolatedTransport.test.mjs functions/test/aiVolumeApproval.test.mjs functions/test/aiAutomaticPumpReadiness.test.mjs
'
echo "[isolated-test] PASS: ephemeral broker and database will be cleaned up."
