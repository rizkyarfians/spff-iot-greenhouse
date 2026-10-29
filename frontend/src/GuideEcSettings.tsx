import {useRef,useState} from 'react'
import {guideEcProfileSchema,guideEcRecipe,type GuideActivity,type GuideEcConversion,type GuideProgram} from '@spff/contracts'
import {saveGuideEcProfile} from './api'
import {guideEcDisplay} from './guideEcDisplay'
import './GuideEcSettings.css'
const fmt=(value:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value)
export function GuideEcSettings({program,activity,conversion,onSaved,onWater}:{program:GuideProgram;activity:GuideActivity;conversion?:GuideEcConversion;onSaved:()=>void;onWater:()=>void}){
 const [open,setOpen]=useState(false)
 const state=guideEcDisplay(activity,conversion),recipe=guideEcRecipe(activity)
 if(state.kind==='dry')return null
 return <div className="gp-ec-settings">
  <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>Atur konversi EC</button>
  {open&&<div className="gp-ec-editor"><p>Konsentrasi campuran: <strong>{recipe?fmt(recipe.concentrationGPerL)+' g/L':'Belum dapat dihitung'}</strong></p><p>EC air baku: <strong>{program.config.waterEcMsCm===undefined?'Belum diisi':fmt(program.config.waterEcMsCm)+' mS/cm'}</strong></p><button type="button" onClick={onWater}>Ubah EC air baku</button>
   {!conversion?<p>Memuat profil konversi…</p>:!recipe?<p className="gp-warning">Lengkapi massa bahan dalam gram/kg dan volume larutan pada Panduan. Bahan mL memerlukan data massa yang terverifikasi.</p>:<EcProfileEditor program={program} activity={activity} conversion={conversion} onSaved={onSaved}/>}
  </div>}
 </div>
}
function EcProfileEditor({program,activity,conversion,onSaved}:{program:GuideProgram;activity:GuideActivity;conversion?:GuideEcConversion;onSaved:()=>void}){
 const [expectedProgramRevision]=useState(program.revision)
 const profile=conversion?.profile
 const [reference,setReference]=useState(profile?.sourceReference??''),[water,setWater]=useState(profile?String(profile.referenceWaterEcMsCm):'')
 const [points,setPoints]=useState(profile?profile.points.slice(1).map(p=>({concentration:String(p.concentrationGPerL),ec:String(p.ecMsCm)})):[{concentration:'',ec:''}])
 const [verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [expectedRevision,setExpectedRevision]=useState(profile?.revision??0)
 const lock=useRef(false)
 async function save(){
  if(lock.current)return
  setError('');setNotice('')
  if(!verified){setError('Konfirmasi sumber data dan campuran terlebih dahulu.');return}
  if(!water.trim()||points.some(p=>!p.concentration.trim()||!p.ec.trim())){setError('Lengkapi semua titik pengukuran.');return}
  const parsed=guideEcProfileSchema.safeParse({expectedProgramRevision,expectedProfileRevision:expectedRevision,activityId:activity.id,sourceReference:reference,referenceWaterEcMsCm:Number(water),temperatureCompensated25C:true,mixtureVerified:true,points:[{concentrationGPerL:0,ecMsCm:Number(water)},...points.map(p=>({concentrationGPerL:Number(p.concentration),ecMsCm:Number(p.ec)}))]})
  if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join(' '));return}
  lock.current=true;setBusy(true)
  try{const result=await saveGuideEcProfile(program.programId,parsed.data);setExpectedRevision(result.revision);setVerified(false);setNotice('Profil tersimpan. Target EC diperbarui.');onSaved()}catch(e){setError(e instanceof Error?e.message:'Profil belum tersimpan.')}finally{lock.current=false;setBusy(false)}
 }
 return <section aria-label={`Profil konversi ${activity.title}`}>
  <fieldset disabled={busy}><label>Sumber data<input value={reference} maxLength={1000} onChange={e=>{setReference(e.target.value);setVerified(false)}} placeholder="Referensi produsen atau catatan hasil uji"/></label>
   <label>EC air pada pengujian (mS/cm)<input type="number" min="0" max="20" step="any" value={water} onChange={e=>{setWater(e.target.value);setVerified(false)}}/></label>
   <div className="gp-ec-point gp-ec-point-heading"><span>Konsentrasi (g/L)</span><span>EC terukur (mS/cm)</span><span/></div>
   <div className="gp-ec-point"><span>0 (air tanpa pupuk)</span><span>{water||'—'}</span><span/></div>
   {points.map((point,index)=><div className="gp-ec-point" key={index}><input aria-label={`Konsentrasi titik ${index+1} g/L`} type="number" min="0" max="1000" step="any" value={point.concentration} onChange={e=>{setPoints(rows=>rows.map((p,i)=>i===index?{...p,concentration:e.target.value}:p));setVerified(false)}}/><input aria-label={`EC titik ${index+1} mS/cm`} type="number" min="0" max="100" step="any" value={point.ec} onChange={e=>{setPoints(rows=>rows.map((p,i)=>i===index?{...p,ec:e.target.value}:p));setVerified(false)}}/><button type="button" disabled={points.length===1} aria-label={`Hapus titik ${index+1}`} onClick={()=>{setPoints(rows=>rows.filter((_,i)=>i!==index));setVerified(false)}}>×</button></div>)}
   <button type="button" disabled={points.length>=29} onClick={()=>{setPoints(rows=>[...rows,{concentration:'',ec:''}]);setVerified(false)}}>Tambah titik uji</button>
   <label className="gp-ec-verify"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>Data berlaku untuk produk dan perbandingan campuran ini, pada acuan 25°C.</label>
   <p>Gunakan data produsen atau hasil ukur. Target hanya dihitung di dalam rentang pengujian.</p>
  </fieldset>
  {error&&<p role="alert" className="gp-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" className="gp-primary" disabled={busy||!verified} onClick={()=>void save()}>{busy?'Menyimpan…':'Simpan profil konversi'}</button>
 </section>
}
