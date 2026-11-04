import {pool,configuredSiteId as siteId} from './postgresRepository.js';
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status});};
type Queryable=Pick<typeof pool,'query'>;
export async function readHstMode(database:Queryable=pool){
 const row=(await database.query('SELECT shadow_enabled,changed_at FROM spff.hst_execution_modes WHERE site_id=$1',[siteId])).rows[0];
 // Missing row, database failure, or old schema must never grant pump authority.
 return {shadowEnabled:row?.shadow_enabled===false?false:true,
   updatedAt:row?.changed_at instanceof Date?row.changed_at.toISOString():new Date(0).toISOString()};
}
export async function requireHstRealMode(database:Queryable=pool){
 const row=(await database.query('SELECT shadow_enabled FROM spff.hst_execution_modes WHERE site_id=$1 FOR SHARE',[siteId])).rows[0];
 if(!row||row.shadow_enabled!==false)return fail('SHADOW MODE masih ON. Matikan lewat dashboard admin sebelum ACC real.');
}
export async function setHstMode(shadowEnabled:boolean,actor:string){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  // Serialize mode flips with creation of an HST adaptive START. If a physical
  // session already exists, operator must STOP and reconcile it first.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ 'hst-mode:'+siteId ]);
  const current=(await c.query('SELECT shadow_enabled FROM spff.hst_execution_modes WHERE site_id=$1 FOR UPDATE',[siteId])).rows[0];
  if(!current)return fail('Konfigurasi SHADOW lokal belum tersedia; migration 038 belum diterapkan.',503);
  if(shadowEnabled&&current.shadow_enabled===false){
   const active=(await c.query(`SELECT 1 FROM spff.hst_real_sessions h
    JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
    WHERE h.site_id=$1 AND s.status NOT IN ('completed','fault')
    LIMIT 1`,[siteId])).rows[0];
   if(active)return fail('Sesi pompa masih aktif/meragukan. STOP dan rekonsiliasi sebelum SHADOW ON.');
  }
  const result=(await c.query(`UPDATE spff.hst_execution_modes SET shadow_enabled=$2,changed_by=$3,changed_at=now()
   WHERE site_id=$1 RETURNING shadow_enabled,changed_at`,[siteId,shadowEnabled,actor])).rows[0];
  await c.query('COMMIT');
  return {shadowEnabled:result.shadow_enabled as boolean,
    updatedAt:(result.changed_at as Date).toISOString()};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
