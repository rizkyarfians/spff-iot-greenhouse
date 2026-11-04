import {isEnergySensor} from './sensorCategory.ts'
export type DashboardSensorGroup='soil1'|'soil2'|'water'|'environment'|'energy'
export function dashboardSensorsFor<T extends {key:string}>(sensors:T[],group:DashboardSensorGroup,definitions:{sensorKey:string;enabled:boolean}[]=[]):T[]{
 // Temporarily unavailable in dashboard monitoring; keep historical data intact.
 if(group==='soil1')return []
 const disabled=new Set(definitions.filter(d=>!d.enabled).map(d=>d.sensorKey))
 return sensors.filter(s=>{
  if(disabled.has(s.key)||s.key.startsWith('soil_1_'))return false
  const category=isEnergySensor(s.key)?'energy':s.key.startsWith('soil_2_')?'soil2':
   /^(liquid_|tank_|flow_)/.test(s.key)?'water':'environment'
  return category===group
 })
}
