import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardSensorsFor} from '../src/dashboardSensors.ts'
const keys=['soil_1_moisture','soil_1_ec_us_cm','soil_1_temp','soil_1_ph','soil_1_n','soil_1_p','soil_1_k','soil_2_moisture','soil_2_temp','soil_2_ec_us_cm','soil_2_ph','soil_2_n','soil_2_p','soil_2_k','liquid_temp','liquid_ph','liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm','flow_water_total_l','flow_fert_total_l','air_temp','air_humidity','battery_voltage','ac_power_w']
const sensors=keys.map(key=>({key,value:null}))
test('available groups cover every non-soil-1 sensor once',()=>{
 const rows=['soil2','water','environment','energy'].flatMap(group=>dashboardSensorsFor(sensors,group))
 const expected=sensors.filter(s=>!s.key.startsWith('soil_1_'))
 assert.equal(rows.length,expected.length)
 assert.equal(new Set(rows.map(r=>r.key)).size,expected.length)
 assert.ok(rows.every(r=>r.value===null))
})
test('soil 1 stays inaccessible even when explicitly requested',()=>{
 assert.deepEqual(dashboardSensorsFor(sensors,'soil1'),[])
 assert.ok(['soil2','water','environment','energy'].every(group=>dashboardSensorsFor(sensors,group).every(s=>!s.key.startsWith('soil_1_'))))
})
test('water and environment parameters are separated and disabled sensors are honored',()=>{
 assert.equal(dashboardSensorsFor(sensors,'soil2').length,7)
 assert.equal(dashboardSensorsFor(sensors,'water').length,9)
 assert.equal(dashboardSensorsFor(sensors,'environment').length,2)
 assert.equal(dashboardSensorsFor(sensors,'energy').length,2)
 for(const key of ['liquid_temp','tank_water_level_pct','flow_water_total_l'])assert.ok(dashboardSensorsFor(sensors,'water').some(r=>r.key===key))
 assert.deepEqual(dashboardSensorsFor(sensors,'environment').map(s=>s.key),['air_temp','air_humidity'])
 assert.ok(!dashboardSensorsFor(sensors,'water',[{sensorKey:'liquid_temp',enabled:false}]).some(s=>s.key==='liquid_temp'))
 assert.deepEqual(dashboardSensorsFor([],'water'),[])
})
test('new catalog sensors retain a group',()=>{
 assert.equal(dashboardSensorsFor([{key:'soil_3_moisture'}],'environment').length,1)
})
