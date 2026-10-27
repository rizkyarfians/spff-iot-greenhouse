#include <cassert>
const int SPFF_MODE_AUTOMATIC=1,SPFF_MODE_MANUAL=0,SPFF_SCHEDULE_TARGET_WATER=3,SPFF_SCHEDULE_TARGET_FERT=1,PUMP_WATER_RELAY=3,PUMP_FERTILIZER_RELAY=1;
bool owner=false,waterWindow=false,fertWindow=false,water=false,fert=false,maintenance=false;
bool spffAutomaticControlLoaded=true,spffAutomaticPaused=false,spffShutdownPending=false,spffShutdownFaultLatched=false,relayReady=true;
struct{int desiredMode=SPFF_MODE_AUTOMATIC;}spffAutomaticControl;
int spffWaterStateTracker=0,spffFertStateTracker=0;
bool serverSoilEcOwnsRelays(){return owner;}
bool otaMaintenanceActive(){return maintenance;}
bool spffScheduleWindowOpen(int target){return target==3?waterWindow:fertWindow;}
void spffStopAutomaticOutputs(const char*){water=false;fert=false;}
void spffApplySyncedScheduleTarget(const char*,int channel,bool on,int&){if(channel==3)water=on;else fert=on;}
#include "IndependentScheduleOutput.h"
int main(){
 // No sensor decision or AI permission is needed for a timed schedule.
 serviceSpffSyncedScheduleOutput();assert(!water&&!fert);
 waterWindow=true;serviceSpffSyncedScheduleOutput();assert(water&&!fert);
 fertWindow=true;serviceSpffSyncedScheduleOutput();assert(water&&fert);
 waterWindow=false;serviceSpffSyncedScheduleOutput();assert(!water&&fert);
 fertWindow=false;serviceSpffSyncedScheduleOutput();assert(!water&&!fert);
 // Schedule code must not overwrite AI-owned outputs or settle periods.
 owner=true;waterWindow=true;fert=true;serviceSpffSyncedScheduleOutput();assert(!water&&fert);
 owner=false;serviceSpffSyncedScheduleOutput();assert(water&&!fert);
 spffAutomaticPaused=true;serviceSpffSyncedScheduleOutput();assert(!water&&!fert);
 spffAutomaticPaused=false;spffAutomaticControl.desiredMode=SPFF_MODE_MANUAL;
 serviceSpffSyncedScheduleOutput();assert(!water&&!fert);
 spffAutomaticControl.desiredMode=SPFF_MODE_AUTOMATIC;spffShutdownFaultLatched=true;
 serviceSpffSyncedScheduleOutput();assert(!water&&!fert);
}
