import {hstIrrigationDisplay} from './hstIrrigationSummary'
import {useEffect,useState} from 'react'
import {Check,Clock3,Cpu,Droplets,FlaskConical,Leaf,Radio,ShieldAlert} from 'lucide-react'
import type {AiHstMode,AiHstExecutionReadiness,AiHstProposal,AiHstRealSessionSummary,FertigationProgress} from '@spff/contracts'
import {fetchGuidePrograms,fetchAiHstProposals,fetchAiHstMode,fetchAiHstExecutionReadiness,fetchAiHstLiquidSummary,fetchAiHstRealLatest} from './api'
import './AiFertigationOverview.css'

const nf=new Intl.NumberFormat('id-ID',{maximumFractionDigits:2})
const finite=(n:number|null|undefined):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0
const amount=(n:number|null|undefined,unit:string)=>finite(n)?nf.format(n)+' '+unit:'—'
const time=(at:string|null|undefined)=>at?new Date(at).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'})+' WIB':'Belum ada data'
type Liquid=Awaited<ReturnType<typeof fetchAiHstLiquidSummary>>
type Overview={proposals:AiHstProposal[]|null;mode:AiHstMode|null;readiness:AiHstExecutionReadiness|null;liquid:Liquid|null}
function Inventory({label,value,capacity,stock=false}:{label:string;value:number|null|undefined;capacity:number|null|undefined;stock?:boolean}){
 const known=finite(value)
 const fill=known&&finite(capacity)&&capacity>0?Math.max(0,Math.min(100,value/capacity*100)):null
 return <div className={'afo-inventory'+(stock?' is-stock':'')}>
  <div className={'afo-tank'+(fill===null?' is-unknown':'')} aria-hidden="true">
   {fill!==null&&<span style={{height:fill+'%'}}/>}
  </div>
  <div><span>{label}</span><strong>{amount(value,'L')}</strong><small>{known?'Estimasi isi tandon':'Menunggu data valid'}</small></div>
 </div>
}
function VolumeBar({label,value,target}:{label:string;value:number|null;target:number|null}){
 const valid=finite(value)&&finite(target)&&target>0
 return <div className="afo-volume">
  <div><span>{label}</span><strong>{amount(value,'L')} <small>/ {amount(target,'L')}</small></strong></div>
  {valid?<progress aria-label={label} value={Math.min(value,target)} max={target}/>:<div className="afo-empty-meter" aria-label={label+' belum terkonfirmasi'}/>}
 </div>
}
/** Read-only overview. Every request below is a GET; ACC stays in the HST panel. */
export function AiFertigationOverview({deviceId,report}:{deviceId:string;report:FertigationProgress|null}){
 const [data,setData]=useState<Overview|null>(null)
 const [selected,setSelected]=useState('')
 const [session,setSession]=useState<AiHstRealSessionSummary|null>(null)
 const [sessionError,setSessionError]=useState(false)
 const [loading,setLoading]=useState(true)
 useEffect(()=>{
  const abort=new AbortController()
  let pending=false
  setData(null);setLoading(true)
  async function refresh(){
   if(pending)return
   pending=true
   try{
    const [programs,proposals,mode,readiness,liquid]=await Promise.allSettled([
     fetchGuidePrograms(),fetchAiHstProposals(abort.signal),fetchAiHstMode(abort.signal),
     fetchAiHstExecutionReadiness(abort.signal),fetchAiHstLiquidSummary(abort.signal),
    ])
    if(abort.signal.aborted)return
    const ids=new Set(programs.status==='fulfilled'?programs.value.filter(p=>p.config.deviceId===deviceId).map(p=>p.programId):[])
    setData({
     proposals:programs.status==='fulfilled'&&proposals.status==='fulfilled'?proposals.value.proposals.filter(p=>ids.has(p.program_id)):null,
     mode:mode.status==='fulfilled'?mode.value:null,
     readiness:readiness.status==='fulfilled'?readiness.value:null,
     liquid:liquid.status==='fulfilled'?liquid.value:null,
    })
   }finally{pending=false;if(!abort.signal.aborted)setLoading(false)}
  }
  void refresh()
  const timer=setInterval(()=>void refresh(),15000)
  return()=>{abort.abort();clearInterval(timer)}
 },[deviceId])
 const proposal=data?.proposals?.find(p=>p.obligation_id===selected)??data?.proposals?.find(p=>p.status!=='COMPLETED')??data?.proposals?.[0]
 const obligationId=proposal?.obligation_id
 useEffect(()=>{
  let active=true,pending=false
  setSession(null);setSessionError(false)
  if(!obligationId)return
  async function refresh(){
   if(pending)return
   pending=true
   try{
    const value=await fetchAiHstRealLatest(obligationId!)
    if(active){setSession(value);setSessionError(false)}
   }catch{if(active){setSession(null);setSessionError(true)}}
   finally{pending=false}
  }
  void refresh()
  const timer=setInterval(()=>void refresh(),5000)
  return()=>{active=false;clearInterval(timer)}
 },[obligationId,deviceId])
 // Never carry another selected duty's session into the new duty's render.
 const matched=session?.obligationId===obligationId?session:null
 const uncertain=matched?.status==='fault'||matched?.status==='reconciliation_required'
 const sessionAge=Date.now()-Date.parse(matched?.lastTelemetryAt??'')
 const sessionFresh=Number.isFinite(sessionAge)&&sessionAge>=0&&sessionAge<=90000
 const sensorFresh=report?.deviceId===deviceId&&report.telemetryFresh
 const fresh=sessionFresh||sensorFresh
 const real=data?.mode?.shadowEnabled===false
 const modeLabel=!data?.mode?'Mode belum tersedia':real?(data.readiness?.canDispatch?'REAL':'REAL terkunci'):'SHADOW'
 const statusLabel=sessionError?'Status sesi belum tersedia':uncertain?'Sesi perlu diperiksa':
  matched?.status==='completed'?'Sesi selesai':matched?.status==='paused'?'Sesi dijeda':
  matched?.status==='running'?(sessionFresh?'Sesi berjalan':'Menunggu data sesi'):
  matched?.status==='queued'?'Menunggu ACK perangkat':proposal?(real?'Menunggu ACC REAL':'Menunggu review HST'):
  loading?'Memuat data…':data?.proposals===null?'Usulan belum tersedia':'Belum ada usulan HST'
 const liquid=data?.liquid
 const sourceAge=Date.now()-Date.parse(liquid?.planning_recorded_at??'')
 const liquidFresh=liquid?.planning_status==='CURRENT'&&Number.isFinite(sourceAge)&&sourceAge>=-5000&&sourceAge<=120000
 const water=liquidFresh&&liquid?.tank_preview?.level_status==='ESTIMATED'?liquid.tank_preview.estimated_available_l:null
 const stock=liquidFresh&&liquid?.fertilizer_tank_preview?.level_status==='ESTIMATED'?liquid.fertilizer_tank_preview.estimated_liquid_volume_l:null
 const irrigation=hstIrrigationDisplay(liquid)
 const credited=proposal?.status!=='REQUIRES_REVIEW'&&proposal?.review_reasons.length===0
 const target=matched?matched.commandedFertL:proposal?.target_g
 const value=uncertain?null:matched?(matched.lastTelemetryAt?matched.fertVolumeL:null):(credited?proposal?.delivered_g:null)
 const percent=finite(value)&&finite(target)&&target>0?Math.max(0,Math.min(100,value/target*100)):null
 const unit=matched?'L':'kg'
 const displayedValue=matched?value:finite(value)?value/1000:null
 const displayedTarget=matched?target:finite(target)?target/1000:null
 const stages=[
  {name:'HST',icon:Leaf,reached:!!proposal},
  {name:'AI',icon:Cpu,reached:!!matched},
  {name:'ACC',icon:Check,reached:!!matched},
  {name:'ESP32',icon:Radio,reached:!!matched?.lastTelemetryAt},
  {name:'Sesi',icon:Droplets,reached:matched?.status==='completed',active:matched?.status==='running'&&sessionFresh&&!uncertain},
 ]
 return <section className="afo" aria-label="Ringkasan pemupukan dan eksekusi AI" aria-busy={loading}>
  <header className="afo-heading"><div><span className="afo-eyebrow"><Leaf size={13}/> PEMUPUKAN AI</span><h3>Tanaman &amp; eksekusi</h3></div><span className={'afo-mode'+(real?' is-real':'')}>{modeLabel}</span></header>
  <div className="afo-status" role="status"><span className={'afo-dot'+(fresh?' is-fresh':'')}/><strong>{statusLabel}</strong><small>{fresh?'Data terbaru':'Data alat belum terbaru'}</small></div>
  {data?.proposals&&data.proposals.length>1?<label className="afo-select">Kegiatan HST<select value={proposal?.obligation_id??''} onChange={event=>setSelected(event.target.value)}>{data.proposals.map(p=><option key={p.obligation_id} value={p.obligation_id}>HST {p.hst??'—'} · {p.product??'Pupuk'}</option>)}</select></label>:<p className="afo-crop">{proposal?<>HST {proposal.hst??'—'} <span>·</span> {proposal.product??'Pupuk'}</>:'Jadwal HST belum tersedia'}</p>}
  <div className="afo-inventories">
   <Inventory label="Air tandon" value={water} capacity={liquid?.tank_preview?.capacity_l}/>
   <Inventory label="Larutan pupuk" value={stock} capacity={liquid?.fertilizer_tank_preview?.capacity_l} stock/>
  </div>
  <div className="afo-dose">
   <div className="afo-ring" role="img" aria-label={percent===null?'Progres belum terkonfirmasi':'Progres '+nf.format(percent)+' persen'}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="afo-ring-track" cx="50" cy="50" r="41"/>{percent!==null&&<circle className="afo-ring-value" cx="50" cy="50" r="41" pathLength="100" strokeDasharray={percent+' 100'}/>}</svg>
    <span><strong>{percent===null?'—':Math.round(percent)+'%'}</strong><small>{matched?'Larutan sesi':'Pupuk tercatat'}</small></span>
   </div>
   <div className="afo-dose-numbers"><span><FlaskConical size={14}/> Progres pemupukan</span><strong>{amount(displayedValue,unit)} <small>/ {amount(displayedTarget,unit)}</small></strong><small>{matched?'Volume laporan perangkat':'Catatan dosis HST'}</small></div>
  </div>
  <div className="afo-fertilizer-remaining" aria-live="polite">
   <div><span>Sisa kebutuhan tanaman</span><small>{proposal?.product??'Pupuk'} · HST {proposal?.hst??'—'}</small></div>
   <strong>{credited&&!uncertain&&finite(proposal?.remaining_g)?amount(proposal.remaining_g/1000,'kg'):'Perlu verifikasi'}</strong>
  </div>
  <ol className="afo-pipeline" aria-label="Tahapan eksekusi AI">{stages.map(stage=><li key={stage.name} className={(stage.reached?'is-reached ':'')+(stage.active?'is-active':'')}><span><stage.icon size={17}/></span><small>{stage.name}</small><span className="afo-sr">{stage.active?'berjalan':stage.reached?'tercatat':'menunggu'}</span></li>)}</ol>
  {matched&&<div className="afo-session"><VolumeBar label="Air sesi" value={matched.lastTelemetryAt?matched.waterVolumeL:null} target={matched.commandedWaterL}/><VolumeBar label="Larutan stok sesi" value={matched.lastTelemetryAt?matched.fertVolumeL:null} target={matched.commandedFertL}/><small><Clock3 size={12}/> Laporan sesi {time(matched.lastTelemetryAt)}</small></div>}
  {liquid?.operational_profile&&<p className="afo-irrigation-note">{liquid.operational_profile.calculation_ready
    ?'Fuzzy: profil Panduan · maksimum '+amount(liquid.operational_profile.target_water_l,'L')
    :liquid.operational_profile.status==='MISSING'?'Fuzzy produksi: profil belum terpasang':'Fuzzy produksi: profil perlu ditinjau'}</p>}
  <div className="afo-remaining"><span>{irrigation.label}</span><strong>{amount(irrigation.valueL,'L')}</strong></div>
  <small className="afo-irrigation-note">{irrigation.note}</small>
  {(uncertain||sessionError)&&<p className="afo-alert"><ShieldAlert size={15}/> Periksa sesi sebelum melanjutkan.</p>}
  <footer><small>Estimasi tandon · {time(liquid?.planning_recorded_at)}</small><small>ACC di panel HST</small></footer>
 </section>
}

