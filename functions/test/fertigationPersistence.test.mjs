import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../lib/services/postgresRepository.js';
import { createFertigationRecipe, updateFertigationRecipe } from '../lib/services/fertigationRepository.js';
import { fertigationRecipeMutationSchema } from '@spff/contracts';

test('save records draft or explicit admin use atomically with recipe revision', async () => {
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
      row={...stored,revision:1,updated_at:new Date()};
      return {rows:[row],rowCount:1};
    }
    if(sql.includes('UPDATE spff.fertigation_recipes SET')) {
      assert.match(sql,/application_mode=\$22,application_interval_days=\$23/);
      assert.equal(values[21],'interval');assert.equal(values[22],1);
      assert.match(sql,/trigger_sample_count=\$24/);assert.equal(values[23],3);
      if(values[2]!==row.revision) return {rows:[],rowCount:0};
      assert.match(sql,/approval_status=\$25,approval_reference=\$26,approved_by=\$27,approved_at=\$28/);
      assert.match(sql,/source_reference=COALESCE\(NULLIF\(\$13,''\),source_reference\)/);
      row={...row,application_interval_days:1,revision:row.revision+1,
        approval_status:values[24],approval_reference:values[25],approved_by:values[26],approved_at:values[27]};
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
    const activeInput=fertigationRecipeMutationSchema.parse({...input,useForEvaluation:true,
      moistureLowPercent:20,moistureTargetPercent:50});
    const activated=await createFertigationRecipe(activeInput,'admin-real');
    assert.equal(activated.approvalStatus,'approved');
    assert.equal(activated.approvedBy,'admin-real');
    assert.equal(activated.approvalReference,'Konfigurasi admin untuk evaluasi Rule-Based');
    assert.ok(activated.approvedAt);
    const updated=await updateFertigationRecipe(activated.recipeId,{...activeInput,expectedRevision:1,applicationIntervalDays:1},'admin-editor');
    assert.equal(updated.approvalStatus,'approved');assert.equal(updated.approvedBy,'admin-editor');
    assert.equal(updated.revision,2);
    assert.equal(await updateFertigationRecipe(updated.recipeId,{...activeInput,expectedRevision:1,applicationIntervalDays:1},'admin-editor'),null);
  } finally {pool.connect=originalConnect;pool.query=originalQuery;await pool.end();}
});
