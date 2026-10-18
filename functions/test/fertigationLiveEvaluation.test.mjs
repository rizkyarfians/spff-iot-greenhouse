import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSiteFertigation } from '../lib/services/fertigationLiveEvaluation.js';

const now=new Date('2026-10-18T10:00:00.000Z');
const recipe={
 recipeId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',siteId:'greenhouse-01',
 cropName:'Ubi Jalar',hstFrom:10,hstTo:50,targetWaterL:10,targetStockL:0,
 fertilizerName:null,stockConcentrationGPerL:null,minWaterTankPercent:15,minStockTankPercent:15,
 sourceReference:'Protokol disetujui',approvalStatus:'approved',approvalReference:'AGR-1',
 approvedBy:'admin',approvedAt:now.toISOString(),plantingDate:'2026-09-18',
 applicationDate:'2026-10-18',revision:2,updatedAt:now.toISOString(),
};
const snapshot={
 telemetryRecordedAt:new Date('2026-10-18T09:59:55Z'),
 deviceRecordedAt:new Date('2026-10-18T09:59:55Z'),
 deviceOnline:true,deviceMode:'automatic',automaticMode:'automatic',
 actualWaterLpm:0,actualStockLpm:0,waterTankPercent:70,stockTankPercent:50,
 flowWaterValid:true,flowStockValid:true,waterTankValid:true,stockTankValid:true,
};
test('site evaluation is an advisory, never publishes command',()=>{
 const d=evaluateSiteFertigation(recipe,'esp32-s3-01',snapshot,now);
 assert.equal(d.decision.status,'suggested');
 assert.equal(d.decision.action,'IRRIGATE');
 assert.equal(d.decision.publishable,false);
});
test('stale and offline readings fail closed',()=>{
 const stale=evaluateSiteFertigation(recipe,'esp32-s3-01',{...snapshot,telemetryRecordedAt:new Date('2026-10-18T09:30:00Z')},now);
 assert.equal(stale.decision.action,'DELAY');
 const offline=evaluateSiteFertigation(recipe,'esp32-s3-01',{...snapshot,deviceOnline:false},now);
 assert.equal(offline.decision.status,'hold');
});
test('recipe draft or date mismatch cannot suggest a dose',()=>{
 assert.equal(evaluateSiteFertigation({...recipe,approvalStatus:'draft'},'esp32-s3-01',snapshot,now).decision.action,'DELAY');
 assert.equal(evaluateSiteFertigation({...recipe,applicationDate:null},'esp32-s3-01',snapshot,now).decision.status,'hold');
});
test('flow of zero is healthy while idle when measurement is valid',()=>{
 assert.equal(evaluateSiteFertigation(recipe,'esp32-s3-01',snapshot,now).decision.status,'suggested');
});
