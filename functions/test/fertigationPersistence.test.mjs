import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../lib/services/postgresRepository.js';
import { createFertigationRecipe, updateFertigationRecipe } from '../lib/services/fertigationRepository.js';
import { fertigationRecipeMutationSchema } from '@spff/contracts';

test('create and edit persist recurring schedules alongside dosage and revision reset', async () => {
  const input=fertigationRecipeMutationSchema.parse({cropId:'sweet-potato',cropName:'Ubi Jalar',
    hstFrom:1,hstTo:35,targetWaterL:1,targetStockL:0,fertilizerName:null,stockConcentrationGPerL:null,
    minWaterTankPercent:20,minStockTankPercent:20,sourceReference:'Test fixture only',
    plantingDate:'2026-10-18',applicationDate:null,applicationMode:'interval',applicationIntervalDays:7});
  const originalConnect=pool.connect,originalQuery=pool.query;
  let row;
  const client={release(){},async query(sql,values){
    if(sql.includes('INSERT INTO spff.fertigation_recipes')) {
      const columns=sql.match(/\(([^)]+)\)\s+VALUES/)[1].split(',').map(s=>s.trim());
      const expressions=sql.match(/VALUES \(([^)]+)\)/)[1].split(',');
      assert.equal(columns.length,expressions.length);
      const stored=Object.fromEntries(columns.map((column,i)=>[column,expressions[i].startsWith('$')?values[Number(expressions[i].slice(1))-1]:'soil-1']));
      assert.equal(stored.application_mode,'interval');assert.equal(stored.application_interval_days,7);
      assert.equal(stored.trigger_sample_count,3);
      row={...stored,revision:1,approval_status:'draft',approval_reference:null,approved_by:null,approved_at:null,updated_at:new Date()};
      return {rows:[row],rowCount:1};
    }
    if(sql.includes('UPDATE spff.fertigation_recipes SET')) {
      assert.match(sql,/application_mode=\$22,application_interval_days=\$23/);
      assert.equal(values[21],'interval');assert.equal(values[22],1);
      assert.match(sql,/trigger_sample_count=\$24/);assert.equal(values[23],3);
      assert.match(sql,/approval_status='draft'/);
      row={...row,application_interval_days:1,revision:2};
      return {rows:[row],rowCount:1};
    }
    return {rows:[],rowCount:0};
  }};
  try {
    pool.connect=async()=>client;pool.query=async()=>({rows:[row]});
    const created=await createFertigationRecipe(input,'test');
    assert.equal(created.applicationIntervalDays,7);
    const edited=await updateFertigationRecipe(created.recipeId,{...input,expectedRevision:1,applicationIntervalDays:1},'test');
    assert.equal(edited.applicationIntervalDays,1);assert.equal(edited.approvalStatus,'draft');
  } finally {pool.connect=originalConnect;pool.query=originalQuery;await pool.end();}
});
