import {createHash,randomUUID} from 'node:crypto';
import {buildGuideProgramPlan,guideProgramHst,type GuideActivity,type GuideProgram,type GuideProgramConfig,type GuideProgramInput,type GuideProgramPlan} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
import {readProtocolGuide,readProtocolGuideSnapshot} from './protocolGuideService.js';
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
export function activityFingerprint(activity:GuideActivity,config:GuideProgramConfig){
 return createHash('sha256').update(JSON.stringify({activity,cropId:config.cropId,plantingDate:config.plantingDate})).digest('hex');
}
async function validateDevice(config:GuideProgramConfig){
 if(config.deviceId&&!(await pool.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled',[siteId,config.deviceId])).rows.length)fail(400,'Perangkat tidak tersedia pada lokasi ini.');
}
export async function previewGuideProgram(config:GuideProgramConfig){
 await validateDevice(config);
 const source=await readProtocolGuideSnapshot(config.cropId);
 return {sourceSha256:source.sourceSha256,guideRevision:source.guideRevision,plan:buildGuideProgramPlan(source.sheet,config)};
}
type ProgramRow={program_id:string;revision:number;config:GuideProgramConfig;source_sha256:string;guide_revision:string|number;plan:GuideProgramPlan;created_at:Date;updated_at:Date;updated_by:string};
async function hydrate(row:ProgramRow):Promise<GuideProgram>{
 const latest=await readProtocolGuide(row.config.cropId);
 const completions=(await pool.query('SELECT * FROM spff.guide_program_completions WHERE site_id=$1 AND program_id=$2 ORDER BY completed_at DESC',[siteId,row.program_id])).rows;
 return {programId:row.program_id,revision:row.revision,config:row.config,sourceSha256:row.source_sha256,guideRevision:Number(row.guide_revision),plan:row.plan,
 createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),updatedBy:row.updated_by,hst:guideProgramHst(row.config.plantingDate),latestGuideRevision:latest.revision,
 sourceChanged:latest.sourceSha256!==row.source_sha256||latest.revision!==Number(row.guide_revision),
 completedActivityIds:(row.plan.activities as GuideActivity[]).filter(activity=>completions.some(c=>c.activity_fingerprint===activityFingerprint(activity,row.config))).map(a=>a.id),
 completions:completions.map(c=>({activityId:c.activity_id,activityFingerprint:c.activity_fingerprint,completedAt:c.completed_at.toISOString(),actor:c.actor,note:c.note,programRevision:c.program_revision}))};
}
export async function listGuidePrograms(){
 const rows=(await pool.query('SELECT * FROM spff.guide_programs WHERE site_id=$1 ORDER BY created_at DESC',[siteId])).rows;
 return Promise.all(rows.map(hydrate));
}
export async function saveGuideProgram(input:GuideProgramInput,actor:string,id?:string,expectedRevision?:number){
 await validateDevice(input.config);
 const source=await readProtocolGuideSnapshot(input.config.cropId);
 if(input.sourceSha256!==source.sourceSha256||input.guideRevision!==source.guideRevision)fail(409,'Panduan berubah. Hitung dan tinjau kembali sebelum menyimpan.');
 const plan=buildGuideProgramPlan(source.sheet,input.config),client=await pool.connect();
 let saved;
 try{
  await client.query('BEGIN');
  let revision=1;const programId=id??randomUUID();
  if(id){
   const current=(await client.query('SELECT revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2 FOR UPDATE',[siteId,id])).rows[0];
   if(!current)fail(404,'Program tidak ditemukan.');
   if(current.revision!==expectedRevision)fail(409,'Program berubah. Muat ulang lalu tinjau kembali.');
   revision=current.revision+1;
  }
  const args=[siteId,programId,revision,JSON.stringify(input.config),source.sourceSha256,source.guideRevision,JSON.stringify(source.sheet),JSON.stringify(plan),actor];
  saved=(await client.query(id?`UPDATE spff.guide_programs SET revision=$3,config=$4,source_sha256=$5,guide_revision=$6,sheet_snapshot=$7,plan=$8,updated_by=$9,updated_at=clock_timestamp() WHERE site_id=$1 AND program_id=$2 RETURNING *`:
   `INSERT INTO spff.guide_programs(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,args)).rows[0];
  await client.query(`INSERT INTO spff.guide_program_revisions(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,actor)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,args);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return hydrate(saved);
}
export async function completeGuideActivity(id:string,expectedRevision:number,activityId:string,note:string,actor:string){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const row=(await client.query('SELECT * FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2 FOR UPDATE',[siteId,id])).rows[0];
  if(!row)fail(404,'Program tidak ditemukan.');
  if(row.revision!==expectedRevision)fail(409,'Program berubah. Muat ulang sebelum menandai kegiatan.');
  const activity=(row.plan.activities as GuideActivity[]).find(a=>a.id===activityId);
  if(!activity)fail(404,'Kegiatan tidak ditemukan.');
  if(activity.hst===null||activity.hst>guideProgramHst(row.config.plantingDate))fail(409,'Kegiatan belum waktunya atau HST belum valid.');
  await client.query(`INSERT INTO spff.guide_program_completions(site_id,program_id,activity_id,activity_fingerprint,program_revision,activity_snapshot,actor,note)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[siteId,id,activityId,activityFingerprint(activity,row.config),row.revision,JSON.stringify(activity),actor,note]);
  await client.query('COMMIT');return {completed:true};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function readGuideProgramHistory(id:string){
 const result=await pool.query('SELECT revision,guide_revision,config,plan,actor,saved_at FROM spff.guide_program_revisions WHERE site_id=$1 AND program_id=$2 ORDER BY revision DESC LIMIT 20',[siteId,id]);
 return result.rows.map(row=>({revision:row.revision,guideRevision:Number(row.guide_revision),config:row.config,plan:row.plan,actor:row.actor,savedAt:row.saved_at.toISOString()}));
}
