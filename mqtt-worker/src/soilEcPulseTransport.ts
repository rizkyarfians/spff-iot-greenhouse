import { Pool } from 'pg';
import { fertigationPulseCommandSchema, fertigationPulseAckSchema, type FertigationPulseAck, type FertigationPulseCommand } from '@spff/contracts';
import { config } from './config.js';

export class SoilEcPulseTransport {
  private readonly pool: Pick<Pool, 'query'|'connect'|'end'>;
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  constructor(private readonly publish:(message:FertigationPulseCommand)=>Promise<void>, database?: Pick<Pool,'query'|'connect'|'end'>){
    this.pool=database??new Pool({connectionString:config.database.url,max:2});
  }
  async isInstalled(){const r=await this.pool.query("SELECT to_regclass('spff.soil_ec_pulse_commands') IS NOT NULL AS ready");return r.rows[0]?.ready===true;}
  start(){this.timer=setInterval(()=>{if(this.running)return;this.running=true;
    void this.dispatch().catch((e:unknown)=>console.error('[soil-ec-dispatch]',e)).finally(()=>{this.running=false;});},1000);this.timer.unref();}
  async stop(){if(this.timer)clearInterval(this.timer);while(this.running)await new Promise(r=>setTimeout(r,10));await this.pool.end();}
  async dispatch(){
    // Publish only pending pulses from a live session. Re-send the SAME immutable ID until expiry;
    // never replay a pulse from a cancelled/faulted session. Stop commands may outlive the session.
    const c=await this.pool.connect();
    try{await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('soil-ec-dispatch',0))");
      const installed=await c.query("SELECT to_regclass('spff.device_soil_ec_execution_configs') IS NOT NULL AS ready");
      // Fail closed for pulses before migration 030; stops/releases still dispatch.
      const executionGate=installed.rows[0]?.ready===true
        ? `EXISTS(SELECT 1 FROM spff.device_soil_ec_execution_configs ec WHERE ec.site_id=s.site_id AND ec.device_id=s.device_id AND ec.enabled)`
        : 'false';
      await c.query(`UPDATE spff.soil_ec_pulse_commands SET status='fault',finished_at=now()
        WHERE status IN ('pending','published','accepted') AND expires_at +
          (COALESCE((payload->'params'->>'onDurationMs')::bigint,0)+10000)*interval '1 millisecond' < now()`);
      const r=await c.query(`SELECT pc.* FROM spff.soil_ec_pulse_commands pc JOIN spff.soil_ec_pulse_sessions s USING(session_id)
        WHERE pc.status IN ('pending','published','accepted') AND pc.expires_at>now()
          AND (pc.operation<>'pulse' OR ($1::boolean AND s.status='in_flight' AND ${executionGate}))
          AND (pc.last_published_at IS NULL OR pc.last_published_at<now()-interval '2 seconds')
        ORDER BY (pc.operation='stop') DESC,pc.created_at FOR UPDATE OF pc SKIP LOCKED LIMIT 10`,[process.env.SPFF_SOIL_EC_PULSES_ENABLED==='true']);
      const hstInstalled=(await c.query("SELECT to_regclass('spff.hst_dose_pulse_commands') IS NOT NULL AS ready")).rows[0]?.ready===true;
      const hst=hstInstalled?await c.query(`
        SELECT pc.*,s.device_id FROM spff.hst_dose_pulse_commands pc
        JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
        WHERE pc.status IN ('pending','published','accepted') AND pc.expires_at>now()
          AND s.command_snapshot->>'kind'='hst_dose_pulse'
          AND (pc.last_published_at IS NULL OR pc.last_published_at<now()-interval '2 seconds')
          AND (pc.operation<>'pulse' OR ($1::boolean AND s.status IN ('queued','running')
            AND EXISTS (SELECT 1 FROM spff.hst_execution_modes m WHERE m.site_id=pc.site_id AND NOT m.shadow_enabled)
            AND NOT EXISTS (SELECT 1 FROM spff.device_soil_ec_execution_configs ec
              WHERE ec.site_id=s.site_id AND ec.device_id=s.device_id AND ec.enabled)))
        ORDER BY (pc.operation='stop') DESC,pc.created_at FOR UPDATE OF pc SKIP LOCKED LIMIT 10`,
      [process.env.SPFF_HST_DOSE_PULSES_ENABLED==='true' && process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED==='true']):null;
      const commands=[
        ...r.rows.map(row=>({row,table:'spff.soil_ec_pulse_commands' as const})),
        ...(hst?.rows??[]).map(row=>({row,table:'spff.hst_dose_pulse_commands' as const})),
      ];
      for(const {row,table} of commands){
        const payload=fertigationPulseCommandSchema.parse(row.payload);
        if(table==='spff.hst_dose_pulse_commands' &&
          (payload.siteId!==row.site_id || payload.deviceId!==row.device_id || payload.sessionId!==row.session_id ||
           payload.commandId!==row.command_id || payload.cycle!==row.cycle ||
           payload.kind!==({pulse:'fertigation_pulse',stop:'fertigation_pulse_stop',release:'fertigation_pulse_release'} as const)[row.operation as 'pulse'|'stop'|'release'] ||
           Date.parse(payload.expiresAt)!==row.expires_at.getTime()))
          throw new Error('HST pulse outbox identity mismatch');
        // Publish while holding the command row lock; ACK updates wait for this transaction.
        // A lost QoS acknowledgement must not hold the OFF switch lock forever.
        // Timeout means outcome unknown, not unsent; IDs and local expiry stay unchanged.
        let timeout:ReturnType<typeof setTimeout>|undefined;
        try {
          await Promise.race([this.publish(payload),new Promise<never>((_,reject)=>{
            timeout=setTimeout(()=>reject(new Error('Pulse MQTT publish acknowledgement timed out')),5000);
          })]);
        }finally{if(timeout)clearTimeout(timeout);}
        await c.query(`UPDATE ${table} SET status=CASE WHEN status='pending' THEN 'published' ELSE status END,
          last_published_at=now() WHERE command_id=$1`,[row.command_id]);
      }
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async saveAck(ack:FertigationPulseAck){
    ack=fertigationPulseAckSchema.parse(ack);
    const c=await this.pool.connect();
    try{await c.query('BEGIN');
      const r=await c.query(`SELECT pc.*,s.site_id,s.device_id FROM spff.soil_ec_pulse_commands pc
        JOIN spff.soil_ec_pulse_sessions s USING(session_id) WHERE pc.command_id=$1 FOR UPDATE OF pc`,[ack.commandId]);
      const hstInstalled=!r.rows.length&&(await c.query("SELECT to_regclass('spff.hst_dose_pulse_commands') IS NOT NULL AS ready")).rows[0]?.ready===true;
      const hst=hstInstalled?(await c.query(`SELECT pc.*,s.device_id FROM spff.hst_dose_pulse_commands pc
        JOIN spff.adaptive_fert_sessions s USING(site_id,session_id) WHERE pc.command_id=$1 FOR UPDATE OF pc`,[ack.commandId])).rows[0]:null;
      const row=r.rows[0]??hst;
      if(!row || row.site_id!==ack.siteId || row.device_id!==ack.deviceId || row.session_id!==ack.sessionId || row.cycle!==ack.cycle)
        throw new Error('Pulse ACK identity mismatch');
      // A stale accepted ACK must never regress a terminal state.
      if(!['completed','rejected','fault'].includes(row.status)){
        const table=hst?'spff.hst_dose_pulse_commands':'spff.soil_ec_pulse_commands';
        await c.query(`UPDATE ${table} SET status=$2,ack=$3,
          finished_at=CASE WHEN $2='accepted' THEN NULL ELSE now() END WHERE command_id=$1`,[ack.commandId,ack.status,JSON.stringify(ack)]);
      }
      if(!hst)await c.query(`INSERT INTO spff.soil_ec_pulse_ack_events(command_id,payload,status) VALUES($1,$2,$3)
        ON CONFLICT(command_id,status) DO NOTHING`,[ack.commandId,JSON.stringify(ack),ack.status]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
