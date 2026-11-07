import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { fertilizationPhases, guideProgramHst, type GuideProgramConfig, type GuideProgramPlan } from '@spff/contracts';
import { fertilizerProgress, type FertilizerDeliveryInput } from './fertilizerDelivery.js';
import { recordEcFertilizerDelivery } from './ecDoseEstimator.js';
import { tickFuzzyWater, type FuzzyWaterDecision } from './automaticFuzzyWater.js';
import {retryableModeRejection} from './nativeHstSchedule.js';
import {hstRuntimeSeconds} from './hstRuntimeLimit.js';

export async function enqueueAutomaticPump(client: PoolClient, site: string, device: string,
  actuator: string, on: boolean, source: string, metadata: Record<string, unknown>, expirySeconds=30) {
  const id = randomUUID();
  await client.query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,
    requested_is_active,requested_by,issued_at,expires_at,request_payload)
    VALUES($1,$2,$3,$4,$5,$6,now(),now()+make_interval(secs=>$8),$7)`,
  [id,site,device,actuator,on,source,JSON.stringify({source,...metadata}),expirySeconds]);
  return id;
}

export const recentSample = (date: unknown, now: Date, age = 120000): boolean =>
  date instanceof Date && now.getTime() - date.getTime() >= -5000 && now.getTime() - date.getTime() <= age;

export async function tickAutomaticCycles(client: PoolClient, enabled: boolean, now = new Date(),
  decision: FuzzyWaterDecision | null = null,
  formula?: (input: FertilizerDeliveryInput) => number | null) {
  if (!(await client.query("SELECT to_regclass('spff.automatic_cycle_states') IS NOT NULL AS ready")).rows[0]?.ready) return;
  // One current saved program owns a device. Historical saved copies cannot each start it.
  const programs = (await client.query(`SELECT DISTINCT ON (p.site_id,p.config->>'deviceId') p.*
    FROM spff.guide_programs p JOIN spff.devices d ON d.site_id=p.site_id AND d.device_id=p.config->>'deviceId'
    WHERE d.enabled ORDER BY p.site_id,p.config->>'deviceId',
      EXISTS(SELECT 1 FROM spff.hst_fertilization_phases phase JOIN spff.hst_fertilization_starts start USING(phase_id)
        WHERE phase.site_id=p.site_id AND phase.program_id=p.program_id AND NOT phase.fulfilled) DESC,
      p.updated_at DESC,p.created_at DESC,p.program_id`)).rows;
  for (const program of programs) {
    const cfg = program.config as GuideProgramConfig, site = program.site_id, device = cfg.deviceId!;
    if (!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
      [`soil-ec:${site}:${device}`])).rows[0]?.acquired) continue;
    const heartbeat = (await client.query(`SELECT * FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
      ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[site,device])).rows[0];
    const sample = (await client.query(`SELECT * FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2
      ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1`,[site,device])).rows[0];
    const control = (await client.query(`SELECT * FROM spff.device_automatic_control_configs WHERE site_id=$1 AND device_id=$2`,[site,device])).rows[0];
    const automatic = heartbeat?.online === true && recentSample(heartbeat.recorded_at,now,90000) &&
      heartbeat.mode === 'automatic' && control?.desired_mode === 'automatic' && control.applied_mode === 'automatic' &&
      control.acknowledgement_status === 'applied' && control.revision === control.acknowledged_revision;
    const raw = heartbeat?.raw_payload;
    const off = automatic && raw?.pumpReadbackValid === true && raw.pumpWaterActualActive === false && raw.pumpFertActualActive === false;
    const hst = guideProgramHst(cfg.plantingDate,now);
    const definitions = fertilizationPhases(program.plan as GuideProgramPlan);
    const due=definitions.filter(p => p.hst<=hst);
    const tracked=new Set((await client.query(`SELECT activity_id FROM spff.hst_fertilization_phases
      WHERE site_id=$1 AND program_id=$2 AND NOT fulfilled`,[site,program.program_id])).rows.map(r=>r.activity_id));
    // On first installation enter the current phase, without replaying every historical HST.
    // A previously tracked unfinished phase stays in charge across the next HST boundary.
    const candidates=due.filter(p=>p.hst===due.at(-1)?.hst||tracked.has(p.activityId));
    let phase: Record<string, any> | null = null;
    let last: Record<string, any> | null = null;
    for (const definition of candidates) {
      await client.query(`INSERT INTO spff.hst_fertilization_phases(phase_id,site_id,device_id,program_id,activity_id,
        phase_number,title,hst,product,method,target_g) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(site_id,program_id,activity_id) DO NOTHING`,
      [randomUUID(),site,device,program.program_id,definition.activityId,definition.phaseNumber,definition.title,
        definition.hst,definition.product,definition.method,definition.targetG]);
      const row = (await client.query(`SELECT * FROM spff.hst_fertilization_phases
        WHERE site_id=$1 AND program_id=$2 AND activity_id=$3 FOR UPDATE`,[site,program.program_id,definition.activityId])).rows[0];
      if(row.fulfilled) { last=row;continue; }
      // Restoring accounting history must not require enabling pump dispatch.
      if(!row.started_at) {
        const history=(await client.query(`UPDATE spff.hst_fertilization_starts SET phase_id=$1
          WHERE start_id=(SELECT start_id FROM spff.hst_fertilization_starts
            WHERE site_id=$2 AND device_id=$3 AND program_id=$4 AND activity_id=$5
              AND lower(trim(product))=lower(trim($6)) AND hst=$7
              AND (phase_id IS NULL OR phase_id=$1) ORDER BY created_at LIMIT 1)
          RETURNING created_at`,[row.phase_id,site,device,row.program_id,row.activity_id,row.product,row.hst])).rows[0];
        if(history) {
          await client.query('UPDATE spff.hst_fertilization_phases SET started_at=$2 WHERE phase_id=$1',[row.phase_id,history.created_at]);
          row.started_at=history.created_at;
        }
      }
      let measured: number | null = null;
      let completionAllowed=false;
      try { if(row.started_at && !formula) {
        const estimate=await recordEcFertilizerDelivery(client,row,now);measured=estimate.grams;completionAllowed=estimate.completionAllowed;
      } else { completionAllowed=!!formula;measured = row.started_at && formula ? formula({phaseId:row.phase_id,programId:program.program_id,
        activityId:row.activity_id,hst:row.hst,product:row.product,targetG:row.target_g,startedAt:row.started_at,
        previousDeliveredG:row.delivered_g,baseline:row.baseline,telemetry:sample ?? null,deviceStatus:heartbeat ?? null}) : null; }
      } catch(error) { console.error('[fertilizer-formula]',row.phase_id,error); }
      if (measured !== null && Number.isFinite(measured) && measured >= 0 &&
        (row.delivered_g === null || measured >= row.delivered_g)) {
        const progress = fertilizerProgress(row.target_g,measured);
        progress.fulfilled=progress.fulfilled&&completionAllowed;
        await client.query(`UPDATE spff.hst_fertilization_phases SET delivered_g=$2,formula_status='ready',fulfilled=$3,
          fulfilled_at=CASE WHEN $3 THEN coalesce(fulfilled_at,now()) ELSE NULL END,updated_at=now() WHERE phase_id=$1`,
        [row.phase_id,measured,progress.fulfilled]);
        row.delivered_g=measured;row.fulfilled=progress.fulfilled;row.formula_status='ready';
        if (progress.fulfilled) await client.query(`UPDATE spff.control_commands SET status='failed',reason='fertilizer_phase_fulfilled'
          WHERE site_id=$1 AND device_id=$2 AND requested_is_active AND status='pending'
          AND request_payload->>'phaseId'=$3`,[site,device,row.phase_id]);
      }
      last=row;
      if (!row.fulfilled) { phase=row; break; }
    }
    // A previous program still holding these relays must settle before a new program can own them.
    const unresolved = (await client.query(`SELECT p.* FROM spff.hst_fertilization_phases p
      JOIN spff.hst_fertilization_starts h ON h.phase_id=p.phase_id
      WHERE p.site_id=$1 AND p.device_id=$2 AND p.program_id<>$3 AND NOT p.fulfilled LIMIT 1`,[site,device,program.program_id])).rows[0];
    if (unresolved) phase=unresolved;
    if (!phase && !last) last=(await client.query(`SELECT p.* FROM spff.hst_fertilization_phases p
      JOIN spff.hst_fertilization_starts h USING(phase_id) WHERE p.site_id=$1 AND p.device_id=$2
      ORDER BY h.created_at DESC LIMIT 1`,[site,device])).rows[0]??null;
    const priorStart = !phase ? (await client.query(`SELECT h.*,w.expires_at AS water_expires,f.expires_at AS fert_expires
      FROM spff.hst_fertilization_starts h JOIN spff.control_commands w ON w.command_id=h.water_command_id
      JOIN spff.control_commands f ON f.command_id=h.fertilizer_command_id WHERE h.site_id=$1 AND h.device_id=$2
      ORDER BY h.created_at DESC LIMIT 1`,[site,device])).rows[0] : null;
    const waitingOff = !phase && !!priorStart && (!off || heartbeat.recorded_at < priorStart.water_expires || heartbeat.recorded_at < priorStart.fert_expires);
    const mode = phase ? 'fertilization' : waitingOff ? 'waiting_off' : 'watering';
    const reason = phase ? phase.formula_status === 'pending' && phase.started_at ? 'fertilizer_formula_pending' : 'fertilizer_remaining'
      : waitingOff ? 'fertilizer_fulfilled_waiting_pumps_off' : 'outside_fertilization_phase';
    await client.query(`INSERT INTO spff.automatic_cycle_states(site_id,device_id,phase_id,mode,reason,next_hst,dispatch_enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(site_id,device_id) DO UPDATE SET phase_id=EXCLUDED.phase_id,
      mode=EXCLUDED.mode,reason=EXCLUDED.reason,next_hst=EXCLUDED.next_hst,dispatch_enabled=EXCLUDED.dispatch_enabled,updated_at=now()`,
    [site,device,(phase??last)?.phase_id??null,mode,reason,definitions.find(p => p.hst>hst)?.hst??null,enabled]);
    // This call stops an existing Fuzzy run before a fertilizer ON can be enqueued.
    await tickFuzzyWater(client,{site,device,enabled:enabled&&automatic,mode,heartbeat,sample,decision,now});
    if (!phase || !enabled || !automatic || !off || raw?.serverPulseOwner===true ||
      raw?.aiAccSessionActive===true || raw?.doseVolumeSessionActive===true) continue;
    if ((await client.query(`SELECT 1 FROM spff.fuzzy_water_runs WHERE site_id=$1 AND device_id=$2 AND status<>'completed'`,[site,device])).rows.length) continue;
    const previous=(await client.query(`SELECT h.*,w.status AS water_status,f.status AS fert_status,
      w.reason AS water_reason,f.reason AS fert_reason,w.expires_at AS water_expires,f.expires_at AS fert_expires,
      coalesce((w.request_payload->>'modeRejectionRetry')::boolean,false) AS retried,
      coalesce((w.request_payload->>'nativeAuthorityRetry')::boolean,false) AS authority_retried,
      w.request_payload->>'nativeHstSchedule'='true' AS native_schedule,
      w.published_at AS water_published,f.published_at AS fert_published,sync.published_authority AS sync_authority,
      EXISTS(SELECT 1 FROM spff.command_ack_events a WHERE a.command_id IN (h.water_command_id,h.fertilizer_command_id)
        AND a.actual_is_active) AS had_on
      FROM spff.hst_fertilization_starts h JOIN spff.control_commands w ON w.command_id=h.water_command_id
      JOIN spff.control_commands f ON f.command_id=h.fertilizer_command_id
      LEFT JOIN spff.device_schedule_sync_state sync ON sync.site_id=h.site_id AND sync.device_id=h.device_id
      WHERE h.phase_id=$1 FOR UPDATE OF h`,[phase.phase_id])).rows[0]??null;
    if(previous && (!retryableModeRejection(previous,heartbeat.recorded_at) || previous.had_on ||
      Number(phase.delivered_g??0)>0)) continue;
    if ((await client.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
      AND status IN ('pending','published','accepted') AND expires_at>now()
      UNION ALL SELECT 1 FROM spff.actuator_schedules WHERE site_id=$1 AND device_id=$2
      AND enabled AND actuator_key IN ('pump_water','pump_fert')`,[site,device])).rows.length) continue;
    if ((await client.query(`SELECT 1 FROM spff.actuators WHERE site_id=$1 AND device_id=$2 AND enabled
      AND actuator_key IN ('pump_water','pump_fert')`,[site,device])).rows.length!==2) continue;
    await client.query('SAVEPOINT phase_start');
    try {
      const sync=(await client.query(`UPDATE spff.device_schedule_sync_state SET revision=revision+1,updated_at=now()
        WHERE site_id=$1 AND device_id=$2 RETURNING revision`,[site,device])).rows[0];
      if(!sync) throw Error('Schedule sync state missing for HST device');
      const startId=previous?.start_id??randomUUID(),metadata={startId,phaseId:phase.phase_id,programId:phase.program_id,
        activityId:phase.activity_id,hst:phase.hst,nativeHstSchedule:true,scheduleRevision:String(sync.revision),
        hstRuntimeLimitSeconds:hstRuntimeSeconds(control?.water_max_runtime_seconds),
        ...(previous?{modeRejectionRetry:previous.retried||previous.water_reason==='automatic_mode',
          nativeAuthorityRetry:previous.authority_retried||previous.water_status==='timed_out',
          previousWaterCommandId:previous.water_command_id,
          previousFertilizerCommandId:previous.fertilizer_command_id}:{} )};
      // Allow time for native schedule synchronization before the dispatcher sends ON.
      const water=await enqueueAutomaticPump(client,site,device,'pump_water',true,'hst-fertilization',metadata,90);
      const fertilizer=await enqueueAutomaticPump(client,site,device,'pump_fert',true,'hst-fertilization',metadata,90);
      if(previous) await client.query(`UPDATE spff.hst_fertilization_starts SET water_command_id=$2,fertilizer_command_id=$3,
        status='queued',started_at=NULL,created_at=now(),application_day=(now() AT TIME ZONE 'Asia/Jakarta')::date
        WHERE start_id=$1`,[startId,water,fertilizer]);
      else await client.query(`INSERT INTO spff.hst_fertilization_starts(start_id,site_id,device_id,program_id,activity_id,hst,
        application_day,product,method,water_command_id,fertilizer_command_id,phase_id)
        VALUES($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Jakarta')::date,$7,$8,$9,$10,$11)`,
      [startId,site,device,phase.program_id,phase.activity_id,phase.hst,phase.product,phase.method,water,fertilizer,phase.phase_id]);
      await client.query(`UPDATE spff.hst_fertilization_phases SET started_at=now(),baseline=$2,updated_at=now() WHERE phase_id=$1`,
      [phase.phase_id,sample?JSON.stringify({recordedAt:sample.recorded_at,flowFertTotalL:sample.flow_fert_total_l,
        flowWaterTotalL:sample.flow_water_total_l,bootId:raw?.pulseBootId}):null]);
      await client.query('RELEASE SAVEPOINT phase_start');
    } catch(error) {
      await client.query('ROLLBACK TO SAVEPOINT phase_start');await client.query('RELEASE SAVEPOINT phase_start');
      if (!(error instanceof Error && 'code' in error && ['55000','23505'].includes(String(error.code)))) throw error;
    }
  }
  // A removed/disabled program must not leave its old water run running unattended.
  const orphans=(await client.query(`SELECT r.site_id,r.device_id FROM spff.fuzzy_water_runs r
    WHERE r.status<>'completed' AND NOT EXISTS(SELECT 1 FROM spff.guide_programs p JOIN spff.devices d
      ON d.site_id=p.site_id AND d.device_id=p.config->>'deviceId' WHERE d.enabled
      AND p.site_id=r.site_id AND p.config->>'deviceId'=r.device_id)`)).rows;
  for(const orphan of orphans) {
    if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
      [`soil-ec:${orphan.site_id}:${orphan.device_id}`])).rows[0]?.acquired) continue;
    const heartbeat=(await client.query(`SELECT * FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
      ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[orphan.site_id,orphan.device_id])).rows[0];
    await tickFuzzyWater(client,{site:orphan.site_id,device:orphan.device_id,enabled:false,
      mode:'unavailable',heartbeat,sample:null,decision:null,now});
    await client.query("UPDATE spff.automatic_cycle_states SET mode='unavailable',reason='program_unavailable',dispatch_enabled=false,updated_at=now() WHERE site_id=$1 AND device_id=$2",
      [orphan.site_id,orphan.device_id]);
  }
}
