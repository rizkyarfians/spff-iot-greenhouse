#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "AdaptiveFertigationTypes.h"

// =============================================================================
// ADAPTIVE FERTIGATION JOURNAL PERSISTENCE (NVS)
// =============================================================================

struct AdaptiveFertJournalData {
  uint32_t magic;                    // 0x53504646 = "SPFF"
  char sessionId[37];
  char commandId[37];
  uint8_t state;
  uint8_t faultReason;
  uint32_t startEpoch;
  uint32_t lastUpdateEpoch;
  float accumulatedWaterL;
  float accumulatedFertL;
  float targetWaterVolumeL;
  float targetFertVolumeL;
  float targetEcUs;
  uint32_t checksum;
};

static uint32_t calculateAdaptiveFertChecksum(const AdaptiveFertJournalData &data) {
  const uint8_t *p = (const uint8_t*)&data;
  uint32_t h = 2166136261UL;
  for (size_t i = 0; i < offsetof(AdaptiveFertJournalData, checksum); ++i) {
    h ^= p[i];
    h *= 16777619UL;
  }
  return h;
}

inline bool saveAdaptiveFertJournal(Preferences &p, const AdaptiveFertigationTracker &tracker, const AdaptiveFertigationConfig &config, uint32_t nowEpoch) {
  AdaptiveFertJournalData data;
  memset(&data, 0, sizeof(data));
  data.magic = 0x53504646UL;
  strncpy(data.sessionId, tracker.sessionId, sizeof(data.sessionId) - 1);
  strncpy(data.commandId, tracker.commandId, sizeof(data.commandId) - 1);
  data.state = (uint8_t)tracker.state;
  data.faultReason = (uint8_t)tracker.faultReason;
  data.startEpoch = tracker.sessionStartedEpoch;
  data.lastUpdateEpoch = nowEpoch;
  data.accumulatedWaterL = tracker.accumulatedWaterL;
  data.accumulatedFertL = tracker.accumulatedFertL;
  data.targetWaterVolumeL = config.targetWaterVolumeL;
  data.targetFertVolumeL = config.targetFertVolumeL;
  data.targetEcUs = config.targetEcUs;
  data.checksum = calculateAdaptiveFertChecksum(data);

  return (p.putBytes("rb_afert", &data, sizeof(data)) == sizeof(data));
}

inline bool loadAdaptiveFertJournal(Preferences &p, AdaptiveFertJournalData &outData) {
  if (!p.isKey("rb_afert")) return false;
  if (p.getBytesLength("rb_afert") != sizeof(AdaptiveFertJournalData)) return false;
  if (p.getBytes("rb_afert", &outData, sizeof(AdaptiveFertJournalData)) != sizeof(AdaptiveFertJournalData)) return false;

  if (outData.magic != 0x53504646UL) return false;
  if (outData.checksum != calculateAdaptiveFertChecksum(outData)) return false;
  if (outData.sessionId[36] != '\0' || outData.commandId[36] != '\0') return false;

  return true;
}

inline void clearAdaptiveFertJournal(Preferences &p) {
  if (p.isKey("rb_afert")) {
    p.remove("rb_afert");
  }
}
