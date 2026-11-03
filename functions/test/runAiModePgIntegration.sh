#!/usr/bin/env bash
# Usage: pg_virtualenv bash functions/test/runAiModePgIntegration.sh
# No production database writes, MQTT commands, firmware or deployment.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -z "${PG_CLUSTER_CONF_ROOT:-}" ||
      -z "${PGVERSION:-}" ||
      -z "${PGPORT:-}" ||
      ! -f "${PG_CLUSTER_CONF_ROOT}/${PGVERSION}/regress/.by_pg_virtualenv" ||
      "${PGPORT}" == "5432" ||
      "${PGDATABASE:-}" == "spff" ]]; then
  echo "ABORT: disposable PostgreSQL cluster not verified." >&2
  exit 1
fi

echo "=== TEMPORARY AI MODE POSTGRESQL ${PGVERSION} PORT ${PGPORT} ==="
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA spff;
CREATE TABLE spff.sites (site_id text PRIMARY KEY);
CREATE TABLE spff.devices (
  site_id text NOT NULL REFERENCES spff.sites(site_id),
  device_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (site_id,device_id)
);
INSERT INTO spff.sites(site_id) VALUES('greenhouse-01');
INSERT INTO spff.devices(site_id,device_id) VALUES('greenhouse-01','esp32-s3-01');
SQL

psql -X -v ON_ERROR_STOP=1 -q -f infrastructure/postgres/migrations/038_ai_execution_modes.sql

SPFF_ISOLATED_AI_MODE_TEST=yes \
SPFF_AI_ACC_LIVE_SWITCH_ENABLED=false \
SPFF_AI_ACC_WATER_TRIAL_ENABLED=false \
PGDATABASE=postgres \
node functions/test/aiExecutionModePg.integration.mjs
