#pragma once

// Staging-only, side-effect-free firmware policy for a future operator-approved
// AI water session. No relay writes, no serial parsing, no MQTT, no NVS I/O.
// IMPORTANT: Successful preflight is NOT permission to actuate: the firmware
// must atomically reserve command/session IDs in durable storage, arbitrate
// actual relay ownership, then recheck all gates immediately before output ON.

#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace spff_ai {

enum StartBlocker : uint32_t {
  START_NONE = 0U,
  START_BAD_IDENTITY = 1U << 0,
  START_WRONG_BOOT = 1U << 1,
  START_INVALID_TIME = 1U << 2,
  START_BAD_LIMITS = 1U << 3,
  START_NOT_AUTOMATIC = 1U << 4,
  START_WATER_UNSAFE = 1U << 5,
  START_METER_UNVERIFIED = 1U << 6,
  START_OUTPUT_NOT_OFF = 1U << 7,
  START_OWNER_CONFLICT = 1U << 8,
  START_STORAGE_UNSAFE = 1U << 9,
  START_DUPLICATE_ID = 1U << 10,
  START_AUTH_UNVERIFIED = 1U << 11,
  START_STATUS_STALE = 1U << 12,
  START_EMERGENCY_STOP_UNVERIFIED = 1U << 13,
};

enum StopReason : uint32_t {
  STOP_NONE = 0U,
  STOP_OPERATOR = 1U << 0,
  STOP_VOLUME_REACHED = 1U << 1,
  STOP_TIMEOUT = 1U << 2,
  STOP_INTERLOCK = 1U << 3,
  STOP_FLOW_LOST = 1U << 4,
  STOP_SELECTOR_CHANGED = 1U << 5,
  STOP_OWNER_LOST = 1U << 6,
  STOP_OUTPUT_UNKNOWN = 1U << 7,
  STOP_GATEWAY_LOST = 1U << 8,
  STOP_WATCHDOG = 1U << 9,
  STOP_UNINITIALIZED = 1U << 10,
};

struct StartRequest {
  const char *commandId;
  const char *sessionId;
  const char *bootId;
  uint64_t issuedAtUtcMs;
  uint64_t expiresAtUtcMs;
  uint32_t targetWaterMl;
  uint32_t timeoutMs;
};

struct OperatingLimits {
  bool calibrated;
  uint32_t maxTargetWaterMl;
  uint32_t maxRuntimeMs;
  uint32_t maxCommandTtlMs;
};

struct StartEvidence {
  const char *currentBootId;
  uint64_t utcNowMs;
  bool clockSynchronized;
  bool automaticModeConfirmed;
  bool waterInterlockOk;
  bool tankSensorFresh;
  bool flowCounterFresh;
  bool flowCounterCalibrated;
  bool bothPumpsReportedOff;
  bool relayOffReadbackVerified;
  bool scheduleFree;
  bool relayOwnerFree;
  bool durableReservationAvailable;
  bool commandPreviouslySeen;
  bool operatorApprovalVerified;
  bool deviceStatusFresh;
  bool emergencyStopVerified;
};

inline bool validId(const char *id) {
  if (id == NULL || id[0] == '\0') return false;
  for (size_t i = 0; i < 64; ++i) {
    const unsigned char c = static_cast<unsigned char>(id[i]);
    if (c == '\0') return true;
    const bool allowed = (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
      c == '-' || c == '_';
    if (!allowed) return false;
  }
  return false;
}

inline uint32_t evaluateStart(const StartRequest &r,
                              const OperatingLimits &limits,
                              const StartEvidence &e) {
  uint32_t failure = START_NONE;
  if (!validId(r.commandId) || !validId(r.sessionId) || !validId(r.bootId) ||
      strcmp(r.commandId, r.sessionId) == 0) failure |= START_BAD_IDENTITY;
  if (!validId(e.currentBootId) || !validId(r.bootId) ||
      (validId(e.currentBootId) && validId(r.bootId) &&
       strcmp(r.bootId, e.currentBootId) != 0)) failure |= START_WRONG_BOOT;
  if (!e.clockSynchronized || e.utcNowMs == 0 || r.issuedAtUtcMs == 0 ||
      r.expiresAtUtcMs <= r.issuedAtUtcMs || r.issuedAtUtcMs > e.utcNowMs ||
      r.expiresAtUtcMs <= e.utcNowMs ||
      (limits.maxCommandTtlMs == 0 ||
       r.expiresAtUtcMs - r.issuedAtUtcMs > limits.maxCommandTtlMs)) {
    failure |= START_INVALID_TIME;
  }
  if (!limits.calibrated || limits.maxTargetWaterMl == 0 ||
      limits.maxRuntimeMs == 0 || r.targetWaterMl == 0 ||
      r.targetWaterMl > limits.maxTargetWaterMl || r.timeoutMs == 0 ||
      r.timeoutMs > limits.maxRuntimeMs) failure |= START_BAD_LIMITS;
  if (!e.automaticModeConfirmed) failure |= START_NOT_AUTOMATIC;
  if (!e.waterInterlockOk || !e.tankSensorFresh) failure |= START_WATER_UNSAFE;
  if (!e.flowCounterFresh || !e.flowCounterCalibrated)
    failure |= START_METER_UNVERIFIED;
  if (!e.bothPumpsReportedOff || !e.relayOffReadbackVerified)
    failure |= START_OUTPUT_NOT_OFF;
  if (!e.scheduleFree || !e.relayOwnerFree) failure |= START_OWNER_CONFLICT;
  if (!e.durableReservationAvailable) failure |= START_STORAGE_UNSAFE;
  if (e.commandPreviouslySeen) failure |= START_DUPLICATE_ID;
  if (!e.operatorApprovalVerified) failure |= START_AUTH_UNVERIFIED;
  if (!e.deviceStatusFresh) failure |= START_STATUS_STALE;
  if (!e.emergencyStopVerified) failure |= START_EMERGENCY_STOP_UNVERIFIED;
  return failure;
}

struct RuntimeEvidence {
  bool sessionActive;
  bool operatorStopRequested;
  bool automaticModeConfirmed;
  bool interlockOk;
  bool flowCounterFresh;
  bool flowCounterCalibrated;
  bool relayOwnershipStillHeld;
  bool waterPumpReadbackKnown;
  bool waterPumpReportedOn;
  bool gatewayFresh;
  bool watchdogHealthy;
  uint32_t elapsedMs;
  uint32_t deliveredWaterMl;
  uint32_t targetWaterMl;
  uint32_t timeoutMs;
};

// A STOP recommendation is conservative. The firmware's independent emergency
// STOP path must immediately drive/verify both outputs OFF even when the
// session is absent, stale or commandId cannot be parsed.
inline uint32_t evaluateRuntime(const RuntimeEvidence &e) {
  uint32_t stop = STOP_NONE;
  if (!e.sessionActive || e.targetWaterMl == 0 || e.timeoutMs == 0)
    stop |= STOP_UNINITIALIZED;
  if (e.operatorStopRequested) stop |= STOP_OPERATOR;
  if (e.targetWaterMl > 0 && e.deliveredWaterMl >= e.targetWaterMl)
    stop |= STOP_VOLUME_REACHED;
  if (e.timeoutMs > 0 && e.elapsedMs >= e.timeoutMs) stop |= STOP_TIMEOUT;
  if (!e.interlockOk) stop |= STOP_INTERLOCK;
  if (!e.flowCounterFresh || !e.flowCounterCalibrated) stop |= STOP_FLOW_LOST;
  if (!e.automaticModeConfirmed) stop |= STOP_SELECTOR_CHANGED;
  if (!e.relayOwnershipStillHeld) stop |= STOP_OWNER_LOST;
  if (!e.waterPumpReadbackKnown || !e.waterPumpReportedOn)
    stop |= STOP_OUTPUT_UNKNOWN;
  if (!e.gatewayFresh) stop |= STOP_GATEWAY_LOST;
  if (!e.watchdogHealthy) stop |= STOP_WATCHDOG;
  return stop;
}

}  // namespace spff_ai
