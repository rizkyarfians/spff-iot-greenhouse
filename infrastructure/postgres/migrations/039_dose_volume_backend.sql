-- Isolated recipe plans and physical evidence, not EC profile substitutions.
BEGIN;
CREATE TABLE IF NOT EXISTS spff.dose_volume_plans (
 site_id text NOT NULL REFERENCES spff.sites(site_id),
 plan_id uuid NOT NULL, request_id uuid NOT NULL, actor text NOT NULL,
 snapshot jsonb NOT NULL, fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 created_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL,
 PRIMARY KEY(site_id,plan_id), UNIQUE(site_id,request_id)
);
CREATE TABLE IF NOT EXISTS spff.dose_volume_bindings (
 site_id text NOT NULL,session_id uuid NOT NULL,plan_id uuid NOT NULL,approval_id uuid NOT NULL,
 actor text NOT NULL,approval jsonb NOT NULL,obligation_id text,
 program_id uuid NOT NULL,program_revision integer NOT NULL,
 activity_id text NOT NULL,source_row integer,product text,
 target_mass_g double precision NOT NULL CHECK(target_mass_g>=0 AND target_mass_g<'Infinity'::float8),
 credited_g double precision NOT NULL DEFAULT 0 CHECK(credited_g>=0 AND credited_g<'Infinity'::float8),
 terminal_ack jsonb,terminal_telemetry jsonb,evidence_verified boolean NOT NULL DEFAULT false,
 evidence_basis text CHECK(evidence_basis IN ('DEVICE_TERMINAL_MEASURED','OPERATOR_RECONCILED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,session_id),UNIQUE(site_id,approval_id),UNIQUE(site_id,plan_id),
 FOREIGN KEY(site_id,plan_id) REFERENCES spff.dose_volume_plans(site_id,plan_id),
 FOREIGN KEY(site_id,session_id) REFERENCES spff.adaptive_fert_sessions(site_id,session_id),
 FOREIGN KEY(site_id,program_id,program_revision) REFERENCES spff.guide_program_revisions(site_id,program_id,revision),
 CHECK(credited_g<=target_mass_g),CHECK(credited_g=0 OR evidence_verified)
);
CREATE INDEX IF NOT EXISTS dose_volume_obligation_idx ON spff.dose_volume_bindings(site_id,obligation_id);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT ON spff.dose_volume_plans TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.dose_volume_bindings TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_mqtt_worker','spff_mqtt_role','spff_worker','spff_worker_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,UPDATE ON spff.dose_volume_bindings TO %I',r); END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT ON spff.dose_volume_plans,spff.dose_volume_bindings TO %I',r); END IF;
 END LOOP;
END $$;
COMMIT;
