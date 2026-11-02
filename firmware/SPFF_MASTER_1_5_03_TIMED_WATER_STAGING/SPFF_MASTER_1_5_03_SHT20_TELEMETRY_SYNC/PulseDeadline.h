#pragma once
#include <stdint.h>
// No delay(duration): rollover-safe deadline and sequence decisions, host tested.
inline bool pulseDurationElapsed(uint32_t now, uint32_t started, uint32_t duration) {
  return (uint32_t)(now-started) >= duration;
}
inline bool pulseNextCycle(uint32_t previous, uint32_t next) {
  return previous < 1000U && next == previous + 1U;
}
