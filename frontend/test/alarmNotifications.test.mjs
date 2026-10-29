import test from 'node:test'
import assert from 'node:assert/strict'
import {alarmNotification,notificationBadgeText} from '../src/alarmNotifications.ts'
const alarm={id:'1',deviceId:'esp32-s3-01',ruleKey:'command_failed',sourceKey:'pump_water',title:'Command aktuator gagal',description:'Gagal',createdAt:'2026-10-27T01:00:00Z',triggeredAt:'2026-10-27T01:00:00Z',lastSeenAt:'2026-10-27T01:00:00Z',metadata:{commandId:'a',requestedIsActive:true,reason:'water_tank_interlock'}}
test('bell explains a rejected start without calling an interlocked pump broken',()=>{
 const n=alarmNotification(alarm)
 assert.equal(n.title,'Pompa air gagal menyala');assert.match(n.description,/Proteksi tandon air/)
 assert.match(n.description,/esp32-s3-01/)
 assert.notEqual(n.id,alarmNotification({...alarm,metadata:{...alarm.metadata,commandId:'b'}}).id)
 assert.equal(n.id,alarmNotification({...alarm,lastSeenAt:'2026-10-27T01:00:30Z'}).id)
})
test('failed OFF or unknown command direction never claims failure to turn ON',()=>{
 assert.doesNotMatch(alarmNotification({...alarm,metadata:{requestedIsActive:false}}).title,/gagal menyala/)
 assert.doesNotMatch(alarmNotification({...alarm,metadata:null}).title,/gagal menyala/)
})
test('AI and scheduled failures describe missing confirmation, not a physical diagnosis',()=>{
 const ai=alarmNotification({...alarm,sourceKey:'pump_fert',metadata:{source:'soil-ec',reason:'pulse_outcome_unknown',sessionId:'session'}})
 assert.match(ai.title,/AI tertahan/);assert.match(ai.description,/belum dapat dipastikan/)
 const scheduled=alarmNotification({...alarm,metadata:{source:'schedule',reason:'schedule_start_unconfirmed'}})
 assert.match(scheduled.title,/belum ada konfirmasi ON/);assert.match(scheduled.description,/30 detik/)
 assert.notEqual(ai.id,alarmNotification({...alarm,sourceKey:'pump_fert',metadata:{source:'soil-ec',reason:'calibration_missing'}}).id)
})
test('unrelated alarms keep their title and badge count caps at 99+',()=>{
 assert.equal(alarmNotification({...alarm,ruleKey:'device_offline',sourceKey:'device'}).title,alarm.title)
 for(const [n,label]of [[0,'0'],[1,'1'],[99,'99'],[100,'99+'],[1000,'99+']])assert.equal(notificationBadgeText(n),label)
})
