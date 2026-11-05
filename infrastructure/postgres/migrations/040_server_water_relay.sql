BEGIN;
-- An AI water session owns the same relay boundary as adaptive fertigation.
-- Only the START ID pinned by its authenticated ACC may enter the normal outbox.
CREATE OR REPLACE FUNCTION spff.guard_adaptive_relay_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_session uuid;cmd_id uuid;snapshot jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('soil-ec:'||NEW.site_id||':'||NEW.device_id,0));
 SELECT session_id,command_snapshot INTO active_session,snapshot FROM spff.adaptive_fert_sessions
 WHERE site_id=NEW.site_id AND device_id=NEW.device_id AND status NOT IN ('completed','fault') LIMIT 1;
 IF active_session IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='control_commands' THEN
  IF snapshot->>'kind'='server_water_control' THEN
   IF NEW.requested_is_active AND (NEW.actuator_key<>'pump_water' OR NEW.command_id IS DISTINCT FROM snapshot->>'startCommandId') THEN
    RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';
   END IF;
   IF NOT NEW.requested_is_active AND NEW.actuator_key='pump_water' THEN
    UPDATE spff.control_commands SET status='failed',reason='server_water_stop'
     WHERE command_id=snapshot->>'startCommandId' AND status='pending';
   END IF;
   RETURN NEW;
  END IF;
  IF NEW.requested_is_active THEN RAISE EXCEPTION 'adaptive_session_owns_relays' USING ERRCODE='55000';END IF;
  UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=NEW.site_id AND session_id=active_session AND status='pending' AND payload->>'commandType'='start';
  IF NOT EXISTS(SELECT 1 FROM spff.adaptive_fert_commands WHERE site_id=NEW.site_id AND session_id=active_session AND payload->>'commandType'='stop' AND status IN ('pending','dispatching','forwarded')) THEN
   cmd_id=gen_random_uuid();
   INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)
   VALUES(NEW.site_id,cmd_id,active_session,gen_random_uuid(),jsonb_build_object('kind','adaptive_fert_command','schemaVersion',1,'siteId',NEW.site_id,'deviceId',NEW.device_id,'sessionId',active_session,'commandId',cmd_id,'commandType','stop'),now()+interval '15 seconds');
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
CREATE OR REPLACE FUNCTION spff.guard_server_water_interlock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.enabled THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('soil-ec:'||NEW.site_id||':'||NEW.device_id,0));
 IF EXISTS(SELECT 1 FROM spff.adaptive_fert_sessions WHERE site_id=NEW.site_id AND device_id=NEW.device_id
  AND command_snapshot->>'kind'='server_water_control' AND status NOT IN ('completed','fault')) THEN
  RAISE EXCEPTION 'server_water_session_owns_interlock' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_server_water_interlock ON spff.device_water_interlock_configs;
CREATE TRIGGER guard_server_water_interlock BEFORE UPDATE OF enabled ON spff.device_water_interlock_configs
 FOR EACH ROW EXECUTE FUNCTION spff.guard_server_water_interlock();
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT UPDATE (status,reason) ON spff.control_commands TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_mqtt_worker','spff_mqtt_role','spff_worker','spff_worker_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT (site_id,shadow_enabled) ON spff.hst_execution_modes TO %I',r);
   EXECUTE format('GRANT SELECT (command_id,status,actual_is_active,acknowledged_at) ON spff.command_ack_events TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
