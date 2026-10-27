// Dev-only visual fixture. No real API, device commands, or authentication.
import { createRoot } from 'react-dom/client'
import { telemetrySensorKeys, fertigationProgressMetric } from '@spff/contracts'
import App from '../../src/App'
import { AuthContext } from '../../src/authContext'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import '../../src/index.css'
import '../../src/ResponsiveLayout.css'

const now = new Date().toISOString()
const labels = {soil_1_moisture:'Kelembapan Tanah 1',soil_2_moisture:'Kelembapan Tanah 2',soil_1_ec_us_cm:'EC Tanah 1',soil_2_ec_us_cm:'EC Tanah 2',liquid_ph:'pH Larutan',liquid_ec_us_cm:'EC Larutan',air_temp:'Suhu Udara',air_humidity:'Kelembapan Udara',tank_water_level_pct:'Level Tandon Air',tank_fert_level_pct:'Level Tandon Pupuk',ac_voltage_v:'Tegangan AC'}
const definitions = telemetrySensorKeys.map((key,index) => ({sensorKey:key,displayName:labels[key] ?? key.replaceAll('_',' '),groupName:key.startsWith('ac_')?'Energi':'Greenhouse',unit:key.includes('moisture')||key.includes('humidity')||key.includes('level')?'%':key.includes('temp')?'°C':key.endsWith('_ph')?'pH':key.includes('ec_us')?'µS/cm':key.includes('voltage')?'V':'',valueType:'float',sortOrder:index,enabled:true}))
const value = key => key.endsWith('_ph')?6.5:key.includes('ec_us')?750:key.includes('temp')?28:key.includes('voltage')?238:key.endsWith('_n')?15:key.endsWith('_p')?8:key.endsWith('_k')?20:45
const sensors = definitions.map(d => ({id:d.sensorKey,type:d.sensorKey,name:d.displayName,groupName:d.groupName,value:value(d.sensorKey),unit:d.unit,status:'good',valid:true,faultReason:null,updatedAt:now}))
const device = {siteId:'greenhouse-01',deviceId:'esp32-s3-01',displayName:'Controller Utama',hardwareModel:'ESP32-S3',firmwareVersion:'fixture',enabled:true,online:true,connectionStatus:'online',mode:'manual',systemState:'ready',growthPhase:'Vegetatif',sensorValid:true,recordedAt:now,lastSeenSecondsAgo:0}
const actuators = ['water','fert'].map(key => ({id:`pump_${key}`,deviceId:device.deviceId,name:key==='water'?'Pompa Air':'Pompa Pupuk',actuatorType:'pump',isActive:false,state:'inactive',commandId:null,commandStatus:null,requestedIsActive:null,activeDuration:'0 detik',maxRuntimeSeconds:120,updatedAt:now}))
const schedules = Array.from({length:4},(_,i)=>({id:`fixture-${i}`,siteId:device.siteId,deviceId:device.deviceId,actuatorKey:'pump_fert',actuatorName:'Pompa Pupuk',onTime:`0${7+i}:00:00`,offTime:`0${7+i}:05:00`,repeatRule:'daily',runDate:null,timezone:'Asia/Jakarta',enabled:true,requestedBy:'fixture',createdAt:now,updatedAt:now}))
const bootstrap = {database:{database:'fixture',schema:'spff'},site:{siteId:device.siteId,name:'Greenhouse Fixture',timezone:'Asia/Jakarta'},sensorDefinitions:definitions,sensors,latestTelemetry:{deviceId:device.deviceId,recordedAt:now,receivedAt:now,values:Object.fromEntries(sensors.map(s=>[s.id,s.value]))},actuators,alarms:[],devices:[device],logs:[],telemetryLog:[],actuatorLog:[],schedules,settings:{greenhouseName:'Greenhouse Fixture',notifications:true,sound:false,autoSchedule:false,temperatureMin:20,temperatureMax:35,humidityMin:40,humidityMax:85},automaticControl:null}
window.EventSource = class extends EventTarget { close() {} } as unknown as typeof EventSource
window.fetch = async input => {
  const url = new URL(String(input), location.origin)
  if (!url.pathname.startsWith('/api/')) throw new Error('Fixture only permits local mock API requests')
  let data: unknown = bootstrap
  if (url.pathname.includes('/sensors/history')) {
    const key = url.searchParams.get('type') ?? 'soil_1_moisture'
    data = {sensorKey:key,unit:definitions.find(d=>d.sensorKey===key)?.unit ?? '',from:new Date(Date.now()-21600000).toISOString(),to:now,bucket:'5m',bucketMinutes:5,aggregate:'avg',points:Array.from({length:72},(_,i)=>({recordedAt:new Date(Date.now()-(71-i)*300000).toISOString(),time:`${Math.floor(i/12)}:${String(i%12*5).padStart(2,'0')}`,value:40+Math.sin(i/7)*4,average:40+Math.sin(i/7)*4,min:39,max:45,samples:10}))}
  } else if (url.pathname.endsWith('/fertigation/progress')) data={deviceId:device.deviceId,evaluatedAt:now,day:'2026-10-27',telemetryAt:now,telemetryFresh:true,soilEcBasis:'stable_mean',recipeId:'fixture',cropName:'Tomat',hst:25,ruleAppliesToday:true,executionEnabled:true,profileArmed:true,liquidControlEnabled:false,status:'needs_action',reason:'soil_ec_below_target',nextPulseOnMs:7000,dailyOnMs:20000,dailyLimitMs:60000,soilEcToleranceUsCm:25,
    soilEc:fertigationProgressMetric('soil','EC tanah','µS/cm',500,1200,600,1500),liquidEc:fertigationProgressMetric('liquid','EC larutan tandon','µS/cm',800,1800,1000,2200),waterTank:fertigationProgressMetric('water','Isi tandon air','%',80,100,20),fertilizerTank:fertigationProgressMetric('fert','Isi tandon pupuk','%',60,100,20)}
  else if (url.pathname.endsWith('/fertigation/recipes')) data=[]
  else if (url.pathname.endsWith('/datalog')) data={items:sensors.slice(0,10).map(s=>({id:s.id,kind:'sensor',recordedAt:now,parameterKey:s.id,displayName:s.name,value:s.value,unit:s.unit,sensorValid:true,reason:null,state:null,source:null})),pagination:{page:1,pageSize:10,totalItems:34,totalPages:4}}
  else if (url.pathname.endsWith('/alarms')) data={items:[],pagination:{page:1,pageSize:10,totalItems:0,totalPages:1},counts:{open:0,acknowledged:0,resolved:0,criticalActive:0}}
  else if (url.pathname.endsWith('/smart-soil')) data={siteId:device.siteId,zoneId:'soil-1',deviceStatus:'online',reference:null,comparison:[],conditions:{recordedAt:now,sensors:sensors.filter(s=>s.id.startsWith('soil_1')||s.id==='air_temp'||s.id==='air_humidity')}}
  else if (url.pathname.endsWith('/users')) data=[]
  return new Response(JSON.stringify({success:true,data}),{headers:{'Content-Type':'application/json'}})
}
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={{user:{id:'fixture',username:'admin',displayName:'Admin',role:'admin'},logout:async()=>{}}}><App/></AuthContext.Provider>)
