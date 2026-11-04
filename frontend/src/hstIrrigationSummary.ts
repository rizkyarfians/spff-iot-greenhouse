export type HstIrrigationSource={
 planning_status:string;
 planning_recorded_at:string|null;
 water_carryover?:{status:string;remaining_for_reassessment_l:number|null};
 irrigation_schedule_preview?:{status:string;tomorrow_at_least_l:number|null;fuzzy_demand_l:number|null};
 fuzzy_preview?:{illustrative_water_l:number|null;recorded_at:string|null}|null;
}
type Display={kind:'recorded'|'capacity_preview'|'demand_preview'|'unavailable';label:string;valueL:number|null;note:string}
const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const fresh=(at:string|null|undefined,now:number)=>{
 const age=now-Date.parse(at??'');
 return Number.isFinite(age)&&age>=-5000&&age<=120000;
};
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
  return {kind:'demand_preview',label:'Kebutuhan penyiraman · estimasi AI',valueL:fuzzy.illustrative_water_l,
   note:'Hasil Fuzzy terbaru; belum ada rencana atau realisasi tercatat.'};
 return {kind:'unavailable',label:'Kebutuhan penyiraman',valueL:null,
  note:'Menunggu hasil perhitungan AI terbaru.'};
}
