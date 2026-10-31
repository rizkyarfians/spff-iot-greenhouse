BEGIN;
-- Shadow-only additions; no DDL/DML on existing actuator or telemetry tables.
CREATE TABLE spff.adaptive_ai_session_links (
  source_session_id uuid PRIMARY KEY REFERENCES spff.fertigation_sessions(session_id),
  obligation_id uuid NOT NULL REFERENCES spff.adaptive_ai_obligations(obligation_id),
  recipe_revision integer NOT NULL CHECK(recipe_revision > 0),
  stock_concentration_g_per_l double precision NOT NULL
    CHECK(stock_concentration_g_per_l > 0 AND stock_concentration_g_per_l < 'Infinity'::double precision),
  counter_reconciled boolean NOT NULL CHECK(counter_reconciled),
  review_reference text NOT NULL CHECK(length(trim(review_reference)) > 0),
  reviewed_by text NOT NULL CHECK(length(trim(reviewed_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Links are supplied by an independently reviewed adapter; evaluator only SELECTs.
CREATE TABLE spff.adaptive_ai_flow_state (
  site_id text NOT NULL, device_id text NOT NULL,
  sensor_key text NOT NULL CHECK(sensor_key IN ('flow_water_lpm','flow_fert_lpm')),
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
  PRIMARY KEY(site_id,device_id,sensor_key),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE TABLE spff.adaptive_ai_ema_feedback (
  site_id text NOT NULL, device_id text NOT NULL,
  sensor_key text NOT NULL CHECK(sensor_key IN ('flow_water_lpm','flow_fert_lpm')),
  message_id text NOT NULL, recorded_at timestamptz NOT NULL,
  profile_revision text NOT NULL, accepted boolean NOT NULL,
  trace jsonb NOT NULL,
  PRIMARY KEY(site_id,device_id,sensor_key,message_id),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
ALTER TABLE spff.adaptive_ai_ema
  ADD COLUMN sample_count bigint NOT NULL DEFAULT 0 CHECK(sample_count>=0),
  ADD COLUMN profile_revision text NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE spff.adaptive_ai_obligations
  ADD COLUMN calculation_status text NOT NULL DEFAULT 'REQUIRES_REVIEW'
    CHECK(calculation_status IN ('REQUIRES_REVIEW','OUTSTANDING','WAITING_FOR_WATER','COMPLETED')),
  ADD COLUMN calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE spff.adaptive_ai_decisions ADD COLUMN evaluation_key text;
CREATE UNIQUE INDEX adaptive_ai_decision_input_unique
  ON spff.adaptive_ai_decisions(site_id,device_id,evaluation_key);
COMMIT;
