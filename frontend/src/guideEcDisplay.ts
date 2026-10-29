import type {GuideActivity,GuideEcConversion} from '@spff/contracts'
export function guideEcDisplay(activity:GuideActivity,conversion?:GuideEcConversion){
 const method=activity.method.trim().toLowerCase()
 if(method==='tabur'||method==='tugal')return {kind:'dry' as const,target:null,label:'EC tidak berlaku untuk pemberian kering'}
 if(!activity.waterL||activity.waterL<=0)return {kind:'blocked' as const,target:null,label:'Volume larutan belum tersedia'}
 if(conversion?.status==='ready'&&conversion.targetEcMsCm!==null)return {kind:'ready' as const,target:conversion.targetEcMsCm,label:'Target EC'}
 if(!conversion)return {kind:'blocked' as const,target:null,label:'Memuat target EC…'}
 const reason=conversion.reason
 return {kind:'blocked' as const,target:null,label:reason.includes('air baku')?'Isi EC air baku':reason.includes('Profil konversi')?'Profil campuran belum tersedia':reason.includes('rentang')?'Konsentrasi di luar profil uji':'Periksa campuran dan satuan bahan'}
}
