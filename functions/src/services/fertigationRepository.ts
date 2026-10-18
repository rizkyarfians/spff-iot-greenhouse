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
  }>(`
    SELECT recipe_id,site_id,crop_name,hst_from,hst_to,target_water_l,target_stock_l,
           fertilizer_name,stock_concentration_g_per_l,min_water_tank_percent,
           min_stock_tank_percent,source_reference,approval_status,
           approval_reference,approved_by,approved_at
    FROM spff.fertigation_recipes WHERE site_id = $1 AND recipe_id = $2
  `, [configuredSiteId, recipeId]);
  const row = result.rows[0];
  if (!row) return null;
  return fertigationRecipeSchema.parse({
    recipeId: row.recipe_id,
    siteId: row.site_id,
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
