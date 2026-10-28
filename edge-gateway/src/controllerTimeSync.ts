import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
export function chronyClockSynchronized(output:string,now=Date.now()):boolean {
 const stratum=Number(output.match(/^Stratum\s*:\s*(\d+)/m)?.[1]??'0');
 const leapNormal=/^Leap status\s*:\s*Normal\s*$/mi.test(output);
 const systemTime=Number(output.match(/^System time\s*:\s*([+-]?[\d.]+)/m)?.[1]??'NaN');
 const reference=output.match(/^Ref time \(UTC\)\s*:\s*(.+)$/m)?.[1]?.trim();
 const age=now-Date.parse(`${reference??''} UTC`);
 return stratum>=1&&stratum<=15&&leapNormal&&Number.isFinite(systemTime)&&Math.abs(systemTime)<5&&Number.isFinite(age)&&age>=-60000&&age<86400000;
}
async function hostClockSynchronized(){
 const {stdout}=await execFileAsync('chronyc',['tracking'],{timeout:3000,maxBuffer:16384,env:{...process.env,LC_ALL:'C'}});
 return chronyClockSynchronized(stdout);
}
type Settings={siteId:string;deviceId:string;isAvailable:()=>boolean;send:(message:unknown)=>Promise<void>;clockSynchronized?:()=>Promise<boolean>;now?:()=>number};
/** Reuse the gateway's existing serial writer. Never open a second USB port. */
export class ControllerTimeSync {
 private timer:NodeJS.Timeout|null=null;private inFlight=false;private stopped=false;private generation=0;
 private lastAttempt:number|null=null;private lastAck:number|null=null;private awaitingAck=false;
 constructor(private settings:Settings){}
 start(){if(this.timer||this.stopped)return;this.timer=setInterval(()=>void this.sync('periodic'),15000);this.timer.unref();void this.sync('startup');}
 stop(){this.stopped=true;this.generation++;if(this.timer)clearInterval(this.timer);this.timer=null;this.awaitingAck=false;}
 reconnected(){if(this.stopped)return;this.generation++;this.lastAck=null;this.lastAttempt=null;this.awaitingAck=false;void this.sync('serial_reconnected');}
 async sync(reason:string){
  if(this.stopped||this.inFlight||!this.settings.isAvailable())return;
  const now=(this.settings.now??Date.now)();
  if(this.lastAck!==null&&now>=this.lastAck&&now-this.lastAck<3600000)return;
  if(this.lastAttempt!==null&&now>=this.lastAttempt&&now-this.lastAttempt<60000)return;
  this.lastAttempt=now;this.inFlight=true;const generation=this.generation;
  try{
   if(!await (this.settings.clockSynchronized??hostClockSynchronized)())return;
   if(this.stopped||generation!==this.generation||!this.settings.isAvailable())return;
   const utcEpoch=Math.floor((this.settings.now??Date.now)()/1000);
   if(utcEpoch<1704067200||utcEpoch>4102444799)return;
   this.awaitingAck=true;
   await this.settings.send({kind:'time_sync',schemaVersion:1,siteId:this.settings.siteId,deviceId:this.settings.deviceId,utcEpoch});
   console.log('[time-sync] Sent UTC clock from Orange Pi',{reason,utcEpoch});
  }catch(error){this.awaitingAck=false;console.warn('[time-sync] Sync unavailable',error instanceof Error?error.message:error);}
  finally{this.inFlight=false;}
 }
 receive(message:unknown):boolean {
  if(!message||typeof message!=='object'||!('kind'in message)||message.kind!=='time_sync_ack')return false;
  const ack=message as Record<string,unknown>;
  if(ack.schemaVersion!==1||ack.siteId!==this.settings.siteId||ack.deviceId!==this.settings.deviceId){console.warn('[time-sync] Ignored ACK with unexpected identity/version');return true;}
  if(this.stopped||!this.awaitingAck)return true;
  if(ack.status==='applied'){this.lastAck=(this.settings.now??Date.now)();this.awaitingAck=false;console.log('[time-sync] ESP32 RTC updated successfully');}
  else{this.awaitingAck=false;console.warn('[time-sync] ESP32 rejected RTC update',ack.status);}
  return true;
 }
}
