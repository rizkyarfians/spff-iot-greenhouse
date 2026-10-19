import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../lib/services/postgresRepository.js';
import { getFertigationRecipe } from '../lib/services/fertigationRepository.js';

test('repository preserves SQL calendar dates in UTC and Jakarta, including null dates', async () => {
  const originalQuery=pool.query;
  const originalTz=process.env.TZ;
  const row={
    recipe_id:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',site_id:'greenhouse-01',
    crop_name:'Ubi Jalar',crop_id:'sweet-potato',zone_id:'soil-1',hst_from:1,hst_to:30,
    target_water_l:1,target_stock_l:0,fertilizer_name:null,stock_concentration_g_per_l:null,
    min_water_tank_percent:10,min_stock_tank_percent:10,source_reference:'Test fixture only',
    approval_status:'draft',approval_reference:null,approved_by:null,approved_at:null,
    planting_date:'2026-10-01',application_date:'2026-10-19',revision:1,updated_at:new Date(),
    moisture_low_percent:null,moisture_target_percent:null,
    ec_low_us_cm:null,ec_target_us_cm:null,ec_high_us_cm:null,
  };
  try {
    pool.query=async sql=>{
      assert.match(sql,/to_char\(planting_date, 'YYYY-MM-DD'\) AS planting_date/);
      assert.match(sql,/to_char\(application_date, 'YYYY-MM-DD'\) AS application_date/);
      return {rows:[row]};
    };
    for (const tz of ['UTC','Asia/Jakarta','America/Los_Angeles']) {
      process.env.TZ=tz;
      const recipe=await getFertigationRecipe(row.recipe_id);
      assert.equal(recipe.plantingDate,'2026-10-01');
      assert.equal(recipe.applicationDate,'2026-10-19');
    }
    row.planting_date=null; row.application_date=null;
    const recipe=await getFertigationRecipe(row.recipe_id);
    assert.equal(recipe.plantingDate,null);
    assert.equal(recipe.applicationDate,null);
  } finally {
    pool.query=originalQuery;
    if(originalTz===undefined) delete process.env.TZ; else process.env.TZ=originalTz;
    await pool.end();
  }
});
