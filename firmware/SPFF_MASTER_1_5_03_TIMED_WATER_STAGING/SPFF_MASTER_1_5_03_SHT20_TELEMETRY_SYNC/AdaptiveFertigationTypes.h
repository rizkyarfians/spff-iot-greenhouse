#pragma once
#include <Arduino.h>

// =============================================================================
// ADAPTIVE FERTIGATION ENUMS & CONSTANTS
// =============================================================================

enum AdaptiveFertigationState : uint8_t {
  FERT_STATE_IDLE              = 0,
  FERT_STATE_PRECHECK          = 1,
  FERT_STATE_WATER_PRIME       = 2,
  FERT_STATE_EC_CONTROL        = 3,
  FERT_STATE_NUTRIENT_COMPLETE = 4,
  FERT_STATE_FLUSHING          = 5,
  FERT_STATE_COMPLETED         = 6,
  FERT_STATE_PAUSED            = 7,
  FERT_STATE_FAULT             = 8
};

enum AdaptiveFertigationFaultReason : uint8_t {
  FERT_FAULT_NONE                 = 0,
  FERT_FAULT_DRY_RUN_WATER        = 1,
  FERT_FAULT_WATER_TANK_LOW       = 2,
  FERT_FAULT_FERT_TANK_LOW        = 3,
  FERT_FAULT_EC_SENSOR_INVALID    = 4,
  FERT_FAULT_SLAVE_SENSOR_INVALID = 5,
  FERT_FAULT_SESSION_TIMEOUT      = 6,
  FERT_FAULT_EC_TARGET_UNREACHABLE= 7,
  FERT_FAULT_INTERRUPTED_RESTART  = 8,
  FERT_FAULT_RELAY_ERROR          = 9,
  FERT_FAULT_OPERATOR_ABORT       = 10,
  FERT_FAULT_SCHEDULE_PRIORITY    = 11,
  FERT_FAULT_STORAGE_ERROR        = 12,
  FERT_FAULT_SOIL_MOISTURE_LIMIT  = 13
};

inline const char* adaptiveFertStateToString(AdaptiveFertigationState s) {
  switch (s) {
    case FERT_STATE_IDLE:              return "IDLE";
    case FERT_STATE_PRECHECK:          return "PRECHECK";
    case FERT_STATE_WATER_PRIME:       return "WATER_PRIME";
    case FERT_STATE_EC_CONTROL:        return "EC_CONTROL";
    case FERT_STATE_NUTRIENT_COMPLETE: return "NUTRIENT_COMPLETE";
    case FERT_STATE_FLUSHING:          return "FLUSHING";
    case FERT_STATE_COMPLETED:         return "COMPLETED";
    case FERT_STATE_PAUSED:            return "PAUSED";
    case FERT_STATE_FAULT:             return "FAULT";
    default:                           return "UNKNOWN";
  }
}

inline const char* adaptiveFertFaultToString(AdaptiveFertigationFaultReason r) {
  switch (r) {
    case FERT_FAULT_NONE:                  return "none";
    case FERT_FAULT_DRY_RUN_WATER:         return "dry_run_water";
    case FERT_FAULT_WATER_TANK_LOW:        return "water_tank_low";
    case FERT_FAULT_FERT_TANK_LOW:         return "fert_tank_low";
    case FERT_FAULT_EC_SENSOR_INVALID:     return "ec_sensor_invalid";
    case FERT_FAULT_SLAVE_SENSOR_INVALID:  return "slave_sensor_invalid";
    case FERT_FAULT_SESSION_TIMEOUT:       return "session_timeout";
    case FERT_FAULT_EC_TARGET_UNREACHABLE: return "ec_target_unreachable";
    case FERT_FAULT_INTERRUPTED_RESTART:   return "interrupted_by_reboot";
    case FERT_FAULT_RELAY_ERROR:           return "relay_error";
    case FERT_FAULT_OPERATOR_ABORT:        return "operator_abort";
    case FERT_FAULT_SCHEDULE_PRIORITY:     return "schedule_priority";
    case FERT_FAULT_STORAGE_ERROR:         return "storage_error";
    case FERT_FAULT_SOIL_MOISTURE_LIMIT:   return "soil_moisture_limit";
    default:                               return "unknown_fault";
  }
}

// =============================================================================
// ADAPTIVE FERTIGATION CONFIGURATION
// =============================================================================

struct AdaptiveFertigationConfig {
  float targetEcUs;                     // misal 2500 µS/cm
  float ecToleranceUs;                  // misal 100 µS/cm (2400-2600 band)
  uint32_t maxDurationSec;              // misal 960 s (16 min)
  float targetWaterVolumeL;             // misal 500.0 L (2000 x 250 mL)
  float targetFertVolumeL;              // misal 16.0 L
  float flushVolumeL;                   // misal 20.0 L
  uint32_t flushDurationSec;            // misal 60 s
  float maxSoilMoisture;                // batas maks kelembaban tanah (opsional, misal 85%)
  float minWaterFlowLpm;                // minimum debit air untuk prime & injeksi aman (50 L/m)
  float minFertFlowLpm;                 // minimum debit pupuk saat pompa ON (0.5 L/m)
  float nominalConcentrationGPerL;      // misal 10.0 g/L (5 kg / 500 L)
  uint32_t plantCount;                  // misal 2000
  uint32_t minPumpOnTimeMs;             // anti-chattering min ON time (8000 ms)
  uint32_t minPumpOffTimeMs;            // anti-chattering min OFF time (10000 ms)
  uint32_t mixingStabilizationDelayMs;  // transport delay cairan venturi ke sensor (12000 ms)
  uint32_t maxContinuousFertOnMs;       // batas continuous ON sebelum EC_TARGET_UNREACHABLE (180000 ms)
  uint32_t waterPrimeTimeoutMs;         // batas waktu pembentukan aliran air awal (45000 ms)
};

inline AdaptiveFertigationConfig defaultAdaptiveFertConfig() {
  AdaptiveFertigationConfig cfg;
  cfg.targetEcUs                    = 2500.0f;
  cfg.ecToleranceUs                 = 100.0f;
  cfg.maxDurationSec                = 960UL;
  cfg.targetWaterVolumeL            = 500.0f;
  cfg.targetFertVolumeL             = 16.0f;
  cfg.flushVolumeL                  = 20.0f;
  cfg.flushDurationSec              = 60UL;
  cfg.maxSoilMoisture               = 85.0f;
  cfg.minWaterFlowLpm               = 50.0f;
  cfg.minFertFlowLpm                = 0.5f;
  cfg.nominalConcentrationGPerL     = 10.0f;
  cfg.plantCount                    = 2000UL;
  cfg.minPumpOnTimeMs               = 8000UL;
  cfg.minPumpOffTimeMs              = 10000UL;
  cfg.mixingStabilizationDelayMs    = 12000UL;
  cfg.maxContinuousFertOnMs         = 180000UL; // 3 menit
  cfg.waterPrimeTimeoutMs           = 45000UL;
  return cfg;
}

// =============================================================================
// RUNTIME TRACKER
// =============================================================================

struct AdaptiveFertigationTracker {
  AdaptiveFertigationState state;
  AdaptiveFertigationFaultReason faultReason;
  char sessionId[37];
  char commandId[37];
  uint32_t sessionStartedEpoch;
  uint32_t sessionStartedMs;
  uint32_t stateEnteredMs;

  // Actual relay status trackers
  bool waterPumpActive;
  bool fertPumpActive;

  // Sensor & Filtered values
  float filteredEc;
  bool ecFilterInitialized;
  float currentWaterFlowLpm;
  float currentFertFlowLpm;

  // Measured accumulated volumes
  float accumulatedWaterL;
  float accumulatedFertL;
  float estimatedFertMassGrams;
  float volumePerPlantMl;

  // Base totalizers snapshot at session start
  uint32_t baseSlaveWaterTotalMl;
  uint32_t baseSlaveFertTotalMl;
  bool baseTotalsCaptured;
  uint32_t lastVolumeUpdateMs;

  // Timing & guards
  uint32_t fertPumpLastSwitchedMs;
  uint32_t fertPumpCurrentOnStartedMs;
  uint32_t lastMixingDelayStartedMs;
  bool mixingDelayActive;
  bool ecTargetUnreachable;

  // NVS & Telemetry pacing
  uint32_t lastNvsSaveMs;
  uint32_t lastTelemetryMs;

  // Pause tracking
  uint32_t pausedAtMs;
  uint32_t totalPausedDurationMs;
  AdaptiveFertigationState resumeState;
  bool resumePending;
  uint32_t pausedPhaseElapsedMs;
  uint32_t lastEcSampleMs;
  uint32_t lastFlowSampleMs;
  uint32_t lastSlaveWaterTotalMl;
  uint32_t lastSlaveFertTotalMl;
  uint32_t lastRelayVerifyMs;
  uint32_t lastFaultRetryMs;
  bool waterPumpKnown;
  bool fertPumpKnown;
  bool volumeEstimated;
  uint32_t commandFingerprint;
};
