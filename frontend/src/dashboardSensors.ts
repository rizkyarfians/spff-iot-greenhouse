import {isEnergySensor} from './sensorCategory.ts'
export type DashboardSensorGroup='soil1'|'soil2'|'environment'|'energy'
export function dashboardSensorsFor<T extends {key:string}>(sensors:T[],group:DashboardSensorGroup,definitions:{sensorKey:string;enabled:boolean}[]=[]):T[]{
 const disabled=new Set(definitions.filter(d=>!d.enabled).map(d=>d.sensorKey))
 return sensors.filter(s=>{
  if(disabled.has(s.key))return false
  const category=isEnergySensor(s.key)?'energy':s.key.startsWith('soil_1_')?'soil1':s.key.startsWith('soil_2_')?'soil2':'environment'
  return category===group
 })
}
