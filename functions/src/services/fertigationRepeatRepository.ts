import { pool, configuredSiteId } from './postgresRepository.js';
import { isVerifiedFertigationReading } from './fertigationSensorHealth.js';
import type { FertigationRecipe } from '@spff/contracts';
import type { FertigationRepeatEvidence, FertigationSessionEvidence } from './fertigationRepeatGuard.js';

/** Read-only session evidence: only device-origin session records count. */
export async function loadRepeatEvidence(
  recipe: FertigationRecipe,
  deviceId: string,
  now = new Date(),
): Promise<FertigationRepeatEvidence> {
  const rows = await pool.query<{
    recipe_id: string | null; status: FertigationSessionEvidence['status'];
    started_at: Date | null; finished_at: Date | null; last_recorded_at: Date;
    target_stock_l: number; actual_water_l: number | null; actual_stock_l: number | null;
    pumps_off: boolean;
  }>(`SELECT recipe_id,status,started_at,finished_at,last_recorded_at,target_stock_l,
            actual_water_l,actual_stock_l,pumps_off
        FROM spff.fertigation_sessions
        WHERE site_id=$1 AND device_id=$2
          AND (status IN ('started','running','fault','aborted')
            OR recipe_id=$3 OR (target_stock_l > 0 AND status='completed' AND
               last_recorded_at >= ($4::timestamptz - INTERVAL '1 day')))
        ORDER BY last_recorded_at DESC`,
    [configuredSiteId, deviceId, recipe.recipeId, now]);
  const sessions: FertigationSessionEvidence[] = rows.rows.map(row => ({
    recipeId: row.recipe_id, status: row.status, startedAt: row.started_at,
    finishedAt: row.finished_at, lastRecordedAt: row.last_recorded_at,
    targetStockL: row.target_stock_l,
    completionProven: row.pumps_off === true &&
      row.actual_water_l !== null && row.actual_stock_l !== null &&
      row.finished_at !== null,
  }));
  const latestFinished = sessions
    .filter(session => session.recipeId === recipe.recipeId && session.status === 'completed' && session.finishedAt)
    .sort((a,b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0]?.finishedAt;
  if (recipe.applicationMode !== 'sensor' || !latestFinished || recipe.moistureTargetPercent === null) {
    return { sessions, recoveredAt: null };
  }
  // The selected soil sensor follows the device's configured sensor key.
  const config = await pool.query<{water_sensor_key:string | null}>(`
    SELECT water_sensor_key FROM spff.device_automatic_control_configs
    WHERE site_id=$1 AND device_id=$2
  `, [configuredSiteId,deviceId]);
  const key = config.rows[0]?.water_sensor_key;
  if (key !== 'soil_1_moisture' && key !== 'soil_2_moisture') return { sessions, recoveredAt:null };
  const history = await pool.query<{
    recorded_at: Date; soil_1_moisture: number | null; soil_2_moisture: number | null;
    sensor_health: Record<string,{valid?:boolean}> | null;
  }>(`SELECT recorded_at,soil_1_moisture,soil_2_moisture,sensor_health
      FROM spff.telemetry_samples
      WHERE site_id=$1 AND device_id=$2 AND recorded_at > $3 AND recorded_at <= $4
      ORDER BY recorded_at DESC, telemetry_id DESC LIMIT 1000`,
    [configuredSiteId,deviceId,latestFinished,now]);
  const recovered = history.rows.find(sample => {
    const moisture = key === 'soil_1_moisture' ? sample.soil_1_moisture : sample.soil_2_moisture;
    return isVerifiedFertigationReading(key, moisture, sample.sensor_health) &&
      moisture !== null && moisture >= recipe.moistureTargetPercent!;
  });
  return { sessions, recoveredAt: recovered?.recorded_at ?? null };
}
