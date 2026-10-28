import {z} from 'zod';
import type {GuideEditValue} from './protocolGuideEdits.js';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(`${value}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;},'Tanggal tanam tidak valid.');
export const guideProgramConfigSchema=z.object({
 cropId:z.string().min(1).max(80),plantingDate:date,basis:z.enum(['plants','area']),quantity:z.number().positive().max(1e7),
 deviceId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).nullable().default(null),
}).strict().refine(value=>value.basis!=='plants'||Number.isInteger(value.quantity),'Jumlah tanaman harus bulat.');
export const guideProgramCreateSchema=z.object({config:guideProgramConfigSchema,sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),guideRevision:z.number().int().min(0)}).strict();
export const guideProgramUpdateSchema=guideProgramCreateSchema.extend({expectedRevision:z.number().int().min(1)});
export const guideProgramCompleteSchema=z.object({expectedRevision:z.number().int().min(1),activityId:z.string().regex(/^row-\d+$/),note:z.string().trim().max(500).default('')}).strict();
export type GuideProgramConfig=z.infer<typeof guideProgramConfigSchema>;
export type GuideProgramInput=z.infer<typeof guideProgramCreateSchema>;
export type GuideSheetSnapshot={id:string;sheetName:string;cropName:string;headerRow:number;lastRow:number;columnCount:number;merges:string[];cells:Record<string,{value:GuideEditValue;display:string}|undefined>};
export type GuideRequirement={row:number;product:string;dose:number|null;doseUnit:string;sourceAmount:number|null;sourceUnit:string;scaledSourceAmount:number|null;amount:number|null;unit:string;waterL:number|null;concentrationGPerL:number|null;warnings:string[]};
export type GuideActivity={id:string;hst:number|null;title:string;method:string;waterL:number|null;requirements:GuideRequirement[];sourceRows:number[];warnings:string[]};
export type GuideProgramPlan={cropName:string;sourceArea:number;sourcePlants:number;area:number;plants:number;scale:number;activities:GuideActivity[]};
export type GuideProgram={programId:string;revision:number;config:GuideProgramConfig;sourceSha256:string;guideRevision:number;plan:GuideProgramPlan;createdAt:string;updatedAt:string;updatedBy:string;hst:number;latestGuideRevision:number;sourceChanged:boolean;completedActivityIds:string[];completions:{activityId:string;activityFingerprint:string;completedAt:string;actor:string;note:string;programRevision:number}[]};
export type GuideProgramPreview={sourceSha256:string;guideRevision:number;plan:GuideProgramPlan};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
/** Resolve only explicit Excel merges. Blank cells are not forward-filled. */
function cellAt(sheet:GuideSheetSnapshot,column:string,row:number){
 for(const range of sheet.merges){const match=/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);if(match&&column>=match[1]&&column<=match[3]&&row>=+match[2]&&row<=+match[4])return sheet.cells[`${match[1]}${match[2]}`];}
 return sheet.cells[`${column}${row}`];
}
export function guideProgramHst(plantingDate:string,now=new Date()):number {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return Math.round((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${plantingDate}T00:00:00Z`))/86400000);
}
export function buildGuideProgramPlan(sheet:GuideSheetSnapshot,config:GuideProgramConfig):GuideProgramPlan {
 const sourceArea=number(sheet.cells.D3?.value),sourcePlants=number(sheet.cells.D7?.value);
 if(!sourceArea||sourceArea<=0||!sourcePlants||sourcePlants<=0)throw new Error('Luas/populasi acuan tidak valid.');
 const scale=config.quantity/(config.basis==='plants'?sourcePlants:sourceArea),plants=sourcePlants*scale,area=sourceArea*scale;
 const activities:GuideActivity[]=[];let group:GuideActivity|undefined,activityNumber:unknown;
 for(let row=sheet.headerRow+1;row<=sheet.lastRow;row++){
  const raw=(col:string)=>cellAt(sheet,col,row)?.value;
  const text=(col:string)=>typeof raw(col)==='string'?String(raw(col)).trim():'';
  const hst=number(raw('B')),a=raw('A'),title=text('C'),method=text('D'),product=text('E');
  if(!title&&!method&&!product)continue;
  if(!group||title||method||a!==activityNumber||hst!==group.hst){
   group={id:`row-${row}`,hst,title:title||'Kegiatan tanpa keterangan',method:method||'Belum ditentukan',waterL:null,requirements:[],sourceRows:[],warnings:[]};activities.push(group);
   if(!title)group.warnings.push('Keterangan kegiatan kosong pada Panduan.');
  }
  activityNumber=a;group.sourceRows.push(row);
  const sourceWater=number(raw('J')),waterL=sourceWater!==null?sourceWater*scale:null;
  if(waterL!==null&&waterL>0){if(group.waterL!==null&&Math.abs(group.waterL-waterL)>1e-6){if(!group.warnings.length||!group.warnings.includes('Volume pelarut berbeda antarproduk; jangan dijumlahkan sebagai satu batch.'))group.warnings.push('Volume pelarut berbeda antarproduk; jangan dijumlahkan sebagai satu batch.');}else group.waterL=waterL;}
  if(hst===null&&!group.warnings.includes('HST belum diisi.'))group.warnings.push('HST belum diisi.');
  if(!product)continue;
  const dose=number(raw('H')),doseUnit=text('I'),sourceAmount=number(raw('K')),sourceUnit=text('L');
  const req:GuideRequirement={row,product,dose,doseUnit,sourceAmount,sourceUnit,scaledSourceAmount:sourceAmount===null?null:sourceAmount*scale,amount:null,unit:'',waterL,concentrationGPerL:null,warnings:[]};
  const unit=doseUnit.toLowerCase().replace(/\s/g,'').replace(/gram|gr/g,'g').replace(/tan\.?/g,'tan');
  if(dose!==null&&dose>=0){
   if(['g/tan','kg/tan','ml/tan'].includes(unit)){req.amount=dose*plants;req.unit=unit.split('/')[0]==='ml'?'mL':unit.split('/')[0];}
   else if(['g/l','kg/l','ml/l'].includes(unit)){
    // A merged J is explicit shared water. Otherwise only the activity's own J is used below.
    const volume=waterL??group.waterL;if(volume!==null&&volume>0){req.amount=dose*volume;req.unit=unit.split('/')[0]==='ml'?'mL':unit.split('/')[0];}else req.warnings.push('Volume pelarut belum tersedia.');
   }else if(['kg/5000m2','g/5000m2','bait/5000m2'].includes(unit)){req.amount=dose*area/5000;req.unit=unit.split('/')[0];}
   else req.warnings.push('Satuan dosis perlu ditinjau.');
  }else req.warnings.push('Dosis belum valid.');
  if(req.unit==='g'&&sourceUnit.toLowerCase()==='kg'&&req.amount!==null){req.amount/=1000;req.unit='kg';}
  if(req.amount!==null&&req.scaledSourceAmount!==null){
   const sourceNormalized=sourceUnit.toLowerCase().replace(/gram|gr/g,'g');
   if(sourceNormalized!==req.unit.toLowerCase())req.warnings.push('Satuan kebutuhan pada Panduan berbeda dari hasil hitung.');
   else if(Math.abs(req.amount-req.scaledSourceAmount)>Math.max(0.001,Math.abs(req.scaledSourceAmount)*0.01))req.warnings.push('Hasil hitung berbeda dari kebutuhan acuan; periksa dosis dan pembulatan.');
  }
  const volume=waterL??group.waterL;
  if(req.amount!==null&&volume!==null&&volume>0&&['g','kg'].includes(req.unit))req.concentrationGPerL=req.amount*(req.unit==='kg'?1000:1)/volume;
  group.requirements.push(req);
 }
 return {cropName:sheet.cropName,sourceArea,sourcePlants,area,plants,scale,activities};
}
export type GuideProgramRevision={revision:number;guideRevision:number;config:GuideProgramConfig;plan:GuideProgramPlan;actor:string;savedAt:string};
