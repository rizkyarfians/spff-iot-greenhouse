import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardSensorsFor} from '../src/dashboardSensors.ts'
const keys=['soil_1_moisture','soil_1_ec_us_cm','soil_1_temp','soil_1_ph','soil_1_n','soil_1_p','soil_1_k','soil_2_moisture','soil_2_temp','soil_2_ec_us_cm','soil_2_ph','soil_2_n','soil_2_p','soil_2_k','liquid_temp','liquid_ph','liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm','flow_water_total_l','flow_fert_total_l','air_temp','air_humidity','battery_voltage','ac_power_w']
const sensors=keys.map(key=>({key,value:null}))
test('four groups cover all enabled sensors once without an all-sensors view',()=>{
 const rows=['soil1','soil2','environment','energy'].flatMap(group=>dashboardSensorsFor(sensors,group))
 assert.equal(rows.length,sensors.length)
 assert.equal(new Set(rows.map(r=>r.key)).size,sensors.length)
 assert.ok(rows.every(r=>r.value===null))
})
test('soil, environment and energy groups include their parameters and honor disabled sensors',()=>{
 assert.equal(dashboardSensorsFor(sensors,'soil1').length,7)
 assert.equal(dashboardSensorsFor(sensors,'soil2').length,7)
 assert.equal(dashboardSensorsFor(sensors,'environment').length,11)
 assert.equal(dashboardSensorsFor(sensors,'energy').length,2)
 for(const key of ['liquid_temp','tank_water_level_pct','flow_water_total_l','air_temp'])assert.ok(dashboardSensorsFor(sensors,'environment').some(r=>r.key===key))
 assert.ok(!dashboardSensorsFor(sensors,'soil1',[{sensorKey:'soil_1_temp',enabled:false}]).some(r=>r.key==='soil_1_temp'))
 assert.deepEqual(dashboardSensorsFor([],'environment'),[])
})
test('new catalog sensors have a group instead of being silently hidden',()=>{
 assert.equal(dashboardSensorsFor([{key:'soil_3_moisture'}],'environment').length,1)
})
