#pragma once
#include <Arduino.h>
#include "AdaptiveFertigationTypes.h"
#include "AdaptiveFertigationJournal.h"

// Forward references to globals and helpers in the main sketch
extern Preferences prefs;
extern NutriData nutri;
extern SlaveData slaveData;
extern SoilData soil1;
extern SoilData soil2;
extern bool relayReady;
extern bool setPumpOutput(uint8_t relayNum, bool state, bool &actualState);
extern bool relayOutputReadback(uint8_t relayNum, bool &state);
extern void spffStopAutomaticOutputs(const char *reason);
extern bool spffCh3WaterInterlockActive();
extern bool spffCh3OnBlocked();
extern bool spffScheduleWindowOpen(uint8_t target);
extern bool otaMaintenanceActive();
extern bool spffAutomaticSlaveFresh(uint32_t maxAgeSeconds);
extern uint32_t spffUtcEpoch();
extern String spffUtcIso8601();
extern bool spffWriteJsonLine(const String &json);
extern void spffAppendEscapedString(String &out, const String &in);
extern bool spffStatusDirty;
extern SpffActuatorStateTracker spffWaterStateTracker;
extern SpffActuatorStateTracker spffFertStateTracker;
extern void spffRememberActuatorState(SpffActuatorStateTracker &tracker, bool known, bool active);
extern bool sendSpffActuatorStateEvent(const String &targetId, bool actualKnown, bool actualActive, const String &commandId, const char *reason);

// Global objects for adaptive fertigation
static AdaptiveFertigationTracker g_afertTracker = {};
static AdaptiveFertigationConfig  g_afertConfig  = defaultAdaptiveFertConfig();

inline bool adaptiveFertOwnsRelays() {
  return (g_afertTracker.state >= FERT_STATE_PRECHECK && g_afertTracker.state <= FERT_STATE_FAULT);
}

inline bool adaptiveEcFresh() {
  return nutri.hasValue && isfinite(nutri.ec) && nutri.ec >= 0.0f &&
    nutri.lastGoodMs != 0 && (uint32_t)(millis()-nutri.lastGoodMs) <= 30000UL;
}
inline void adaptiveReadRelays() {
  g_afertTracker.waterPumpKnown = relayOutputReadback(PUMP_WATER_RELAY, g_afertTracker.waterPumpActive);
  g_afertTracker.fertPumpKnown = relayOutputReadback(PUMP_FERTILIZER_RELAY, g_afertTracker.fertPumpActive);
}
inline bool adaptiveStopOutputs(const char *reason) {
  spffStopAutomaticOutputs(reason);
  adaptiveReadRelays();
  return g_afertTracker.waterPumpKnown && g_afertTracker.fertPumpKnown &&
    !g_afertTracker.waterPumpActive && !g_afertTracker.fertPumpActive;
}
inline bool adaptiveUuid(const String &v) {
  if (v.length()!=36) return false;
  for (size_t i=0;i<36;i++) {
    if(i==8||i==13||i==18||i==23) { if(v[i]!='-') return false; }
    else if(!isxdigit((unsigned char)v[i])) return false;
  }
  return true;
}
static String adaptiveLastSession, adaptiveLastCommand, adaptiveLastStatus, adaptiveLastReason;
static String adaptiveAckSession, adaptiveAckCommand;
static bool adaptiveHandlingCommand = false;
inline void sendAdaptiveFertAck(const char *status, const char *reason) {
  if (adaptiveHandlingCommand) {
    adaptiveLastSession=adaptiveAckSession; adaptiveLastCommand=adaptiveAckCommand;
    adaptiveLastStatus=status; adaptiveLastReason=reason;
  }
  String at = spffUtcIso8601();
  String json = "{\"kind\":\"adaptive_fert_ack\",\"schemaVersion\":1,\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\",\"sessionId\":\"";
  spffAppendEscapedString(json, adaptiveHandlingCommand ? adaptiveAckSession : String(g_afertTracker.sessionId));
  json += "\",\"commandId\":\"";
  spffAppendEscapedString(json, adaptiveHandlingCommand ? adaptiveAckCommand : String(g_afertTracker.commandId));
  json += "\",\"state\":\"";
  json += adaptiveFertStateToString(g_afertTracker.state);
  json += "\",\"status\":\"";
  json += status;
  json += "\",\"acknowledgedAt\":\"";
  json += at;
  json += "\",\"reason\":\"";
  json += reason;
  json += "\"}";
  spffWriteJsonLine(json);
}

inline void sendAdaptiveFertTelemetry() {
  bool waterActual=false,fertActual=false;
  const bool waterKnown=relayOutputReadback(PUMP_WATER_RELAY,waterActual);
  const bool fertKnown=relayOutputReadback(PUMP_FERTILIZER_RELAY,fertActual);
  String at = spffUtcIso8601();
  String json = "{\"kind\":\"adaptive_fert_telemetry\",\"schemaVersion\":1,\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\",\"timestamp\":\"";
  json += at;
  json += "\",\"sessionId\":\"";
  spffAppendEscapedString(json, g_afertTracker.sessionId);
  json += "\",\"state\":\"";
  json += adaptiveFertStateToString(g_afertTracker.state);
  json += "\",\"filteredEc\":";
  json += String(g_afertTracker.filteredEc, 1);
  json += ",\"rawEc\":";
  json += String(nutri.hasValue && isfinite(nutri.ec) ? nutri.ec : 0.0f, 1);
  json += ",\"waterFlowLpm\":";
  json += String(isfinite(slaveData.waterFlowLpm) ? slaveData.waterFlowLpm : 0.0f, 2);
  json += ",\"fertFlowLpm\":";
  json += String(isfinite(slaveData.fertFlowLpm) ? slaveData.fertFlowLpm : 0.0f, 2);
  json += ",\"waterVolumeL\":";
  json += String(g_afertTracker.accumulatedWaterL, 2);
  json += ",\"fertVolumeL\":";
  json += String(g_afertTracker.accumulatedFertL, 2);
  json += ",\"fertMassGrams\":";
  json += String(g_afertTracker.estimatedFertMassGrams, 1);
  json += ",\"volumePerPlantMl\":";
  json += String(g_afertTracker.volumePerPlantMl, 1);
  json += ",\"waterPump\":";
  json += waterActual ? "true" : "false";
  json += ",\"fertPump\":";
  json += fertActual ? "true" : "false";
  json += ",\"faultReason\":\"";
  json += adaptiveFertFaultToString(g_afertTracker.faultReason);
  json += "\",\"ecTargetUnreachable\":";
  json += g_afertTracker.ecTargetUnreachable ? "true" : "false";
  json += ",\"ecValid\":"; json += adaptiveEcFresh() ? "true":"false";
  json += ",\"flowValid\":"; json += spffAutomaticSlaveFresh(25U) ? "true":"false";
  json += ",\"ecAgeMs\":"; json += String((uint32_t)(millis()-nutri.lastGoodMs));
  json += ",\"flowAgeMs\":"; json += String((uint32_t)(millis()-slaveData.lastGoodMs));
  json += ",\"waterPumpKnown\":"; json += waterKnown ? "true":"false";
  json += ",\"fertPumpKnown\":"; json += fertKnown ? "true":"false";
  json += ",\"volumeEstimated\":"; json += g_afertTracker.volumeEstimated ? "true":"false";
  json += ",\"targetEcUs\":"; json += String(g_afertConfig.targetEcUs,1);
  json += ",\"bootId\":\""; json += spffBootId;
  json += "\",\"controlAlgorithm\":\"ec_hysteresis_ema\",\"firmwareVersion\":\"1.5.03-SHT20-TELEMETRY-SYNC\"";

  json += "}";
  spffWriteJsonLine(json);
}

inline void abortAdaptiveFertigation(AdaptiveFertigationFaultReason reason, const char *desc) {
  g_afertTracker.state = FERT_STATE_FAULT;
  g_afertTracker.faultReason = reason;
  if (!adaptiveStopOutputs(desc)) g_afertTracker.faultReason = FERT_FAULT_RELAY_ERROR;
  g_afertTracker.lastFaultRetryMs = millis();

  saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
  sendAdaptiveFertAck("fault", desc);
  sendAdaptiveFertTelemetry();
  spffStatusDirty = true;
}

// Fast guards also run while a bounded Modbus read is waiting for bytes.
inline void serviceAdaptiveSafety() {
  static bool busy=false;
  if (busy || g_afertTracker.state<FERT_STATE_WATER_PRIME || g_afertTracker.state>FERT_STATE_FLUSHING) return;
  busy=true;
  if (!spffAutomaticSlaveFresh(25U)) abortAdaptiveFertigation(FERT_FAULT_SLAVE_SENSOR_INVALID,"slave_sensor_stale");
  else if (!adaptiveEcFresh()) abortAdaptiveFertigation(FERT_FAULT_EC_SENSOR_INVALID,"ec_sensor_stale");
  else if (g_afertTracker.state!=FERT_STATE_WATER_PRIME && (!isfinite(slaveData.waterFlowLpm) || slaveData.waterFlowLpm<g_afertConfig.minWaterFlowLpm*0.4f))
    abortAdaptiveFertigation(FERT_FAULT_DRY_RUN_WATER,"water_flow_lost");
  else if (g_afertTracker.fertPumpActive && (uint32_t)(millis()-g_afertTracker.fertPumpCurrentOnStartedMs)>=g_afertConfig.maxContinuousFertOnMs)
    abortAdaptiveFertigation(FERT_FAULT_EC_TARGET_UNREACHABLE,"continuous_injection_limit");
  busy=false;
}

inline void initAdaptiveFertigation() {
  memset(&g_afertTracker, 0, sizeof(g_afertTracker));
  g_afertTracker.state = FERT_STATE_IDLE;
  g_afertTracker.faultReason = FERT_FAULT_NONE;

  AdaptiveFertJournalData jData;
  if (loadAdaptiveFertJournal(prefs, jData)) {
    // If system rebooted while session was active, latch into FAULT safely
    if (jData.state > (uint8_t)FERT_STATE_IDLE && jData.state != (uint8_t)FERT_STATE_COMPLETED) {
      strncpy(g_afertTracker.sessionId, jData.sessionId, sizeof(g_afertTracker.sessionId) - 1);
      strncpy(g_afertTracker.commandId, jData.commandId, sizeof(g_afertTracker.commandId) - 1);
      g_afertTracker.accumulatedWaterL = jData.accumulatedWaterL;
      g_afertTracker.accumulatedFertL = jData.accumulatedFertL;
      abortAdaptiveFertigation(FERT_FAULT_INTERRUPTED_RESTART, "interrupted_by_reboot");
    }
  }
}

inline void updateAdaptiveFertVolume() {
  // Integrate once per fresh meter sample; never integrate a cached stale flow.
  if (!spffAutomaticSlaveFresh(25U) || slaveData.lastGoodMs == g_afertTracker.lastFlowSampleMs) return;
  const uint32_t sample=slaveData.lastGoodMs;
  float dt = g_afertTracker.lastFlowSampleMs ? (float)(sample-g_afertTracker.lastFlowSampleMs)/60000.0f : 0;
  g_afertTracker.lastFlowSampleMs=sample;
  if (slaveData.totalsAvailable) {
    if (g_afertTracker.baseTotalsCaptured) {
      // Counter decrease is uncertain (reboot/reset/wrap); stop instead of inventing dose.
      if (slaveData.waterTotalMl < g_afertTracker.lastSlaveWaterTotalMl || slaveData.fertTotalMl < g_afertTracker.lastSlaveFertTotalMl) {
        abortAdaptiveFertigation(FERT_FAULT_SLAVE_SENSOR_INVALID,"flow_totalizer_reset"); return;
      }
      g_afertTracker.accumulatedWaterL += (slaveData.waterTotalMl-g_afertTracker.lastSlaveWaterTotalMl)/1000.0f;
      g_afertTracker.accumulatedFertL += (slaveData.fertTotalMl-g_afertTracker.lastSlaveFertTotalMl)/1000.0f;
    }
    g_afertTracker.baseTotalsCaptured=true;
    g_afertTracker.lastSlaveWaterTotalMl=slaveData.waterTotalMl;
    g_afertTracker.lastSlaveFertTotalMl=slaveData.fertTotalMl;
  } else {
    if (g_afertTracker.baseTotalsCaptured) { abortAdaptiveFertigation(FERT_FAULT_SLAVE_SENSOR_INVALID,"flow_totalizer_missing"); return; }
    g_afertTracker.volumeEstimated=true;
    if (dt>0 && dt<=25.0f/60.0f) {
      if (g_afertTracker.waterPumpActive && isfinite(slaveData.waterFlowLpm)) g_afertTracker.accumulatedWaterL += max(0.0f,slaveData.waterFlowLpm)*dt;
      if (g_afertTracker.fertPumpActive && isfinite(slaveData.fertFlowLpm)) g_afertTracker.accumulatedFertL += max(0.0f,slaveData.fertFlowLpm)*dt;
    }
  }
  g_afertTracker.estimatedFertMassGrams=g_afertTracker.accumulatedFertL*g_afertConfig.nominalConcentrationGPerL;
  if (g_afertConfig.plantCount) g_afertTracker.volumePerPlantMl=g_afertTracker.accumulatedWaterL*1000.0f/g_afertConfig.plantCount;
}

inline void updateAdaptiveFertEcFilter() {
  if (!adaptiveEcFresh() || (g_afertTracker.ecFilterInitialized && g_afertTracker.lastEcSampleMs==nutri.lastGoodMs)) return;
  g_afertTracker.lastEcSampleMs=nutri.lastGoodMs;
  if (!g_afertTracker.ecFilterInitialized) {
    g_afertTracker.filteredEc = nutri.ec;
    g_afertTracker.ecFilterInitialized = true;
  } else {
    // EMA: 30% new sample, 70% previous filtered value
    g_afertTracker.filteredEc = (0.3f * nutri.ec) + (0.7f * g_afertTracker.filteredEc);
  }
}

inline void serviceAdaptiveFertigation() {
  const uint32_t nowMs = millis();

  // Telemetry periodic output (every 5 seconds during active session, or 30s in idle)
  const uint32_t telemInterval = 5000UL;
  if ((uint32_t)(nowMs - g_afertTracker.lastTelemetryMs) >= telemInterval) {
    g_afertTracker.lastTelemetryMs = nowMs;
    sendAdaptiveFertTelemetry();
  }

  if (g_afertTracker.state == FERT_STATE_IDLE) {
    return;
  }

  if (g_afertTracker.state == FERT_STATE_FAULT) {
    if ((uint32_t)(nowMs-g_afertTracker.lastFaultRetryMs)>=2000UL) {
      g_afertTracker.lastFaultRetryMs=nowMs;
      adaptiveReadRelays();
      if (!g_afertTracker.waterPumpKnown || !g_afertTracker.fertPumpKnown || g_afertTracker.waterPumpActive || g_afertTracker.fertPumpActive)
        adaptiveStopOutputs("adaptive_fault_shutdown_retry");
    }
    return;
  }
  if (g_afertTracker.state == FERT_STATE_PAUSED || g_afertTracker.state == FERT_STATE_COMPLETED) return;
  if (!spffAutomaticSlaveFresh(25U)) { abortAdaptiveFertigation(FERT_FAULT_SLAVE_SENSOR_INVALID,"slave_sensor_stale"); return; }
  if (!adaptiveEcFresh()) { abortAdaptiveFertigation(FERT_FAULT_EC_SENSOR_INVALID,"ec_sensor_stale"); return; }
  if (!relayReady || spffShutdownPending || spffShutdownFaultLatched) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_fault"); return; }
  // Verify relay readback against expected state while the session owns outputs.
  if (g_afertTracker.state != FERT_STATE_PRECHECK && (uint32_t)(nowMs-g_afertTracker.lastRelayVerifyMs)>=1000UL) {
    g_afertTracker.lastRelayVerifyMs=nowMs;
    bool water=false,fert=false;
    if (!relayOutputReadback(PUMP_WATER_RELAY,water) || !relayOutputReadback(PUMP_FERTILIZER_RELAY,fert) ||
        water!=g_afertTracker.waterPumpActive || fert!=g_afertTracker.fertPumpActive) {
      abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_state_mismatch"); return;
    }
  }
  if ((g_afertTracker.state==FERT_STATE_NUTRIENT_COMPLETE || g_afertTracker.state==FERT_STATE_FLUSHING) &&
      (!isfinite(slaveData.waterFlowLpm) || slaveData.waterFlowLpm<g_afertConfig.minWaterFlowLpm*0.4f)) {
    abortAdaptiveFertigation(FERT_FAULT_DRY_RUN_WATER,"water_flow_lost"); return;
  }

  // Interlock checks: Master Water Tank Level & Safety
  if (spffCh3WaterInterlockActive() || spffCh3OnBlocked()) {
    abortAdaptiveFertigation(FERT_FAULT_WATER_TANK_LOW, "water_tank_level_critical");
    return;
  }

  // Interlock: Schedule Window Priority Takeover
  if (spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_WATER) || spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_FERT)) {
    abortAdaptiveFertigation(FERT_FAULT_SCHEDULE_PRIORITY, "schedule_priority_takeover");
    return;
  }

  // Interlock: OTA maintenance active
  if (otaMaintenanceActive()) {
    abortAdaptiveFertigation(FERT_FAULT_OPERATOR_ABORT, "ota_maintenance_active");
    return;
  }

  // State Machine Execution
  switch (g_afertTracker.state) {
    case FERT_STATE_PRECHECK: {
      // Validate sensors before starting pumps
      if (!spffAutomaticSlaveFresh(25U)) {
        abortAdaptiveFertigation(FERT_FAULT_SLAVE_SENSOR_INVALID, "slave_sensor_stale");
        return;
      }
      if (!nutri.hasValue || (uint32_t)(nowMs - nutri.lastGoodMs) > 30000UL) {
        abortAdaptiveFertigation(FERT_FAULT_EC_SENSOR_INVALID, "ec_sensor_not_ready");
        return;
      }
      if (!relayReady) {
        abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR, "relay_expander_not_ready");
        return;
      }

      // Capture base totalizers
      if (slaveData.totalsAvailable && !g_afertTracker.resumePending) {
        g_afertTracker.lastSlaveWaterTotalMl=slaveData.waterTotalMl;
        g_afertTracker.lastSlaveFertTotalMl=slaveData.fertTotalMl;
        g_afertTracker.lastFlowSampleMs=slaveData.lastGoodMs;
        g_afertTracker.baseSlaveWaterTotalMl = slaveData.waterTotalMl;
        g_afertTracker.baseSlaveFertTotalMl = slaveData.fertTotalMl;
        g_afertTracker.baseTotalsCaptured = true;
      }
      g_afertTracker.lastVolumeUpdateMs = nowMs;

      // Start water pump for priming
      bool actual = false;
      if (!setPumpOutput(PUMP_WATER_RELAY, true, actual) || !actual) {
        abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR, "water_pump_relay_failed");
        return;
      }
      g_afertTracker.waterPumpActive = true;
      spffRememberActuatorState(spffWaterStateTracker, true, true);

      g_afertTracker.state = FERT_STATE_WATER_PRIME;
      g_afertTracker.stateEnteredMs = nowMs;
      saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
      sendAdaptiveFertAck("in_progress", "water_priming_started");
      break;
    }

    case FERT_STATE_WATER_PRIME: {
      updateAdaptiveFertVolume();
      if (g_afertTracker.state==FERT_STATE_FAULT) return;
      // Check dry-run timeout
      if ((uint32_t)(nowMs - g_afertTracker.stateEnteredMs) > g_afertConfig.waterPrimeTimeoutMs) {
        abortAdaptiveFertigation(FERT_FAULT_DRY_RUN_WATER, "water_prime_timeout_no_flow");
        return;
      }

      // Check if water flow is established and stable
      if (isfinite(slaveData.waterFlowLpm) && slaveData.waterFlowLpm >= g_afertConfig.minWaterFlowLpm) {
        // Aliran air sudah tercapai, transisi ke kontrol EC
        g_afertTracker.state = g_afertTracker.resumePending ? g_afertTracker.resumeState : FERT_STATE_EC_CONTROL;
        if (g_afertTracker.state==FERT_STATE_WATER_PRIME) g_afertTracker.state=FERT_STATE_EC_CONTROL;
        g_afertTracker.stateEnteredMs = nowMs-(g_afertTracker.resumePending ? g_afertTracker.pausedPhaseElapsedMs : 0UL);
        g_afertTracker.resumePending=false;
        g_afertTracker.fertPumpLastSwitchedMs = nowMs;
        g_afertTracker.mixingDelayActive = false;
        g_afertTracker.ecFilterInitialized = false;
        updateAdaptiveFertEcFilter();

        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("in_progress", "ec_control_started");
      }
      break;
    }

    case FERT_STATE_EC_CONTROL: {
      updateAdaptiveFertVolume();
      if (g_afertTracker.state==FERT_STATE_FAULT) return;
      updateAdaptiveFertEcFilter();

      // 1. Water flow loss protection during EC control
      if (!isfinite(slaveData.waterFlowLpm) || slaveData.waterFlowLpm < (g_afertConfig.minWaterFlowLpm * 0.4f)) {
        // Water flow dropped! Cut off fertilizer immediately to prevent concentrated backflow
        if (g_afertTracker.fertPumpActive) {
          bool actual = false;
          if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
          g_afertTracker.fertPumpActive = false;
          spffRememberActuatorState(spffFertStateTracker, true, false);
        }
        abortAdaptiveFertigation(FERT_FAULT_DRY_RUN_WATER, "water_flow_lost_during_ec_control");
        return;
      }

      // 2. Check total session max duration
      if ((uint32_t)(nowMs - g_afertTracker.sessionStartedMs) >= (g_afertConfig.maxDurationSec * 1000UL)) {
        // Time is up -> advance to flushing
        if (g_afertTracker.fertPumpActive) {
          bool actual = false;
          if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
          g_afertTracker.fertPumpActive = false;
          spffRememberActuatorState(spffFertStateTracker, true, false);
        }
        g_afertTracker.state = FERT_STATE_FLUSHING;
        g_afertTracker.stateEnteredMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("in_progress", "duration_limit_flushing_started");
        return;
      }

      // 3. Check nutrient target volume completion
      if (g_afertTracker.accumulatedFertL >= g_afertConfig.targetFertVolumeL) {
        if (g_afertTracker.fertPumpActive) {
          bool actual = false;
          if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
          g_afertTracker.fertPumpActive = false;
          spffRememberActuatorState(spffFertStateTracker, true, false);
        }
        g_afertTracker.state = FERT_STATE_NUTRIENT_COMPLETE;
        g_afertTracker.stateEnteredMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("in_progress", "nutrient_volume_target_reached");
        return;
      }

      // 4. Check total water volume limit
      if (g_afertTracker.accumulatedWaterL >= g_afertConfig.targetWaterVolumeL) {
        if (g_afertTracker.fertPumpActive) {
          bool actual = false;
          if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
          g_afertTracker.fertPumpActive = false;
          spffRememberActuatorState(spffFertStateTracker, true, false);
        }
        g_afertTracker.state = FERT_STATE_FLUSHING;
        g_afertTracker.stateEnteredMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("in_progress", "water_volume_target_reached_flushing");
        return;
      }

      // 5. EC sensor freshness check
      if (!nutri.hasValue || (uint32_t)(nowMs - nutri.lastGoodMs) > 30000UL) {
        abortAdaptiveFertigation(FERT_FAULT_EC_SENSOR_INVALID, "ec_sensor_stale_during_injection");
        return;
      }

      // 6. Hysteresis Controller Logic
      const float ecLowThreshold  = g_afertConfig.targetEcUs - g_afertConfig.ecToleranceUs;
      const float ecHighThreshold = g_afertConfig.targetEcUs + g_afertConfig.ecToleranceUs;

      if (g_afertTracker.fertPumpActive) {
        // Watchdog: Continuous ON time without reaching target EC
        if ((uint32_t)(nowMs - g_afertTracker.fertPumpCurrentOnStartedMs) >= g_afertConfig.maxContinuousFertOnMs) {
          bool actual = false;
          if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
          g_afertTracker.fertPumpActive = false;
          g_afertTracker.fertPumpLastSwitchedMs = nowMs;
          g_afertTracker.ecTargetUnreachable = true;
          spffRememberActuatorState(spffFertStateTracker, true, false);
          sendAdaptiveFertAck("in_progress", "ec_target_unreachable_injection_paused");
        } else if (g_afertTracker.filteredEc >= ecHighThreshold) {
          // Check Minimum ON Time before turning OFF
          if ((uint32_t)(nowMs - g_afertTracker.fertPumpCurrentOnStartedMs) >= g_afertConfig.minPumpOnTimeMs) {
            bool actual = false;
            if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
            g_afertTracker.fertPumpActive = false;
            g_afertTracker.fertPumpLastSwitchedMs = nowMs;
            g_afertTracker.lastMixingDelayStartedMs = nowMs;
            g_afertTracker.mixingDelayActive = true;
            spffRememberActuatorState(spffFertStateTracker, true, false);
          }
        }
      } else {
        // Fertilizer pump is currently OFF
        // Check mixing stabilization delay
        if (g_afertTracker.mixingDelayActive) {
          if ((uint32_t)(nowMs - g_afertTracker.lastMixingDelayStartedMs) >= g_afertConfig.mixingStabilizationDelayMs) {
            g_afertTracker.mixingDelayActive = false;
          }
        }

        if (!g_afertTracker.mixingDelayActive && !g_afertTracker.ecTargetUnreachable) {
          if (g_afertTracker.filteredEc <= ecLowThreshold) {
            // Check Minimum OFF Time before turning ON
            if ((uint32_t)(nowMs - g_afertTracker.fertPumpLastSwitchedMs) >= g_afertConfig.minPumpOffTimeMs) {
              bool actual = false;
              if (setPumpOutput(PUMP_FERTILIZER_RELAY, true, actual) && actual) {
                g_afertTracker.fertPumpActive = true;
                g_afertTracker.fertPumpLastSwitchedMs = nowMs;
                g_afertTracker.fertPumpCurrentOnStartedMs = nowMs;
                spffRememberActuatorState(spffFertStateTracker, true, true);
              }
            }
          }
        }
      }

      // Safe Flash Persistence: Save journal every 60 seconds
      if ((uint32_t)(nowMs - g_afertTracker.lastNvsSaveMs) >= 60000UL) {
        g_afertTracker.lastNvsSaveMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
      }
      break;
    }

    case FERT_STATE_NUTRIENT_COMPLETE: {
      updateAdaptiveFertVolume();
      if (g_afertTracker.state==FERT_STATE_FAULT) return;
      // Ensure fert pump is physically off
      if (g_afertTracker.fertPumpActive) {
        bool actual = false;
        if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
        g_afertTracker.fertPumpActive = false;
        spffRememberActuatorState(spffFertStateTracker, true, false);
      }

      // Check if water irrigation volume or max duration is reached
      if (g_afertTracker.accumulatedWaterL >= g_afertConfig.targetWaterVolumeL ||
          (uint32_t)(nowMs - g_afertTracker.sessionStartedMs) >= (g_afertConfig.maxDurationSec * 1000UL)) {
        g_afertTracker.state = FERT_STATE_FLUSHING;
        g_afertTracker.stateEnteredMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("in_progress", "flushing_started");
      }
      break;
    }

    case FERT_STATE_FLUSHING: {
      updateAdaptiveFertVolume();
      if (g_afertTracker.state==FERT_STATE_FAULT) return;
      // Ensure fert pump is off
      if (g_afertTracker.fertPumpActive) {
        bool actual = false;
        if (!setPumpOutput(PUMP_FERTILIZER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
        g_afertTracker.fertPumpActive = false;
      }

      // Flushing runs until flush duration or flush volume is reached
      const uint32_t flushElapsedSec = (uint32_t)(nowMs - g_afertTracker.stateEnteredMs) / 1000UL;
      if (flushElapsedSec >= g_afertConfig.flushDurationSec) {
        // Complete! Turn off water pump
        bool actual = false;
        if (!setPumpOutput(PUMP_WATER_RELAY, false, actual) || actual) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return; }
        g_afertTracker.waterPumpActive = false;
        spffRememberActuatorState(spffWaterStateTracker, true, false);

        g_afertTracker.state = FERT_STATE_COMPLETED;
        g_afertTracker.stateEnteredMs = nowMs;
        saveAdaptiveFertJournal(prefs, g_afertTracker, g_afertConfig, spffUtcEpoch());
        sendAdaptiveFertAck("completed", "session_completed_normally");
        sendAdaptiveFertTelemetry();
        spffStatusDirty = true;
      }
      break;
    }

    case FERT_STATE_COMPLETED: {
      // Transition cleanly back to IDLE
      g_afertTracker.state = FERT_STATE_IDLE;
      g_afertTracker.faultReason = FERT_FAULT_NONE;
      clearAdaptiveFertJournal(prefs);
      break;
    }

    case FERT_STATE_PAUSED: {
      // Pumps are paused OFF
      break;
    }

    case FERT_STATE_FAULT: {
      // Latched until manual clear/abort
      break;
    }
  }
}

inline bool processAdaptiveFertCommand(const String &line, size_t start, size_t end) {
  String kind, cmdType, site, device, session, command;
  uint32_t version = 0;

  if (!spffJsonGetStringMember(line, start, end, "kind", kind) || kind != "adaptive_fert_command") {
    return false;
  }
  if (!spffJsonGetUintMember(line, start, end, "schemaVersion", version) || version != 1) {
    return false;
  }
  if (!spffJsonGetStringMember(line, start, end, "siteId", site) || site != SPFF_SITE_ID) {
    return false;
  }
  if (!spffJsonGetStringMember(line, start, end, "deviceId", device) || device != SPFF_DEVICE_ID) {
    return false;
  }
  if (!spffJsonGetStringMember(line, start, end, "commandType", cmdType)) {
    return false;
  }
  if (!spffJsonGetStringMember(line, start, end, "sessionId", session) || !adaptiveUuid(session)) {
    return false;
  }
  if (!spffJsonGetStringMember(line, start, end, "commandId", command) || !adaptiveUuid(command)) {
    return false;
  }

  struct AckScope { AckScope(){adaptiveHandlingCommand=true;} ~AckScope(){adaptiveHandlingCommand=false;} } scope;
  adaptiveAckSession=session; adaptiveAckCommand=command;
  if (session==adaptiveLastSession && command==adaptiveLastCommand) {
    String status=adaptiveLastStatus,reason=adaptiveLastReason;
    sendAdaptiveFertAck(status.c_str(),reason.c_str()); return true;
  }
  if (cmdType=="status") { sendAdaptiveFertAck("accepted","status_report"); sendAdaptiveFertTelemetry(); return true; }
  if (cmdType!="start" && session!=String(g_afertTracker.sessionId)) { sendAdaptiveFertAck("rejected","session_mismatch"); return true; }
  if (cmdType=="start" && session==String(g_afertTracker.sessionId)) { sendAdaptiveFertAck("rejected","session_id_reused"); return true; }
  if (cmdType=="reset_fault") {
    if (g_afertTracker.state!=FERT_STATE_FAULT && g_afertTracker.state!=FERT_STATE_COMPLETED) { sendAdaptiveFertAck("rejected","not_terminal"); return true; }
    if (!adaptiveStopOutputs("adaptive_reset")) { sendAdaptiveFertAck("rejected","relay_fault"); return true; }
    g_afertTracker.state=FERT_STATE_IDLE; g_afertTracker.faultReason=FERT_FAULT_NONE;
    clearAdaptiveFertJournal(prefs); sendAdaptiveFertAck("accepted","fault_reset"); sendAdaptiveFertTelemetry(); return true;
  }
  if (cmdType=="start" || cmdType=="resume") {
    String boot,issued,expires; uint32_t issuedEpoch=0,expiresEpoch=0,now=spffUtcEpoch();
    if (!spffJsonGetStringMember(line,start,end,"bootId",boot) || boot!=spffBootId ||
        !spffJsonGetStringMember(line,start,end,"issuedAt",issued) || !spffJsonGetStringMember(line,start,end,"expiresAt",expires) ||
        !spffParseUtcIso8601Epoch(issued,issuedEpoch) || !spffParseUtcIso8601Epoch(expires,expiresEpoch) ||
        now<issuedEpoch || now>=expiresEpoch || expiresEpoch<=issuedEpoch || expiresEpoch-issuedEpoch>300UL) {
      sendAdaptiveFertAck("rejected","expired_or_wrong_boot"); return true;
    }
    if (!adaptiveEcFresh() || !spffAutomaticSlaveFresh(25U) || timedWaterOwner || serverSoilEcOwnsRelays() ||
        spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_WATER) || spffScheduleWindowOpen(SPFF_SCHEDULE_TARGET_FERT) ||
        !spffAutomaticControlLoaded || spffAutomaticControl.desiredMode!=SPFF_MODE_MANUAL) {
      sendAdaptiveFertAck("rejected","sensors_or_control_not_ready"); return true;
    }
  }

  // Handle Command Types: start, stop, pause, resume
  if (cmdType == "start") {
    if (g_afertTracker.state != FERT_STATE_IDLE && g_afertTracker.state != FERT_STATE_COMPLETED) {
      sendAdaptiveFertAck("rejected", "session_already_active");
      return true;
    }
    if (spffCh3WaterInterlockActive() || spffCh3OnBlocked()) {
      sendAdaptiveFertAck("rejected", "water_tank_level_low");
      return true;
    }
    if (otaMaintenanceActive()) {
      sendAdaptiveFertAck("rejected", "ota_active");
      return true;
    }

    g_afertConfig=defaultAdaptiveFertConfig();
    // Validate every required field; never silently substitute dose defaults.
    // Optional config parameters from JSON
    float tEc = 0.0f, ecTol = 0.0f, tWater = 0.0f, tFert = 0.0f, flushVol = 0.0f, conc = 0.0f;
    uint32_t maxDur = 0, flushDur = 0, plants = 0;
    bool isNull = false;

    if (spffJsonGetNullableFloatMember(line, start, end, "targetEcUs", tEc, isNull) && !isNull && tEc > 100.0f && tEc < 8000.0f) {
      g_afertConfig.targetEcUs = tEc;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetNullableFloatMember(line, start, end, "ecToleranceUs", ecTol, isNull) && !isNull && ecTol >= 20.0f && ecTol <= 500.0f) {
      g_afertConfig.ecToleranceUs = ecTol;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetUintMember(line, start, end, "maxDurationSec", maxDur) && maxDur >= 60 && maxDur <= 7200) {
      g_afertConfig.maxDurationSec = maxDur;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetNullableFloatMember(line, start, end, "targetWaterVolumeL", tWater, isNull) && !isNull && tWater >= 10.0f && tWater <= 10000.0f) {
      g_afertConfig.targetWaterVolumeL = tWater;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetNullableFloatMember(line, start, end, "targetFertVolumeL", tFert, isNull) && !isNull && tFert >= 1.0f && tFert <= 1000.0f) {
      g_afertConfig.targetFertVolumeL = tFert;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetNullableFloatMember(line, start, end, "nominalConcentrationGPerL", conc, isNull) && !isNull && conc > 0.0f) {
      g_afertConfig.nominalConcentrationGPerL = conc;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetUintMember(line, start, end, "plantCount", plants) && plants > 0) {
      g_afertConfig.plantCount = plants;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (spffJsonGetUintMember(line, start, end, "flushDurationSec", flushDur) && flushDur >= 10 && flushDur <= 600) {
      g_afertConfig.flushDurationSec = flushDur;
    } else { sendAdaptiveFertAck("rejected","invalid_config"); return true; }

    if (g_afertConfig.ecToleranceUs>=g_afertConfig.targetEcUs || !isfinite(g_afertConfig.nominalConcentrationGPerL) || g_afertConfig.nominalConcentrationGPerL>1000.0f) { sendAdaptiveFertAck("rejected","invalid_config"); return true; }
    if (!adaptiveStopOutputs("adaptive_prestart")) { sendAdaptiveFertAck("rejected","relay_fault"); return true; }
    // Initialize session tracker
    memset(&g_afertTracker, 0, sizeof(g_afertTracker));
    session.toCharArray(g_afertTracker.sessionId, sizeof(g_afertTracker.sessionId));
    command.toCharArray(g_afertTracker.commandId, sizeof(g_afertTracker.commandId));
    g_afertTracker.sessionStartedEpoch = spffUtcEpoch();
    g_afertTracker.sessionStartedMs = millis();
    g_afertTracker.state = FERT_STATE_PRECHECK;
    g_afertTracker.stateEnteredMs = millis();
    g_afertTracker.faultReason = FERT_FAULT_NONE;

    if (!saveAdaptiveFertJournal(prefs,g_afertTracker,g_afertConfig,spffUtcEpoch())) {
      abortAdaptiveFertigation(FERT_FAULT_STORAGE_ERROR,"journal_write_failed"); return true;
    }
    sendAdaptiveFertAck("accepted", "session_start_accepted");
    spffStatusDirty = true;
    return true;
  }
  else if (cmdType == "stop") {
    abortAdaptiveFertigation(FERT_FAULT_OPERATOR_ABORT, "stopped_by_command");
    return true;
  }
  else if (cmdType == "pause") {
    if (g_afertTracker.state >= FERT_STATE_WATER_PRIME && g_afertTracker.state <= FERT_STATE_FLUSHING) {
      updateAdaptiveFertVolume();
      if (g_afertTracker.state==FERT_STATE_FAULT) return true;
      g_afertTracker.resumeState=g_afertTracker.state;
      g_afertTracker.pausedPhaseElapsedMs=millis()-g_afertTracker.stateEnteredMs;
      if (!adaptiveStopOutputs("adaptive_pause")) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return true; }
      g_afertTracker.pausedAtMs=millis();
      g_afertTracker.state=FERT_STATE_PAUSED;
      if (!saveAdaptiveFertJournal(prefs,g_afertTracker,g_afertConfig,spffUtcEpoch())) { abortAdaptiveFertigation(FERT_FAULT_STORAGE_ERROR,"journal_write_failed"); return true; }
      sendAdaptiveFertAck("accepted", "session_paused");
    } else {
      sendAdaptiveFertAck("rejected", "not_in_pausable_state");
    }
    return true;
  }
  else if (cmdType == "resume") {
    if (g_afertTracker.state == FERT_STATE_PAUSED) {
      if (!adaptiveStopOutputs("adaptive_resume_precheck")) { abortAdaptiveFertigation(FERT_FAULT_RELAY_ERROR,"relay_stop_failed"); return true; }
      g_afertTracker.sessionStartedMs += (uint32_t)(millis()-g_afertTracker.pausedAtMs);
      g_afertTracker.resumePending=true;
      g_afertTracker.lastFlowSampleMs=slaveData.lastGoodMs;
      g_afertTracker.state=FERT_STATE_PRECHECK;
      g_afertTracker.stateEnteredMs=millis();
      sendAdaptiveFertAck("accepted", "session_resumed");
    } else {
      sendAdaptiveFertAck("rejected", "not_paused");
    }
    return true;
  }

  return false;
}
