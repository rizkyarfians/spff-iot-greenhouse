import {isEnergySensor} from './sensorCategory.ts'
export type DashboardSensorGroup='greenhouse'|'soil1'|'soil2'|'solution'|'flow'|'air'|'energy'
const priority=['soil_1_moisture','soil_1_ec_us_cm','soil_2_moisture','soil_2_ec_us_cm','liquid_ph','liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct']
export function dashboardSensorsFor<T extends {key:string}>(sensors:T[],group:DashboardSensorGroup,definitions:{sensorKey:string;enabled:boolean}[]=[]):T[]{
 const disabled=new Set(definitions.filter(d=>!d.enabled).map(d=>d.sensorKey))
 const chosen=sensors.filter(s=>!disabled.has(s.key)&&(group==='energy'?isEnergySensor(s.key):group==='greenhouse'?!isEnergySensor(s.key):group==='soil1'?s.key.startsWith('soil_1_'):group==='soil2'?s.key.startsWith('soil_2_'):group==='solution'?s.key.startsWith('liquid_')||s.key.startsWith('tank_'):group==='flow'?s.key.startsWith('flow_'):s.key.startsWith('air_')))
 return group==='greenhouse'?[...chosen.filter(s=>priority.includes(s.key)).sort((a,b)=>priority.indexOf(a.key)-priority.indexOf(b.key)),...chosen.filter(s=>!priority.includes(s.key))]:chosen
}
