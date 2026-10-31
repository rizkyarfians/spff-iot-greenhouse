import {pool,configuredSiteId as siteId} from './postgresRepository.js';

/** Device-level diagnostics feed the AI panel even before a crop session exists. */
export async function readAdaptiveDevice(deviceId:string) {
 const [events,status,samples,config]=await Promise.all([
  pool.query("SELECT payload,received_at FROM spff.adaptive_fert_events WHERE site_id=$1 AND device_id=$2 AND payload->>'kind'='adaptive_fert_telemetry' ORDER BY received_at DESC LIMIT 1",[siteId,deviceId]),
  pool.query('SELECT raw_payload,recorded_at FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2 ORDER BY recorded_at DESC LIMIT 1',[siteId,deviceId]),
  pool.query('SELECT raw_payload,recorded_at FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2 AND recorded_at<=now() ORDER BY recorded_at DESC LIMIT 1',[siteId,deviceId]),
  pool.query('SELECT desired_mode,water_enabled,fertilizer_enabled FROM spff.device_automatic_control_configs WHERE site_id=$1 AND device_id=$2',[siteId,deviceId]),
 ]);
 const t=events.rows[0],s=status.rows[0],sample=samples.rows[0],now=Date.now();
 const age=t?now-Date.parse(t.payload.timestamp):null;
 const live=age!==null&&age>=0&&age<=30000&&now-new Date(t.received_at).getTime()<=30000;
 const sensorAge=sample?now-new Date(sample.recorded_at).getTime():null;
 const sensors=Object.entries(sample?.raw_payload.sensorHealth??{}).map(([key,health])=>{
  const h=health as {valid?:boolean;rawAgeMs?:number;lastPollResult?:string;reason?:string};
  return {key,value:sample?.raw_payload.sensors?.[key]??null,valid:sensorAge!==null&&sensorAge>=0&&sensorAge<=90000&&h.valid===true,ageMs:h.rawAgeMs==null?null:h.rawAgeMs+Math.max(0,sensorAge??0),poll:h.lastPollResult??null,reason:h.reason??null};
 });
 const blockers:string[]=[];
 if(!live)blockers.push('Telemetry kontrol adaptif belum tersedia atau kedaluwarsa.');
 if(s?.raw_payload.firmwareVersion!=='1.5.03-SHT20-TELEMETRY-SYNC')blockers.push('Firmware 1.5.03 belum terkonfirmasi.');
 if(live&&!t.payload.ecValid)blockers.push('Sensor EC belum valid.');
 if(live&&!t.payload.flowValid)blockers.push('Sensor debit belum valid.');
 if(live&&(!t.payload.waterPumpKnown||!t.payload.fertPumpKnown))blockers.push('Status relay belum terverifikasi.');
 if(config.rows[0]?.desired_mode!=='manual'||config.rows[0]?.water_enabled||config.rows[0]?.fertilizer_enabled)blockers.push('Pengaturan kontrol lain perlu diselaraskan sebelum memulai sesi adaptif.');
 return {deviceId,firmware:s?.raw_payload.firmwareVersion??null,live,ageMs:age,telemetry:t?.payload??null,sensors,blockers,dispatchEnabled:process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true',algorithm:'Kontrol EC hysteresis dengan filter EMA',evaluatedAt:new Date().toISOString()};
}
