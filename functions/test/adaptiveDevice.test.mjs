import test from 'node:test'
import assert from 'node:assert/strict'
import {pool} from '../lib/services/postgresRepository.js'
import {readAdaptiveDevice} from '../lib/services/adaptiveDeviceService.js'

test('existing device panel recognizes 1.5.03 and preserves sensor diagnostics',async()=>{
 const original=pool.query,at=new Date()
 pool.query=async sql=>{
  if(sql.includes('adaptive_fert_events'))return {rows:[{payload:{timestamp:at.toISOString(),ecValid:true,flowValid:true,waterPumpKnown:true,fertPumpKnown:true},received_at:at}]}
  if(sql.includes('device_status_events'))return {rows:[{raw_payload:{firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC'},recorded_at:at}]}
  if(sql.includes('telemetry_samples'))return {rows:[{raw_payload:{sensors:{air_temp:29},sensorHealth:{air_temp:{valid:true,rawAgeMs:100,lastPollResult:'ok'}}},recorded_at:at}]}
  return {rows:[{desired_mode:'manual',water_enabled:false,fertilizer_enabled:false}]}
 }
 try{
  const result=await readAdaptiveDevice('esp32-s3-01')
  assert.equal(result.firmware,'1.5.03-SHT20-TELEMETRY-SYNC');assert.equal(result.live,true)
  assert.deepEqual(result.blockers,[]);assert.equal(result.sensors[0].value,29)
  assert.equal(result.sensors[0].valid,true);assert.equal(result.sensors[0].poll,'ok')
 }finally{pool.query=original}
})

test('old firmware and missing live telemetry remain visible as panel blockers',async()=>{
 const original=pool.query
 pool.query=async sql=>({rows:sql.includes('device_status_events')?[{raw_payload:{firmwareVersion:'1.5.01-ADAPTIVE-FERTIGATION'},recorded_at:new Date()}]:sql.includes('device_automatic_control_configs')?[{desired_mode:'manual',water_enabled:false,fertilizer_enabled:false}]:[]})
 try{
  const result=await readAdaptiveDevice('esp32-s3-01')
  assert.equal(result.live,false)
  assert.ok(result.blockers.includes('Firmware 1.5.03 belum terkonfirmasi.'))
  assert.equal(result.sensors.length,0)
 }finally{pool.query=original}
})
