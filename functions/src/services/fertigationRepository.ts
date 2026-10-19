import { randomUUID } from 'node:crypto';
import type { FertigationRecipeMutation, FertigationRecipeUpdate } from '@spff/contracts';
import { pool, configuredSiteId } from './postgresRepository.js';
import { fertigationRecipeSchema } from '@spff/contracts';
import type { FertigationRecipe } from '@spff/contracts';

export async function getFertigationRecipe(recipeId: string): Promise<FertigationRecipe | null> {
  const result = await pool.query<{
    recipe_id: string; site_id: string; crop_name: string; hst_from: number; hst_to: number;
    target_water_l: number; target_stock_l: number; fertilizer_name: string | null;
    stock_concentration_g_per_l: number | null; min_water_tank_percent: number;
    min_stock_tank_percent: number; source_reference: string; approval_status: 'draft' | 'approved';
    approval_reference: string | null; approved_by: string | null; approved_at: Date | null;
    planting_date: Date | string | null; application_date: Date | string | null;
    revision: number; updated_at: Date; zone_id: string; crop_id: string | null;
  }>(`
    SELECT recipe_id,site_id,crop_name,hst_from,hst_to,target_water_l,target_stock_l,
           fertilizer_name,stock_concentration_g_per_l,min_water_tank_percent,
           min_stock_tank_percent,source_reference,approval_status,
           approval_reference,approved_by,approved_at,planting_date,application_date,revision,updated_at,zone_id,crop_id
    FROM spff.fertigation_recipes WHERE site_id = $1 AND recipe_id = $2
  `, [configuredSiteId, recipeId]);
  const row = result.rows[0];
  if (!row) return null;
  return fertigationRecipeSchema.parse({
    recipeId: row.recipe_id,
    siteId: row.site_id,
    zoneId: 'soil-1',
    cropId: row.crop_id,
    cropName: row.crop_name,
    hstFrom: row.hst_from,
    hstTo: row.hst_to,
    targetWaterL: row.target_water_l,
    targetStockL: row.target_stock_l,
    fertilizerName: row.fertilizer_name,
    stockConcentrationGPerL: row.stock_concentration_g_per_l,
    minWaterTankPercent: row.min_water_tank_percent,
    minStockTankPercent: row.min_stock_tank_percent,
    sourceReference: row.source_reference,
    approvalStatus: row.approval_status,
    approvalReference: row.approval_reference,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at?.toISOString() ?? null,
    plantingDate: row.planting_date ? new Date(row.planting_date).toISOString().slice(0,10) : null,
    applicationDate: row.application_date ? new Date(row.application_date).toISOString().slice(0,10) : null,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  });
}

export async function getRecentFertigationSessions(deviceId: string) {
  const result = await pool.query(`
    SELECT session_id AS "sessionId", device_id AS "deviceId",
           status,target_water_l AS "targetWaterL",target_stock_l AS "targetStockL",
           actual_water_l AS "actualWaterL",actual_stock_l AS "actualStockL",
           pumps_off AS "pumpsOff", completion_reason AS "completionReason",
           started_at AS "startedAt", finished_at AS "finishedAt",
           last_recorded_at AS "lastRecordedAt"
    FROM spff.fertigation_sessions
    WHERE site_id = $1 AND device_id = $2
    ORDER BY last_recorded_at DESC LIMIT 50
  `, [configuredSiteId, deviceId]);
  return result.rows;
}

export async function listFertigationRecipes() {
  const result = await pool.query<{ recipe_id: string }>(
    'SELECT recipe_id FROM spff.fertigation_recipes WHERE site_id=$1 ORDER BY crop_name,hst_from,recipe_id LIMIT 500',
    [configuredSiteId],
  );
  return Promise.all(result.rows.map(row => getFertigationRecipe(row.recipe_id)));
}
export async function createFertigationRecipe(input: FertigationRecipeMutation, actor: string) {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`
      INSERT INTO spff.fertigation_recipes
      (recipe_id,site_id,crop_name,hst_from,hst_to,target_water_l,target_stock_l,
       fertilizer_name,stock_concentration_g_per_l,min_water_tank_percent,min_stock_tank_percent,
       source_reference,planting_date,application_date,zone_id,crop_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'soil-1',$15) RETURNING *
    `, [id,configuredSiteId,input.cropName,input.hstFrom,input.hstTo,input.targetWaterL,
      input.targetStockL,input.fertilizerName,input.stockConcentrationGPerL,
      input.minWaterTankPercent,input.minStockTankPercent,input.sourceReference,
      input.plantingDate,input.applicationDate,input.cropId]);
    await client.query(
      'INSERT INTO spff.fertigation_recipe_revisions (recipe_id,revision,snapshot,changed_by) VALUES ($1,1,$2,$3)',
      [id,inserted.rows[0],actor],
    );
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return getFertigationRecipe(id);
}
export async function updateFertigationRecipe(recipeId: string, input: FertigationRecipeUpdate, actor: string) {
  const client = await pool.connect();
  let updated = false;
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE spff.fertigation_recipes SET
        crop_name=$4,hst_from=$5,hst_to=$6,target_water_l=$7,target_stock_l=$8,
        fertilizer_name=$9,stock_concentration_g_per_l=$10,min_water_tank_percent=$11,
        min_stock_tank_percent=$12,source_reference=$13,planting_date=$14,application_date=$15,crop_id=$16,
        approval_status='draft',approval_reference=NULL,approved_by=NULL,approved_at=NULL,
        revision=revision+1,updated_at=now()
      WHERE site_id=$1 AND recipe_id=$2 AND revision=$3 RETURNING *
    `, [configuredSiteId,recipeId,input.expectedRevision,input.cropName,input.hstFrom,
      input.hstTo,input.targetWaterL,input.targetStockL,input.fertilizerName,
      input.stockConcentrationGPerL,input.minWaterTankPercent,input.minStockTankPercent,
      input.sourceReference,input.plantingDate,input.applicationDate,input.cropId]);
    updated = result.rowCount === 1;
    if (updated) await client.query(
      'INSERT INTO spff.fertigation_recipe_revisions(recipe_id,revision,snapshot,changed_by) VALUES($1,$2,$3,$4)',
      [recipeId,result.rows[0].revision,result.rows[0],actor],
    );
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return updated ? getFertigationRecipe(recipeId) : null;
}
export async function approveFertigationRecipe(recipeId: string, expectedRevision: number, reference: string, actor: string) {
  const client = await pool.connect();
  let updated = false;
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE spff.fertigation_recipes SET approval_status='approved',
        approval_reference=$4,approved_by=$5,approved_at=now(),
        revision=revision+1,updated_at=now()
      WHERE site_id=$1 AND recipe_id=$2 AND revision=$3 RETURNING *
    `, [configuredSiteId,recipeId,expectedRevision,reference,actor]);
    updated = result.rowCount === 1;
    if (updated) await client.query(
      'INSERT INTO spff.fertigation_recipe_revisions(recipe_id,revision,snapshot,changed_by) VALUES($1,$2,$3,$4)',
      [recipeId,result.rows[0].revision,result.rows[0],actor],
    );
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return updated ? getFertigationRecipe(recipeId) : null;
}
export interface SiteEvaluationSnapshot {
  telemetryRecordedAt: Date | null;
  deviceRecordedAt: Date | null;
  deviceOnline: boolean | null;
  deviceMode: 'manual' | 'automatic' | null;
  automaticMode: 'manual' | 'automatic' | null;
  actualWaterLpm: number | null;
  actualStockLpm: number | null;
  waterTankPercent: number | null;
  stockTankPercent: number | null;
  flowWaterValid: boolean;
  flowStockValid: boolean;
  waterTankValid: boolean;
  stockTankValid: boolean;
  activeCropId: string | null;
  moistureSensorKey: 'soil_1_moisture' | 'soil_2_moisture' | null;
  moisture: number | null;
  moistureValid: boolean;
  moistureLowPercent: number | null;
  moistureTargetPercent: number | null;
  liquidEcUsCm: number | null;
  liquidEcValid: boolean;
  ecLowUsCm: number | null;
  ecHighUsCm: number | null;
  appliedMode: string | null;
  configRevision: number | null;
  acknowledgedRevision: number | null;
  acknowledgementStatus: string | null;
}
export async function loadSiteFertigationSnapshot(deviceId: string): Promise<SiteEvaluationSnapshot> {
  const result = await pool.query<{
    telemetry_recorded_at: Date | null; device_recorded_at: Date | null;
    online: boolean | null; mode: string | null; desired_mode: string | null;
    flow_water_lpm: number | null; flow_fert_lpm: number | null;
    tank_water_level_pct: number | null; tank_fert_level_pct: number | null;
    sensor_health: Record<string,{valid?: boolean}> | null;
    crop_id: string | null; water_sensor_key: string | null;
    soil_1_moisture: number | null; soil_2_moisture: number | null;
    liquid_ec_us_cm: number | null;
    water_moisture_low_pct: number | null; water_moisture_target_pct: number | null;
    fertilizer_ec_low_us_cm: number | null; fertilizer_ec_high_us_cm: number | null;
    applied_mode: string | null; revision: number | null;
    acknowledged_revision: number | null; acknowledgement_status: string | null;
  }>(`
    SELECT t.recorded_at AS telemetry_recorded_at,
      s.recorded_at AS device_recorded_at,s.online,s.mode,c.desired_mode,
      c.water_sensor_key,c.water_moisture_low_pct,c.water_moisture_target_pct,
      c.fertilizer_ec_low_us_cm,c.fertilizer_ec_high_us_cm,
      c.applied_mode,c.revision,c.acknowledged_revision,c.acknowledgement_status,sc.crop_id,
      t.flow_water_lpm,t.flow_fert_lpm,t.tank_water_level_pct,t.tank_fert_level_pct,t.sensor_health,
      t.soil_1_moisture,t.soil_2_moisture,t.liquid_ec_us_cm
    FROM spff.devices d
    LEFT JOIN LATERAL (
      SELECT recorded_at,flow_water_lpm,flow_fert_lpm,tank_water_level_pct,tank_fert_level_pct,sensor_health,
             soil_1_moisture,soil_2_moisture,liquid_ec_us_cm
      FROM spff.telemetry_samples
      WHERE site_id=d.site_id AND device_id=d.device_id
      ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT recorded_at,online,mode FROM spff.device_status_events
      WHERE site_id=d.site_id AND device_id=d.device_id
      ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1
    ) s ON true
    LEFT JOIN spff.device_automatic_control_configs c
      ON c.site_id=d.site_id AND c.device_id=d.device_id
    LEFT JOIN spff.site_crop_selections sc ON sc.site_id=d.site_id AND sc.zone_id='soil-1'
    WHERE d.site_id=$1 AND d.device_id=$2 AND d.enabled=true
  `,[configuredSiteId,deviceId]);
  const r=result.rows[0];
  if(!r) throw new Error('Perangkat tidak ditemukan atau tidak aktif.');
  const valid=(name:string,value:number|null)=>value!==null && r.sensor_health?.[name]?.valid!==false;
  const moistureKey=r.water_sensor_key==='soil_1_moisture'||r.water_sensor_key==='soil_2_moisture'?r.water_sensor_key:null;
  const moisture=moistureKey==='soil_1_moisture'?r.soil_1_moisture:moistureKey==='soil_2_moisture'?r.soil_2_moisture:null;
  return {
    activeCropId:r.crop_id,
    moistureSensorKey:moistureKey,moisture,moistureValid:moistureKey!==null && valid(moistureKey,moisture),
    moistureLowPercent:r.water_moisture_low_pct,moistureTargetPercent:r.water_moisture_target_pct,
    liquidEcUsCm:r.liquid_ec_us_cm,liquidEcValid:valid('liquid_ec_us_cm',r.liquid_ec_us_cm),
    ecLowUsCm:r.fertilizer_ec_low_us_cm,ecHighUsCm:r.fertilizer_ec_high_us_cm,
    appliedMode:r.applied_mode,configRevision:r.revision,acknowledgedRevision:r.acknowledged_revision,
    acknowledgementStatus:r.acknowledgement_status,
    telemetryRecordedAt:r.telemetry_recorded_at,deviceRecordedAt:r.device_recorded_at,
    deviceOnline:r.online,deviceMode:r.mode==='automatic'?'automatic':r.mode==='manual'?'manual':null,
    automaticMode:r.desired_mode==='automatic'?'automatic':r.desired_mode==='manual'?'manual':null,
    actualWaterLpm:r.flow_water_lpm,actualStockLpm:r.flow_fert_lpm,
    waterTankPercent:r.tank_water_level_pct,stockTankPercent:r.tank_fert_level_pct,
    flowWaterValid:valid('flow_water_lpm',r.flow_water_lpm),
    flowStockValid:valid('flow_fert_lpm',r.flow_fert_lpm),
    waterTankValid:valid('tank_water_level_pct',r.tank_water_level_pct),
    stockTankValid:valid('tank_fert_level_pct',r.tank_fert_level_pct),
  };
}
export async function recordFertigationEvaluation(recipeId:string,deviceId:string,actor:string,
  telemetryAt:Date|null,deviceAt:Date|null,decision:unknown) {
  await pool.query(`
    INSERT INTO spff.fertigation_evaluations
    (site_id,device_id,recipe_id,telemetry_recorded_at,device_recorded_at,decision,requested_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)
  `,[configuredSiteId,deviceId,recipeId,telemetryAt,deviceAt,JSON.stringify(decision),actor]);
}
