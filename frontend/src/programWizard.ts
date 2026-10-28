/** Fields needed to evaluate a dated, sensor-driven plant program; zero is a value. */
export function missingProgramField(form:Record<string,string>,withFertilizer:boolean):string|undefined {
  const needed=['cropId','plantingDate','hstFrom','hstTo','moistureLowPercent','moistureTargetPercent']
  if(withFertilizer)needed.push('ecLowUsCm','ecTargetUsCm','ecHighUsCm')
  return needed.find(key=>!form[key]?.trim())
}
export function programFieldStep(key:unknown):0|1 {
  return ['cropId','cropName','plantingDate','hstFrom','hstTo'].includes(String(key))?0:1
}
