BEGIN;
-- Physical HST sessions use the existing durable adaptive command dispatcher.
-- No direct MQTT write from the HTTP API; the profile is a verified equipment
-- binding, NOT user-submitted actuator parameters on the ACC request.
CREATE TABLE spff.hst_real_profiles (
 site_id text NOT NULL REFERENCES spff.sites(site_id),
 program_id uuid NOT NULL,
 activity_id text NOT NULL,
 source_row integer NOT NULL CHECK(source_row>0),
 device_id text NOT NULL,
 product text NOT NULL CHECK(length(trim(product))>0),
 program_revision integer NOT NULL CHECK(program_revision>0),
 ec_profile_revision integer NOT NULL CHECK(ec_profile_revision>0),
 stock_concentration_g_l double precision NOT NULL CHECK(stock_concentration_g_l>0 AND stock_concentration_g_l<=1000),
 water_meter_position text NOT NULL CHECK(water_meter_position IN ('before_injector','after_injector')),
 hydraulics_reference text NOT NULL CHECK(length(trim(hydraulics_reference))>=10),
 ec_tolerance_us double precision NOT NULL CHECK(ec_tolerance_us>=20 AND ec_tolerance_us<=500),
 max_duration_sec integer NOT NULL CHECK(max_duration_sec BETWEEN 60 AND 7200),
 flush_duration_sec integer NOT NULL CHECK(flush_duration_sec BETWEEN 10 AND 600),
 verified_by text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,program_id,activity_id,source_row),
 FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
 FOREIGN KEY(site_id,program_id,program_revision) REFERENCES spff.guide_program_revisions(site_id,program_id,revision)
);
CREATE TABLE spff.hst_real_sessions(
 site_id text NOT NULL,
 obligation_id text NOT NULL CHECK(obligation_id~'^[a-f0-9]{64}$'),
 approval_id uuid NOT NULL,
 session_id uuid NOT NULL,
 source_row integer NOT NULL CHECK(source_row>0),
 product text NOT NULL,
 expected_remaining_g double precision NOT NULL CHECK(expected_remaining_g>0),
 ai_plan jsonb NOT NULL,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,approval_id),
 UNIQUE(site_id,session_id),
 FOREIGN KEY(site_id,session_id) REFERENCES spff.adaptive_fert_sessions(site_id,session_id)
);
CREATE INDEX hst_real_obligation_history ON spff.hst_real_sessions(site_id,obligation_id,created_at DESC);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.hst_real_profiles TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON spff.hst_real_sessions TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.hst_real_profiles,spff.hst_real_sessions TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
