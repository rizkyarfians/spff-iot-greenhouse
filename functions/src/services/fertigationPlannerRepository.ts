import { fertigationPlannerMutationSchema, fertigationPlannerProfileSchema, type FertigationRecipe } from '@spff/contracts';
import { pool, configuredSiteId } from './postgresRepository.js';
import { getFertigationRecipe, loadSiteFertigationSnapshot } from './fertigationRepository.js';
import { loadRepeatEvidence } from './fertigationRepeatRepository.js';
import { evaluateAutomaticRuleBased } from './automaticRuleBased.js';
import { listFertigationRecipes } from './fertigationRepository.js';
import { planAdaptiveFertigation, type PlannerEvidence } from './fertigationPlanner.js';

function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export async function plannerStorageReady() {
  const result = await pool.query("SELECT to_regclass('spff.fertigation_planner_profiles') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}
export async function getPlannerProfile(deviceId: string, recipeId: string) {
  if (!await plannerStorageReady()) fail('Migration 029 planner belum diterapkan.', 503);
  const result = await pool.query(`SELECT revision,recipe_revision,profile,updated_by,updated_at
    FROM spff.fertigation_planner_profiles WHERE site_id=$1 AND device_id=$2 AND recipe_id=$3`,
  [configuredSiteId, deviceId, recipeId]);
  const row = result.rows[0];
  return row ? { revision: Number(row.revision), recipeRevision: Number(row.recipe_revision),
    profile: fertigationPlannerProfileSchema.parse(row.profile), updatedBy: row.updated_by, updatedAt: row.updated_at } : null;
}
export async function savePlannerProfile(input: unknown, actor: string) {
  const value = fertigationPlannerMutationSchema.parse(input);
  if (!await plannerStorageReady()) fail('Migration 029 planner belum diterapkan.', 503);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recipe = await client.query(`SELECT revision FROM spff.fertigation_recipes
      WHERE site_id=$1 AND recipe_id=$2 FOR SHARE`, [configuredSiteId, value.recipeId]);
    if (Number(recipe.rows[0]?.revision) !== value.expectedRecipeRevision) fail('Aturan sudah berubah atau tidak ditemukan. Muat ulang aturan.');
    const device = await client.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled', [configuredSiteId, value.deviceId]);
    if (!device.rowCount) fail('Perangkat tidak ditemukan atau nonaktif.');
    // Optimistic revision applies to both initial create and subsequent edits.
    const result = await client.query(`INSERT INTO spff.fertigation_planner_profiles
      (site_id,device_id,recipe_id,recipe_revision,revision,profile,updated_by)
      SELECT $1,$2,$3,$4,1,$5,$6 WHERE $7::bigint=0
      ON CONFLICT (site_id,device_id,recipe_id) DO NOTHING RETURNING *`,
    [configuredSiteId, value.deviceId, value.recipeId, value.expectedRecipeRevision, JSON.stringify(value.profile), actor, value.expectedRevision]);
    const saved = result.rows[0] ?? (await client.query(`UPDATE spff.fertigation_planner_profiles
      SET recipe_revision=$4,revision=revision+1,profile=$5,updated_by=$6,updated_at=now()
      WHERE site_id=$1 AND device_id=$2 AND recipe_id=$3 AND revision=$7 AND $7::bigint>0 RETURNING *`,
    [configuredSiteId, value.deviceId, value.recipeId, value.expectedRecipeRevision, JSON.stringify(value.profile), actor, value.expectedRevision])).rows[0];
    if (!saved) fail('Profil sudah berubah. Muat ulang sebelum menyimpan.');
    await client.query(`INSERT INTO spff.fertigation_planner_profile_revisions
      (site_id,device_id,recipe_id,revision,snapshot,changed_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [configuredSiteId, value.deviceId, value.recipeId, saved.revision, JSON.stringify(saved), actor]);
    await client.query('COMMIT');
    return { revision: Number(saved.revision), recipeRevision: Number(saved.recipe_revision), profile: value.profile };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function loadPlannerEvidence(deviceId: string, fertilizer: boolean, now: Date): Promise<PlannerEvidence> {
  const result = await pool.query(`WITH windows AS (
    SELECT a.actuator_key, MAX(EXTRACT(EPOCH FROM
      (((($3::timestamptz AT TIME ZONE a.timezone)::date + a.off_time) AT TIME ZONE a.timezone) - $3::timestamptz))) AS seconds
    FROM spff.actuator_schedules a
    WHERE a.site_id=$1 AND a.device_id=$2 AND a.enabled
      AND ($3::timestamptz AT TIME ZONE a.timezone)::time >= a.on_time
      AND ($3::timestamptz AT TIME ZONE a.timezone)::time < a.off_time
      AND (a.repeat_rule='daily'
        OR (a.repeat_rule='weekdays' AND extract(isodow FROM $3::timestamptz AT TIME ZONE a.timezone)<=5)
        OR (a.repeat_rule='weekends' AND extract(isodow FROM $3::timestamptz AT TIME ZONE a.timezone)>=6)
        OR (a.repeat_rule='once' AND a.run_date=($3::timestamptz AT TIME ZONE a.timezone)::date))
    GROUP BY a.actuator_key
  ) SELECT ss.acknowledgement_status,ss.revision,ss.acknowledged_revision,
    (SELECT seconds FROM windows WHERE actuator_key='pump_water') AS water_seconds,
    (SELECT seconds FROM windows WHERE actuator_key='pump_fert') AS fert_seconds
    FROM spff.device_schedule_sync_state ss WHERE ss.site_id=$1 AND ss.device_id=$2`,
  [configuredSiteId, deviceId, now]);
  const row = result.rows[0];
  const holdReasons: string[] = [];
  if (!row || row.acknowledgement_status !== 'applied' || String(row.revision) !== String(row.acknowledged_revision))
    holdReasons.push('Jadwal terbaru belum dikonfirmasi ESP32.');
  const water = row?.water_seconds == null ? null : Number(row.water_seconds);
  const fert = row?.fert_seconds == null ? null : Number(row.fert_seconds);
  const remainingSeconds = water === null || (fertilizer && fert === null) ? null : Math.min(water, fertilizer ? fert! : water);
  const daily = await pool.query(`SELECT COALESCE(sum(actual_stock_l),0) AS used,
    count(*) FILTER (WHERE actual_stock_l IS NULL OR NOT pumps_off OR status<>'completed') AS unknown
    FROM spff.fertigation_sessions WHERE site_id=$1 AND device_id=$2 AND
      (last_recorded_at AT TIME ZONE 'Asia/Jakarta')::date=($3::timestamptz AT TIME ZONE 'Asia/Jakarta')::date`,
  [configuredSiteId, deviceId, now]);
  // Pulse sessions use ON-time budgets, not measured stock litres. Never treat them as zero dose.
  const pulses = await pool.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions
    WHERE site_id=$1 AND device_id=$2 AND (status IN ('waiting','in_flight','fault') OR
      application_day=($3::timestamptz AT TIME ZONE 'Asia/Jakarta')::date) LIMIT 1`, [configuredSiteId, deviceId, now]);
  if (pulses.rowCount) holdReasons.push('Ada sesi pulse EC tanah yang aktif atau dosis hari ini belum diketahui dalam liter.');
  return { remainingSeconds, dailyStockUsedL: Number(daily.rows[0]?.unknown) === 0 ? Number(daily.rows[0]?.used) : null, holdReasons };
}

export async function buildServerFertigationPlan(deviceId: string, recipeId: string, now = new Date()) {
  if (!await plannerStorageReady()) return { status: 'not_configured', canDispatch: false, reasons: ['Migration 029 planner belum diterapkan.'], plan: null };
  const [profile, recipe, snapshot, programs] = await Promise.all([
    getPlannerProfile(deviceId, recipeId), getFertigationRecipe(recipeId), loadSiteFertigationSnapshot(deviceId), listFertigationRecipes(),
  ]);
  if (!recipe) fail('Aturan tidak ditemukan.', 404);
  if (!profile) return { status: 'not_configured', canDispatch: false, reasons: ['Profil budidaya dan kalibrasi planner belum diisi.'], plan: null };
  const [repeat, evidence] = await Promise.all([loadRepeatEvidence(recipe, deviceId, now), loadPlannerEvidence(deviceId, recipe.targetStockL > 0, now)]);
  const decision = evaluateAutomaticRuleBased(programs.filter((p): p is FertigationRecipe => p !== null), deviceId, snapshot, now, repeat);
  if (profile.recipeRevision !== recipe.revision) evidence.holdReasons.push('Aturan berubah; verifikasi dan simpan ulang profil kalibrasi planner.');
  if (decision.selectedProgramId !== recipeId) evidence.holdReasons.push('Program bukan satu-satunya aturan aktif untuk tanaman/HST saat ini.');
  if (decision.status === 'hold') evidence.holdReasons.push(...decision.reasons);
  return { recipeId, deviceId, recipeRevision: recipe.revision, profileRevision: profile.revision,
    observedAt: now.toISOString(), telemetryRecordedAt: snapshot.telemetryRecordedAt?.toISOString() ?? null,
    ...planAdaptiveFertigation(recipe, snapshot, profile.profile, evidence) };
}
