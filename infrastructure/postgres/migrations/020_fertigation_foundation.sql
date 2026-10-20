BEGIN;

CREATE TABLE IF NOT EXISTS spff.fertigation_recipes (
  recipe_id uuid PRIMARY KEY,
  site_id text NOT NULL REFERENCES spff.sites(site_id),
  crop_name text NOT NULL,
  hst_from integer NOT NULL CHECK (hst_from >= 0),
  hst_to integer NOT NULL CHECK (hst_to >= hst_from),
  target_water_l double precision NOT NULL CHECK (target_water_l > 0 AND target_water_l <= 100000),
  target_stock_l double precision NOT NULL CHECK (target_stock_l >= 0 AND target_stock_l <= 100000),
  fertilizer_name text,
  stock_concentration_g_per_l double precision CHECK (stock_concentration_g_per_l > 0),
  min_water_tank_percent double precision NOT NULL CHECK (min_water_tank_percent BETWEEN 0 AND 100),
  min_stock_tank_percent double precision NOT NULL CHECK (min_stock_tank_percent BETWEEN 0 AND 100),
  source_reference text NOT NULL,
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','approved')),
  approval_reference text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fertilizer_stock_match CHECK (
    (target_stock_l = 0 AND fertilizer_name IS NULL AND stock_concentration_g_per_l IS NULL)
    OR (target_stock_l > 0 AND fertilizer_name IS NOT NULL AND stock_concentration_g_per_l IS NOT NULL)
  ),
  CONSTRAINT recipe_approval_complete CHECK (
    approval_status = 'draft'
    OR (approval_reference IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS fertigation_recipes_site_crop_idx
  ON spff.fertigation_recipes(site_id,crop_name,hst_from,hst_to);

-- Store device-reported final counters before they are reset. No server process may invent completion.
CREATE TABLE IF NOT EXISTS spff.fertigation_sessions (
  session_id uuid PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  recipe_id uuid REFERENCES spff.fertigation_recipes(recipe_id),
  target_water_l double precision NOT NULL CHECK (target_water_l > 0),
  target_stock_l double precision NOT NULL CHECK (target_stock_l >= 0),
  actual_water_l double precision CHECK (actual_water_l >= 0),
  actual_stock_l double precision CHECK (actual_stock_l >= 0),
  status text NOT NULL CHECK (status IN ('started','running','completed','aborted','fault')),
  pumps_off boolean NOT NULL DEFAULT false,
  completion_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  last_recorded_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_device_fk FOREIGN KEY (site_id,device_id)
    REFERENCES spff.devices(site_id,device_id),
  CONSTRAINT session_completion_proof CHECK (
    status <> 'completed' OR (pumps_off AND actual_water_l IS NOT NULL AND actual_stock_l IS NOT NULL AND finished_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS fertigation_sessions_recent_idx
  ON spff.fertigation_sessions(site_id,device_id,last_recorded_at DESC);

CREATE TABLE IF NOT EXISTS spff.fertigation_session_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES spff.fertigation_sessions(session_id),
  site_id text NOT NULL,
  device_id text NOT NULL,
  message_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  status text NOT NULL CHECK (status IN ('started','running','completed','aborted','fault')),
  recorded_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, device_id, message_id)
);
CREATE INDEX IF NOT EXISTS fertigation_session_events_order_idx
  ON spff.fertigation_session_events(session_id,recorded_at DESC);

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT ON spff.fertigation_recipes,spff.fertigation_sessions,spff.fertigation_session_events TO %I',role_name);
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['spff_worker','spff_worker_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT ON spff.fertigation_recipes,spff.fertigation_sessions,spff.fertigation_session_events TO %I',role_name);
      EXECUTE format('GRANT INSERT,UPDATE ON spff.fertigation_sessions TO %I',role_name);
      EXECUTE format('GRANT INSERT ON spff.fertigation_session_events TO %I',role_name);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE spff.fertigation_session_events_event_id_seq TO %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON spff.fertigation_recipes,spff.fertigation_sessions,spff.fertigation_session_events TO spff_backup_role;
  END IF;
END $$;
COMMIT;
