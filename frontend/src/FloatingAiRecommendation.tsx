import {useEffect,useId,useRef,useState} from 'react'
import type {AutomaticCycleStatus} from '@spff/contracts'
import {Droplets,X} from 'lucide-react'
import {fetchAiHstLiquidSummary,fetchAutomaticCycleStatus} from './api'
import {HstPhaseCard} from './HstFertilizationNotice'
import {fuzzyIrrigationEstimate,recentTankReadings,tankDisplayEstimate} from './hstIrrigationSummary'
import './FloatingAiRecommendation.css'

const litres=new Intl.NumberFormat('id-ID',{maximumFractionDigits:2})
const readingTime=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit'})

function AutomaticSummary({deviceId}:{deviceId:string}){
 const [liquid,setLiquid]=useState<Awaited<ReturnType<typeof fetchAiHstLiquidSummary>>|null>(null)
 const [tankReadings,setTankReadings]=useState<ReturnType<typeof recentTankReadings>>([])
 const [cycle,setCycle]=useState<AutomaticCycleStatus|null>(null)
 const [loading,setLoading]=useState(true)
 useEffect(()=>{
  const controller=new AbortController()
  const {signal}=controller
  let pending=false
  async function refresh(){
   if(pending)return
   pending=true
   const fuzzyRequest=fetchAiHstLiquidSummary(signal).then(
    value=>{
     if(signal.aborted)return
     setLiquid(value)
     setTankReadings(previous=>recentTankReadings(previous,value))
    },
    ()=>{if(!signal.aborted)setLiquid(null)},
   )
   const cycleRequest=deviceId?fetchAutomaticCycleStatus(deviceId,signal).then(
    value=>{if(!signal.aborted)setCycle(value)},
    ()=>{if(!signal.aborted)setCycle(null)},
   ):undefined
   await Promise.all([fuzzyRequest,cycleRequest])
   pending=false
   if(!signal.aborted)setLoading(false)
  }
  void refresh()
  const timer=setInterval(()=>void refresh(),15000)
  return()=>{controller.abort();clearInterval(timer)}
 },[deviceId])
 const estimate=fuzzyIrrigationEstimate(liquid)
 const tank=tankDisplayEstimate(tankReadings,liquid)
 return <div className="ai-floating-content">
  <section className="ai-floating-fuzzy" aria-label="Penyiraman Fuzzy">
   <h2><Droplets size={18} aria-hidden="true"/>Penyiraman Fuzzy</h2>
   {estimate?<dl><dt>{estimate.label}</dt><dd>{litres.format(estimate.valueL)} L</dd></dl>:
    <p>{loading?'Memuat estimasi…':'Estimasi terbaru belum tersedia.'}</p>}
   {estimate&&<small>{estimate.source}</small>}
   <div className="ai-floating-tank">
    <dl><dt>Estimasi air di tandon</dt><dd>{tank?litres.format(tank.valueL)+' L':'—'}</dd></dl>
    {tank?<small>{tank.current?'':'Bacaan terkini belum tersedia · '}{tank.sampleCount} sampel · terakhir {readingTime.format(new Date(tank.recordedAt))} WIB</small>:
     <small>Menunggu bacaan tandon yang valid.</small>}
   </div>
  </section>
  {cycle?<HstPhaseCard cycle={cycle}/>:<p className="ai-floating-cycle-status" role="status">
   {loading&&deviceId?'Memuat program otomatis…':deviceId?'Status program otomatis belum tersedia.':'Belum ada perangkat untuk program otomatis.'}
  </p>}
 </div>
}

export function FloatingAiRecommendation({deviceId}:{deviceId:string}){
 const [open,setOpen]=useState(false)
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null)
 const panelId=useId(),titleId=useId()
 const close=()=>{setOpen(false);trigger.current?.focus()}
 useEffect(()=>{
  if(!open)return
  closeButton.current?.focus()
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();setOpen(false);trigger.current?.focus()}}
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false)}
  document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside)
  return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside)}
 },[open])
 return <div className="ai-floating" ref={root}>
  {open&&<section className="ai-floating-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} id={panelId}>
   <header className="ai-floating-header"><div><strong id={titleId}>Kebutuhan tanaman</strong></div>
    <button type="button" className="ai-floating-close" ref={closeButton} aria-label="Tutup kebutuhan tanaman" onClick={close}><X size={19} aria-hidden="true"/></button>
   </header>
   <AutomaticSummary key={deviceId} deviceId={deviceId}/>
  </section>}
  <button type="button" className={`ai-floating-trigger${open?' is-open':''}`} ref={trigger} aria-label={open?'Tutup kebutuhan tanaman':'Buka kebutuhan tanaman'}
   aria-expanded={open} aria-controls={open?panelId:undefined} aria-haspopup="dialog" onClick={()=>open?close():setOpen(true)}>
   {open?<X size={26} aria-hidden="true"/>:<svg width="31" height="31" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
    <path d="M13 8C15 15 17 17 24 19C17 21 15 23 13 30C11 23 9 21 2 19C9 17 11 15 13 8Z"/>
    <path d="M27 1C28 5 30 7 34 8C30 9 28 11 27 15C26 11 24 9 20 8C24 7 26 5 27 1Z"/>
    <path d="M27 24C28 27 29 28 32 29C29 30 28 31 27 34C26 31 25 30 22 29C25 28 26 27 27 24Z"/>
   </svg>}
   <span className="ai-floating-tooltip" aria-hidden="true">Kebutuhan tanaman</span>
  </button>
 </div>
}
