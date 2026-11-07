import { ecDoseProfileInputSchema,type EcDoseSettings } from '@spff/contracts';
import { pool,configuredSiteId as site } from './postgresRepository.js';

export async function readEcDoseSettings(device:string,product:string):Promise<EcDoseSettings> {
  if(!(await pool.query("SELECT to_regclass('spff.ec_dose_profiles') IS NOT NULL AS ready")).rows[0]?.ready)
    throw Object.assign(new Error('Pengaturan estimasi EC belum dipasang.'),{status:503});
  const p=(await pool.query('SELECT * FROM spff.ec_dose_profiles WHERE site_id=$1 AND device_id=$2 AND product_key=$3',
    [site,device,product.trim().toLowerCase()])).rows[0];
  const baseline=(await pool.query(`SELECT e.baseline_ec,e.baseline_at FROM spff.ec_dose_estimates e
    JOIN spff.hst_fertilization_phases phase USING(phase_id) WHERE phase.site_id=$1 AND phase.device_id=$2
    AND lower(e.profile_snapshot->>'product')=$3 ORDER BY e.updated_at DESC LIMIT 1`,[site,device,product.trim().toLowerCase()])).rows[0];
  return {deviceId:device,profile:p?{product:p.product,coefficient:p.coefficient,validated:p.validated,
    calibrationReference:p.calibration_reference,revision:p.revision}:null,
    baseline:baseline?{ecUsCm:baseline.baseline_ec,recordedAt:baseline.baseline_at.toISOString()}:null};
}

export async function saveEcDoseSettings(device:string,input:unknown,actor:string) {
  const data=ecDoseProfileInputSchema.parse(input),c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`ec-dose:${site}:${device}:${data.product.toLowerCase()}`]);
    if(!(await c.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled',[site,device])).rows.length)
      throw Object.assign(new Error('Perangkat tidak tersedia.'),{status:404});
    const existing=(await c.query('SELECT revision FROM spff.ec_dose_profiles WHERE site_id=$1 AND device_id=$2 AND product_key=$3 FOR UPDATE',
      [site,device,data.product.toLowerCase()])).rows[0];
    if((existing?.revision??0)!==data.expectedRevision) throw Object.assign(new Error('Pengaturan berubah. Muat ulang sebelum menyimpan.'),{status:409});
    await c.query(`INSERT INTO spff.ec_dose_profiles(site_id,device_id,product_key,product,coefficient,validated,calibration_reference,revision,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8) ON CONFLICT(site_id,device_id,product_key) DO UPDATE SET
      product=EXCLUDED.product,coefficient=EXCLUDED.coefficient,validated=EXCLUDED.validated,
      calibration_reference=EXCLUDED.calibration_reference,revision=ec_dose_profiles.revision+1,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [site,device,data.product.toLowerCase(),data.product,data.coefficient,data.validated,data.calibrationReference,actor]);
    await c.query('COMMIT');
  } catch(error) {await c.query('ROLLBACK');throw error;} finally {c.release();}
  return readEcDoseSettings(device,data.product);
}
