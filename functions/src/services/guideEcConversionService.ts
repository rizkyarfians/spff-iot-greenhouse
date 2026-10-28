import {createHash} from 'node:crypto';
import {guideEcRecipe,convertGuideEc,type GuideActivity,type GuideProgramConfig,type GuideEcConversion,type GuideEcProfile,type GuideEcProfileInput} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
const keyFor=(key:string)=>createHash('sha256').update(key).digest('hex');
const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
async function program(id:string,database:Pick<typeof pool,'query'>=pool){const row=(await database.query('SELECT * FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',[siteId,id])).rows[0];return row??fail(404,'Program tidak ditemukan.');}
export async function readGuideEcConversions(id:string,database:Pick<typeof pool,'query'>=pool):Promise<GuideEcConversion[]>{
 const p=await program(id,database),profiles=(await database.query('SELECT * FROM spff.guide_ec_profiles WHERE site_id=$1',[siteId])).rows;
 return (p.plan.activities as GuideActivity[]).map(activity=>{
  const recipe=guideEcRecipe(activity),recipeKey=recipe?keyFor(recipe.key):null,row=profiles.find(profile=>profile.recipe_key===recipeKey);
  const profile:GuideEcProfile|null=row?{...row.profile,recipeKey,revision:row.revision,updatedBy:row.updated_by,updatedAt:row.updated_at.toISOString()}:null;
  const base:GuideEcConversion={activityId:activity.id,status:'blocked',reason:'Resep/volume/satuan belum valid untuk konversi.',recipeKey,concentrationGPerL:recipe?.concentrationGPerL??null,targetEcMsCm:null,profile,automaticExecutionEnabled:false};
  if(!recipe)return base;
  if(!profile)return {...base,reason:'Profil konversi untuk campuran ini belum tersedia.'};
  const water=(p.config as GuideProgramConfig).waterEcMsCm;
  if(water===undefined)return {...base,reason:'EC air baku belum diisi pada pengaturan program.'};
  const target=convertGuideEc(recipe.concentrationGPerL,water,profile);
  if(target===null)return {...base,reason:'Konsentrasi di luar rentang profil atau profil tidak valid. Tidak dilakukan ekstrapolasi.'};
  return {...base,status:'ready',reason:'Target EC larutan hasil konversi. Eksekusi otomatis belum dihubungkan.',targetEcMsCm:target};
 });
}
export async function saveGuideEcProfile(id:string,input:GuideEcProfileInput,actor:string){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const p=(await client.query('SELECT * FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2 FOR SHARE',[siteId,id])).rows[0];
  if(!p)fail(404,'Program tidak ditemukan.');
  if(p.revision!==input.expectedProgramRevision)fail(409,'Program berubah. Muat ulang sebelum menyimpan profil.');
  const activity=(p.plan.activities as GuideActivity[]).find(a=>a.id===input.activityId),recipe=activity?guideEcRecipe(activity):null;
  if(!recipe)return fail(400,'Resep tidak dapat dikonversi. Periksa massa pupuk, satuan dan volume larutan.');
  const recipeKey=keyFor(recipe.key);
  // Serialize first inserts and subsequent edits for this exact site + recipe.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guide-ec:${siteId}:${recipeKey}`]);
  const existing=(await client.query('SELECT revision FROM spff.guide_ec_profiles WHERE site_id=$1 AND recipe_key=$2 FOR UPDATE',[siteId,recipeKey])).rows[0];
  if((existing?.revision??0)!==input.expectedProfileRevision)fail(409,'Profil konversi berubah. Muat ulang sebelum menyimpan.');
  const revision=(existing?.revision??0)+1;
  const profile={sourceReference:input.sourceReference,referenceWaterEcMsCm:input.referenceWaterEcMsCm,temperatureCompensated25C:input.temperatureCompensated25C,mixtureVerified:input.mixtureVerified,points:input.points};
  await client.query(`INSERT INTO spff.guide_ec_profiles(site_id,recipe_key,revision,profile,updated_by)VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(site_id,recipe_key)DO UPDATE SET revision=$3,profile=$4,updated_by=$5,updated_at=clock_timestamp()`,[siteId,recipeKey,revision,JSON.stringify(profile),actor]);
  await client.query('INSERT INTO spff.guide_ec_profile_revisions(site_id,recipe_key,revision,profile,actor)VALUES($1,$2,$3,$4,$5)',[siteId,recipeKey,revision,JSON.stringify(profile),actor]);
  await client.query('COMMIT');return {revision};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
