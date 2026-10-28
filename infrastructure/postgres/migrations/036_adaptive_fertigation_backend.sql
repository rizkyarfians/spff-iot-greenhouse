BEGIN;
CREATE TABLE spff.adaptive_fert_sessions (
 site_id text NOT NULL,session_id uuid NOT NULL,device_id text NOT NULL,program_id uuid NOT NULL,
 program_revision integer NOT NULL,activity_id text NOT NULL,activity_fingerprint text NOT NULL,
 request_id uuid NOT NULL,input jsonb NOT NULL,command_snapshot jsonb NOT NULL,conversion_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','paused','completed','fault','reconciliation_required')),
 water_volume_l double precision NOT NULL DEFAULT 0,fert_volume_l double precision NOT NULL DEFAULT 0,
 last_telemetry_at timestamptz,last_telemetry jsonb,reason text,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,session_id),UNIQUE(site_id,request_id),
 FOREIGN KEY(site_id,device_id)REFERENCES spff.devices(site_id,device_id),
 FOREIGN KEY(site_id,program_id,program_revision)REFERENCES spff.guide_program_revisions(site_id,program_id,revision)
);
CREATE INDEX adaptive_program_history ON spff.adaptive_fert_sessions(site_id,program_id,created_at DESC);
-- Multiple uncertain historical sessions may require review; only one can be runnable.
CREATE UNIQUE INDEX adaptive_one_running_device ON spff.adaptive_fert_sessions(site_id,device_id)WHERE status IN ('queued','running','paused');
CREATE TABLE spff.adaptive_fert_commands (
 site_id text NOT NULL,command_id uuid NOT NULL,session_id uuid NOT NULL,request_id uuid NOT NULL,
 payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',expires_at timestamptz NOT NULL,
 dispatch_started_at timestamptz,ack jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,command_id),UNIQUE(site_id,request_id),FOREIGN KEY(site_id,session_id)REFERENCES spff.adaptive_fert_sessions(site_id,session_id)
);
CREATE TABLE spff.adaptive_fert_events (
 site_id text NOT NULL,device_id text NOT NULL,message_id text NOT NULL,payload jsonb NOT NULL,
 received_at timestamptz NOT NULL,stored_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(site_id,device_id,message_id),
 FOREIGN KEY(site_id,device_id)REFERENCES spff.devices(site_id,device_id)
);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role','spff_mqtt_worker','spff_mqtt_role','spff_worker','spff_worker_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.adaptive_fert_sessions,spff.adaptive_fert_commands TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON spff.adaptive_fert_events TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)THEN
   EXECUTE format('GRANT SELECT ON spff.adaptive_fert_sessions,spff.adaptive_fert_commands,spff.adaptive_fert_events TO %I',r);
  END IF;
 END LOOP;
END $$;

-- Coordinate existing API writers with adaptive ownership at the database boundary.
CREATE FUNCTION spff.guard_adaptive_relay_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_session uuid;cmd_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('soil-ec:'||NEW.site_id||':'||NEW.device_id,0));
 SELECT session_id INTO active_session FROM spff.adaptive_fert_sessions WHERE site_id=NEW.site_id AND device_id=NEW.device_id AND status NOT IN ('completed','fault') LIMIT 1;
 IF active_session IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='control_commands' THEN
  IF NEW.requested_is_active THEN RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';END IF;
  -- A dashboard OFF must stop the adaptive engine as well as the relay.
  UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=NEW.site_id AND session_id=active_session AND status='pending' AND payload->>'commandType'='start';
  IF NOT EXISTS(SELECT 1 FROM spff.adaptive_fert_commands WHERE site_id=NEW.site_id AND session_id=active_session AND payload->>'commandType'='stop' AND status IN ('pending','dispatching','forwarded')) THEN
   cmd_id=gen_random_uuid();
   INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)VALUES(NEW.site_id,cmd_id,active_session,gen_random_uuid(),jsonb_build_object('kind','adaptive_fert_command','schemaVersion',1,'siteId',NEW.site_id,'deviceId',NEW.device_id,'sessionId',active_session,'commandId',cmd_id,'commandType','stop'),now()+interval '15 seconds');
  END IF;
  UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='external_manual_stop' WHERE site_id=NEW.site_id AND session_id=active_session;
 ELSIF TG_TABLE_NAME='device_automatic_control_configs' THEN
  IF NEW.desired_mode<>'manual' OR NEW.water_enabled OR NEW.fertilizer_enabled THEN RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';END IF;
 ELSIF TG_TABLE_NAME='actuator_schedules' THEN
  IF NEW.enabled THEN RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';END IF;
 ELSE
  RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_adaptive_control BEFORE INSERT ON spff.control_commands FOR EACH ROW EXECUTE FUNCTION spff.guard_adaptive_relay_writer();
CREATE TRIGGER guard_adaptive_mode BEFORE INSERT OR UPDATE ON spff.device_automatic_control_configs FOR EACH ROW EXECUTE FUNCTION spff.guard_adaptive_relay_writer();
CREATE TRIGGER guard_adaptive_schedule BEFORE INSERT OR UPDATE ON spff.actuator_schedules FOR EACH ROW EXECUTE FUNCTION spff.guard_adaptive_relay_writer();
CREATE TRIGGER guard_adaptive_soil_session BEFORE INSERT ON spff.soil_ec_pulse_sessions FOR EACH ROW EXECUTE FUNCTION spff.guard_adaptive_relay_writer();
CREATE TABLE spff.adaptive_fert_reconciliations (
 reconciliation_id uuid PRIMARY KEY,site_id text NOT NULL,session_id uuid NOT NULL,
 observation jsonb NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,session_id)REFERENCES spff.adaptive_fert_sessions(site_id,session_id)
);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)THEN EXECUTE format('GRANT SELECT,INSERT ON spff.adaptive_fert_reconciliations TO %I',r);END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)THEN EXECUTE format('GRANT SELECT ON spff.adaptive_fert_reconciliations TO %I',r);END IF;
 END LOOP;
END $$;
CREATE INDEX adaptive_pending_commands ON spff.adaptive_fert_commands(status,expires_at);
CREATE INDEX adaptive_event_history ON spff.adaptive_fert_events(site_id,device_id,(payload->>'sessionId'),stored_at DESC);
INSERT INTO spff.alarm_rules(site_id,rule_key,source_type,source_key,comparator,severity,trigger_count,recovery_count,title,description,recommendation)
 SELECT site_id,'adaptive_fertigation_attention','actuator','pump_fert','failed','warning',1,1,'Fertigasi adaptif perlu diperiksa','Hasil sesi memerlukan rekonsiliasi.','Periksa telemetry sesi, kondisi pompa dan volume sebelum melanjutkan.' FROM spff.sites ON CONFLICT DO NOTHING;
CREATE FUNCTION spff.adaptive_session_alarm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stop_id uuid;
BEGIN
 IF NEW.status='reconciliation_required' AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=NEW.site_id AND session_id=NEW.session_id AND status='pending' AND payload->>'commandType'='start';
  IF NOT EXISTS(SELECT 1 FROM spff.adaptive_fert_commands WHERE site_id=NEW.site_id AND session_id=NEW.session_id AND payload->>'commandType'='stop')THEN
   stop_id=gen_random_uuid();
   INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)VALUES(NEW.site_id,stop_id,NEW.session_id,gen_random_uuid(),jsonb_build_object('kind','adaptive_fert_command','schemaVersion',1,'siteId',NEW.site_id,'deviceId',NEW.device_id,'sessionId',NEW.session_id,'commandId',stop_id,'commandType','stop'),now()+interval '15 seconds');
  END IF;
 END IF;
 BEGIN
 IF NEW.status='reconciliation_required' AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM spff.apply_alarm_observation(NEW.site_id,NEW.device_id,'adaptive_fertigation_attention','adaptive_fert:'||NEW.session_id,'pump_fert',true,clock_timestamp(),NULL,NULL,jsonb_build_object('source','adaptive-fertigation','sessionId',NEW.session_id,'reason',NEW.reason));
 ELSIF OLD.status='reconciliation_required' AND NEW.status IN ('completed','fault') THEN
  PERFORM spff.apply_alarm_observation(NEW.site_id,NEW.device_id,'adaptive_fertigation_attention','adaptive_fert:'||NEW.session_id,'pump_fert',false,clock_timestamp(),NULL,NULL,jsonb_build_object('source','adaptive-fertigation','sessionId',NEW.session_id,'reason',NEW.reason));
 END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'adaptive alarm update failed: %',SQLERRM;
 END;
 RETURN NEW;
END $$;
CREATE TRIGGER adaptive_session_alarm_event AFTER UPDATE OF status ON spff.adaptive_fert_sessions FOR EACH ROW EXECUTE FUNCTION spff.adaptive_session_alarm();
COMMIT;
