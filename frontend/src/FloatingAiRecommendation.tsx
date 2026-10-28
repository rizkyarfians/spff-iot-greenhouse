import {useEffect,useId,useRef,useState} from 'react'
import type {FertigationProgress} from '@spff/contracts'
import {X} from 'lucide-react'
import {FertigationProgressPanel} from './FertigationProgressPanel'
import './FloatingAiRecommendation.css'

/** Read-only recommendation drawer; no chat prompt or pump action is sent. */
export function FloatingAiRecommendation({report,error,loading,onRetry,onOpenProgram}:{
 report:FertigationProgress|null;error:string;loading:boolean;onRetry:()=>void;onOpenProgram:()=>void
}){
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
   <header className="ai-floating-header"><div><strong id={titleId}>Rekomendasi AI</strong></div>
    <button type="button" className="ai-floating-close" ref={closeButton} aria-label="Tutup rekomendasi AI" onClick={close}><X size={19} aria-hidden="true"/></button>
   </header>
   <FertigationProgressPanel minimal report={report} error={error} loading={loading} onRetry={onRetry} onOpen={()=>{close();onOpenProgram()}}/>
  </section>}
  <button type="button" className={`ai-floating-trigger${open?' is-open':''}`} ref={trigger} aria-label={open?'Tutup rekomendasi AI':'Buka rekomendasi AI'}
   aria-expanded={open} aria-controls={open?panelId:undefined} aria-haspopup="dialog" onClick={()=>open?close():setOpen(true)}>
   {open?<X size={26} aria-hidden="true"/>:<svg width="31" height="31" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
    <path d="M13 8C15 15 17 17 24 19C17 21 15 23 13 30C11 23 9 21 2 19C9 17 11 15 13 8Z"/>
    <path d="M27 1C28 5 30 7 34 8C30 9 28 11 27 15C26 11 24 9 20 8C24 7 26 5 27 1Z"/>
    <path d="M27 24C28 27 29 28 32 29C29 30 28 31 27 34C26 31 25 30 22 29C25 28 26 27 27 24Z"/>
   </svg>}
   <span className="ai-floating-tooltip" aria-hidden="true">Rekomendasi AI</span>
  </button>
 </div>
}
