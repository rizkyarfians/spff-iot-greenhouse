#pragma once
// Dedicated NVS key: preserve all legacy automatic-control and pulse journals.
// Missing/corrupt storage boots enabled. No config operation turns a relay ON.
struct WaterInterlockStore {
  uint32_t magic;
  uint32_t revision;
  uint32_t enabled;
  uint32_t checksum;
};
static uint32_t waterInterlockChecksum(const WaterInterlockStore &s) {
  return s.magic ^ s.revision ^ (s.enabled * 0x9e3779b9UL) ^ 0x73504646UL;
}
static void loadWaterInterlockSettings() {
  spffCh3WaterInterlockEnabled=true;spffWaterInterlockRevision=0;
  spffWaterInterlockStorageFault=false;
  if(!prefs.isKey("ch3_il_cfg"))return;
  WaterInterlockStore s={};
  if(prefs.getBytesLength("ch3_il_cfg")!=sizeof(s) ||
      prefs.getBytes("ch3_il_cfg",&s,sizeof(s))!=sizeof(s) ||
      s.magic!=0x43483349UL || s.revision<1 || s.revision>2147483647UL ||
      s.enabled>1 || s.checksum!=waterInterlockChecksum(s)) {
    spffWaterInterlockStorageFault=true;return;
  }
  spffCh3WaterInterlockEnabled=s.enabled!=0;spffWaterInterlockRevision=s.revision;
}
static void sendWaterInterlockAck(uint32_t revision,bool applied,const char *reason) {
  const String at=spffUtcIso8601();if(!at.length())return;
  String json="{\"kind\":\"water_interlock_ack\",\"schemaVersion\":1,\"siteId\":\"";
  json+=SPFF_SITE_ID;json+="\",\"deviceId\":\"";json+=SPFF_DEVICE_ID;
  json+="\",\"revision\":";json+=String(revision);
  json+=",\"status\":\"";json+=applied?"applied":"rejected";
  json+="\",\"appliedRevision\":";json+=String(spffWaterInterlockRevision);
  json+=",\"enabled\":";json+=spffCh3WaterInterlockEnabled?"true":"false";
  json+=",\"acknowledgedAt\":\"";json+=at;
  json+="\",\"reason\":\"";json+=reason;json+="\"}";spffWriteJsonLine(json);
}
static void processWaterInterlockSettings(const String &line,size_t start,size_t end) {
  String site,device;uint32_t version=0,revision=0;bool enabled=true;
  if(!spffJsonGetUintMember(line,start,end,"schemaVersion",version)||version!=1 ||
      !spffJsonGetStringMember(line,start,end,"siteId",site)||site!=SPFF_SITE_ID ||
      !spffJsonGetStringMember(line,start,end,"deviceId",device)||device!=SPFF_DEVICE_ID ||
      !spffJsonGetUintMember(line,start,end,"revision",revision)||revision<1||revision>2147483647UL ||
      !spffJsonGetBoolMember(line,start,end,"enabled",enabled))return;
  if(revision<spffWaterInterlockRevision){sendWaterInterlockAck(revision,false,"stale_revision");return;}
  if(revision==spffWaterInterlockRevision){
    sendWaterInterlockAck(revision,!spffWaterInterlockStorageFault&&enabled==spffCh3WaterInterlockEnabled,
      enabled==spffCh3WaterInterlockEnabled?"already_applied":"revision_conflict");return;
  }
  if(spffWaterInterlockStorageFault&&!enabled){sendWaterInterlockAck(revision,false,"interlock_storage_fault");return;}
  const bool changed=enabled!=spffCh3WaterInterlockEnabled;
  if(changed){
    abortServerSoilEcPulse("water_interlock_config_change");
    spffStopAutomaticOutputs("water_interlock_config_change");
    if(!serverPulseOutputsOff()){
      // Enabling protection must take effect immediately even if OFF verification fails.
      if(enabled)spffCh3WaterInterlockEnabled=true;
      spffCh3OffVerificationPending=true;
      sendWaterInterlockAck(revision,false,"outputs_not_verified_off");return;
    }
  }
  const WaterInterlockStore s={0x43483349UL,revision,enabled?1U:0U,0};
  WaterInterlockStore saved=s;saved.checksum=waterInterlockChecksum(saved);
  if(prefs.putBytes("ch3_il_cfg",&saved,sizeof(saved))!=sizeof(saved)){
    // Failed disable never bypasses protection, including after an earlier disabled config.
    spffCh3WaterInterlockEnabled=true;spffWaterInterlockStorageFault=true;
    spffCh3WaterInterlockLatched=true;spffCh3OffVerificationPending=true;
    spffStatusDirty=true;sendWaterInterlockAck(revision,false,"interlock_storage_fault");return;
  }
  spffCh3WaterInterlockEnabled=enabled;spffWaterInterlockRevision=revision;spffWaterInterlockStorageFault=false;
  if(changed){
    spffCh3WaterInterlockLatched=true;spffCh3OffVerificationPending=true;
    spffWaterAutoActive=false;spffWaterLowSampleCount=0;spffWaterCooldownStartedMs=millis();
    spffWaterLastSampleMs=spffAutomaticControl.water.sensor==2U?soil2RegLastGoodMs[0]:soil1RegLastGoodMs[0];
  }
  lcdDirty=true;spffStatusDirty=true;sendWaterInterlockAck(revision,true,"interlock_config_applied");
}
