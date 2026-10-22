#include <cassert>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>
#include <map>
class String:public std::string {public:using std::string::string;String()=default;String(uint32_t v):std::string(std::to_string(v)){} };
struct PreferencesStub {
  std::map<std::string,std::vector<uint8_t>>data;bool writes=true;
  bool isKey(const char*k){return data.count(k);}
  size_t getBytesLength(const char*k){return data[k].size();}
  size_t getBytes(const char*k,void*p,size_t n){if(data[k].size()!=n)return 0;memcpy(p,data[k].data(),n);return n;}
  size_t putBytes(const char*k,const void*p,size_t n){if(!writes)return 0;data[k].assign((const uint8_t*)p,(const uint8_t*)p+n);return n;}
}prefs;
bool spffCh3WaterInterlockEnabled=true,spffWaterInterlockStorageFault=false,spffCh3WaterInterlockLatched=true;
bool spffCh3OffVerificationPending=true,spffWaterAutoActive=false,lcdDirty=false,spffStatusDirty=false;
uint32_t spffWaterInterlockRevision=0,spffWaterLowSampleCount=0,spffWaterCooldownStartedMs=0,spffWaterLastSampleMs=0;
uint32_t soil1RegLastGoodMs[]={50},soil2RegLastGoodMs[]={60};
struct{struct{unsigned sensor=1;}water;}spffAutomaticControl;
struct{float waterDistanceCm=30;}slaveData;
const float SPFF_CH3_WATER_LOCK_CM=20,SPFF_CH3_WATER_RELEASE_CM=25;
bool trusted=true,outputsOff=true;unsigned stops=0,aborts=0;
uint32_t millis(){return 100;}
bool spffCh3WaterSensorTrusted(){return trusted;}
void abortServerSoilEcPulse(const char*){aborts++;}
void spffStopAutomaticOutputs(const char*){stops++;}
bool serverPulseOutputsOff(){return outputsOff;}
String spffUtcIso8601(){return "2026-10-21T06:00:00Z";}
const char*SPFF_SITE_ID="greenhouse-01",*SPFF_DEVICE_ID="esp32-s3-01";
std::vector<std::string>acks;
void spffWriteJsonLine(const String&s){acks.push_back(s);}
uint32_t requestedRevision=1;bool requestedEnabled=true;
bool spffJsonGetStringMember(const String&,size_t,size_t,const char*k,String&v){v=std::string(k)=="siteId"?SPFF_SITE_ID:SPFF_DEVICE_ID;return true;}
bool spffJsonGetUintMember(const String&,size_t,size_t,const char*k,uint32_t&v){v=std::string(k)=="revision"?requestedRevision:1;return true;}
bool spffJsonGetBoolMember(const String&,size_t,size_t,const char*,bool&v){v=requestedEnabled;return true;}
#include "WaterInterlockPolicy.h"
#include "WaterInterlockSettings.h"
void apply(uint32_t revision,bool enabled){requestedRevision=revision;requestedEnabled=enabled;processWaterInterlockSettings("frame",0,1);}
int main(){
  loadWaterInterlockSettings();assert(spffCh3WaterInterlockEnabled&&spffWaterInterlockRevision==0);
  spffCh3OffVerificationPending=false;trusted=false;assert(spffCh3OnBlocked());
  trusted=true;slaveData.waterDistanceCm=25;assert(!spffCh3WaterInterlockActive());
  spffCh3OffVerificationPending=false;slaveData.waterDistanceCm=20;assert(spffCh3WaterInterlockActive());
  slaveData.waterDistanceCm=23;assert(spffCh3WaterInterlockActive());
  slaveData.waterDistanceCm=25;assert(!spffCh3WaterInterlockActive());
  apply(1,false);assert(!spffCh3WaterInterlockEnabled&&spffWaterInterlockRevision==1&&stops==1&&aborts==1);
  spffCh3OffVerificationPending=false;trusted=false;slaveData.waterDistanceCm=0;assert(!spffCh3OnBlocked());
  auto before=stops;apply(1,false);assert(stops==before); // duplicate doesn't stop outputs or rewrite NVS
  apply(1,true);assert(!spffCh3WaterInterlockEnabled&&acks.back().find("revision_conflict")!=std::string::npos);
  loadWaterInterlockSettings();assert(!spffCh3WaterInterlockEnabled&&spffWaterInterlockRevision==1); // reboot keeps disabled
  apply(2,true);assert(spffCh3WaterInterlockEnabled&&spffCh3OnBlocked());
  apply(1,false);assert(spffCh3WaterInterlockEnabled&&acks.back().find("stale_revision")!=std::string::npos);
  outputsOff=false;apply(3,false);assert(spffCh3WaterInterlockEnabled&&spffWaterInterlockRevision==2);
  outputsOff=true;prefs.writes=false;apply(3,false);assert(spffCh3WaterInterlockEnabled&&spffWaterInterlockStorageFault);
  prefs.writes=true;apply(3,true);assert(spffCh3WaterInterlockEnabled&&!spffWaterInterlockStorageFault);
  prefs.data["ch3_il_cfg"].assign(16,0xff);loadWaterInterlockSettings();assert(spffCh3WaterInterlockEnabled&&spffWaterInterlockStorageFault);
  apply(4,false);assert(spffCh3WaterInterlockEnabled); // corrupt NVS cannot be bypassed
  apply(4,true);assert(!spffWaterInterlockStorageFault);
  apply(5,false);assert(!spffCh3WaterInterlockEnabled);
  spffCh3OffVerificationPending=true;assert(spffCh3OnBlocked()); // disable doesn't bypass OFF verification
}
