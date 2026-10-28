export function scheduleDuration(onTime:string,offTime:string):string|null {
  const valid=/^([01]\d|2[0-3]):[0-5]\d$/
  if(!valid.test(onTime)||!valid.test(offTime))return null
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3))
  const duration=minutes(offTime)-minutes(onTime)
  if(duration<=0)return null
  const hours=Math.floor(duration/60),rest=duration%60
  return [hours?`${hours} jam`:'',rest?`${rest} menit`:''].filter(Boolean).join(' ')
}
