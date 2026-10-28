import {readFileSync} from 'node:fs';
import type {GuideEditValue,ProtocolGuideSave,ProtocolGuideState,ProtocolGuideRevision} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
// One immutable source, also used by the frontend; present in the Orange Pi checkout.
const source=JSON.parse(readFileSync(new URL('../../../frontend/src/data/protocolGuide.json',import.meta.url),'utf8')) as {
 sourceSha256:string;sheets:{id:string;headerRow:number;lastRow:number;columnCount:number;merges:string[];cells:Record<string,{value:GuideEditValue}>}[]
};
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
function sheetFor(cropId:string){return source.sheets.find(sheet=>sheet.id===cropId)??fail(404,'Tanaman panduan tidak ditemukan.');}
const state=(cropId:string,row?:Record<string,unknown>):ProtocolGuideState=>({cropId,sourceSha256:String(row?.source_sha256??source.sourceSha256),revision:Number(row?.revision??0),
 overrides:(row?.overrides??{}) as Record<string,GuideEditValue>,updatedBy:row?String(row.updated_by):null,updatedAt:row?(row.updated_at as Date).toISOString():null});
export async function readProtocolGuide(cropId:string){
 sheetFor(cropId);
 const result=await pool.query('SELECT * FROM spff.protocol_guide_edits WHERE site_id=$1 AND crop_id=$2',[siteId,cropId]);
 return state(cropId,result.rows[0]);
}
function position(address:string){return {column:address.charCodeAt(0)-65,row:Number(address.slice(1))};}
export function validateGuideChanges(cropId:string,input:ProtocolGuideSave){
 const sheet=sheetFor(cropId);
 if(input.sourceSha256!==source.sourceSha256)fail(409,'Sumber panduan berubah. Muat ulang halaman sebelum mengedit.');
 for(const change of input.changes){
  const {column,row}=position(change.address);
  if(row<=sheet.headerRow||row>sheet.lastRow||column<0||column>=sheet.columnCount)fail(400,'Sel berada di luar tabel panduan.');
  for(const range of sheet.merges){const [first,last]=range.split(':');const start=position(first),end=position(last??first);
   if(change.address!==first&&row>=start.row&&row<=end.row&&column>=start.column&&column<=end.column)fail(400,'Edit sel utama pada bagian tabel yang digabung.');
  }
  const value=change.value;if(value===null)continue;
  if(column===6){if(typeof value!=='boolean')fail(400,'Kolom Cek harus berupa pilihan ya/tidak.');}
  else if([0,1,7,9,10,12,14,15].includes(column)){
   if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e9||(column!==1&&value<0)||([0,1].includes(column)&&!Number.isInteger(value)))fail(400,'Angka panduan tidak valid. HST boleh negatif untuk kegiatan sebelum tanam.');
  }else if(typeof value!=='string')fail(400,'Kolom keterangan harus berupa teks.');
 }
 return sheet;
}
export async function saveProtocolGuide(cropId:string,input:ProtocolGuideSave,actor:string){
 const sheet=validateGuideChanges(cropId,input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO spff.protocol_guide_edits(site_id,crop_id,source_sha256,updated_by)VALUES($1,$2,$3,$4)ON CONFLICT DO NOTHING`,[siteId,cropId,source.sourceSha256,actor]);
  const current=(await client.query('SELECT * FROM spff.protocol_guide_edits WHERE site_id=$1 AND crop_id=$2 FOR UPDATE',[siteId,cropId])).rows[0];
  if(Number(current.revision)!==input.expectedRevision||current.source_sha256!==input.sourceSha256)fail(409,'Panduan telah diubah pengguna lain. Batalkan edit, muat ulang, lalu ulangi perubahan.');
  const overrides={...current.overrides} as Record<string,GuideEditValue>;
  const changes=[] as ProtocolGuideRevision['changes'];
  for(const change of input.changes){
   const original=sheet.cells[change.address]?.value??null;
   const before=Object.hasOwn(overrides,change.address)?overrides[change.address]:original;
   if(before===change.value)continue;
   changes.push({address:change.address,before,after:change.value});
   if(change.value===original)delete overrides[change.address];else overrides[change.address]=change.value;
  }
  if(!changes.length){await client.query('COMMIT');return state(cropId,current);}
  const revision=Number(current.revision)+1;
  const result=await client.query(`UPDATE spff.protocol_guide_edits SET revision=$3,overrides=$4,updated_by=$5,updated_at=clock_timestamp()
   WHERE site_id=$1 AND crop_id=$2 RETURNING *`,[siteId,cropId,revision,JSON.stringify(overrides),actor]);
  await client.query(`INSERT INTO spff.protocol_guide_revisions(site_id,crop_id,revision,source_sha256,changes,overrides,note,actor)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[siteId,cropId,revision,input.sourceSha256,JSON.stringify(changes),JSON.stringify(overrides),input.note,actor]);
  await client.query('COMMIT');return state(cropId,result.rows[0]);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function readProtocolGuideHistory(cropId:string):Promise<ProtocolGuideRevision[]>{
 sheetFor(cropId);
 const result=await pool.query('SELECT revision,actor,saved_at,note,changes FROM spff.protocol_guide_revisions WHERE site_id=$1 AND crop_id=$2 ORDER BY revision DESC LIMIT 20',[siteId,cropId]);
 return result.rows.map(row=>({revision:Number(row.revision),actor:row.actor,savedAt:row.saved_at.toISOString(),note:row.note,changes:row.changes}));
}
