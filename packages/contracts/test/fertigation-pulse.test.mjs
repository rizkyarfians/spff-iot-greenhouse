import test from 'node:test';
import assert from 'node:assert/strict';
import { soilEcPulseProfileSchema, soilEcPulseDuration, decideSoilEcPulse,
  fertigationPulseSchema, fertigationPulseAckSchema } from '../dist/index.js';
const p={calibrationReference:'TEST ONLY synthetic calibration',soilEcTargetsVerified:true,hydraulicsVerified:true,
 kpMsPerUsCm:10,minOnMs:1500,maxOnMs:10000,settleMs:60000,maxSessionMs:3600000,maxTotalOnMs:30000,
 maxDailyOnMs:60000,maxCycles:10,stableSamples:3,stableSpreadUsCm:20,toleranceUsCm:25,
 minimumRiseUsCm:10,maxNoResponseCycles:2,moistureMinPercent:30,moistureMaxPercent:60,cooldownMs:60000,
 waterWithPulse:false,flowSensorKey:'flow_fert_lpm',minFlowLpm:1};
const now=Date.parse('2026-10-21T04:10:00Z');
const samples=(values)=>values.map((ec,i)=>({recordedAt:new Date(now-i*30000).toISOString(),ec,moisture:40,valid:true}));
const evaluate=(overrides={})=>decideSoilEcPulse({nowMs:now,afterMs:now-100000,samples:samples([400,400,400]),
 target:1200,high:1500,startLow:500,cycles:0,totalOnMs:0,dailyOnMs:0,previousEc:null,noResponseCycles:0,profile:p,...overrides});
test('all calibration fields required and incompatible limits rejected',()=>{
 assert.equal(soilEcPulseProfileSchema.safeParse(p).success,true);
 assert.equal(soilEcPulseProfileSchema.safeParse({}).success,false);
 assert.equal(soilEcPulseProfileSchema.safeParse({...p,minOnMs:1000}).success,false);
 assert.equal(soilEcPulseProfileSchema.safeParse({...p,minOnMs:11000}).success,false);
 assert.equal(soilEcPulseProfileSchema.safeParse({...p,soilEcTargetsVerified:false}).success,false);
});
test('error determines bounded ON duration, no EC-to-volume assumption',()=>{
 assert.equal(soilEcPulseDuration(800,p),8000);
 assert.equal(soilEcPulseDuration(400,p),4000);
 assert.equal(soilEcPulseDuration(100,p),1500);
 assert.equal(soilEcPulseDuration(2000,p),10000);
 assert.equal(soilEcPulseDuration(25,p),0);
 assert.equal(evaluate().onMs,8000);
});
test('complete only when every new stable sample lies in target tolerance',()=>{
 assert.equal(evaluate({samples:samples([1200,1190,1210])}).action,'complete');
 assert.equal(evaluate({samples:samples([1170,1180,1180]),cycles:1}).action,'wait');
 assert.equal(evaluate({samples:samples([1200,1200,1200]),afterMs:now-1000}).action,'wait');
});
test('refresh or duplicate timestamps cannot confirm a target',()=>{
 assert.equal(evaluate({samples:Array(3).fill(samples([1200])[0])}).action,'wait');
});
test('wait the full settling interval and ignore samples from during settling',()=>{
 assert.equal(evaluate({afterMs:now+10000}).reason,'settling');
 assert.equal(evaluate({afterMs:now-1000}).reason,'waiting_new_samples');
});
test('unhealthy/stale/future/NaN soil input fails closed',()=>{
 for(const replacement of [
  {...samples([400])[0],valid:false}, {...samples([400])[0],ec:NaN},
  {...samples([400])[0],recordedAt:new Date(now+1).toISOString()},
  {...samples([400])[0],recordedAt:new Date(now-121000).toISOString()},
 ])assert.equal(evaluate({samples:[replacement]}).action,'fault');
});
test('moisture out of calibration range blocks EC chasing',()=>{
 assert.equal(evaluate({samples:samples([400,400,400]).map(s=>({...s,moisture:70}))}).reason,'moisture_outside_calibrated_range');
});
test('overshoot, high EC and response reversal stop rather than add fertilizer',()=>{
 assert.equal(evaluate({samples:samples([1300,1300,1300]),cycles:1}).reason,'soil_ec_overshoot');
 assert.equal(evaluate({samples:samples([1500,1500,1500])}).reason,'soil_ec_high');
 assert.equal(evaluate({cycles:1,previousEc:800}).reason,'unexpected_soil_ec_decrease');
});
test('unresponsive soil hits attempt limit',()=>{
 assert.equal(evaluate({cycles:2,previousEc:400,noResponseCycles:1}).reason,'soil_ec_no_response');
});
test('per-session, daily and cycle budgets reserve before publication',()=>{
 for(const override of [{cycles:10},{totalOnMs:25000},{dailyOnMs:55000}])
  assert.equal(evaluate(override).reason,'pulse_budget_limit');
});
test('unstable samples and already-above-start reading do not trigger a pulse',()=>{
 assert.equal(evaluate({samples:samples([400,450,400])}).reason,'soil_ec_unstable');
 assert.equal(evaluate({samples:samples([800,800,800])}).reason,'soil_ec_above_start_threshold');
});
test('payload rejects unbounded duration/expiry and completed ACK requires OFF',()=>{
 const identity={schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'00000000-0000-4000-8000-000000000001',
 commandId:'00000000-0000-4000-8000-000000000002',cycle:1};
 const command={...identity,bootId:'0123456789abcdef',kind:'fertigation_pulse',issuedAt:'2026-10-21T04:00:00Z',expiresAt:'2026-10-21T04:00:15Z',
 targetId:'pump_fert',params:{onDurationMs:3000,waterWithPulse:false,minFlowLpm:1,flowSensorKey:'flow_fert_lpm'}};
 assert.equal(fertigationPulseSchema.safeParse(command).success,true);
 assert.equal(fertigationPulseSchema.safeParse({...command,params:{...command.params,onDurationMs:30001}}).success,false);
 assert.equal(fertigationPulseSchema.safeParse({...command,expiresAt:'2026-10-21T04:01:00Z'}).success,false);
 const ack={...identity,kind:'fertigation_pulse_ack',acknowledgedAt:'2026-10-21T04:00:03Z',status:'completed',pumpsOff:false,reason:'test'};
 assert.equal(fertigationPulseAckSchema.safeParse(ack).success,false);
 assert.equal(fertigationPulseAckSchema.safeParse({...ack,pumpsOff:true}).success,true);
});
