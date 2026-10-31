BEGIN;
-- Additive, shadow-only storage. No triggers on existing control/domain tables.
CREATE TABLE spff.adaptive_ai_obligations (
  obligation_id uuid PRIMARY KEY,
  site_id text NOT NULL, device_id text NOT NULL,
  recipe_id uuid NOT NULL REFERENCES spff.fertigation_recipes(recipe_id),
  application_day date NOT NULL, recipe_revision integer NOT NULL,
  recipe_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,device_id,recipe_id,application_day),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE TABLE spff.adaptive_ai_delivery_evidence (
  source_session_id uuid PRIMARY KEY REFERENCES spff.fertigation_sessions(session_id),
  obligation_id uuid NOT NULL REFERENCES spff.adaptive_ai_obligations(obligation_id),
  actual_stock_l double precision NOT NULL
    CHECK(actual_stock_l >= 0 AND actual_stock_l < 'Infinity'::double precision),
  source_recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adaptive_ai_evidence_obligation_idx
  ON spff.adaptive_ai_delivery_evidence(obligation_id);
CREATE TABLE spff.adaptive_ai_ema (
  site_id text NOT NULL, device_id text NOT NULL,
  sensor_key text NOT NULL CHECK(sensor_key IN ('flow_water_lpm','flow_fert_lpm')),
  value_lpm double precision NOT NULL CHECK(value_lpm > 0 AND value_lpm <= 10000),
  last_recorded_at timestamptz NOT NULL,
  PRIMARY KEY(site_id,device_id,sensor_key),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE TABLE spff.adaptive_ai_decisions (
  decision_id uuid PRIMARY KEY, site_id text NOT NULL, device_id text NOT NULL,
  engine_version text NOT NULL,
  execution_mode text NOT NULL CHECK(execution_mode = 'SHADOW_MODE'),
  evaluated_at timestamptz NOT NULL, action text NOT NULL,
  result jsonb NOT NULL, input_snapshot jsonb NOT NULL,
  CHECK(result @> '{"execution_mode":"SHADOW_MODE","can_dispatch":false}'::jsonb),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE INDEX adaptive_ai_decisions_recent_idx
  ON spff.adaptive_ai_decisions(site_id,device_id,evaluated_at DESC);
-- No automatic grants: provision a dedicated least-privilege role separately.
-- Never grant this role writes on control_commands or soil_ec_pulse_commands.
COMMIT;
