#include <cassert>
#include <cstdint>
#include "AiSessionSafetyPolicy.h"

using namespace spff_ai;

int main() {
  StartRequest command = {
    "cmd-A1", "session-A1", "boot-A1", 100000ULL, 112000ULL, 500U, 10000U
  };
  OperatingLimits limits = {true, 2000U, 30000U, 15000U};
  StartEvidence evidence = {
    "boot-A1", 101000ULL, true, true, true, true, true, true,
    true, true, true, true, true, false, true, true, true
  };
  assert(evaluateStart(command, limits, evidence) == START_NONE);

  evidence.automaticModeConfirmed = false;
  assert(evaluateStart(command, limits, evidence) & START_NOT_AUTOMATIC);
  evidence.automaticModeConfirmed = true;

  evidence.tankSensorFresh = false; // sensor currently disconnected in field
  assert(evaluateStart(command, limits, evidence) & START_WATER_UNSAFE);
  evidence.tankSensorFresh = true;

  evidence.commandPreviouslySeen = true;
  assert(evaluateStart(command, limits, evidence) & START_DUPLICATE_ID);
  evidence.commandPreviouslySeen = false;

  evidence.durableReservationAvailable = false;
  assert(evaluateStart(command, limits, evidence) & START_STORAGE_UNSAFE);
  evidence.durableReservationAvailable = true;

  evidence.flowCounterCalibrated = false;
  assert(evaluateStart(command, limits, evidence) & START_METER_UNVERIFIED);
  evidence.flowCounterCalibrated = true;

  evidence.scheduleFree = false;
  assert(evaluateStart(command, limits, evidence) & START_OWNER_CONFLICT);
  evidence.scheduleFree = true;

  evidence.relayOffReadbackVerified = false;
  assert(evaluateStart(command, limits, evidence) & START_OUTPUT_NOT_OFF);
  evidence.relayOffReadbackVerified = true;

  evidence.operatorApprovalVerified = false;
  assert(evaluateStart(command, limits, evidence) & START_AUTH_UNVERIFIED);
  evidence.operatorApprovalVerified = true;

  evidence.emergencyStopVerified = false;
  assert(evaluateStart(command, limits, evidence) & START_EMERGENCY_STOP_UNVERIFIED);
  evidence.emergencyStopVerified = true;

  evidence.currentBootId = "boot-B2";
  assert(evaluateStart(command, limits, evidence) & START_WRONG_BOOT);
  evidence.currentBootId = "boot-A1";

  command.targetWaterMl = 2500U;
  assert(evaluateStart(command, limits, evidence) & START_BAD_LIMITS);
  command.targetWaterMl = 500U;

  command.issuedAtUtcMs = 102000ULL; // issued in the future
  assert(evaluateStart(command, limits, evidence) & START_INVALID_TIME);
  command.issuedAtUtcMs = 100000ULL;

  evidence.utcNowMs = 112000ULL;
  assert(evaluateStart(command, limits, evidence) & START_INVALID_TIME);
  evidence.utcNowMs = 101000ULL;

  command.commandId = "bad/id";
  assert(evaluateStart(command, limits, evidence) & START_BAD_IDENTITY);
  command.commandId = "cmd-A1";

  RuntimeEvidence runtime = {
    true, false, true, true, true, true, true, true, true, true, true,
    100U, 100U, 500U, 10000U
  };
  assert(evaluateRuntime(runtime) == STOP_NONE);
  runtime.deliveredWaterMl = 500U;
  assert(evaluateRuntime(runtime) & STOP_VOLUME_REACHED);
  runtime.deliveredWaterMl = 100U;
  runtime.elapsedMs = 10000U;
  assert(evaluateRuntime(runtime) & STOP_TIMEOUT);
  runtime.elapsedMs = 100U;
  runtime.interlockOk = false;
  assert(evaluateRuntime(runtime) & STOP_INTERLOCK);
  runtime.interlockOk = true;
  runtime.flowCounterFresh = false;
  assert(evaluateRuntime(runtime) & STOP_FLOW_LOST);
  runtime.flowCounterFresh = true;
  runtime.automaticModeConfirmed = false;
  assert(evaluateRuntime(runtime) & STOP_SELECTOR_CHANGED);
  runtime.automaticModeConfirmed = true;
  runtime.relayOwnershipStillHeld = false;
  assert(evaluateRuntime(runtime) & STOP_OWNER_LOST);
  runtime.relayOwnershipStillHeld = true;
  runtime.waterPumpReadbackKnown = false;
  assert(evaluateRuntime(runtime) & STOP_OUTPUT_UNKNOWN);
  runtime.waterPumpReadbackKnown = true;
  runtime.gatewayFresh = false;
  assert(evaluateRuntime(runtime) & STOP_GATEWAY_LOST);
  runtime.gatewayFresh = true;
  runtime.watchdogHealthy = false;
  assert(evaluateRuntime(runtime) & STOP_WATCHDOG);
  runtime.watchdogHealthy = true;
  runtime.operatorStopRequested = true;
  assert(evaluateRuntime(runtime) & STOP_OPERATOR);
  runtime.operatorStopRequested = false;
  runtime.sessionActive = false;
  assert(evaluateRuntime(runtime) & STOP_UNINITIALIZED);
  return 0;
}
