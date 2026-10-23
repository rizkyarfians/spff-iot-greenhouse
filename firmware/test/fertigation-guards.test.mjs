import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = resolve('firmware/SPFF_MASTER_1.4.10_SCHEDULE_SENSOR');
const firmware = readFileSync(join(directory, 'SPFF_MASTER_1.4.10_SCHEDULE_SENSOR.ino'), 'utf8');
function body(name) {
  const start = firmware.indexOf(`static void ${name}(`);
  assert.ok(start >= 0);
  const open = firmware.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth; end++) {
    if (firmware[end] === '{') depth++;
    if (firmware[end] === '}') depth--;
  }
  return firmware.slice(start, end);
}

test('actual water controller locks on runtime, sensor and flow fault; target and schedule stop normally', () => {
  const temp = mkdtempSync(join(tmpdir(), 'spff-guards-'));
  try {
    const cpp = `
#include <cassert>
#include <cmath>
#include <cstring>
#include "FertigationGuards.h"
using std::isfinite;
struct SpffWaterAutomaticConfig {
 bool enabled=true; float moistureLowPercent=30, moistureTargetPercent=50, minFlowLpm=1;
 uint32_t maxRuntimeSeconds=10, sensorStaleSeconds=30, triggerSampleCount=1, cooldownSeconds=0;
};
struct { SpffWaterAutomaticConfig water; } spffAutomaticControl;
struct { float waterFlowLpm=2; } slaveData;
bool spffWaterFaultLatched=false, spffWaterAutoActive=false, valid=true, windowOpen=true, fresh=true, maintenance=false;
uint32_t spffWaterStartedMs=1, spffWaterCooldownStartedMs=0, spffWaterLastSampleMs=0, sampleTime=100;
uint8_t spffWaterLowSampleCount=0;
float reading=20;
int starts=0, stops=0;
const char *lastReason="";
const int SPFF_SCHEDULE_TARGET_WATER=0, PUMP_WATER_RELAY=0;
const uint32_t SPFF_AUTO_FLOW_GRACE_MS=5000;
int spffWaterStateTracker=0;
bool spffScheduleWindowOpen(int) {return windowOpen;}
bool spffWaterAutomaticSample(float &v, uint32_t &t) {v=reading;t=sampleTime;return valid;}
bool spffAutomaticSlaveFresh(uint32_t) {return fresh;}
bool otaMaintenanceActive() {return maintenance;}
bool spffAutoElapsed(uint32_t, uint32_t) {return true;}
enum PreferenceType {PT_U8, PT_INVALID, PT_OTHER};
struct {
 bool exists=false, stored=false, writesSucceed=true; PreferenceType type=PT_INVALID;
 PreferenceType getType(const char*) {return type;}
 bool isKey(const char*) {return exists;}
 bool getBool(const char*, bool) {return stored;}
 unsigned putBool(const char*,bool value) {if(!writesSucceed)return 0;exists=true;type=PT_U8;stored=value;return 1;}
} prefs;
${body('spffLoadWaterFaultLatch')}
${body('spffLatchWaterFault')}
void spffStopAutomaticWater(uint32_t, const char *reason="automatic_water") {stops++;spffWaterAutoActive=false;lastReason=reason;}
bool spffAutomaticPumpOutput(const char*,int,bool,int&,const char*) {starts++;return true;}
${body('spffServiceAutomaticWater')}
void reset() {
 spffWaterFaultLatched=false;spffWaterAutoActive=true;valid=true;windowOpen=true;fresh=true;
 reading=20;slaveData.waterFlowLpm=2;spffWaterLowSampleCount=0;spffWaterLastSampleMs=0;starts=0;stops=0;
 spffAutomaticControl.water.minFlowLpm=1;
}
int main() {
 reset();spffServiceAutomaticWater(11001);assert(spffWaterFaultLatched);assert(!strcmp(lastReason,"water_runtime_limit"));
 sampleTime++;spffServiceAutomaticWater(12000);assert(starts==0);
 reset();valid=false;spffServiceAutomaticWater(6001);assert(spffWaterFaultLatched);assert(!strcmp(lastReason,"water_sensor_fault"));
 reset();slaveData.waterFlowLpm=0;spffServiceAutomaticWater(6001);assert(spffWaterFaultLatched);assert(!strcmp(lastReason,"water_flow_fault"));
 reset();reading=50;spffServiceAutomaticWater(1001);assert(!spffWaterFaultLatched && stops==1);
 reset();windowOpen=false;spffServiceAutomaticWater(1001);assert(!spffWaterFaultLatched && stops==1);
 reset();spffAutomaticControl.water.minFlowLpm=0;slaveData.waterFlowLpm=0;spffServiceAutomaticWater(6001);assert(!spffWaterFaultLatched && stops==0);
 prefs.exists=false;prefs.type=PT_INVALID;spffLoadWaterFaultLatch();assert(!spffWaterFaultLatched);
 spffLatchWaterFault();spffWaterFaultLatched=false;spffLoadWaterFaultLatch();assert(spffWaterFaultLatched);
 prefs.type=PT_OTHER;spffLoadWaterFaultLatch();assert(spffWaterFaultLatched);
 prefs.writesSucceed=false;spffWaterFaultLatched=false;spffLatchWaterFault();assert(spffWaterFaultLatched);
 assert(!spffSampleAfterMixing(1999,1000,1000));
 assert(!spffSampleAfterMixing(2000,1000,1000));
 assert(spffSampleAfterMixing(2001,1000,1000));
 assert(!spffSampleAfterMixing(0xfffffff0U,0xfffffff0U,32));
 assert(spffSampleAfterMixing(17,0xfffffff0U,32));
}
`;
    writeFileSync(join(temp, 'test.cpp'), cpp);
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', directory, join(temp, 'test.cpp'), '-o', join(temp, 'test')]);
    execFileSync(join(temp, 'test'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('guard wiring: both profiles reject unsupported tank protection and mixing uses post-deadline sample', () => {
  assert.equal((firmware.match(/reason = "tank_level_interlock_unsupported"/g) || []).length, 2);
  assert.match(firmware, /spffSampleAfterMixing\(sampleMs, spffFertStateStartedMs/);
  assert.match(firmware, /prefs\.getBool\("water_fault", true\)/);
  assert.match(firmware, /prefs\.putBool\("water_fault", true\)/);
  const duplicateRevision = firmware.indexOf('same ? "" : "revision_conflict"');
  assert.ok(duplicateRevision < firmware.indexOf('prefs.putBool("water_fault", false)'));
});
