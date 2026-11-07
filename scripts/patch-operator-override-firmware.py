#!/usr/bin/env python3
"""Add the operator override contract to the supplied TIMED-FERT-EC 1.5.12 archive.
Creates a new archive; never changes the operator's source ZIP or flashes a device.
"""
import argparse
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZIP_DEFLATED


def patch(source: str) -> str:
    def change(old, new):
        nonlocal source
        if source.count(old) != 1:
            raise ValueError('Firmware differs from the reviewed 1.5.12 source: ' + old[:65])
        source = source.replace(old, new, 1)

    change('"1.5.12-TIMED-FERT-EC"', '"1.5.12-OPERATOR-OVERRIDE"')
    change('bool spffAutomaticPaused = false; // Dashboard OFF pauses auto until settings are explicitly saved again.', '''bool spffAutomaticPaused = false; // Dashboard OFF pauses auto until settings are explicitly saved again.
bool spffOperatorOverrideHold = false;
bool spffOperatorOverrideStorageFault = false;
bool spffOperatorOverrideTimed = false;
bool spffOperatorOverrideWrite = false;
uint32_t spffOperatorOverrideStartedMs = 0U;
uint32_t spffOperatorOverrideLimitMs = 900000UL;
static bool spffSaveOperatorOverrideHold(bool enabled) {
  Preferences storage;
  if (!storage.begin("spff-override", false)) { spffOperatorOverrideStorageFault=true; return false; }
  const bool ok=storage.putBool("hold",enabled)==1U;
  storage.end();
  if (!ok) { spffOperatorOverrideStorageFault=true; return false; }
  spffOperatorOverrideHold=enabled;
  return true;
}''')
    change('void serviceIrrigationTimerOutput() {', 'void serviceIrrigationTimerOutput() {\n  if (spffOperatorOverrideHold) return;')
    change('  // CH3 water-level guard is independent of automatic-control config.', '''  if (requestedActive && spffOperatorOverrideHold && !spffOperatorOverrideWrite) return false;
  // CH3 water-level guard is independent of automatic-control config.''')
    change('void serviceSpffAutomaticControl() {', '''static void serviceSpffOperatorOverride() {
  if (!spffOperatorOverrideHold) return;
  if (spffShutdownPending || (spffOperatorOverrideTimed &&
      (uint32_t)(millis()-spffOperatorOverrideStartedMs)>=spffOperatorOverrideLimitMs)) {
    static uint32_t lastStopMs=0U;
    if ((uint32_t)(millis()-lastStopMs)<1000UL) return;
    lastStopMs=millis();
    spffStopAutomaticOutputs("operator_override_limit");
    bool water=true,fert=true;
    if (relayOutputReadback(PUMP_WATER_RELAY,water) && relayOutputReadback(PUMP_FERTILIZER_RELAY,fert) && !water && !fert)
      spffOperatorOverrideTimed=false;
    spffStatusDirty=true;
  }
}
void serviceSpffAutomaticControl() {
  if (spffOperatorOverrideHold) return;''')
    change('void appLoop() {', 'void appLoop() {\n  serviceSpffOperatorOverride();')
    change('  loadSpffSyncedSchedules();', '''  loadSpffSyncedSchedules();
  { Preferences storage;
    if (storage.begin("spff-override",false)) { spffOperatorOverrideHold=storage.getBool("hold",false); storage.end(); }
    else { spffOperatorOverrideStorageFault=true; spffOperatorOverrideHold=true; }
    if (spffOperatorOverrideHold) spffAutomaticPaused=true;
  }''')
    change('  spffAutomaticPaused = false;\n  spffAutomaticControl = candidate;', '''  bool releaseOperatorOverride=false;
  spffJsonGetBoolMember(line,rootStart,rootEnd,"releaseOperatorOverride",releaseOperatorOverride);
  if (releaseOperatorOverride && !spffSaveOperatorOverrideHold(false)) { spffStatusDirty=true; return; }
  if (releaseOperatorOverride) spffOperatorOverrideTimed=false;
  spffAutomaticPaused = spffOperatorOverrideHold;
  spffAutomaticControl = candidate;''')
    change('  const bool scheduleCommand = requestedBy.startsWith("schedule:");', '''  bool operatorOverride=false;
  bool overridePresent=false; size_t overrideStart=0U,overrideEnd=0U;
  if (!spffJsonFindUniqueMember(line,paramsStart,paramsEnd,"operatorOverride",overridePresent,overrideStart,overrideEnd) ||
      (overridePresent && !spffJsonGetBoolMember(line,paramsStart,paramsEnd,"operatorOverride",operatorOverride))) {
    spffSendFinalAckAndRemember(commandId,targetId,"rejected",false,false,"invalid_operator_override"); return;
  }
  const bool scheduleCommand = requestedBy.startsWith("schedule:");
  if (operatorOverride && (scheduleCommand || isAiTrial || durationPresent || (requestedActive && spffOperatorOverrideStorageFault))) {
    spffSendFinalAckAndRemember(commandId,targetId,"rejected",false,false,"invalid_operator_override"); return;
  }''')
    change('    } else if (scheduleCommand) {', '''    } else if (spffOperatorOverrideHold && !operatorOverride) {
      sourceDenial="operator_override_active";
    } else if (scheduleCommand) {''')
    change('    } else if (automaticMode && !isAiTrial) {', '    } else if (automaticMode && !isAiTrial && !operatorOverride) {')
    change('  const char *sourceDenial = nullptr;', '''  if (operatorOverride && requestedActive && !automaticMode) {
    spffSendFinalAckAndRemember(commandId,targetId,"rejected",false,false,"operator_override_requires_automatic"); return;
  }
  if (!automaticMode && !requestedActive) operatorOverride=false;
  const char *sourceDenial = nullptr;''')
    change('  if (!requestedActive && !scheduleCommand && automaticMode) {', '  if (!requestedActive && !scheduleCommand && automaticMode && !operatorOverride) {')
    change('  bool previousStateKnown = relayOutputReadback(relayChannel, previousActive);', '''  bool previousStateKnown = relayOutputReadback(relayChannel, previousActive);
  if (operatorOverride) {
    if (!spffSaveOperatorOverrideHold(true) && requestedActive) {
      spffSendFinalAckAndRemember(commandId,targetId,"rejected",previousStateKnown,previousActive,"operator_override_storage_fault"); return;
    }
    spffOperatorOverrideHold=true;
    spffAutomaticPaused=true;
    spffStatusDirty=true;
    if (requestedActive && !spffOperatorOverrideTimed) {
      uint32_t limit=spffAutomaticControlLoaded?spffAutomaticControl.water.maxRuntimeSeconds:900U;
      if (limit==0U || limit>900U) limit=900U;
      spffOperatorOverrideLimitMs=limit*1000UL;
      spffOperatorOverrideStartedMs=millis();spffOperatorOverrideTimed=true;
    }
  }''')
    change('  bool actualActive = previousActive;\n  bool outputOk = false;', '  spffOperatorOverrideWrite=operatorOverride;\n  bool actualActive = previousActive;\n  bool outputOk = false;')
    change('  timedWaterStartWrite = false;\n  if (durationPresent)', '  timedWaterStartWrite = false;\n  spffOperatorOverrideWrite=false;\n  if (durationPresent)')
    change('  // Final ACK hanya sesudah output register dibaca kembali sesuai desired state.', '''  if (operatorOverride && !requestedActive) {
    bool water=true,fert=true;
    if (relayOutputReadback(PUMP_WATER_RELAY,water) && relayOutputReadback(PUMP_FERTILIZER_RELAY,fert) && !water && !fert)
      spffOperatorOverrideTimed=false;
  }
  // Final ACK hanya sesudah output register dibaca kembali sesuai desired state.''')
    change('  json += ",\\\"waterInterlockConfigCapable\\\":";', '''  json += ",\\\"operatorOverrideCapable\\\":";
  json += spffOperatorOverrideStorageFault ? "false" : "true";
  json += ",\\\"operatorOverrideActive\\\":";
  json += spffOperatorOverrideHold ? "true" : "false";
  json += ",\\\"waterInterlockConfigCapable\\\":";''')
    return source


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    if args.output.exists():parser.error('Output already exists; choose a new filename.')
    with ZipFile(args.input) as original:
        names=[name for name in original.namelist() if name.endswith('.ino')]
        if len(names)!=1:parser.error('Expected exactly one sketch in the reviewed archive.')
        updated=patch(original.read(names[0]).decode('utf-8-sig').replace('\r\n','\n'))
        # Validate before creating output; every other member is copied byte for byte.
        for name in original.namelist():
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                parser.error('Unexpected archive member path.')
        with ZipFile(args.output,'x',ZIP_DEFLATED) as output:
            for info in original.infolist():
                output.writestr(info,updated.encode('utf-8') if info.filename==names[0] else original.read(info.filename))
    print('OPERATOR_OVERRIDE_PATCH=APPLIED; original archive unchanged; compile and flash required')


if __name__=='__main__':main()
