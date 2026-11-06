import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { fertigationPulseCommandSchema, fertigationPulseAckSchema, measureHstDosePulse, type FertigationPulseAck, type FertigationPulseCommand } from '@spff/contracts';
import { config } from './config.js';

async function settleHstPulses(client:PoolClient) {
  const sessions=(await client.query(`SELECT s.*,p.ack AS pulse_ack,p.status AS pulse_status,p.expires_at,p.payload,
      stop.ack AS stop_ack,release.ack AS release_ack,release.created_at AS release_queued_at
    FROM spff.adaptive_fert_sessions s JOIN spff.hst_dose_pulse_commands p USING(site_id,session_id)
    LEFT JOIN spff.hst_dose_pulse_commands stop ON stop.site_id=s.site_id AND stop.session_id=s.session_id AND stop.operation='stop'
    LEFT JOIN spff.hst_dose_pulse_commands release ON release.site_id=s.site_id AND release.session_id=s.session_id AND release.operation='release'
    WHERE s.command_snapshot->>'kind'='hst_dose_pulse' AND s.status NOT IN ('completed','fault')
      AND p.operation='pulse' FOR UPDATE OF s SKIP LOCKED`)).rows;
  for(const s of sessions){
    const snapshot=s.command_snapshot;
    const stopAt=Date.parse(s.stop_ack?.acknowledgedAt??'');
    const expiresAt=s.expires_at.getTime();
    const pulseDone=s.pulse_status==='completed'&&s.pulse_ack?.pumpsOff===true;
    const faultStopped=s.pulse_status==='fault'&&s.pulse_ack?.pumpsOff===true&&
      stopAt>=expiresAt&&s.stop_ack?.pumpsOff===true;
    const needsStop=!pulseDone&&(s.status==='reconciliation_required'||
      ['fault','rejected'].includes(s.pulse_status)||Date.now()>expiresAt+s.payload.params.onDurationMs+10000);
    async function queue(operation:'stop'|'release'){
      const now=new Date(),expires=new Date(now.getTime()+15000),commandId=randomUUID();
      const payload=fertigationPulseCommandSchema.parse({
        kind:operation==='stop'?'fertigation_pulse_stop':'fertigation_pulse_release',
        schemaVersion:1,siteId:s.site_id,deviceId:s.device_id,sessionId:s.session_id,cycle:1,commandId,
        issuedAt:now.toISOString(),expiresAt:expires.toISOString(),
        ...(operation==='release'&&!faultStopped?{resumeAutomatic:true}:{}),
      });
      await client.query(`INSERT INTO spff.hst_dose_pulse_commands
        (site_id,session_id,cycle,command_id,operation,payload,expires_at) VALUES($1,$2,1,$3,$4,$5,$6)
        ON CONFLICT (site_id,session_id,cycle,operation) DO UPDATE SET
          command_id=EXCLUDED.command_id,payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,
          status='pending',last_published_at=NULL,finished_at=NULL,ack=NULL
        WHERE hst_dose_pulse_commands.expires_at<=now() AND (hst_dose_pulse_commands.status<>'completed'
          OR ($4='stop' AND (hst_dose_pulse_commands.ack->>'acknowledgedAt')::timestamptz<$7))`,
      [s.site_id,s.session_id,commandId,operation,JSON.stringify(payload),expires,s.expires_at]);
    }
    if(needsStop){
      await client.query(`UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',
        reason=coalesce(reason,'pulse_outcome_unconfirmed') WHERE site_id=$1 AND session_id=$2`,[s.site_id,s.session_id]);
      if(Date.now()>=expiresAt&&!(stopAt>=expiresAt&&s.stop_ack?.pumpsOff===true))await queue('stop');
      if(!faultStopped)continue;
    }
    if(!pulseDone&&!faultStopped)continue;
    if(!(stopAt>=expiresAt&&s.stop_ack?.pumpsOff===true)){
      if(Date.now()>=expiresAt)await queue('stop');
      continue;
    }
    const samples=(await client.query(`SELECT recorded_at,flow_fert_total_l,flow_water_total_l,sensor_health,
      raw_payload #>> '{sensorHealth,soil_2_moisture,pollBootId}' AS boot
      FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2 AND recorded_at>$3
        AND ($4::timestamptz IS NULL OR (recorded_at<$4 AND received_at<$4))
      ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 2`,[s.site_id,s.device_id,new Date(stopAt),s.release_queued_at])).rows.reverse();
    if(samples.length!==2)continue;
    const stockReading=(sample:typeof samples[number])=>({recordedAtMs:sample.recorded_at.getTime(),bootId:sample.boot,
      totalL:sample.flow_fert_total_l,valid:sample.sensor_health?.flow_fert_total_l?.valid===true});
    const measured=measureHstDosePulse({
      before:{recordedAtMs:Date.parse(snapshot.baselineAt),bootId:snapshot.bootId,totalL:snapshot.baselineStockL,valid:true},
      startedAtMs:Date.parse(s.payload.issuedAt),pumpsOffAtMs:stopAt,concentrationGPerL:snapshot.concentrationGPerL,
      after:[stockReading(samples[0]),stockReading(samples[1])],
    });
    const final=samples[1],waterL=final.flow_water_total_l-snapshot.baselineWaterL;
    if(!measured||final.sensor_health?.flow_water_total_l?.valid!==true||
      !Number.isFinite(final.flow_water_total_l)||!Number.isFinite(waterL)||waterL<0)continue;
    if(s.release_ack?.status!=='completed'||s.release_ack.pumpsOff!==true){
      if(faultStopped){
        const heartbeat=(await client.query(`SELECT online,mode,recorded_at,raw_payload
          FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
          ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[s.site_id,s.device_id])).rows[0];
        const age=Date.now()-(heartbeat?.recorded_at?.getTime()??0), raw=heartbeat?.raw_payload;
        if(!heartbeat?.online||heartbeat.mode!=='manual'||age< -5000||age>90000||
          raw?.pulseBootId!==snapshot.bootId||raw.pumpReadbackValid!==true||
          raw.pumpWaterActualActive!==false||raw.pumpFertActualActive!==false)continue;
      }
      await queue('release');
      continue;
    }
    await client.query(`UPDATE spff.dose_volume_bindings SET credited_g=least(target_mass_g,$3),
      evidence_verified=true,evidence_basis='DEVICE_TERMINAL_MEASURED' WHERE site_id=$1 AND session_id=$2`,
    [s.site_id,s.session_id,measured.deliveredG]);
    await client.query(`UPDATE spff.adaptive_fert_sessions SET status='completed',reason=$6,
      water_volume_l=$3,fert_volume_l=$4,last_telemetry_at=$5 WHERE site_id=$1 AND session_id=$2`,
    [s.site_id,s.session_id,waterL,measured.stockL,final.recorded_at,
      faultStopped?'hst_pulse_fault_recovered:'+s.pulse_ack.reason:'hst_pulse_measured']);
  }
}

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
      if(hstInstalled)await settleHstPulses(c);
      const hst=hstInstalled?await c.query(`
        SELECT pc.*,s.device_id FROM spff.hst_dose_pulse_commands pc
        JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
        WHERE pc.status IN ('pending','published','accepted') AND pc.expires_at>now()
          AND s.command_snapshot->>'kind'='hst_dose_pulse'
          AND (pc.last_published_at IS NULL OR pc.last_published_at<now()-interval '2 seconds')
          AND (pc.operation<>'pulse' OR ($1::boolean AND s.status IN ('queued','running')
            AND EXISTS (SELECT 1 FROM spff.hst_execution_modes m WHERE m.site_id=pc.site_id AND NOT m.shadow_enabled)
            AND EXISTS (SELECT 1 FROM LATERAL (
              SELECT online,mode,recorded_at,raw_payload FROM spff.device_status_events
              WHERE site_id=s.site_id AND device_id=s.device_id
              ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1
            ) h WHERE h.online AND h.mode='automatic' AND h.recorded_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds'
              AND h.raw_payload->>'pulseBootId'=s.command_snapshot->>'bootId'
              AND h.raw_payload @> '{"serverPulseCapable":true,"waterInterlockEnabled":true,"aiAccTankGuardHealthy":true}'::jsonb)
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
