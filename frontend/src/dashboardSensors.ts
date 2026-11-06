import {isEnergySensor} from './sensorCategory.ts'
export type DashboardSensorGroup='soil1'|'soil2'|'water'|'environment'|'energy'
export function dashboardSensorGroup(key:string):DashboardSensorGroup {
 return isEnergySensor(key)?'energy':key.startsWith('soil_1_')?'soil1':key.startsWith('soil_2_')?'soil2':
  /^(liquid_|tank_|flow_)/.test(key)?'water':'environment'
}
export function dashboardSensorsFor<T extends {key:string}>(sensors:T[],group:DashboardSensorGroup,definitions:{sensorKey:string;enabled:boolean}[]=[]):T[]{
 const enabled=new Map(definitions.map(d=>[d.sensorKey,d.enabled]))
 return sensors.filter(s=>dashboardSensorGroup(s.key)===group&&
  (enabled.get(s.key)??group!=='soil1'))
}
