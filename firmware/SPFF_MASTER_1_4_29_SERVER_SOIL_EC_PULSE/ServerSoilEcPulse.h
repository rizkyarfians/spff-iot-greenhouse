#pragma once
#include "PulseDeadline.h"
#ifndef SPFF_ENABLE_SERVER_SOIL_EC_PULSES
#define SPFF_ENABLE_SERVER_SOIL_EC_PULSES 0
#endif
// Enable only after compiling for the actual board and commissioning hydraulics.
// No agronomic calculation here: duration is supplied by Orange Pi.
struct ServerPulseJournal {
  uint32_t magic;
  char session[37]; char command[37]; char issuedAt[36];
  uint32_t cycle; uint32_t issuedEpoch; uint32_t fingerprint;
  uint8_t owner; uint8_t state; // 1 running/reserved, 2 completed, 3 fault, 4 closed
  uint32_t checksum;
};
static ServerPulseJournal serverPulseJournal = {};
static bool serverPulseStorageFault = false;
static bool serverPulseRunning = false;
static bool serverPulsePendingOff = false;
static uint32_t serverPulseStartedMs = 0;
static uint32_t serverPulseDurationMs = 0;
static uint32_t serverPulseLastAckMs = 0;
static float serverPulseMinFlow = 0;
static bool serverPulseUseWaterFlow = false;
static bool serverPulseWater = false;
static const char *serverPulseReason = "boot";
static uint32_t serverPulseChecksum(const ServerPulseJournal &v) {
  const uint8_t *p=(const uint8_t*)&v; uint32_t h=2166136261UL;
  for(size_t i=0;i<offsetof(ServerPulseJournal,checksum);++i){h^=p[i];h*=16777619UL;}return h;
}
static bool saveServerPulseJournal() {
  serverPulseJournal.magic=0x53504650UL;
  serverPulseJournal.checksum=serverPulseChecksum(serverPulseJournal);
  if(prefs.putBytes("rb_pulse",&serverPulseJournal,sizeof(serverPulseJournal))!=sizeof(serverPulseJournal)) {
    serverPulseStorageFault=true;return false;
  }return true;
}
static void loadServerPulseJournal() {
  if(!prefs.isKey("rb_pulse"))return;
  if(prefs.getBytesLength("rb_pulse")!=sizeof(serverPulseJournal) ||
     prefs.getBytes("rb_pulse",&serverPulseJournal,sizeof(serverPulseJournal))!=sizeof(serverPulseJournal) ||
     serverPulseJournal.magic!=0x53504650UL || serverPulseJournal.checksum!=serverPulseChecksum(serverPulseJournal) ||
     serverPulseJournal.session[36]!='\0' || serverPulseJournal.command[36]!='\0' || serverPulseJournal.issuedAt[35]!='\0') {
    serverPulseStorageFault=true;serverPulseJournal.owner=1;serverPulsePendingOff=true;return;
  }
  if(serverPulseJournal.state==1){
    serverPulseJournal.state=3;serverPulseReason="restart_outcome_unknown";
    serverPulsePendingOff=true; // Never resume an interrupted pulse.
  }
}
static bool serverPulseOutputsOff() {
  bool water=true,fert=true;
  return relayReady && relayOutputReadback(PUMP_WATER_RELAY,water) &&
    relayOutputReadback(PUMP_FERTILIZER_RELAY,fert) && !water && !fert;
}
static void sendServerPulseAck(const String &session,const String &command,uint32_t cycle,
    const char *status,const char *reason) {
  String at=spffUtcIso8601();
  if(!at.length())at=serverPulseJournal.issuedAt;
  if(!at.length())return;
  String json="{\"kind\":\"fertigation_pulse_ack\",\"schemaVersion\":1,\"siteId\":\"";
  json+=SPFF_SITE_ID;json+="\",\"deviceId\":\"";json+=SPFF_DEVICE_ID;
  json+="\",\"sessionId\":\"";spffAppendEscapedString(json,session);
  json+="\",\"commandId\":\"";spffAppendEscapedString(json,command);
  json+="\",\"cycle\":";json+=String(cycle);json+=",\"status\":\"";json+=status;
  json+="\",\"acknowledgedAt\":\"";json+=at;json+="\",\"pumpsOff\":";
  json+=serverPulseOutputsOff()?"true":"false";json+=",\"reason\":\"";json+=reason;json+="\"}";
  spffWriteJsonLine(json);
}
static void replayServerPulseAck() {
  if(!serverPulseJournal.command[0])return;
  const char *status=serverPulseJournal.state==1?"accepted":
    (serverPulseJournal.state==2||serverPulseJournal.state==4)?"completed":"fault";
  sendServerPulseAck(serverPulseJournal.session,serverPulseJournal.command,serverPulseJournal.cycle,status,serverPulseReason);
  serverPulseLastAckMs=millis();
}
static void finishServerPulse(const char *reason,bool fault) {
  serverPulseRunning=false;serverPulsePendingOff=true;serverPulseReason=reason;
  spffStopAutomaticOutputs(reason);
  if(!serverPulseOutputsOff()){
    serverPulseJournal.state=3;saveServerPulseJournal();return;
  }
  serverPulsePendingOff=false;serverPulseJournal.state=fault?3:2;
  if(!saveServerPulseJournal()){serverPulseJournal.state=3;serverPulseReason="pulse_storage_fault";}
  replayServerPulseAck();spffStatusDirty=true;
}
void serviceServerSoilEcPulse() {
  if(serverPulsePendingOff){finishServerPulse(serverPulseReason,true);return;}
  if(!serverPulseRunning){
    // Repeat terminal ACKs; duplicates are idempotent in PostgreSQL.
    if(serverPulseJournal.owner && serverPulseJournal.state!=1 &&
        (uint32_t)(millis()-serverPulseLastAckMs)>=5000UL)replayServerPulseAck();
    return;
  }
  if(pulseDurationElapsed(millis(),serverPulseStartedMs,serverPulseDurationMs)){
    finishServerPulse("pulse_duration_elapsed",false);return;
  }
  const bool automatic=spffAutomaticControlLoaded && spffAutomaticControl.desiredMode==SPFF_MODE_AUTOMATIC;
  const bool fresh=spffAutomaticSlaveFresh(20U);
  const float flow=serverPulseUseWaterFlow?slaveData.waterFlowLpm:slaveData.fertFlowLpm;
  if(serverPulseStorageFault || !automatic || spffAutomaticControl.fertilizer.enabled || spffAutomaticPaused || otaMaintenanceActive() ||
      spffShutdownPending || spffShutdownFaultLatched || spffCh3OnBlocked() ||
      !spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_FERT) ||
      (serverPulseWater && !spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_WATER)) || !fresh ||
      ((uint32_t)(millis()-serverPulseStartedMs)>=1000UL && (!isfinite(flow)||flow<serverPulseMinFlow))) {
    finishServerPulse("pulse_local_interlock",true);
  }
}
static bool serverPulseUuid(const String &s) {
  if(s.length()!=36U)return false;
  for(size_t i=0;i<36U;++i){const char c=s[i];
    if(i==8||i==13||i==18||i==23){if(c!='-')return false;}
    else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;
  }return true;
}
void processServerSoilEcPulse(const String &line,size_t start,size_t end,bool stop,bool release) {
  String session,command,site,device,issued,expires,target,flowSensor;
  uint32_t version=0,cycle=0,issuedEpoch=0,expiresEpoch=0,duration=0;
  size_t paramsStart=0,paramsEnd=0;bool water=false;
  float minFlow=0;bool flowNull=false;
  if(!spffJsonGetUintMember(line,start,end,"schemaVersion",version)||version!=1 ||
    !spffJsonGetStringMember(line,start,end,"siteId",site)||site!=SPFF_SITE_ID ||
    !spffJsonGetStringMember(line,start,end,"deviceId",device)||device!=SPFF_DEVICE_ID ||
    !spffJsonGetStringMember(line,start,end,"sessionId",session)||!serverPulseUuid(session) ||
    !spffJsonGetStringMember(line,start,end,"commandId",command)||!serverPulseUuid(command) ||
    !spffJsonGetUintMember(line,start,end,"cycle",cycle)||cycle<1||cycle>1000 ||
    !spffJsonGetStringMember(line,start,end,"issuedAt",issued)||issued.length()>=36 ||
    !spffJsonGetStringMember(line,start,end,"expiresAt",expires) ||
    !spffParseUtcIso8601Epoch(issued,issuedEpoch)||!spffParseUtcIso8601Epoch(expires,expiresEpoch))return;
  const uint32_t nowEpoch=spffUtcEpoch();
  if(!nowEpoch || issuedEpoch>nowEpoch || expiresEpoch<=nowEpoch ||
      expiresEpoch<=issuedEpoch || expiresEpoch-issuedEpoch>30U){
    sendServerPulseAck(session,command,cycle,"rejected","pulse_expired_or_clock_invalid");return;
  }
  if(!stop && !release){
    String boot;
    if(!spffJsonGetStringMember(line,start,end,"bootId",boot) || boot!=spffBootId){
      sendServerPulseAck(session,command,cycle,"rejected","pulse_boot_changed");return;
    }
  }
  uint32_t fingerprint=2166136261UL;
  for(size_t i=0;i<line.length();++i){fingerprint^=(uint8_t)line[i];fingerprint*=16777619UL;}
  if(command==serverPulseJournal.command){
    if(fingerprint!=serverPulseJournal.fingerprint){sendServerPulseAck(session,command,cycle,"rejected","pulse_id_conflict");return;}
    replayServerPulseAck();return;
  }
  if(release){
    if(serverPulseRunning || serverPulsePendingOff || serverPulseStorageFault || spffShutdownPending || spffShutdownFaultLatched ||
       !spffAutomaticControlLoaded || spffAutomaticControl.desiredMode!=SPFF_MODE_MANUAL || !serverPulseOutputsOff()) {
      sendServerPulseAck(session,command,cycle,"rejected","release_requires_manual_and_off");return;
    }
    serverPulseJournal.owner=0;serverPulseJournal.state=4;
    session.toCharArray(serverPulseJournal.session,sizeof(serverPulseJournal.session));
    command.toCharArray(serverPulseJournal.command,sizeof(serverPulseJournal.command));
    issued.toCharArray(serverPulseJournal.issuedAt,sizeof(serverPulseJournal.issuedAt));
    serverPulseJournal.cycle=cycle;serverPulseJournal.issuedEpoch=issuedEpoch;serverPulseJournal.fingerprint=fingerprint;
    serverPulseReason="pulse_ownership_released";
    if(!saveServerPulseJournal()){serverPulseJournal.owner=1;serverPulseJournal.state=3;}
    replayServerPulseAck();spffStatusDirty=true;return;
  }
  if(stop){
    // STOP is always safe, including unknown sessions; never resume legacy after it.
    if(serverPulseRunning)finishServerPulse("server_stop",true);
    spffStopAutomaticOutputs("server_stop");
    serverPulseJournal.owner=1;serverPulseJournal.state=4;
    session.toCharArray(serverPulseJournal.session,sizeof(serverPulseJournal.session));
    command.toCharArray(serverPulseJournal.command,sizeof(serverPulseJournal.command));
    issued.toCharArray(serverPulseJournal.issuedAt,sizeof(serverPulseJournal.issuedAt));
    serverPulseJournal.cycle=cycle;serverPulseJournal.issuedEpoch=issuedEpoch;
    serverPulseJournal.fingerprint=fingerprint;serverPulseReason="server_stop";
    if(!serverPulseOutputsOff()){serverPulseJournal.state=3;serverPulsePendingOff=true;}
    if(!saveServerPulseJournal())serverPulseJournal.state=3;
    replayServerPulseAck();return;
  }
  if(!SPFF_ENABLE_SERVER_SOIL_EC_PULSES || serverPulseStorageFault || serverPulseRunning || serverPulsePendingOff ||
      spffAutomaticControl.fertilizer.enabled || spffAutomaticPaused || !spffAutomaticControlLoaded || spffAutomaticControl.desiredMode!=SPFF_MODE_AUTOMATIC ||
      spffShutdownPending || spffShutdownFaultLatched || otaMaintenanceActive() || spffCh3OnBlocked() ||
      !spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_FERT)){
    sendServerPulseAck(session,command,cycle,"rejected","pulse_not_ready");return;
  }
  if(!spffJsonGetStringMember(line,start,end,"targetId",target)||target!="pump_fert" ||
      !spffJsonGetObjectMember(line,start,end,"params",paramsStart,paramsEnd) ||
      !spffJsonGetUintMember(line,paramsStart,paramsEnd,"onDurationMs",duration)||duration<1500||duration>30000 ||
      !spffJsonGetBoolMember(line,paramsStart,paramsEnd,"waterWithPulse",water) ||
      !spffJsonGetStringMember(line,paramsStart,paramsEnd,"flowSensorKey",flowSensor) ||
      (flowSensor!="flow_water_lpm"&&flowSensor!="flow_fert_lpm") ||
      !spffJsonGetNullableFloatMember(line,paramsStart,paramsEnd,"minFlowLpm",minFlow,flowNull) || flowNull||!isfinite(minFlow)||minFlow<=0||minFlow>10000 ||
      (water && !spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_WATER)) || !spffAutomaticSlaveFresh(20U)){
    sendServerPulseAck(session,command,cycle,"rejected","pulse_invalid_parameters_or_feedback");return;
  }
  const bool sameSession=session==serverPulseJournal.session;
  if((sameSession && (serverPulseJournal.state!=2 || !pulseNextCycle(serverPulseJournal.cycle,cycle))) ||
      (!sameSession && (cycle!=1 || serverPulseJournal.state==1 || serverPulseJournal.state==3 || issuedEpoch<=serverPulseJournal.issuedEpoch))){
    sendServerPulseAck(session,command,cycle,"rejected","pulse_sequence_or_fault");return;
  }
  // Acquire relay ownership and persist reservation BEFORE energizing anything.
  spffStopAutomaticOutputs("server_pulse_takeover");
  if(!serverPulseOutputsOff()){sendServerPulseAck(session,command,cycle,"rejected","pulse_outputs_not_off");return;}
  session.toCharArray(serverPulseJournal.session,sizeof(serverPulseJournal.session));
  command.toCharArray(serverPulseJournal.command,sizeof(serverPulseJournal.command));
  issued.toCharArray(serverPulseJournal.issuedAt,sizeof(serverPulseJournal.issuedAt));
  serverPulseJournal.cycle=cycle;serverPulseJournal.issuedEpoch=issuedEpoch;serverPulseJournal.fingerprint=fingerprint;
  serverPulseJournal.owner=1;serverPulseJournal.state=1;
  if(!saveServerPulseJournal()){sendServerPulseAck(session,command,cycle,"rejected","pulse_storage_fault");return;}
  serverPulseWater=water;serverPulseUseWaterFlow=flowSensor=="flow_water_lpm";serverPulseMinFlow=minFlow;
  serverPulseDurationMs=duration;serverPulseStartedMs=millis();serverPulseRunning=true;
  bool actual=false;
  if((water && (!setPumpOutput(PUMP_WATER_RELAY,true,actual)||!actual)) ||
      !setPumpOutput(PUMP_FERTILIZER_RELAY,true,actual)||!actual){finishServerPulse("pulse_relay_fault",true);return;}
  serverPulseReason="pulse_started";replayServerPulseAck();spffStatusDirty=true;
}
void abortServerSoilEcPulse(const char *reason) {
  if(serverPulseRunning)finishServerPulse(reason,true);
}
