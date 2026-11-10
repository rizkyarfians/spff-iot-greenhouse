export type HstIrrigationSource={
 planning_status:string;
 planning_recorded_at:string|null;
 tank_preview?:{level_status:string;estimated_available_l:number|null};
 water_carryover?:{status:string;remaining_for_reassessment_l:number|null};
 irrigation_schedule_preview?:{status:string;tomorrow_at_least_l:number|null;fuzzy_demand_l:number|null};
 fuzzy_preview?:{illustrative_water_l:number|null;recorded_at:string|null;basis?:'SIMULATION_PROFILE'|'OPERATIONAL_PROFILE'}|null;
 fuzzy_preview_blockers?:readonly string[];
 production_fuzzy?:{
  status:string; basis?:string; recorded_at:string|null; expires_at:string|null; target_water_l:number|null; irrigation_needed:boolean|null;
 };
}
type Display={kind:'recorded'|'capacity_preview'|'demand_preview'|'unavailable';label:string;valueL:number|null;note:string}
const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const fresh=(at:string|null|undefined,now:number)=>{
 const age=now-Date.parse(at??'');
 return Number.isFinite(age)&&age>=-5000&&age<=120000;
};
export function fuzzyIrrigationEstimate(data:HstIrrigationSource|null,now=Date.now()){
 if(data?.planning_status!=='CURRENT')return null;
 const production=data.production_fuzzy;
 if(production?.basis!=='TANK_INVENTORY_FUZZY'&&production?.status==='READY'&&fresh(data.planning_recorded_at,now)&&fresh(production.recorded_at,now)&&Date.parse(production.expires_at??'')>now&&valid(production.target_water_l)){
  return {
   valueL:production.target_water_l,
   label:production.irrigation_needed===false?'Belum perlu penyiraman':'Target penyiraman Fuzzy',
   source:'Profil produksi',
  };
 }
 const preview=data.fuzzy_preview;
 // The API validates freshness for CURRENT. Match the preview to that same sample.
 const recorded=Date.parse(data.planning_recorded_at??'');
 if(preview&&Number.isFinite(recorded)&&Date.parse(preview.recorded_at??'')===recorded&&valid(preview.illustrative_water_l)){
  return {
   valueL:preview.illustrative_water_l,
   label:'Estimasi kebutuhan air',
   source:preview.basis==='OPERATIONAL_PROFILE'?'Pratinjau profil Panduan':'Simulasi Fuzzy',
  };
 }
 return null;
}

export function fuzzyUnavailableReason(data:HstIrrigationSource|null){
 if(!data)return 'Menunggu data AI.';
 if(data.planning_status!=='CURRENT'){
  return 'Menunggu data sensor terbaru.';
 }
 const blockers=data.fuzzy_preview_blockers??[];
 if(blockers.includes('control_source_not_selected'))return 'Pilih sensor kelembapan di Kontrol Perangkat.';
 if(blockers.includes('control_config_not_acknowledged'))return 'Menunggu alat menerapkan pengaturan sensor.';
 if(blockers.some(reason=>reason.startsWith('selected_sensor_')||reason.startsWith('sensor_raw_')||
    reason==='sensor_control_diagnostic_rejected'||reason==='sensor_poll_boot_missing')){
  return 'Menunggu bacaan sensor kelembapan yang valid.';
 }
 if(blockers.includes('simulation_profile_unavailable')||blockers.includes('simulation_rules_invalid')){
  return 'Profil perhitungan Fuzzy perlu diperiksa.';
 }
 return 'Menunggu hasil Fuzzy terbaru.';
}

type TankReading={recordedAt:string;valueL:number};

function currentTankReading(data:HstIrrigationSource|null,now:number):TankReading|null{
 const at=data?.planning_recorded_at;
 const tank=data?.tank_preview;
 if(!at||data?.planning_status!=='CURRENT'||!fresh(at,now)||
    tank?.level_status!=='ESTIMATED'||!valid(tank.estimated_available_l))return null;
 return {recordedAt:at,valueL:tank.estimated_available_l};
}

export function recentTankReadings(previous:TankReading[],data:HstIrrigationSource|null,now=Date.now()){
 const readings=previous.filter(reading=>fresh(reading.recordedAt,now));
 const latest=currentTankReading(data,now);
 if(latest){
  const at=Date.parse(latest.recordedAt);
  const repeated=readings.findIndex(reading=>Date.parse(reading.recordedAt)===at);
  if(repeated===-1)readings.push(latest);
  else readings[repeated]=latest;
 }
 return readings.sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)).slice(0,3);
}

export function tankDisplayEstimate(readings:TankReading[],data:HstIrrigationSource|null,now=Date.now()){
 const recent=recentTankReadings(readings,data,now);
 if(recent.length===0)return null;
 const sorted=recent.map(reading=>reading.valueL).sort((a,b)=>a-b);
 const middle=Math.floor(sorted.length/2);
 return {
  valueL:sorted.length%2===0?(sorted[middle-1]+sorted[middle])/2:sorted[middle],
  recordedAt:recent[0].recordedAt,
  sampleCount:recent.length,
  current:currentTankReading(data,now)!==null,
 };
}
/** Select existing Python results only. No delivery or tank calculations are recreated here. */
export function hstIrrigationDisplay(data:HstIrrigationSource|null|undefined,now=Date.now()):Display{
 const carryover=data?.water_carryover;
 if(carryover&&carryover.status!=='NO_PLAN'&&valid(carryover.remaining_for_reassessment_l))
  return {kind:'recorded',label:'Sisa kebutuhan penyiraman',valueL:carryover.remaining_for_reassessment_l,
   note:'Dari sesi perangkat yang tercatat; tinjau ulang sebelum pelaksanaan.'};
 const current=data?.planning_status==='CURRENT'&&fresh(data.planning_recorded_at,now);
 const preview=data?.irrigation_schedule_preview;
 if(current&&preview?.status==='GEOMETRY_ONLY'&&valid(preview.tomorrow_at_least_l))
  return {kind:'capacity_preview',label:'Sisa kebutuhan · estimasi kapasitas',valueL:preview.tomorrow_at_least_l,
   note:'Estimasi kapasitas tandon, bukan realisasi penyiraman.'};
 const fuzzy=data?.fuzzy_preview;
 if(current&&fuzzy&&fresh(fuzzy.recorded_at,now)&&valid(fuzzy.illustrative_water_l))
  return {kind:'demand_preview',label:fuzzy.basis==='OPERATIONAL_PROFILE'?'Kebutuhan air · profil Panduan':'Kebutuhan air · simulasi Fuzzy',valueL:fuzzy.illustrative_water_l,
   note:fuzzy.basis==='OPERATIONAL_PROFILE'?'Target dari profil Panduan terverifikasi; belum menjadi perintah pompa.':'Profil simulasi; belum menjadi target pompa produksi.'};
 return {kind:'unavailable',label:'Kebutuhan penyiraman',valueL:null,
  note:'Menunggu hasil perhitungan AI terbaru.'};
}

