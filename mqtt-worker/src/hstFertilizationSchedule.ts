import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { guideProgramHst, type GuideProgramConfig, type GuideProgramPlan } from '@spff/contracts';
import { config } from './config.js';

export function matchHstFertilization(plan: GuideProgramPlan, hst: number) {
  return plan.activities.flatMap(activity => {
    if (activity.hst !== hst || activity.method.trim().toLowerCase() !== 'tabur') return [];
    return activity.requirements.filter(requirement =>
      /^phonska(?:\s+plus)?$/i.test(requirement.product.trim()),
    ).map(requirement => ({ activityId: activity.id, product: requirement.product, method: activity.method }));
  });
}

export async function tickHstFertilization(client: PoolClient, enabled: boolean, now = new Date()) {
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
  if (!enabled) return;
  const programs = (await client.query(`SELECT p.* FROM spff.guide_programs p
    JOIN spff.devices d ON d.site_id=p.site_id AND d.device_id=p.config->>'deviceId'
    WHERE d.enabled ORDER BY p.created_at,p.program_id FOR SHARE OF p`)).rows;
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  for (const program of programs) {
    const cfg = program.config as GuideProgramConfig;
    const hst = guideProgramHst(cfg.plantingDate, now);
    const matches = matchHstFertilization(program.plan as GuideProgramPlan, hst);
    if (!matches.length) continue;
    const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
      ['soil-ec:'+program.site_id+':'+cfg.deviceId])).rows[0];
    if (!lock?.acquired) continue;
    if ((await client.query('SELECT 1 FROM spff.hst_fertilization_starts WHERE site_id=$1 AND device_id=$2 AND application_day=$3',
      [program.site_id,cfg.deviceId,day])).rows.length) continue;
    if ((await client.query(`SELECT 1 FROM spff.actuators WHERE site_id=$1 AND device_id=$2 AND enabled
      AND actuator_key IN ('pump_water','pump_fert')`,[program.site_id,cfg.deviceId])).rows.length !== 2) continue;
    await client.query('SAVEPOINT hst_start');
    try {
      const match = matches[0], startId = randomUUID(), water = randomUUID(), fertilizer = randomUUID();
      for (const [commandId,actuator] of [[water,'pump_water'],[fertilizer,'pump_fert']]) {
        await client.query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,
          requested_is_active,requested_by,issued_at,expires_at,request_payload)
          VALUES($1,$2,$3,$4,true,'hst-fertilization',now(),now()+interval '30 seconds',$5)`,
        [commandId,program.site_id,cfg.deviceId,actuator,JSON.stringify({source:'hst-fertilization',startId,programId:program.program_id,
          activityId:match.activityId,hst,product:match.product,method:match.method})]);
      }
      await client.query(`INSERT INTO spff.hst_fertilization_starts(start_id,site_id,device_id,program_id,activity_id,
        hst,application_day,product,method,water_command_id,fertilizer_command_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [startId,program.site_id,cfg.deviceId,program.program_id,match.activityId,hst,day,match.product,match.method,water,fertilizer]);
      await client.query('RELEASE SAVEPOINT hst_start');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT hst_start');
      await client.query('RELEASE SAVEPOINT hst_start');
      if (!(error instanceof Error && 'code' in error && error.code === '55000')) throw error;
      console.warn('[hst-fertilization] Relay masih dimiliki sesi lain',program.site_id,cfg.deviceId);
    }
  }
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await tickHstFertilization(client,process.env.SPFF_HST_SCHEDULE_DISPATCH_ENABLED==='true');
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
