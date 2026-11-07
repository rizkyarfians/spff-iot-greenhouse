import type { PoolClient } from 'pg';
import { enqueueAutomaticPump, recentSample } from './automaticCycle.js';

export type FuzzyWaterDecision = {
  site: string; device: string; recordedAt: Date; expiresAt: Date;
  needed: boolean; targetL: number;
};

/** Read the existing production Fuzzy result. Simulation previews never drive this path. */
export async function readProductionFuzzy(): Promise<FuzzyWaterDecision | null> {
  const port=process.env.AI_LOCAL_PORT??'5010';
  if (!/^\d{4,5}$/.test(port) || Number(port)>65535 || Number(port)<1024) return null;
  try {
    const response=await fetch(`http://127.0.0.1:${port}/dashboard/summary`,{signal:AbortSignal.timeout(3000),redirect:'error',cache:'no-store'});
    if (!response.ok) return null;
    const data=await response.json() as any, fuzzy=data.production_fuzzy;
    if (data.planning_status!=='CURRENT' || fuzzy?.status!=='READY' || fuzzy.basis==='SIMULATION_PROFILE' ||
      fuzzy.input_key!=='soil_2_moisture' || typeof fuzzy.irrigation_needed!=='boolean' ||
      !Number.isFinite(fuzzy.target_water_l) || fuzzy.target_water_l<0) return null;
    const recordedAt=new Date(fuzzy.recorded_at),expiresAt=new Date(fuzzy.expires_at);
    if (!Number.isFinite(recordedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) return null;
    return {site:process.env.AI_SITE_ID??'greenhouse-01',device:process.env.AI_DEVICE_ID??'esp32-s3-01',
      recordedAt,expiresAt,needed:fuzzy.irrigation_needed,targetL:fuzzy.target_water_l};
  } catch { return null; }
}

type Context = {site:string;device:string;enabled:boolean;mode:string;heartbeat:any;sample:any;decision:FuzzyWaterDecision|null;now:Date};
export async function tickFuzzyWater(client:PoolClient,ctx:Context) {
  const {site,device,heartbeat:h,sample:t,now}=ctx;
  const raw=h?.raw_payload;
  const boot=t?.raw_payload?.sensorHealth?.soil_2_moisture?.pollBootId;
  const valid=recentSample(h?.recorded_at,now,90000) && h.online===true && raw?.pumpReadbackValid===true &&
    raw.waterInterlockEnabled===true && raw.aiAccTankGuardHealthy===true &&
    recentSample(t?.recorded_at,now) && t.sensor_health?.tank_water_level_pct?.valid===true &&
    Number.isFinite(t.tank_water_level_pct) && t.tank_water_level_pct>0 &&
    t.sensor_health?.flow_water_total_l?.valid===true && Number.isFinite(t.flow_water_total_l) &&
    typeof raw.pulseBootId==='string' && boot===raw.pulseBootId;
  const decision=ctx.decision;
  const decisionValid=!!decision && decision.site===site && decision.device===device &&
    recentSample(decision.recordedAt,now) && decision.expiresAt>now &&
    t?.recorded_at?.getTime()===decision.recordedAt.getTime() &&
    t.sensor_health?.soil_2_moisture?.valid===true && t.raw_payload?.sensorHealth?.soil_2_moisture?.rawFresh===true &&
    t.raw_payload?.sensorHealth?.soil_2_moisture?.lastPollOk===true;
  const run=(await client.query(`SELECT r.*,c.status AS command_status,c.expires_at AS start_expires
    FROM spff.fuzzy_water_runs r JOIN spff.control_commands c ON c.command_id=r.start_command_id
    WHERE r.site_id=$1 AND r.device_id=$2 AND r.status<>'completed' FOR UPDATE OF r`,[site,device])).rows[0];
  if(run) {
    const elapsed=now.getTime()-run.created_at.getTime();
    const operatorStop=(await client.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
      AND actuator_key='pump_water' AND NOT requested_is_active AND requested_by<>'hst-fuzzy-water-stop'
      AND issued_at>=$3 LIMIT 1`,[site,device,run.created_at])).rows.length>0;
    const delivered=valid&&boot===run.boot_id?t.flow_water_total_l-run.baseline_l:null;
    const reason=run.status==='stopping'?run.reason:
      ctx.mode!=='watering'?'fertilization_priority':!ctx.enabled?'automatic_disabled':operatorStop?'operator_stop':
      !valid||boot!==run.boot_id||delivered===null||delivered<0?'water_evidence_unavailable':
      raw.pumpFertActualActive!==false?'fertilizer_pump_active':delivered>=run.target_l?'fuzzy_target_reached':
      decisionValid&&!decision!.needed?'fuzzy_no_irrigation':elapsed>=7200000?'water_runtime_limit':
      ['failed','rejected','expired','timed_out'].includes(run.command_status)?'start_unconfirmed':
      run.status==='running'&&raw.pumpWaterActualActive===false?'device_stopped':
      elapsed>90000&&t?.sensor_health?.flow_water_lpm?.valid===true&&t.flow_water_lpm===0?'no_water_flow':null;
    if(!reason) {
      if(run.command_status==='completed'&&raw.pumpWaterActualActive===true)
        await client.query("UPDATE spff.fuzzy_water_runs SET status='running' WHERE run_id=$1",[run.run_id]);
      return;
    }
    await client.query("UPDATE spff.control_commands SET status='failed',reason='fuzzy_run_stopped' WHERE command_id=$1 AND status='pending'",[run.start_command_id]);
    await client.query("UPDATE spff.fuzzy_water_runs SET status='stopping',reason=$2 WHERE run_id=$1",[run.run_id,reason]);
    // Even a late ON must have expired before OFF evidence can release this run.
    if(recentSample(h?.recorded_at,now,90000) && h.online && raw?.pumpReadbackValid===true &&
      raw.pumpWaterActualActive===false && raw.pumpFertActualActive===false && h.recorded_at>=run.start_expires) {
      await client.query("UPDATE spff.fuzzy_water_runs SET status='completed',stopped_at=now() WHERE run_id=$1",[run.run_id]);
      return;
    }
    if(!(await client.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
      AND request_payload->>'runId'=$3 AND NOT requested_is_active AND expires_at>now()
      AND status IN ('pending','published','accepted')`,[site,device,run.run_id])).rows.length)
      await enqueueAutomaticPump(client,site,device,'pump_water',false,'hst-fuzzy-water-stop',{runId:run.run_id,reason});
    return;
  }
  if(!ctx.enabled||ctx.mode!=='watering'||!valid||!decisionValid||!decision!.needed||decision!.targetL<=0 ||
    raw.pumpWaterActualActive!==false||raw.pumpFertActualActive!==false||raw.serverPulseOwner===true||
    raw.aiAccSessionActive===true||raw.doseVolumeSessionActive===true) return;
  if((await client.query(`SELECT 1 FROM spff.fuzzy_water_runs WHERE site_id=$1 AND device_id=$2
    AND (input_at>=$3 OR stopped_at>now()-interval '60 seconds') LIMIT 1`,[site,device,decision!.recordedAt])).rows.length) return;
  if((await client.query(`SELECT 1 FROM spff.actuator_schedules WHERE site_id=$1 AND device_id=$2
    AND enabled AND actuator_key IN ('pump_water','pump_fert') UNION ALL
    SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2 AND expires_at>now()
    AND status IN ('pending','published','accepted')`,[site,device])).rows.length) return;
  const {randomUUID}=await import('node:crypto');
  const id=randomUUID();
  await client.query('SAVEPOINT fuzzy_start');
  try {
    const command=await enqueueAutomaticPump(client,site,device,'pump_water',true,'hst-fuzzy-water',{runId:id});
    await client.query(`INSERT INTO spff.fuzzy_water_runs(run_id,site_id,device_id,status,input_at,baseline_l,boot_id,target_l,start_command_id)
      VALUES($1,$2,$3,'queued',$4,$5,$6,$7,$8)`,[id,site,device,decision!.recordedAt,t.flow_water_total_l,boot,decision!.targetL,command]);
    await client.query('RELEASE SAVEPOINT fuzzy_start');
  } catch(error) {
    await client.query('ROLLBACK TO SAVEPOINT fuzzy_start');await client.query('RELEASE SAVEPOINT fuzzy_start');
    if(!(error instanceof Error&&'code' in error&&error.code==='55000')) throw error;
  }
}
