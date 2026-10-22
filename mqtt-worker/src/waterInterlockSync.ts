import { Pool } from 'pg';
import { waterInterlockAckSchema,waterInterlockSyncSchema,type WaterInterlockSync,type WaterInterlockAck } from '@spff/contracts';
import { config } from './config.js';
export class WaterInterlockSyncService {
  private readonly pool:Pick<Pool,'query'|'connect'|'end'>;
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  private force=false;
  constructor(private readonly publish:(v:WaterInterlockSync)=>Promise<void>,database?:Pick<Pool,'query'|'connect'|'end'>){
    this.pool=database??new Pool({connectionString:config.database.url,max:2});
  }
  async installed(){const r=await this.pool.query("SELECT to_regclass('spff.device_water_interlock_configs') IS NOT NULL AS ready");return r.rows[0]?.ready===true;}
  start(){if(this.timer)return;void this.runOnce(true);this.timer=setInterval(()=>void this.runOnce(),5000);this.timer.unref();}
  async stop(){if(this.timer)clearInterval(this.timer);while(this.running)await new Promise(r=>setTimeout(r,10));await this.pool.end();}
  async runOnce(force=false){
    this.force ||= force;if(this.running)return;this.running=true;
    try{
      do{
        const forced=this.force;this.force=false;
        // Deliberately non-retained on commands. Persistent desired state is resent;
        // it cannot overwrite retained schedule/automatic-control snapshots.
        const r=await this.pool.query(`SELECT c.* FROM spff.device_water_interlock_configs c
          JOIN spff.devices d USING(site_id,device_id) WHERE d.enabled
          AND ($1::boolean OR c.published_at IS NULL OR c.published_at<now()-interval '30 seconds'
            OR ((c.acknowledged_revision IS DISTINCT FROM c.revision OR c.acknowledgement_status IS DISTINCT FROM 'applied')
              AND c.published_at<now()-interval '5 seconds'))`,[forced]);
        for(const row of r.rows){
          const message=waterInterlockSyncSchema.parse({kind:'water_interlock_sync',schemaVersion:1,
            siteId:row.site_id,deviceId:row.device_id,revision:row.revision,enabled:row.enabled});
          await this.publish(message);
          await this.pool.query(`UPDATE spff.device_water_interlock_configs SET published_at=now()
            WHERE site_id=$1 AND device_id=$2 AND revision=$3`,[row.site_id,row.device_id,row.revision]);
        }
      }while(this.force);
    }catch(e){console.error('[water-interlock-sync]',e);}finally{this.running=false;}
  }
  async saveAck(input:WaterInterlockAck){
    const ack=waterInterlockAckSchema.parse(input),c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      const r=await c.query(`SELECT * FROM spff.device_water_interlock_configs WHERE site_id=$1 AND device_id=$2 FOR UPDATE`,[ack.siteId,ack.deviceId]);
      const row=r.rows[0];if(!row||ack.revision>row.revision)throw new Error('Unknown interlock ACK identity/revision');
      if(ack.status==='applied'&&ack.revision===row.revision&&ack.enabled!==row.enabled)throw new Error('Interlock ACK value mismatch');
      await c.query(`INSERT INTO spff.water_interlock_ack_events(site_id,device_id,revision,status,payload)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(site_id,device_id,revision,status) DO NOTHING`,[ack.siteId,ack.deviceId,ack.revision,ack.status,JSON.stringify(ack)]);
      // Late/stale ACKs cannot regress a newer revision or a successful apply.
      await c.query(`UPDATE spff.device_water_interlock_configs SET acknowledged_revision=$3,
        acknowledgement_status=$4,applied_enabled=$5,acknowledged_at=now(),acknowledgement_reason=$6
        WHERE site_id=$1 AND device_id=$2 AND revision=$3
          AND NOT(acknowledged_revision IS NOT DISTINCT FROM revision AND acknowledgement_status='applied' AND $4='rejected')`,
        [ack.siteId,ack.deviceId,ack.revision,ack.status,ack.enabled,ack.reason]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
