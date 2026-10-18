import type { FertigationLiveDecision, FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';

const fresh=(date:Date|null, now:Date, limitSeconds:number):boolean =>
  date!==null && now.getTime()-date.getTime()>=0 && now.getTime()-date.getTime()<=limitSeconds*1000;

function jakartaDay(now:Date):string {
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(now);
}

function hstFor(plantingDate:string|null, today:string):number|null {
  if (!plantingDate) return null;
  const days=(Date.parse(today+'T00:00:00Z')-Date.parse(plantingDate+'T00:00:00Z'))/86400000;
  return Number.isSafeInteger(days) && days>=0 ? days:null;
}

/** Advisory decision only; real automatic selector position needs explicit hardware proof. */
export function evaluateSiteFertigation(recipe:FertigationRecipe,deviceId:string,snapshot:SiteEvaluationSnapshot,now=new Date()):FertigationLiveDecision {
  const reasons:string[]=[];
  const hst=hstFor(recipe.plantingDate,jakartaDay(now));
  const telemetryFresh=fresh(snapshot.telemetryRecordedAt,now,120);
  const deviceFresh=fresh(snapshot.deviceRecordedAt,now,90);
  if(recipe.approvalStatus!=='approved'||!recipe.approvalReference) reasons.push('Resep belum disetujui tim agronomi.');
  if(hst===null||hst<recipe.hstFrom||hst>recipe.hstTo) reasons.push('Tanggal tanam atau HST tidak sesuai resep.');
  if(!recipe.applicationDate||recipe.applicationDate!==jakartaDay(now)) reasons.push('Tanggal aplikasi tidak dijadwalkan hari ini.');
  if(!telemetryFresh) reasons.push('Telemetry terbaru tidak tersedia atau sudah stale.');
  if(!deviceFresh||snapshot.deviceOnline!==true) reasons.push('Status ESP32 tidak tersedia, stale, atau offline.');
  if(snapshot.deviceMode!=='automatic'||snapshot.automaticMode!=='automatic') reasons.push('Mode otomatis perangkat tidak terkonfirmasi.');
  // Physical selector is not reported in a dedicated field: do not present as an execution permit.
  if(!snapshot.flowWaterValid||(recipe.targetStockL>0&&!snapshot.flowStockValid)) reasons.push('Sensor flow meter tidak valid atau tidak tersedia.');
  if(!snapshot.waterTankValid||snapshot.waterTankPercent===null||snapshot.waterTankPercent<recipe.minWaterTankPercent) reasons.push('Level tangki air tidak tersedia atau di bawah batas.');
  if(recipe.targetStockL>0&&(!snapshot.stockTankValid||snapshot.stockTankPercent===null||snapshot.stockTankPercent<recipe.minStockTankPercent)) reasons.push('Level tangki pupuk tidak tersedia atau di bawah batas.');
  const ready=reasons.length===0;
  return {
    recipeId:recipe.recipeId,deviceId,source:'site-postgresql',
    siteObservedAt:now.toISOString(),hst,
    telemetryRecordedAt:snapshot.telemetryRecordedAt?.toISOString()??null,
    deviceRecordedAt:snapshot.deviceRecordedAt?.toISOString()??null,
    decision:{
      modelId:'rule-based-v1',simulationOnly:true,
      status:ready?'suggested':'hold',
      action:ready?(recipe.targetStockL>0?'FERTIGATE':'IRRIGATE'):'DELAY',
      targetWaterL:ready?recipe.targetWaterL:null,
      targetStockL:ready?recipe.targetStockL:null,
      reasons:ready?['Rekomendasi berdasarkan data site. Bukan izin menggerakkan pompa; posisi selector fisik dan kontrol volume belum terverifikasi.']:reasons,
      requiresApproval:true,publishable:false,
    },
  };
}
