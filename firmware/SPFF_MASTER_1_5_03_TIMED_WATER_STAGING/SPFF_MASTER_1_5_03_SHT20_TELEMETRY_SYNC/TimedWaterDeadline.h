#pragma once
// Independent runtime ceiling. Main sketch owns command validation and relay I/O.
// See TimedWaterConfig.h and INTEGRATION.md for activation and device validation.
#include <stdint.h>

namespace spff {
class TimedWaterDeadline {
public:
  // maxAllowedSec must come from a physically validated device safety limit.
  // A watchdog/relay fail-safe and flow checks are required separately.
  bool arm(uint32_t nowMs, uint32_t requestedSec, uint32_t maxAllowedSec) {
    if (armed_ || requestedSec == 0 || maxAllowedSec == 0 ||
        requestedSec > maxAllowedSec || requestedSec > UINT32_MAX / 1000U) {
      return false;
    }
    startedMs_ = nowMs;
    durationMs_ = requestedSec * 1000U;
    armed_ = true;
    return true;
  }
  bool expired(uint32_t nowMs) const {
    return armed_ && static_cast<uint32_t>(nowMs - startedMs_) >= durationMs_;
  }
  bool armed() const { return armed_; }
  uint32_t elapsedMs(uint32_t nowMs) const {
    return armed_ ? static_cast<uint32_t>(nowMs - startedMs_) : 0U;
  }
  void reset() { armed_ = false; durationMs_ = 0U; startedMs_ = 0U; }
private:
  bool armed_ = false;
  uint32_t startedMs_ = 0U;
  uint32_t durationMs_ = 0U;
};
} // namespace spff
