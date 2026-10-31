import type {GuideEcConversion} from '@spff/contracts'

/** A conversion target belongs to one selected activity, not idle MCU defaults. */
export function conversionTarget(activityId:string,conversion?:GuideEcConversion){
 if(!conversion||conversion.activityId!==activityId)return {ready:false,targetMsCm:null,targetUsCm:null,concentrationGPerL:null,reason:'Hasil konversi kegiatan belum tersedia.'}
 const target=conversion.targetEcMsCm
 const ready=conversion.status==='ready'&&typeof target==='number'&&Number.isFinite(target)&&target>=0
 const concentration=conversion.concentrationGPerL
 return {ready,targetMsCm:ready?target:null,targetUsCm:ready?target*1000:null,
  concentrationGPerL:typeof concentration==='number'&&Number.isFinite(concentration)&&concentration>=0?concentration:null,
  reason:ready?null:conversion.reason||'Hasil konversi kegiatan belum tersedia.'}
}
