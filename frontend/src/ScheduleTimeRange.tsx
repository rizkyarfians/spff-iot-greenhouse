import {useId} from 'react'
import {Clock3} from 'lucide-react'
import {scheduleDuration} from './scheduleTimeSummary'
import './ScheduleTimeRange.css'

const hours=Array.from({length:24},(_,n)=>String(n).padStart(2,'0'))
const minutes=Array.from({length:60},(_,n)=>String(n).padStart(2,'0'))
export function ScheduleTimeRange({onTime,offTime,timezone,disabled,onChange}:{
  onTime:string;offTime:string;timezone:string;disabled:boolean;
  onChange:(field:'onTime'|'offTime',value:string)=>void
}){
  const id=useId(),duration=scheduleDuration(onTime,offTime)
  const zone=timezone==='Asia/Jakarta'?'WIB':timezone
  const change=(field:'onTime'|'offTime',part:number,value:string)=>{
    const parts=(field==='onTime'?onTime:offTime).split(':');parts[part]=value
    onChange(field,parts.join(':'))
  }
  return <div className="schedule-time-range">
    <div className="schedule-time-heading"><strong>Waktu pompa bekerja</strong><span>Format 24 jam · {zone}</span></div>
    <div className="schedule-time-cards">
      {(['onTime','offTime'] as const).map((field,index)=>{
        const value=field==='onTime'?onTime:offTime
        return <fieldset className={`schedule-time-card${index===0?' is-start':''}`} key={field} disabled={disabled} aria-describedby={`${id}-summary`}>
          <legend><span className="schedule-time-step" aria-hidden="true">{index+1}</span>{index===0?'Mulai menyala':'Berhenti menyala'}</legend>
          <div className="schedule-time-inputs">
            <label htmlFor={`${id}-${field}-hour`}><span>Jam</span><select id={`${id}-${field}-hour`} value={value.split(':')[0]} onChange={event=>change(field,0,event.target.value)}>
              {hours.map(hour=><option value={hour} key={hour}>{hour}</option>)}
            </select></label>
            <b className="schedule-time-colon" aria-hidden="true">:</b>
            <label htmlFor={`${id}-${field}-minute`}><span>Menit</span><select id={`${id}-${field}-minute`} value={value.split(':')[1]} onChange={event=>change(field,1,event.target.value)}>
              {minutes.map(minute=><option value={minute} key={minute}>{minute}</option>)}
            </select></label>
          </div>
          <small>{index===0?'Pompa mulai bekerja pada waktu ini.':'Pompa berhenti pada hari yang sama.'}</small>
        </fieldset>
      })}
    </div>
    <div id={`${id}-summary`} className={`schedule-time-preview${duration?'':' is-invalid'}`} role="status" aria-live="polite" aria-atomic="true">
      <Clock3 size={20} aria-hidden="true"/>
      <div><strong>{onTime} – {offTime} {zone}</strong><span>{duration?`Pompa menyala selama ${duration}.`:'Pilih waktu berhenti setelah waktu mulai.'}</span></div>
    </div>
  </div>
}
