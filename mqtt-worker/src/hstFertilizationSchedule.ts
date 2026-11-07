import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { type GuideProgramPlan } from '@spff/contracts';
import { config } from './config.js';
import { tickAutomaticCycles } from './automaticCycle.js';
import { readProductionFuzzy } from './automaticFuzzyWater.js';

export function matchHstFertilization(plan: GuideProgramPlan, hst: number) {
  return plan.activities.flatMap(activity => {
    if (activity.hst !== hst || activity.method.trim().toLowerCase() !== 'tabur') return [];
    return activity.requirements.filter(requirement =>
      /^phonska(?:\s+plus)?$/i.test(requirement.product.trim()),
    ).map(requirement => ({ activityId: activity.id, product: requirement.product, method: activity.method }));
  });
}

export async function tickHstFertilization(client: PoolClient, enabled: boolean, now = new Date(), decision: Awaited<ReturnType<typeof readProductionFuzzy>> = null) {
  if (!(await client.query("SELECT to_regclass('spff.hst_fertilization_starts') IS NOT NULL AS ready")).rows[0]?.ready) return;
  const pending = (await client.query(`SELECT h.*,w.status AS water_status,f.status AS fertilizer_status,
      EXISTS(SELECT 1 FROM spff.command_ack_events a WHERE a.command_id=h.water_command_id
        AND a.status='completed' AND a.actual_is_active) AS water_on,
      EXISTS(SELECT 1 FROM spff.command_ack_events a WHERE a.command_id=h.fertilizer_command_id
        AND a.status='completed' AND a.actual_is_active) AS fertilizer_on
    FROM spff.hst_fertilization_starts h JOIN spff.control_commands w ON w.command_id=h.water_command_id
    JOIN spff.control_commands f ON f.command_id=h.fertilizer_command_id
    WHERE h.status='queued' FOR UPDATE OF h SKIP LOCKED`)).rows;
  for (const row of pending) {
    if (row.water_on && row.fertilizer_on) {
      await client.query("UPDATE spff.hst_fertilization_starts SET status='started',started_at=now() WHERE start_id=$1", [row.start_id]);
    } else if ([row.water_status,row.fertilizer_status].some(status => ['rejected','timed_out','expired','failed'].includes(status))) {
      await client.query("UPDATE spff.hst_fertilization_starts SET status='failed' WHERE start_id=$1", [row.start_id]);
      for (const actuator of ['pump_water','pump_fert']) {
        await client.query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,
          requested_is_active,requested_by,issued_at,expires_at,request_payload)
          VALUES($1,$2,$3,$4,false,'hst-fertilization-recovery',now(),now()+interval '15 seconds',$5)`,
        [randomUUID(),row.site_id,row.device_id,actuator,JSON.stringify({source:'hst-fertilization-recovery',startId:row.start_id})]);
      }
    }
  }
  await tickAutomaticCycles(client,enabled,now,decision);
}

export class HstFertilizationSchedule {
  private pool = new Pool({connectionString:config.database.url,max:1});
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<void> | null = null;
  start() {
    this.timer = setInterval(() => {
      if (this.pending) return;
      this.pending = this.tick().catch(error => console.error('[hst-fertilization]',error)).finally(() => { this.pending=null; });
    },5000);
  }
  private async tick() {
    const enabled=process.env.SPFF_HST_SCHEDULE_DISPATCH_ENABLED==='true';
    const decision=enabled?await readProductionFuzzy():null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await tickHstFertilization(client,enabled,new Date(),decision);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.pool.end();
  }
}
