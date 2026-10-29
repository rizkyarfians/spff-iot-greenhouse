import type {GuideProgram} from '@spff/contracts'
/** Calendar date arithmetic uses UTC date-only values; today is supplied in site time. */
const dayMs=86400000
export function guideActivityDate(plantingDate:string,hst:number):string {
 return new Date(Date.parse(`${plantingDate}T00:00:00Z`)+hst*dayMs).toISOString().slice(0,10)
}
export function guideCalendarMonth(month:string){
 const first=new Date(`${month}-01T00:00:00Z`)
 const offset=(first.getUTCDay()+6)%7
 const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate()
 return Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
  const date=new Date(first.getTime()+(i-offset)*dayMs)
  return {date:date.toISOString().slice(0,10),day:date.getUTCDate(),inMonth:i>=offset&&i<offset+days}
 })
}
export function shiftGuideMonth(month:string,delta:number){const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7)}

export function guideTaskSummary(program:Pick<GuideProgram,'plan'|'hst'|'completedActivityIds'>){
 const due=program.plan.activities.filter(a=>a.hst!==null&&a.hst<=program.hst)
 const done=due.filter(a=>program.completedActivityIds.includes(a.id))
 const pending=due.filter(a=>!program.completedActivityIds.includes(a.id))
 const next=program.plan.activities.filter(a=>a.hst!==null&&a.hst>program.hst).sort((a,b)=>a.hst!-b.hst!)[0]
 return {due,done,pending,next}
}
