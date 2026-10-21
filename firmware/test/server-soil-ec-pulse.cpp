#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <map>
#include <vector>
#include <cstdio>
using std::isfinite;
class String:public std::string {
 public:using std::string::string;
 String()=default;String(const std::string &s):std::string(s){}
 String(uint32_t v):std::string(std::to_string(v)){}
 void toCharArray(char *p,size_t n)const{std::snprintf(p,n,"%s",c_str());}
};
struct {std::vector<uint8_t> bytes;bool writes=true;
 bool isKey(const char*){return !bytes.empty();}
 size_t getBytesLength(const char*){return bytes.size();}
 size_t getBytes(const char*,void *p,size_t n){if(bytes.size()!=n)return 0;memcpy(p,bytes.data(),n);return n;}
 size_t putBytes(const char*,const void *p,size_t n){if(!writes)return 0;bytes.assign((const uint8_t*)p,(const uint8_t*)p+n);return n;}
}prefs;
uint32_t clockMs=100,epoch=1000;
uint32_t millis(){return clockMs;}
const char *spffBootId="0123456789abcdef";
const char *SPFF_SITE_ID="greenhouse-01",*SPFF_DEVICE_ID="esp32-s3-01";
const int PUMP_WATER_RELAY=3,PUMP_FERTILIZER_RELAY=1,SPFF_MODE_MANUAL=0,SPFF_MODE_AUTOMATIC=1;
const int SPFF_SCHEDULE_TARGET_FERT=1,SPFF_SCHEDULE_TARGET_WATER=3;
bool relayReady=true,waterOutput=false,fertOutput=false,relayWorks=true;
bool spffShutdownPending=false,spffShutdownFaultLatched=false,spffAutomaticPaused=false,spffStatusDirty=false;
bool spffAutomaticControlLoaded=true,fresh=true,maintenance=false,levelBlocked=false,windowOpen=true;
struct{int desiredMode=SPFF_MODE_AUTOMATIC;struct{bool enabled=false;}fertilizer;}spffAutomaticControl;
struct{float waterFlowLpm=2,fertFlowLpm=2;}slaveData;
int starts=0;std::vector<std::string>acks;
bool relayOutputReadback(int channel,bool &v){v=channel==3?waterOutput:fertOutput;return relayWorks;}
bool setPumpOutput(int channel,bool on,bool &actual){if(!relayWorks)return false;
 if(channel==3)waterOutput=on;else fertOutput=on;actual=on;if(on)starts++;return true;}
void spffStopAutomaticOutputs(const char*){if(relayWorks){waterOutput=false;fertOutput=false;}else spffShutdownPending=true;}
bool spffAutomaticSlaveFresh(uint32_t){return fresh;}
bool spffCh3OnBlocked(){return levelBlocked;}
bool otaMaintenanceActive(){return maintenance;}
bool spffScheduleWindowOpen(int){return windowOpen;}
String spffUtcIso8601(){return "2026-10-21T04:00:00Z";}
uint32_t spffUtcEpoch(){return epoch;}
bool spffParseUtcIso8601Epoch(const String &s,uint32_t &v){if(s.length()<20)return false;v=1000+std::stoi(s.substr(17,2));return true;}
void spffAppendEscapedString(String &out,const String &v){out+=v;}
bool spffWriteJsonLine(const String &v){acks.push_back(v);return true;}
std::map<std::string,String>strings;
std::map<std::string,uint32_t>integers;
bool requestedWater=false;
bool spffJsonGetStringMember(const String&,size_t,size_t,const char *key,String &v){if(!strings.count(key))return false;v=strings[key];return true;}
bool spffJsonGetUintMember(const String&,size_t,size_t,const char *key,uint32_t &v){if(!integers.count(key))return false;v=integers[key];return true;}
bool spffJsonGetBoolMember(const String&,size_t,size_t,const char*,bool &v){v=requestedWater;return true;}
bool spffJsonGetObjectMember(const String&,size_t,size_t,const char*,size_t &a,size_t &b){a=0;b=1;return true;}
bool spffJsonGetNullableFloatMember(const String&,size_t,size_t,const char*,float &v,bool &null){v=1;null=false;return true;}
#define SPFF_ENABLE_SERVER_SOIL_EC_PULSES 1
#include "ServerSoilEcPulse.h"
void setupCommand(const char *command,uint32_t cycle=1,const char *session="00000000-0000-4000-8000-000000000001"){
 strings={{"siteId",SPFF_SITE_ID},{"deviceId",SPFF_DEVICE_ID},{"sessionId",session},{"commandId",command},
 {"bootId",spffBootId},{"issuedAt","2026-10-21T04:00:00Z"},{"expiresAt","2026-10-21T04:00:15Z"},{"targetId","pump_fert"},{"flowSensorKey","flow_fert_lpm"}};
 integers={{"schemaVersion",1},{"cycle",cycle},{"onDurationMs",3000}};
}
void reset(){serverPulseJournal={};serverPulseStorageFault=false;serverPulseRunning=false;serverPulsePendingOff=false;
 serverPulseLastAckMs=0;prefs.bytes.clear();prefs.writes=true;clockMs=100;epoch=1000;
 waterOutput=false;fertOutput=false;relayWorks=true;spffShutdownPending=false;spffShutdownFaultLatched=false;
 spffAutomaticPaused=false;fresh=true;maintenance=false;levelBlocked=false;windowOpen=true;starts=0;acks.clear();requestedWater=false;
 slaveData.fertFlowLpm=2;spffAutomaticControl.desiredMode=SPFF_MODE_AUTOMATIC;spffAutomaticControl.fertilizer.enabled=false;
 setupCommand("00000000-0000-4000-8000-000000000002");}
int main(){
 reset();processServerSoilEcPulse("frame1",0,1,false,false);assert(serverPulseRunning&&fertOutput&&starts==1&&serverPulseJournal.owner);
 processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==1); // duplicate doesn't restart timer/output
 processServerSoilEcPulse("changed-frame",0,1,false,false);assert(starts==1&&acks.back().find("pulse_id_conflict")!=std::string::npos);
 clockMs=3099;serviceServerSoilEcPulse();assert(fertOutput);
 clockMs=3100;serviceServerSoilEcPulse();assert(!fertOutput&&serverPulseJournal.state==2);
 assert(acks.back().find("\"status\":\"completed\"")!=std::string::npos);
 processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==1);
 setupCommand("00000000-0000-4000-8000-000000000003",3);processServerSoilEcPulse("frame3",0,1,false,false);assert(starts==1);
 setupCommand("00000000-0000-4000-8000-000000000003",2);processServerSoilEcPulse("frame2",0,1,false,false);assert(starts==2);
 // A master reset with a reserved/running journal must not resume or replay ON.
 serverPulseRunning=false;waterOutput=false;fertOutput=false;loadServerPulseJournal();assert(serverPulsePendingOff&&serverPulseJournal.state==3);
 serviceServerSoilEcPulse();assert(!fertOutput&&serverPulseJournal.state==3);
 processServerSoilEcPulse("frame2",0,1,false,false);assert(starts==2);
 reset();prefs.writes=false;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0&&serverPulseStorageFault);
 reset();spffAutomaticControl.fertilizer.enabled=true;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0);
 reset();epoch=1015;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0);
 reset();epoch=0;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0);
 reset();levelBlocked=true;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0);
 reset();integers["onDurationMs"]=30001;processServerSoilEcPulse("frame1",0,1,false,false);assert(starts==0);
 reset();processServerSoilEcPulse("frame1",0,1,false,false);fresh=false;serviceServerSoilEcPulse();assert(!fertOutput&&serverPulseJournal.state==3);
 reset();processServerSoilEcPulse("frame1",0,1,false,false);slaveData.fertFlowLpm=0;clockMs=1100;serviceServerSoilEcPulse();assert(!fertOutput&&serverPulseJournal.state==3);
 reset();requestedWater=true;processServerSoilEcPulse("frame1",0,1,false,false);assert(waterOutput&&fertOutput);windowOpen=false;serviceServerSoilEcPulse();assert(!waterOutput&&!fertOutput);
 reset();processServerSoilEcPulse("frame1",0,1,false,false);setupCommand("00000000-0000-4000-8000-000000000004");processServerSoilEcPulse("stop",0,1,true,false);assert(!fertOutput&&serverPulseJournal.state==4&&serverPulseJournal.owner);
 setupCommand("00000000-0000-4000-8000-000000000005");processServerSoilEcPulse("release",0,1,false,true);assert(serverPulseJournal.owner); // must first apply Manual
 spffAutomaticControl.desiredMode=SPFF_MODE_MANUAL;processServerSoilEcPulse("release",0,1,false,true);assert(!serverPulseJournal.owner);
 reset();processServerSoilEcPulse("frame1",0,1,false,false);relayWorks=false;clockMs=3100;serviceServerSoilEcPulse();assert(serverPulsePendingOff&&serverPulseJournal.state==3);
 reset();relayWorks=false;setupCommand("00000000-0000-4000-8000-000000000004");processServerSoilEcPulse("failed-stop",0,1,true,false);assert(serverPulsePendingOff);relayWorks=true;serviceServerSoilEcPulse();assert(!serverPulsePendingOff&&!fertOutput);
 reset();strings["bootId"]="ffffffffffffffff";processServerSoilEcPulse("old-boot",0,1,false,false);assert(starts==0);
 reset();prefs.bytes.assign(sizeof(ServerPulseJournal),0xff);loadServerPulseJournal();assert(serverPulseStorageFault);
 assert(!pulseDurationElapsed(0xfffffff0U,0xfffffff0U,32));assert(pulseDurationElapsed(16,0xfffffff0U,32));
}
