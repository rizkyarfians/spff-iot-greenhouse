BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $$
DECLARE
 p spff.hst_fertilization_phases%ROWTYPE;
 h spff.hst_fertilization_starts%ROWTYPE;
 hb spff.device_status_events%ROWTYPE;
 ctl spff.device_automatic_control_configs%ROWTYPE;
 w spff.control_commands%ROWTYPE;
 f spff.control_commands%ROWTYPE;
 sample spff.telemetry_samples%ROWTYPE;
 water_id text:=gen_random_uuid()::text;
 fert_id text:=gen_random_uuid()::text;
 resume_id text:=gen_random_uuid()::text;
 sync_revision bigint;
 runtime_seconds integer;
 metadata jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('soil-ec:greenhouse-01:esp32-s3-01',0));
 SELECT phase.* INTO p FROM spff.hst_fertilization_phases phase
 JOIN spff.automatic_cycle_states cycle USING(phase_id)
 WHERE cycle.site_id='greenhouse-01' AND cycle.device_id='esp32-s3-01'
   AND cycle.mode='fertilization' AND cycle.dispatch_enabled AND NOT phase.fulfilled FOR UPDATE OF phase;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOP: no unfinished active HST phase'; END IF;
 SELECT * INTO h FROM spff.hst_fertilization_starts WHERE phase_id=p.phase_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR h.status NOT IN ('started','failed') THEN RAISE EXCEPTION 'STOP: HST is already queued or has not been started'; END IF;
 SELECT * INTO hb FROM spff.device_status_events WHERE site_id=p.site_id AND device_id=p.device_id
 ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1;
 SELECT * INTO ctl FROM spff.device_automatic_control_configs WHERE site_id=p.site_id AND device_id=p.device_id FOR SHARE;
 IF hb.online IS DISTINCT FROM true OR hb.recorded_at IS NULL OR hb.recorded_at<now()-interval '90 seconds'
    OR hb.recorded_at>now()+interval '5 seconds' OR hb.mode IS DISTINCT FROM 'automatic'
    OR ctl.desired_mode IS DISTINCT FROM 'automatic' OR ctl.applied_mode IS DISTINCT FROM 'automatic'
    OR ctl.acknowledgement_status IS DISTINCT FROM 'applied' OR ctl.acknowledged_revision IS DISTINCT FROM ctl.revision
    OR NOT coalesce(hb.raw_payload @> '{"pumpReadbackValid":true,"pumpWaterActualActive":false,"pumpFertActualActive":false}'::jsonb,false)
 THEN RAISE EXCEPTION 'STOP: need fresh confirmed automatic mode and BOTH pumps OFF'; END IF;
 IF coalesce(hb.raw_payload->>'serverPulseOwner','false')<>'false'
    OR coalesce(hb.raw_payload->>'aiAccSessionActive','false')<>'false'
    OR coalesce(hb.raw_payload->>'doseVolumeSessionActive','false')<>'false'
    OR EXISTS(SELECT 1 FROM spff.adaptive_fert_sessions WHERE site_id=p.site_id AND device_id=p.device_id AND status NOT IN ('completed','fault'))
    OR EXISTS(SELECT 1 FROM spff.fuzzy_water_runs WHERE site_id=p.site_id AND device_id=p.device_id AND status<>'completed')
    OR EXISTS(SELECT 1 FROM spff.actuator_schedules WHERE site_id=p.site_id AND device_id=p.device_id AND enabled AND actuator_key IN ('pump_water','pump_fert'))
    OR EXISTS(SELECT 1 FROM spff.control_commands WHERE site_id=p.site_id AND device_id=p.device_id AND status IN ('pending','published','accepted') AND expires_at>now())
 THEN RAISE EXCEPTION 'STOP: another schedule, command or session still owns the device'; END IF;
 IF (SELECT count(*) FROM spff.actuators WHERE site_id=p.site_id AND device_id=p.device_id AND enabled AND actuator_key IN ('pump_water','pump_fert'))<>2
 THEN RAISE EXCEPTION 'STOP: both pump actuators must be enabled'; END IF;
 SELECT * INTO w FROM spff.control_commands WHERE command_id=h.water_command_id;
 SELECT * INTO f FROM spff.control_commands WHERE command_id=h.fertilizer_command_id;
 IF hb.recorded_at<greatest(w.expires_at,f.expires_at)
 THEN RAISE EXCEPTION 'STOP: wait until the previous ONs expire and a newer OFF heartbeat arrives'; END IF;
 UPDATE spff.device_schedule_sync_state SET revision=revision+1,updated_at=now()
 WHERE site_id=p.site_id AND device_id=p.device_id RETURNING revision INTO sync_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOP: missing native schedule synchronization state'; END IF;
 runtime_seconds:=least(coalesce(ctl.water_max_runtime_seconds,900),900);
 metadata:=jsonb_build_object('source','hst-fertilization','startId',h.start_id,'phaseId',p.phase_id,
  'programId',p.program_id,'activityId',p.activity_id,'hst',p.hst,'nativeHstSchedule',true,
  'scheduleRevision',sync_revision::text,'hstRuntimeLimitSeconds',runtime_seconds,
  'operatorResumeId',resume_id,'sameBatch',true,'requestedBy','operator-hst-resume',
  'previousWaterCommandId',h.water_command_id,'previousFertilizerCommandId',h.fertilizer_command_id,
  'previousStartedAt',p.started_at,'previousAttemptCreatedAt',h.created_at);
 INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,requested_by,issued_at,expires_at,request_payload)
 VALUES(water_id,p.site_id,p.device_id,'pump_water',true,'hst-fertilization',now(),now()+interval '90 seconds',metadata),
       (fert_id,p.site_id,p.device_id,'pump_fert',true,'hst-fertilization',now(),now()+interval '90 seconds',metadata);
 UPDATE spff.hst_fertilization_starts SET water_command_id=water_id,fertilizer_command_id=fert_id,
  status='queued',created_at=now(),started_at=NULL,application_day=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE start_id=h.start_id;
 SELECT * INTO sample FROM spff.telemetry_samples WHERE site_id=p.site_id AND device_id=p.device_id
 ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1;
 UPDATE spff.hst_fertilization_phases SET started_at=now(),updated_at=now(),
  baseline=coalesce(p.baseline,'{}'::jsonb)||jsonb_build_object(
   'originalStartedAt',coalesce(p.baseline->'originalStartedAt',to_jsonb(p.started_at)),
   'originalBootId',coalesce(p.baseline->'originalBootId',p.baseline->'bootId'),
   'recordedAt',sample.recorded_at,'flowFertTotalL',sample.flow_fert_total_l,'flowWaterTotalL',sample.flow_water_total_l,
   'bootId',hb.raw_payload->>'pulseBootId','resumeId',resume_id)
 WHERE phase_id=p.phase_id;
 -- Keep the cumulative grams, cursor, K, baseline and audit intervals; break the stopped interval's anchor.
 UPDATE spff.ec_dose_estimates SET anchor=NULL,reason='awaiting_resume_samples',updated_at=now() WHERE phase_id=p.phase_id;
 RAISE NOTICE 'HST resume queued: %, duration limit % seconds; previous grams preserved',resume_id,runtime_seconds;
END $$;
COMMIT;
SELECT h.status,p.product,p.delivered_g AS gram_tercatat,p.target_g AS target_gram
FROM spff.hst_fertilization_starts h JOIN spff.hst_fertilization_phases p USING(phase_id)
WHERE h.site_id='greenhouse-01' AND h.device_id='esp32-s3-01' ORDER BY h.created_at DESC LIMIT 1;
