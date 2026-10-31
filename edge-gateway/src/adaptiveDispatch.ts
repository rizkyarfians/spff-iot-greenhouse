import {createHash} from 'node:crypto';
import {mkdir,readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {adaptiveDispatchSchema,adaptiveEventPayloadSchema,type AdaptiveDispatch,type AdaptiveEvent} from '@spff/contracts';

export function adaptiveEnvelope(raw:unknown):AdaptiveEvent {
 const payload=adaptiveEventPayloadSchema.parse(raw);
 return {kind:'adaptive_fert_event',schemaVersion:1,siteId:payload.siteId,deviceId:payload.deviceId,messageId:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),receivedAt:new Date().toISOString(),payload};
}
export class AdaptiveDispatchGuard {
 constructor(private directory:string,private send:(payload:unknown)=>Promise<void>,private report:(event:AdaptiveEvent)=>Promise<void>){}
 async forward(raw:AdaptiveDispatch){
  const message=adaptiveDispatchSchema.parse(raw),command=message.command;
  const ack=async(status:'forwarded'|'expired'|'unknown',reason:string)=>this.report(adaptiveEnvelope({kind:'adaptive_fert_gateway_ack',schemaVersion:1,siteId:message.siteId,deviceId:message.deviceId,sessionId:command.sessionId,commandId:command.commandId,status,timestamp:new Date().toISOString(),reason}));
  if(Date.parse(message.expiresAt)<=Date.now()){await ack('expired','gateway_expiry');return;}
  if('issuedAt' in command&&Date.parse(command.issuedAt)>Date.now()){await ack('expired','gateway_command_not_yet_valid');return;}
  await mkdir(this.directory,{recursive:true});
  const filename=path.join(this.directory,`${command.commandId}.json`),serialized=JSON.stringify(message);
  try{const file=await open(filename,'wx',0o600);try{await file.writeFile(serialized);await file.sync();}finally{await file.close();}
   // Windows does not support fsync on directory handles. File fsync remains
   // required there; Linux/Orange Pi must also persist the directory entry.
   if(process.platform!=='win32'){const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}
  }
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await readFile(filename,'utf8')!==serialized)throw new Error('Adaptive command ID conflict');await ack('unknown','duplicate_suppressed_outcome_not_replayed');return;}
  // Persist intent before serial write. A crash may lose an action, never knowingly repeat it.
  try{if(Date.parse(message.expiresAt)<=Date.now()){await ack('expired','gateway_expiry_before_serial');return;}await this.send(command);}
  catch(error){await ack('unknown','serial_forward_outcome_unknown');throw error;}
  await ack('forwarded','serial_write_completed_not_device_ack');
 }
}
