import type {PoolClient} from 'pg';

export class OperatorOverrideError extends Error {}

export async function beginOperatorPumpOverride(c:PoolClient,site:string,device:string,commandId:string,on=true) {
  const config=(await c.query(`SELECT * FROM spff.device_automatic_control_configs
    WHERE site_id=$1 AND device_id=$2 FOR UPDATE`,[site,device])).rows[0];
  // An operator STOP never depends on a new firmware capability or a healthy sensor.
  if(!on) {
    if(config?.desired_mode==='automatic'||config?.applied_mode==='automatic') {
      await c.query(`UPDATE spff.device_automatic_control_configs SET operator_override_active=true,
        operator_override_command_id=$3,operator_override_started_at=coalesce(operator_override_started_at,now())
        WHERE site_id=$1 AND device_id=$2`,[site,device,commandId]);
      await c.query(`UPDATE spff.control_commands SET status='failed',reason='operator_override'
        WHERE site_id=$1 AND device_id=$2 AND requested_is_active AND status='pending' AND published_at IS NULL
        AND requested_by IN ('hst-fertilization','hst-fuzzy-water')`,[site,device]);
      await c.query(`UPDATE spff.hst_fertilization_starts h SET status='failed' WHERE h.site_id=$1 AND h.device_id=$2
        AND h.status='queued' AND EXISTS(SELECT 1 FROM spff.control_commands c
        WHERE c.command_id IN(h.water_command_id,h.fertilizer_command_id) AND c.reason='operator_override')`,[site,device]);
    }
    return;
  }
  const h=(await c.query(`SELECT * FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
    ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[site,device])).rows[0];
  const raw=h?.raw_payload;
  const age=h?Date.now()-new Date(h.recorded_at).getTime():Infinity;
  if(!h?.online||age>90000||age< -5000||raw?.operatorOverrideCapable!==true||raw?.pumpReadbackValid!==true||
    typeof raw.pumpWaterActualActive!=='boolean'||typeof raw.pumpFertActualActive!=='boolean')
    throw new OperatorOverrideError('Override memerlukan heartbeat terbaru dan dukungan operatorOverrideCapable dari firmware.');
  if(h.mode!=='automatic'||config?.desired_mode!=='automatic'||config.applied_mode!=='automatic'||
    config.acknowledgement_status!=='applied'||String(config.revision)!==String(config.acknowledged_revision))
    throw new OperatorOverrideError('Tunggu konfirmasi mode Otomatis dari perangkat.');
  if(raw.serverPulseOwner===true||raw.aiAccSessionActive===true||raw.doseVolumeSessionActive===true||
    (await c.query(`SELECT 1 FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND device_id=$2
      AND status NOT IN ('completed','fault') UNION ALL
      SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2
      AND status NOT IN ('completed','cancelled') LIMIT 1`,[site,device])).rows.length)
    throw new OperatorOverrideError('Hentikan sesi pompa yang masih memegang relay sebelum override.');
  // Cancel only unpublished automatic ONs; already published commands must settle first.
  await c.query(`UPDATE spff.control_commands SET status='failed',reason='operator_override'
    WHERE site_id=$1 AND device_id=$2 AND requested_is_active AND status='pending' AND published_at IS NULL
    AND requested_by IN ('hst-fertilization','hst-fuzzy-water')`,[site,device]);
  if((await c.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
    AND status IN ('pending','published','accepted') AND expires_at>now() LIMIT 1`,[site,device])).rows.length)
    throw new OperatorOverrideError('Tunggu perintah perangkat sebelumnya selesai sebelum override.');
  await c.query(`UPDATE spff.device_automatic_control_configs SET operator_override_active=true,
    operator_override_command_id=$3,operator_override_started_at=coalesce(operator_override_started_at,now())
    WHERE site_id=$1 AND device_id=$2`,[site,device,commandId]);
  await c.query(`UPDATE spff.hst_fertilization_starts h SET status='failed'
    WHERE h.site_id=$1 AND h.device_id=$2 AND h.status='queued' AND EXISTS(
      SELECT 1 FROM spff.control_commands c WHERE c.command_id IN(h.water_command_id,h.fertilizer_command_id)
      AND c.reason='operator_override')`,[site,device]);
}

export async function resumePumpAutomation(c:PoolClient,site:string,device:string,actor:string) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`soil-ec:${site}:${device}`]);
  const config=(await c.query(`SELECT * FROM spff.device_automatic_control_configs
    WHERE site_id=$1 AND device_id=$2 FOR UPDATE`,[site,device])).rows[0];
  if(!config)throw new OperatorOverrideError('Konfigurasi perangkat tidak ditemukan.');
  if(!config.operator_override_active)return;
  const h=(await c.query(`SELECT * FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
    ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[site,device])).rows[0];
  const age=h?Date.now()-new Date(h.recorded_at).getTime():Infinity;
  if(!h?.online||age>90000||age< -5000||h.raw_payload?.pumpReadbackValid!==true||
    h.raw_payload.pumpWaterActualActive!==false||h.raw_payload.pumpFertActualActive!==false||
    h.recorded_at<config.operator_override_started_at)
    throw new OperatorOverrideError('Matikan kedua pompa dan tunggu heartbeat OFF terbaru sebelum melanjutkan otomasi.');
  if((await c.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
    AND status IN ('pending','published','accepted') AND expires_at>now() LIMIT 1`,[site,device])).rows.length)
    throw new OperatorOverrideError('Masih ada perintah yang menunggu konfirmasi perangkat.');
  const lastOn=(await c.query(`SELECT max(expires_at) AS expires FROM spff.control_commands
    WHERE site_id=$1 AND device_id=$2 AND requested_is_active AND request_payload->>'operatorOverride'='true'
    AND issued_at>=$3`,[site,device,config.operator_override_started_at])).rows[0];
  if(lastOn?.expires&&new Date(h.recorded_at)<new Date(lastOn.expires))
    throw new OperatorOverrideError('Tunggu masa berlaku ON sebelumnya habis dan heartbeat OFF yang lebih baru.');
  // Reusing the acknowledged configuration channel explicitly releases firmware ownership.
  // Automatic ON remains gated on the new configuration ACK, never just this database update.
  await c.query(`UPDATE spff.device_automatic_control_configs SET operator_override_active=false,
    operator_override_command_id=NULL,operator_override_started_at=NULL,revision=revision+1,
    published_revision=NULL,published_at=NULL,acknowledged_revision=NULL,acknowledgement_status=NULL,
    acknowledged_at=NULL,acknowledgement_reason=NULL,updated_by=$3
    WHERE site_id=$1 AND device_id=$2`,[site,device,actor]);
}
