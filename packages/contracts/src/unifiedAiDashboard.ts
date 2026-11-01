/** Read-only public-safe presentation contract for the standalone Python AI.
 * Source is a stored, non-simulated SHADOW decision; not an actuation grant.
 */
import { z } from 'zod';

const str = z.string().max(200);
const nullableStr = str.nullable();
const num = z.number().finite().nonnegative().nullable();
const booleanNull = z.boolean().nullable();
const reasons = z.array(str).max(80);

const product = z.object({
  product: str, source_row: z.number().int().positive().nullable(),
  is_fertilizer: z.boolean(), amount: num, unit: nullableStr,
  target_mass_g: num, credited_mass_g: num, remaining_mass_g: num,
  ledger_status: nullableStr, requires_review: z.boolean(),
  review_reasons: reasons,
}).strict();

const activity = z.object({
  activity_id: str, title: str, hst: z.number().int().nullable(),
  application_date: nullableStr, calendar_status: str,
  method: nullableStr, reference_water_l: num,
  manually_completed: z.boolean(), products: z.array(product).max(30),
}).strict();

const program = z.object({
  program_id: str, crop_name: str, current_hst: z.number().int().nullable(),
  plant_count: num, planting_date: nullableStr, status: str,
  hold_reasons: reasons, activities: z.array(activity).max(120),
}).strict();

export const unifiedAiDashboardSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('SHADOW_MODE'),
  can_dispatch: z.literal(false),
  status: z.enum(['CURRENT', 'STALE', 'NO_DECISION']),
  evaluated_at: nullableStr,
  decision: z.object({
    type: nullableStr, proposed_action: nullableStr,
    hold_reasons: reasons, configuration_version: nullableStr,
  }).strict(),
  feedback: z.object({
    status: str, reported_off: z.boolean(), boot_matches: z.boolean(),
    water_pump: booleanNull, fert_pump: booleanNull,
    reported_at: nullableStr,
  }).strict(),
  sensors: z.object({
    recorded_at: nullableStr, soil_moisture_pct: num,
    soil_2_moisture_pct: num,
    soil_1_valid: booleanNull, soil_2_valid: booleanNull,
    control_moisture_source: z.enum(['soil_1_moisture', 'soil_2_moisture']).nullable(),
    water_tank_pct: num, stock_tank_pct: num, device_mode: nullableStr,
  }).strict(),
  calculation: z.object({
    water_l: num, stock_l: num, fertilizer_mass_g: num,
    duration_seconds: num, fuzzy_score: num,
  }).strict(),
  programs: z.array(program).max(30),
  note: z.string().max(500),
}).strict();

export type UnifiedAiDashboard = z.infer<typeof unifiedAiDashboardSchema>;
