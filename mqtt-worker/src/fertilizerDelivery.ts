export type FertilizerDeliveryInput = {
  phaseId: string;
  programId: string;
  activityId: string;
  hst: number;
  product: string;
  targetG: number | null;
  startedAt: Date | null;
  previousDeliveredG: number | null;
  coefficient?: number;
  baselineEcUs?: number;
  previousSample?: EcDoseSample | null;
  baseline: Record<string, unknown> | null;
  telemetry: {
    recorded_at: Date; flow_fert_total_l: number | null; flow_water_total_l: number | null;
    liquid_ec_us_cm?: number | null;
    flow_fert_lpm: number | null; flow_water_lpm: number | null;
    sensor_health: Record<string, unknown>; raw_payload: Record<string, unknown>;
  } | null;
  deviceStatus: { recorded_at: Date; mode: string; raw_payload: Record<string, unknown> } | null;
};

/** Cumulative EC estimate from one interval and its previous measured total.
 * The worker persists checkpoints and audit rows in ecDoseEstimator.ts.
 * Missing baseline, coefficient or interval evidence returns null.
 */
export function calculateDeliveredFertilizerGrams(input: FertilizerDeliveryInput): number | null {
  if(!input.telemetry||!input.deviceStatus||!input.previousSample||input.coefficient===undefined||input.baselineEcUs===undefined) return null;
  const current=ecDoseSample({...input.telemetry,status_payload:input.deviceStatus.raw_payload,status_at:input.deviceStatus.recorded_at});
  const interval=estimateEcDoseInterval(input.previousSample,current,input.baselineEcUs,input.coefficient);
  return interval.status==='invalid'?null:(input.previousDeliveredG??0)+(interval.massG??0);
}

export type EcDoseSample={id:string;at:string;ec:number|null;totalL:number|null;stockTotalL:number|null;flowLpm:number|null;stockLpm:number|null;
  waterOn:boolean|null;fertOn:boolean|null;boot:string|null;valid:boolean;reason:string};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function ecDoseSample(row:any):EcDoseSample {
  const health=row.sensor_health??{},raw=row.raw_payload??{},status=row.status_payload??{};
  const boot=raw.sensorHealth?.liquid_ec_us_cm?.pollBootId??raw.sensorHealth?.soil_2_moisture?.pollBootId??raw.sensorHealth?.soil_1_moisture?.pollBootId??raw.pulseBootId;
  const at=new Date(row.recorded_at),statusAt=new Date(row.status_at);
  const ec=finite(row.liquid_ec_us_cm)&&health.liquid_ec_us_cm?.valid===true?row.liquid_ec_us_cm:null;
  const flow=finite(row.flow_water_lpm)&&health.flow_water_lpm?.valid===true?row.flow_water_lpm:null;
  const stock=finite(row.flow_fert_lpm)&&health.flow_fert_lpm?.valid===true?row.flow_fert_lpm:null;
  const statusValid=row.status_online!==false&&Number.isFinite(at.getTime())&&Number.isFinite(statusAt.getTime())&&at.getTime()-statusAt.getTime()>=0&&
    at.getTime()-statusAt.getTime()<=60000&&status.pumpReadbackValid===true&&typeof status.pumpWaterActualActive==='boolean'&&typeof status.pumpFertActualActive==='boolean';
  const valid=ec!==null&&flow!==null&&stock!==null&&typeof boot==='string'&&boot===status.pulseBootId&&statusValid&&
    health.liquid_ec_us_cm?.rawFresh!==false&&health.liquid_ec_us_cm?.lastPollOk!==false;
  return {id:String(row.telemetry_id??''),at:Number.isFinite(at.getTime())?at.toISOString():'',ec,
    totalL:finite(row.flow_water_total_l)&&health.flow_water_total_l?.valid===true?row.flow_water_total_l:null,
    stockTotalL:finite(row.flow_fert_total_l)&&health.flow_fert_total_l?.valid===true?row.flow_fert_total_l:null,
    flowLpm:flow,stockLpm:stock,waterOn:statusValid?status.pumpWaterActualActive:null,fertOn:statusValid?status.pumpFertActualActive:null,
    boot:typeof boot==='string'?boot:null,valid,reason:valid?'valid':!statusValid?'pump_status_unconfirmed':'ec_or_flow_invalid'};
}

export type EcDoseInterval={status:'measured'|'anchor'|'excluded'|'invalid';reason:string;volumeL:number|null;massG:number|null};
export function estimateEcDoseInterval(previous:EcDoseSample|null,current:EcDoseSample,baselineEc:number,k:number):EcDoseInterval {
  const result=(status:EcDoseInterval['status'],reason:string,volumeL:number|null=null,massG:number|null=null)=>({status,reason,volumeL,massG});
  if(!finite(baselineEc)||!finite(k)||k===0||!current.valid) return result('invalid',current.valid?'calibration_missing':current.reason);
  if(!previous) return result('anchor','first_sample');
  if(!previous.valid) return result('anchor','recovering_valid_data');
  const seconds=(Date.parse(current.at)-Date.parse(previous.at))/1000;
  if(seconds===0&&current.ec===previous.ec&&current.totalL===previous.totalL&&current.boot===previous.boot&&
    current.waterOn===previous.waterOn&&current.fertOn===previous.fertOn) return result('excluded','duplicate_sample');
  if(!Number.isFinite(seconds)||seconds<=0) return result('invalid','sample_out_of_order');
  if(current.boot!==previous.boot) return result('invalid','device_reboot');
  if(seconds>120) return result('invalid','telemetry_gap');
  if(previous.totalL!==null&&current.totalL!==null&&current.totalL<previous.totalL) return result('invalid','totalizer_rollback');
  if(!previous.waterOn||!previous.fertOn||!current.waterOn||!current.fertOn) return result('excluded','outside_confirmed_injection');
  const stockMoved=previous.stockTotalL!==null&&current.stockTotalL!==null&&current.stockTotalL>previous.stockTotalL;
  if(current.flowLpm===null||current.flowLpm<=0||current.stockLpm===null||!(current.stockLpm>0||stockMoved)) return result('invalid','injection_flow_unconfirmed');
  const volume=previous.totalL!==null&&current.totalL!==null?current.totalL-previous.totalL:current.flowLpm*seconds/60;
  const mass=Math.max(0,current.ec!-baselineEc)/k*volume;
  if(!finite(volume)||!finite(mass)) return result('invalid','nonfinite_interval');
  return result('measured',current.totalL!==null&&previous.totalL!==null?'totalizer_volume':'flow_integrated_volume',volume,mass);
}

export function fertilizerProgress(targetG: number | null, deliveredG: number | null) {
  const known = targetG !== null && Number.isFinite(targetG) && targetG >= 0 &&
    deliveredG !== null && Number.isFinite(deliveredG) && deliveredG >= 0;
  return { remainingG: known ? Math.max(0, targetG! - deliveredG!) : null,
    fulfilled: known && deliveredG! >= targetG! };
}
