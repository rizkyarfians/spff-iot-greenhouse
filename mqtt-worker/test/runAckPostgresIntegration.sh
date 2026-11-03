#!/usr/bin/env bash
# Run ONLY with: pg_virtualenv bash mqtt-worker/test/runAckPostgresIntegration.sh
# Creates an isolated minimal fixture; never connects to SPFF operational DB.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -z "${PG_CLUSTER_CONF_ROOT:-}" ||
      -z "${PGVERSION:-}" ||
      -z "${PGPORT:-}" ||
      ! -f "${PG_CLUSTER_CONF_ROOT}/${PGVERSION}/regress/.by_pg_virtualenv" ||
      "${PGPORT}" == "5432" ]]; then
  echo "ABORT: disposable PostgreSQL cluster marker/port not verified." >&2
  exit 1
fi
if [[ -n "${PGDATABASE:-}" && "${PGDATABASE}" == "spff" ]]; then
  echo "ABORT: refusing to use live SPFF database." >&2
  exit 1
fi

echo "=== ISOLATED POSTGRESQL ${PGVERSION} PORT ${PGPORT} ==="
echo "This creates minimal SPFF test tables in disposable cluster only."

psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA spff;

CREATE TABLE spff.control_commands (
  command_id text PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  actuator_key text NOT NULL,
  status text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  reason text,
  request_payload jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE spff.command_ack_events (
  ack_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL,
  status text NOT NULL,
  actual_is_active boolean,
  reason text,
  acknowledged_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL,
  UNIQUE (command_id, status, acknowledged_at)
);

CREATE TABLE spff.actuator_state_events (
  site_id text,
  device_id text,
  actuator_key text,
  command_id text,
  source text,
  state text,
  is_active boolean,
  reason text,
  recorded_at timestamptz,
  raw_payload jsonb
);

INSERT INTO spff.control_commands
  (command_id, site_id, device_id, actuator_key, status, issued_at, expires_at)
VALUES
  ('ack-isolated-001', 'greenhouse-01', 'esp32-s3-01', 'pump_water',
   'published', now() - interval '40 seconds', now() - interval '10 seconds');
SQL

# The repository config module requires DATABASE_URL for import; this dummy
# target is NEVER used because we supply an explicit pg.Pool to the repository.
SPFF_ISOLATED_PG_ACK_TEST=yes \
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused \
node mqtt-worker/test/ackPostgresIntegration.mjs
