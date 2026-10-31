-- Apply with a migrator to a reviewed PostgreSQL database. Never run at API startup.
BEGIN;
CREATE SCHEMA IF NOT EXISTS spff_ai;
CREATE TABLE IF NOT EXISTS spff_ai.engine_state (
    scope text PRIMARY KEY,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spff_ai.audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS ai_audit_scope_time ON spff_ai.audit_events(scope, recorded_at DESC);
COMMIT;
-- Give a separate AI role SELECT on the six audited spff source tables and
-- USAGE on spff. On spff_ai give USAGE, SELECT/INSERT/UPDATE on engine_state,
-- SELECT/INSERT on audit_events, USAGE/SELECT on audit_events_id_seq.
-- Do not grant the AI role INSERT/UPDATE on spff.control_commands or actuator tables.
