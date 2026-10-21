import test from 'node:test';
import assert from 'node:assert/strict';
import {waterInterlockSyncSchema,waterInterlockAckSchema,waterInterlockUpdateSchema} from '../dist/index.js';
const sync={kind:'water_interlock_sync',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',revision:2,enabled:false};
test('interlock requires an explicit boolean and a bounded monotonic revision',()=>{
  assert.equal(waterInterlockSyncSchema.safeParse(sync).success,true);
  for(const changed of [{enabled:'false'},{enabled:undefined},{revision:0},{revision:2147483648},{siteId:'bad/id'},{targetId:'pump_fert'}])
    assert.equal(waterInterlockSyncSchema.safeParse({...sync,...changed}).success,false);
  assert.equal(waterInterlockUpdateSchema.safeParse({deviceId:sync.deviceId,expectedRevision:1,enabled:false}).success,true);
  assert.equal(waterInterlockUpdateSchema.safeParse({deviceId:sync.deviceId,enabled:false}).success,false);
});
test('applied ACK must confirm the requested revision, rejected ACK reports actual config',()=>{
  const ack={...sync,kind:'water_interlock_ack',status:'applied',appliedRevision:2,
    acknowledgedAt:'2026-10-21T06:00:00Z',reason:'applied'};
  assert.equal(waterInterlockAckSchema.safeParse(ack).success,true);
  assert.equal(waterInterlockAckSchema.safeParse({...ack,appliedRevision:1}).success,false);
  assert.equal(waterInterlockAckSchema.safeParse({...ack,status:'rejected',appliedRevision:1,enabled:true}).success,true);
});
