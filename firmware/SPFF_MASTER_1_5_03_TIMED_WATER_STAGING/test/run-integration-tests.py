"""Host checks execute actual firmware deadline service and relay writer with mocked I/O."""
from pathlib import Path
import os
import re
import subprocess

root = Path(__file__).resolve().parents[3]
package = Path(__file__).resolve().parents[1]
fw = package / 'SPFF_MASTER_1_5_03_SHT20_TELEMETRY_SYNC'
source = (fw / (fw.name + '.ino')).read_text(encoding='utf-8')
out = root / 'firmware/build-timed-water-tests'
out.mkdir(exist_ok=True)
def function(name, text=source):
    m = re.search(r'^(?:static )?(?:bool|void) '+name+r'\([^;]*?\)\s*\{', text, re.M)
    assert m, name
    return text[m.start():text.index('\n}',m.end())+2]
code = r'''
#include <stdint.h>
#include <assert.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#include "TimedWaterDeadline.h"
#define SPFF_TIMED_WATER_MAX_SECONDS 180U
struct String {
 char buf[128]; String(const char *s="") { strncpy(buf,s,127); buf[127]=0; }
 unsigned length() const { return strlen(buf); }
 const char *c_str() const { return buf; }
 bool operator==(const char *s) const { return strcmp(buf,s)==0; }
};
uint32_t nowMs=0; uint32_t millis(){return nowMs;}
constexpr uint8_t PUMP_WATER_RELAY=3,PUMP_FERTILIZER_RELAY=1,SPFF_MODE_MANUAL=0;
constexpr uint32_t SPFF_AUTO_FLOW_GRACE_MS=1000;
constexpr uint8_t TCA_OUTPUT_REG=1;
bool relayReady=true; uint8_t relayState=0;
bool interlock=false,ota=false,adaptive=false,pulse=false,fresh=true,waterOn=true;
bool writeOk=true,storageOk=true,ackOk=true;
bool spffShutdownPending=false,spffShutdownFaultLatched=false,spffAutomaticControlLoaded=true,spffStatusDirty=false;
uint32_t spffWaterCooldownStartedMs=0;
struct {uint8_t desiredMode=0; uint32_t revision=1; struct {float minFlowLpm=1;} water;} spffAutomaticControl;
struct {float waterFlowLpm=2;} slaveData;
struct {unsigned putBool(const char*,bool){return storageOk?1:0;}} prefs;
String spffCurrentCommandIssuedAt;
bool spffCh3OnBlocked(){return interlock;}
bool otaMaintenanceActive(){return ota;}
bool adaptiveFertOwnsRelays(){return adaptive;}
bool serverSoilEcOwnsRelays(){return pulse;}
bool spffAutomaticSlaveFresh(uint32_t){return fresh;}
bool spffSaveShutdownFaultLatch(){return true;}
bool relayOutputReadback(uint8_t,bool &v){v=waterOn;return true;}
int stopWrites=0,finalAcks=0; String lastStatus,lastReason;
bool setPumpOutput(uint8_t,bool on,bool &actual){++stopWrites; if(!writeOk)return false;actual=waterOn=on;return true;}
bool tcaWrite(uint8_t,uint8_t){return true;}
bool spffSendFinalAckAndRemember(const String&,const String&,const char *status,bool,bool active,const char *reason){
 assert(!active); if(ackOk){++finalAcks;lastStatus=status;lastReason=reason;} return ackOk;
}
void spffPublishBackendStateChange(const String&,bool,bool,bool,const String&){}
'''
a = source.index('spff::TimedWaterDeadline timedWaterDeadline;')
b = source.index('String timedWaterStopReason;',a)+len('String timedWaterStopReason;')
code += '\n'+source[a:b]+'\n'+function('setRelay')+'\n'+function('timedWaterCapable')+'\n'+function('serviceTimedWater')
code += r'''
void start(){
 nowMs=100; interlock=ota=adaptive=pulse=false; fresh=waterOn=writeOk=storageOk=ackOk=true;
 spffShutdownPending=spffShutdownFaultLatched=false;spffAutomaticControl.desiredMode=0;
 spffAutomaticControl.revision=1;slaveData.waterFlowLpm=2;
 timedWaterOwner=true;timedWaterStartWrite=false;timedWaterServicing=false;
 timedWaterStopReason="";timedWaterLastStopAttempt=0;timedWaterLastOutputCheck=0;timedWaterRevision=1;
 timedWaterDeadline.reset();assert(timedWaterDeadline.arm(nowMs,2,180));stopWrites=finalAcks=0;
}
int main(){
 start(); serviceTimedWater();assert(timedWaterOwner&&finalAcks==0&&stopWrites==0);
 assert(!setRelay(3,true));assert(!setRelay(1,true));assert(setRelay(3,false));
 timedWaterStartWrite=true;assert(setRelay(3,true));assert(!setRelay(1,true));timedWaterStartWrite=false;
 nowMs=2100;serviceTimedWater();assert(!timedWaterOwner&&finalAcks==1&&lastStatus=="completed"&&!waterOn);
 start();writeOk=false;nowMs=2100;serviceTimedWater();assert(timedWaterOwner&&finalAcks==0&&spffShutdownFaultLatched);
 writeOk=true;nowMs+=250;serviceTimedWater();assert(!timedWaterOwner&&finalAcks==1&&!waterOn);
 start();fresh=false;serviceTimedWater();assert(lastStatus=="rejected"&&lastReason=="flow_sensor_stale"&&!waterOn);
 start();slaveData.waterFlowLpm=0;nowMs=1100;serviceTimedWater();assert(lastReason=="low_flow"&&!waterOn);
 start();spffAutomaticControl.revision=2;serviceTimedWater();assert(lastReason=="control_changed");
 start();interlock=true;serviceTimedWater();assert(lastReason=="safety_interlock");
 start();waterOn=false;serviceTimedWater();assert(lastReason=="unexpected_output");
 start();timedWaterStopReason="operator_stop";serviceTimedWater();assert(lastReason=="operator_stop");
 start();storageOk=false;nowMs=2100;serviceTimedWater();assert(timedWaterOwner&&finalAcks==0&&!waterOn);
 storageOk=true;nowMs+=250;serviceTimedWater();assert(!timedWaterOwner);
 start();ackOk=false;nowMs=2100;serviceTimedWater();assert(timedWaterOwner&&finalAcks==0&&!waterOn);
 ackOk=true;nowMs+=250;serviceTimedWater();assert(!timedWaterOwner&&finalAcks==1);
 puts("PASS: deadline, relay ownership, OFF retry, flow, mode/config, interlock, output mismatch, STOP, NVS and ACK failures");
}
'''
generated = out/'timed-water-integration.cpp'
generated.write_text(code)
zig = root/'firmware/.test-tools/ziglang/zig.exe'
env = dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str(root/'firmware/.test-tools/zig-cache'),ZIG_LOCAL_CACHE_DIR=str(root/'firmware/.test-tools/zig-local'))
# Only use portable C header names for the supplied test; assertions are unchanged.
deadline_source=out/'deadline.cpp'
deadline_source.write_text((package/'test/timed-water-deadline.cpp').read_text().replace('<cassert>','<assert.h>').replace('<cstdint>','<stdint.h>'))
for name,src in [('integration',generated),('deadline',deadline_source)]:
    exe=out/(name+'.exe')
    subprocess.run([str(zig),'cc','-std=c++11','-fno-exceptions','-fno-rtti','-I',str(fw),str(src),'-o',str(exe)],env=env,check=True)
    subprocess.run([str(exe)],check=True)
print('PASS: supplied deadline boundaries, overflow and invalid duration checks')
baseline=root/'firmware/baseline-1503/SPFF_MASTER_1_5_03_SHT20_TELEMETRY_SYNC'
original=(baseline/(baseline.name+'.ino')).read_text(encoding='utf-8-sig')
for name in ['readSHT20','serviceTelemetrySnapshot','serviceSpffCh3WaterInterlock','processSpffAutomaticControlSyncLine','processSpffScheduleSyncLine']:
    assert function(name)==function(name,original), name
print('PASS: unchanged SHT20, telemetry, CH3 interlock and config/schedule sync bodies')
