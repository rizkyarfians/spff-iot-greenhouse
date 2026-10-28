import {useEffect,useRef,useState} from 'react'
import type {GuideEcConversion,GuideProgram} from '@spff/contracts'
import {guideEcProfileSchema} from '@spff/contracts'
import {fetchGuideEcConversions,saveGuideEcProfile} from './api'
const emptyPoints=()=>[{concentration:'',ec:''},{concentration:'',ec:''}]
export function GuideEcPanel({program,activityId,admin}:{program:GuideProgram;activityId:string;admin:boolean}){
 const [info,setInfo]=useState<GuideEcConversion|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false)
 const [reference,setReference]=useState(''),[water,setWater]=useState(''),[points,setPoints]=useState(emptyPoints),[verified,setVerified]=useState(false)
 const lock=useRef(false)
 useEffect(()=>{
  let active=true;setInfo(null);setError('');setNotice('');setVerified(false)
  void fetchGuideEcConversions(program.programId).then(rows=>{
   if(!active)return
   const result=rows.find(row=>row.activityId===activityId)??null;setInfo(result)
   setReference(result?.profile?.sourceReference??'');setWater(result?.profile?String(result.profile.referenceWaterEcMsCm):'')
   setPoints(result?.profile?.points.map(p=>({concentration:String(p.concentrationGPerL),ec:String(p.ecMsCm)}))??emptyPoints())
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Konversi belum dapat dimuat.')})
  return()=>{active=false}
 },[program.programId,program.revision,activityId,reload])
 async function save(){
  if(lock.current||!info)return
  const result=guideEcProfileSchema.safeParse({expectedProgramRevision:program.revision,expectedProfileRevision:info.profile?.revision??0,activityId,sourceReference:reference,referenceWaterEcMsCm:water.trim()===''?null:Number(water),temperatureCompensated25C:verified,mixtureVerified:verified,points:points.map(p=>({concentrationGPerL:p.concentration.trim()===''?null:Number(p.concentration),ecMsCm:p.ec.trim()===''?null:Number(p.ec)}))})
  if(!result.success){setError(result.error.issues.map(i=>i.message).join(' '));return}
  lock.current=true;setBusy(true);setError('');setNotice('')
  try{await saveGuideEcProfile(program.programId,result.data);setReload(n=>n+1);setNotice('Profil konversi tersimpan.')}catch(e){setError(e instanceof Error?e.message:'Profil belum tersimpan.')}finally{setBusy(false);lock.current=false}
 }
 return <section className="gp-ec-panel" aria-label="Konversi EC larutan">
  <h4>Target EC dari resep</h4>
  {error&&<p className="gp-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!info&&!error&&<p>Memuat konversi…</p>}
  {info&&<><strong className="gp-ec-target">{info.targetEcMsCm===null?'Konversi belum tersedia':`${new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(info.targetEcMsCm)} mS/cm`}</strong>
   <p>{info.reason}</p>
   <details><summary>Dasar konversi</summary><p>Konsentrasi resep: {info.concentrationGPerL===null?'—':`${info.concentrationGPerL.toFixed(3)} g/L`} · EC air baku: {program.config.waterEcMsCm??'belum diisi'} mS/cm.</p>{info.profile&&<><p>Sumber: {info.profile.sourceReference}</p><p>Profil revisi {info.profile.revision} · {info.profile.updatedBy} · acuan 25°C.</p></>}<p>Target ini untuk larutan akhir, bukan EC tanah. Angka antarhari tidak dijumlahkan. Eksekusi pompa belum dihubungkan.</p></details>
   {admin&&info.recipeKey&&<details><summary>{info.profile?'Ubah profil konversi':'Tambahkan profil konversi'}</summary>
    <form onSubmit={event=>{event.preventDefault();void save()}}><fieldset disabled={busy}>
     <p>Isi data produsen atau hasil pengukuran campuran yang sama. Titik pertama: 0 g/L dan EC air acuan. Semua EC dinyatakan pada 25°C.</p>
     <label>Sumber data / referensi pengukuran<input required minLength={5} maxLength={1000} value={reference} onChange={e=>setReference(e.target.value)}/></label>
     <label>EC air acuan saat membuat profil (mS/cm)<input type="number" required min={0} max={20} step="any" value={water} onChange={e=>setWater(e.target.value)}/></label>
     <div className="gp-ec-points"><div aria-hidden="true"><strong>Konsentrasi (g/L)</strong><strong>EC larutan (mS/cm)</strong><span/></div>{points.map((point,index)=><div key={index}><input aria-label={`Konsentrasi titik ${index+1} g/L`} required type="number" min={0} max={1000} step="any" value={point.concentration} onChange={e=>setPoints(rows=>rows.map((p,i)=>i===index?{...p,concentration:e.target.value}:p))}/><input aria-label={`EC titik ${index+1} mS/cm`} required type="number" min={0} max={100} step="any" value={point.ec} onChange={e=>setPoints(rows=>rows.map((p,i)=>i===index?{...p,ec:e.target.value}:p))}/><button type="button" disabled={points.length<=2} aria-label={`Hapus titik ${index+1}`} onClick={()=>setPoints(rows=>rows.filter((_,i)=>i!==index))}>×</button></div>)}</div>
     <button type="button" disabled={points.length>=30} onClick={()=>setPoints(rows=>[...rows,{concentration:'',ec:''}])}>Tambah titik</button>
     <label className="gp-ec-check"><input type="checkbox" required checked={verified} onChange={e=>setVerified(e.target.checked)}/>Saya memastikan profil sesuai produk dan rasio campuran ini, dengan EC mengacu ke 25°C.</label>
     <button className="gp-primary" type="submit">{busy?'Menyimpan…':'Simpan profil'}</button>
    </fieldset></form>
   </details>}
  </>}
 </section>
}
