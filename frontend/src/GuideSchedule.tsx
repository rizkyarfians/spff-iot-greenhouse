import {useState} from 'react'
import type {GuideProgram,GuideEcConversion} from '@spff/contracts'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import {GuideEcTarget} from './GuideEcTarget'
import {guideActivityDate,guideCalendarMonth,shiftGuideMonth} from './guideSchedule'
const dateLabel=(date:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`))
export function GuideSchedule({program,conversions=[]}:{program:GuideProgram;conversions?:GuideEcConversion[]}){
 const today=guideActivityDate(program.config.plantingDate,program.hst)
 const [month,setMonth]=useState(today.slice(0,7)),[chosen,setChosen]=useState(today)
 const activities=program.plan.activities.filter(a=>a.hst!==null).map(a=>({...a,date:guideActivityDate(program.config.plantingDate,a.hst!)}))
 const selected=activities.filter(a=>a.date===chosen)
 const monthName=new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`))
 return <section className="gp-schedule" aria-label="Jadwal kegiatan tanaman">
  <div className="gp-panel"><div className="gp-calendar-toolbar"><h3>{monthName}</h3><div><button type="button" aria-label="Bulan sebelumnya" onClick={()=>setMonth(shiftGuideMonth(month,-1))}><ChevronLeft size={20}/></button><button type="button" onClick={()=>{setMonth(today.slice(0,7));setChosen(today)}}>Hari ini</button><button type="button" aria-label="Bulan berikutnya" onClick={()=>setMonth(shiftGuideMonth(month,1))}><ChevronRight size={20}/></button></div></div>
   <div className="gp-calendar-week" aria-hidden="true">{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=><span key={d}>{d}</span>)}</div>
   <div className="gp-calendar-grid">{guideCalendarMonth(month).map(day=>{
    const events=activities.filter(a=>a.date===day.date),done=events.length>0&&events.every(a=>program.completedActivityIds.includes(a.id))
    return <button type="button" key={day.date} aria-pressed={chosen===day.date} aria-current={day.date===today?'date':undefined} aria-label={`${dateLabel(day.date)}${day.date===today?', hari ini':''}${events.length?`, ${events.length} kegiatan, ${done?'selesai':day.date<=today?'belum selesai':'akan datang'}`:', tidak ada kegiatan'}`} className={`gp-calendar-day${!day.inMonth?' is-other-month':''}${day.date===today?' is-today':''}${chosen===day.date?' is-selected':''}`} onClick={()=>{setChosen(day.date);if(!day.inMonth)setMonth(day.date.slice(0,7))}}>
     <span>{day.day}</span>{events.length>0&&<span className={`gp-calendar-count ${done?'is-done':day.date<=today?'is-pending':'is-next'}`}>{events.length}<span className="gp-calendar-word"> kegiatan</span></span>}
    </button>
   })}</div>
   <div className="gp-calendar-legend"><span><i className="is-pending"/>Belum selesai</span><span><i className="is-done"/>Selesai</span><span><i className="is-next"/>Akan datang</span></div>
  </div>
  <aside className="gp-panel gp-calendar-details"><h3>{dateLabel(chosen)}</h3><p>{selected.length} kegiatan</p>{!selected.length&&<p>Tidak ada kegiatan terjadwal.</p>}{selected.map(a=><article key={a.id}><span className="gp-hst">HST {a.hst}</span><h4>{a.title}</h4><GuideEcTarget activity={a} conversion={conversions.find(c=>c.activityId===a.id)}/><p>{a.method} · {program.completedActivityIds.includes(a.id)?'Selesai':a.date<=today?'Belum selesai':'Akan datang'}</p><ul>{a.requirements.map(r=><li key={r.row}>{r.product}<strong>{r.amount===null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(r.amount)} {r.unit}</strong></li>)}</ul>{a.waterL!==null&&<p>Larutan {a.waterL.toLocaleString('id-ID')} L</p>}</article>)}
  {program.plan.activities.some(a=>a.hst===null)&&<p className="gp-warning">Ada kegiatan tanpa HST. Periksa di Semua kegiatan.</p>}
  </aside>
 </section>
}
