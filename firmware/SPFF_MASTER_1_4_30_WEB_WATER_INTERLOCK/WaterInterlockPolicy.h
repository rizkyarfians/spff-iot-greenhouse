#pragma once
bool spffCh3WaterInterlockActive() {
  if (!spffCh3WaterInterlockEnabled) return false;
  const bool wasLocked = spffCh3WaterInterlockLatched;
  if (!spffCh3WaterSensorTrusted() ||
      slaveData.waterDistanceCm <= SPFF_CH3_WATER_LOCK_CM) {
    spffCh3WaterInterlockLatched = true;
  } else if (slaveData.waterDistanceCm >= SPFF_CH3_WATER_RELEASE_CM) {
    spffCh3WaterInterlockLatched = false;
  }

  if (wasLocked != spffCh3WaterInterlockLatched) {
    // ON stays blocked until an OFF readback is verified even AFTER release.
    spffCh3OffVerificationPending = true;
    // Discard previous automatic moisture trigger and active-water state.
    // After release AUTO must collect NEW samples; MANUAL needs a NEW command.
    spffWaterAutoActive = false;
    spffWaterLowSampleCount = 0;
    spffWaterCooldownStartedMs = millis();
    spffWaterLastSampleMs =
      spffAutomaticControl.water.sensor == 2U
      ? soil2RegLastGoodMs[0] : soil1RegLastGoodMs[0];
    lcdDirty = true;
    spffStatusDirty = true;
  }
  return spffCh3WaterInterlockLatched;
}

bool spffCh3OnBlocked() {
  return spffCh3WaterInterlockActive() ||
         spffCh3OffVerificationPending;
}

