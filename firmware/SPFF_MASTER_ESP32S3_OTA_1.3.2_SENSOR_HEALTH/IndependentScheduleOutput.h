#pragma once
void serviceSpffSyncedScheduleOutput() {
  // AI owns both outputs throughout pulse + settling. Otherwise a current
  // synced schedule is an independent timed trigger, even with AI disabled.
  static bool waterScheduled=false, fertScheduled=false;
  if(serverSoilEcOwnsRelays())return;
  const bool ready=spffAutomaticControlLoaded && spffAutomaticControl.desiredMode==SPFF_MODE_AUTOMATIC &&
    !spffAutomaticPaused && !spffShutdownPending && !spffShutdownFaultLatched && relayReady && !otaMaintenanceActive();
  const bool water=ready && spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_WATER);
  const bool fert=ready && spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_FERT);
  if((water||fert) && !waterScheduled && !fertScheduled)spffStopAutomaticOutputs("schedule_takeover");
  if(water||waterScheduled)spffApplySyncedScheduleTarget("pump_water",PUMP_WATER_RELAY,water,spffWaterStateTracker);
  if(fert||fertScheduled)spffApplySyncedScheduleTarget("pump_fert",PUMP_FERTILIZER_RELAY,fert,spffFertStateTracker);
  waterScheduled=water;fertScheduled=fert;
}
