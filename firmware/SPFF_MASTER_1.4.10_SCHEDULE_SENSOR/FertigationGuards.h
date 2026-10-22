#pragma once
#include <stdint.h>

// Pure decisions shared by firmware and executable host regression tests.
inline const char *spffWaterFaultReason(bool sensorInvalid, bool runtimeExceeded, bool flowFault) {
  if (sensorInvalid) return "water_sensor_fault";
  if (flowFault) return "water_flow_fault";
  if (runtimeExceeded) return "water_runtime_limit";
  return nullptr;
}

inline bool spffSampleAfterMixing(uint32_t sampleMs, uint32_t mixingStartedMs, uint32_t delayMs) {
  // Signed subtraction handles millis() wrap; configured delays are < 2^31 ms.
  return (int32_t)(sampleMs - (mixingStartedMs + delayMs)) > 0;
}
