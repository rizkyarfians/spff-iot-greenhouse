import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardSensorsFor} from '../src/dashboardSensors.ts'
const keys=['soil_1_moisture','soil_1_ec_us_cm','soil_1_temp','soil_1_ph','soil_1_n','soil_1_p','soil_1_k','soil_2_moisture','soil_2_temp','soil_2_ec_us_cm','soil_2_ph','soil_2_n','soil_2_p','soil_2_k','liquid_temp','liquid_ph','liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm','flow_water_total_l','flow_fert_total_l','air_temp','air_humidity','battery_voltage','ac_power_w']
const sensors=keys.map(key=>({key,value:null}))
test('greenhouse overview includes every enabled non-energy parameter, without an eight-card cap',()=>{
 const rows=dashboardSensorsFor(sensors,'greenhouse')
 assert.equal(rows.length,25)
 for(const key of ['soil_1_temp','soil_1_ph','soil_1_n','soil_2_k','liquid_temp','flow_water_total_l','air_temp'])assert.ok(rows.some(r=>r.key===key))
 assert.equal(rows[0].key,'soil_1_moisture')
 assert.ok(rows.every(r=>r.value===null))
})
test('group filters include the right channels, honor disabled sensors, and handle empty groups',()=>{
 assert.equal(dashboardSensorsFor(sensors,'soil1').length,7)
 assert.equal(dashboardSensorsFor(sensors,'soil2').length,7)
 assert.equal(dashboardSensorsFor(sensors,'flow').length,4)
 assert.equal(dashboardSensorsFor(sensors,'air').length,2)
 assert.equal(dashboardSensorsFor(sensors,'energy').length,2)
 assert.ok(!dashboardSensorsFor(sensors,'greenhouse',[{sensorKey:'soil_1_temp',enabled:false}]).some(r=>r.key==='soil_1_temp'))
 assert.deepEqual(dashboardSensorsFor([],'solution'),[])
})
test('new catalog sensors are not silently hidden from the greenhouse summary',()=>{
 assert.equal(dashboardSensorsFor([{key:'soil_3_moisture'}],'greenhouse').length,1)
})
