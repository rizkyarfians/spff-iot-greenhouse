import type { PoolClient } from 'pg';
import { ecDoseSample,estimateEcDoseInterval,type EcDoseSample } from './fertilizerDelivery.js';

// Select status at/before the measurement; a later heartbeat cannot describe an earlier interval.
const sampleStatus=`LEFT JOIN LATERAL(SELECT recorded_at,raw_payload,online FROM spff.device_status_events h
  WHERE h.site_id=t.site_id AND h.device_id=t.device_id AND h.recorded_at<=t.recorded_at
  ORDER BY h.recorded_at DESC,h.device_status_id DESC LIMIT 1) h ON true`;

export async function findEcWaterBaseline(c:PoolClient,site:string,device:string,before:Date) {
  const rows=(await c.query(`SELECT t.*,h.raw_payload AS status_payload,h.recorded_at AS status_at,h.online AS status_online
    FROM spff.telemetry_samples t ${sampleStatus} WHERE t.site_id=$1 AND t.device_id=$2
    AND t.recorded_at BETWEEN $3::timestamptz-interval '15 minutes' AND $3
    ORDER BY t.recorded_at DESC,t.telemetry_id DESC LIMIT 3`,[site,device,before])).rows.map(ecDoseSample);
  if(rows.length!==3||rows.some(s=>!s.valid||s.waterOn!==true||s.fertOn!==false||s.flowLpm===null||s.flowLpm<=0||s.stockLpm!==0)||
    new Set(rows.map(s=>s.boot)).size!==1) return null;
  const times=rows.map(s=>Date.parse(s.at));
  if(times[0]-times[2]<40000||times[0]-times[1]>120000||times[1]-times[2]>120000) return null;
  const mean=rows.reduce((sum,s)=>sum+s.ec!,0)/3;
  if(Math.max(...rows.map(s=>s.ec!))-Math.min(...rows.map(s=>s.ec!))>Math.max(20,mean*0.05)) return null;
  return {ec:mean,at:rows[0].at,boot:rows[0].boot!,evidence:rows.map(s=>s.id)};
}

export async function recordEcFertilizerDelivery(c:PoolClient,phase:any,now=new Date()) {
  if(!(await c.query("SELECT to_regclass('spff.ec_dose_estimates') IS NOT NULL AS ready")).rows[0]?.ready)
    return {grams:null,completionAllowed:false};
  let state=(await c.query('SELECT * FROM spff.ec_dose_estimates WHERE phase_id=$1 FOR UPDATE',[phase.phase_id])).rows[0];
  const currentProfile=(await c.query(`SELECT * FROM spff.ec_dose_profiles WHERE site_id=$1 AND device_id=$2 AND product_key=$3 FOR SHARE`,
    [phase.site_id,phase.device_id,phase.product.trim().toLowerCase()])).rows[0];
  if(!state) {
    const profile=currentProfile;
    if(!profile) return {grams:null,completionAllowed:false};
    const baseline=await findEcWaterBaseline(c,phase.site_id,phase.device_id,phase.started_at)
      ?? await findEcWaterBaseline(c,phase.site_id,phase.device_id,now);
    if(!baseline) return {grams:null,completionAllowed:false};
    await c.query(`INSERT INTO spff.ec_dose_estimates(phase_id,profile_snapshot,baseline_ec,baseline_at,baseline_boot_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [phase.phase_id,JSON.stringify({product:profile.product,coefficient:profile.coefficient,validated:profile.validated,
      calibrationReference:profile.calibration_reference,revision:profile.revision,baselineEvidence:baseline.evidence}),baseline.ec,baseline.at,baseline.boot]);
    state=(await c.query('SELECT * FROM spff.ec_dose_estimates WHERE phase_id=$1 FOR UPDATE',[phase.phase_id])).rows[0];
  }
  const samples=(await c.query(`SELECT t.*,h.raw_payload AS status_payload,h.recorded_at AS status_at,h.online AS status_online
    FROM spff.telemetry_samples t ${sampleStatus} WHERE t.site_id=$1 AND t.device_id=$2
    AND t.recorded_at>=greatest($3::timestamptz,$6::timestamptz) AND t.recorded_at<=$4 AND t.telemetry_id>$5
    ORDER BY t.telemetry_id LIMIT 200`,[phase.site_id,phase.device_id,phase.started_at,now,state.cursor_id,state.baseline_at])).rows;
  let anchor=state.anchor as EcDoseSample|null,mass=state.estimated_g as number,invalid=state.unmeasured_intervals as number;
  let cursor=state.cursor_id,reason=state.reason;
  for(const row of samples) {
    const current=ecDoseSample(row);
    let interval=current.boot!==state.baseline_boot_id
      ? {status:'invalid' as const,reason:'baseline_boot_changed',volumeL:null,massG:null}
      : estimateEcDoseInterval(anchor,current,state.baseline_ec,state.profile_snapshot.coefficient);
    if(interval.massG!==null&&!Number.isFinite(mass+interval.massG))
      interval={status:'invalid',reason:'cumulative_mass_overflow',volumeL:null,massG:null};
    const inserted=await c.query(`INSERT INTO spff.ec_dose_intervals(phase_id,telemetry_id,recorded_at,status,reason,volume_l,mass_g,previous_at,ec_us_cm)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING telemetry_id`,
    [phase.phase_id,row.telemetry_id,row.recorded_at,interval.status,interval.reason,interval.volumeL,interval.massG,anchor?.at||null,current.ec]);
    if(inserted.rows.length) {
      if(interval.status==='measured') mass+=interval.massG!;
      if(interval.status==='invalid') invalid++;
    }
    cursor=row.telemetry_id;reason=interval.reason;
    // Late inserts are audited but must not move the chronological anchor backward.
    if(!anchor||Date.parse(current.at)>Date.parse(anchor.at)) anchor=current;
  }
  await c.query(`UPDATE spff.ec_dose_estimates SET cursor_id=$2,anchor=$3,estimated_g=$4,unmeasured_intervals=$5,
    reason=$6,updated_at=now() WHERE phase_id=$1`,[phase.phase_id,cursor,anchor?JSON.stringify(anchor):null,mass,invalid,reason]);
  const completionAllowed=currentProfile?.validated===true&&
    currentProfile.coefficient===state.profile_snapshot.coefficient;
  // Missing/invalid intervals contribute no grams. Only the measured sum can reach the target.
  if(completionAllowed) await c.query('UPDATE spff.ec_dose_estimates SET completion_profile_snapshot=$2 WHERE phase_id=$1',
    [phase.phase_id,JSON.stringify({product:currentProfile.product,coefficient:currentProfile.coefficient,revision:currentProfile.revision,
      calibrationReference:currentProfile.calibration_reference,actor:currentProfile.updated_by,updatedAt:currentProfile.updated_at})]);
  return {grams:anchor?mass:null,completionAllowed};
}
