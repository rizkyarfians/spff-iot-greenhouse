import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('../SPFF_MASTER_1_4_35_AUTO_DIAGNOSTICS/SPFF_MASTER_1_4_35_AUTO_DIAGNOSTICS.ino', import.meta.url), 'utf8');
const start = source.indexOf('String spffAutomaticWaterDiagnostics() {');
const end = source.indexOf('static void spffServiceAutomaticWater(', start);
const diagnostics = source.slice(start, end);

test('water diagnostics are attached to device status and bounded by existing frame check', () => {
  assert.match(source, /json \+= ",\\"automaticWaterDiagnostics\\":";/);
  assert.match(source, /json \+= spffAutomaticWaterDiagnostics\(\);/);
  assert.match(source, /json\.length\(\) \+ 1U >\s+SPFF_SERIAL_FRAME_MAX/);
  assert.match(source, /1\.4\.35-AUTO-DIAGNOSTICS-CANDIDATE/);
  assert.match(source, /SOIL_DIAG_SINGLE_REGISTER_ONLY = true/);
});

test('diagnostics observe state without servicing relays, clocks, interlocks or persistence', () => {
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(diagnostics, /(?:setPumpOutput|relayOutputReadback|spffCh3OnBlocked|spffCh3WaterInterlockActive|updateRTC|rtcWrite|putBytes|sendSpff|spffStop|spffService)\s*\(/);
  assert.doesNotMatch(diagnostics, /(?:spff\w+|relayReady|rtcNow\.\w+)\s*(?:=(?!=)|\+\+|--|\+=)/);
  for (const field of ['sampleAgeMs', 'lowSampleCount', 'requiredSampleCount', 'scheduleWindowOpen', 'paused', 'relayReady', 'offVerificationPending', 'autoActive']) {
    assert.ok(diagnostics.includes(field), field);
  }
  assert.match(diagnostics, /sampleMs == 0UL \? String\("null"\)/);
  assert.match(diagnostics, /isfinite\(moisture\) \? String\(moisture, 1\) : String\("null"\)/);
});

test('candidate preserves the archive control code exactly outside diagnostic additions and version/single-only patch', {
  skip: !process.env.SPFF_FW_BASELINE_RAR,
}, () => {
  const original = execFileSync('tar', ['-xOf', process.env.SPFF_FW_BASELINE_RAR,
    'SPFF_MASTER_1_4_34_OPI_CHRONY_SOIL_SINGLE_ONLY/SPFF_MASTER_1_4_33_OPI_CHRONY_TIME_SYNC/SPFF_MASTER_1_4_33_OPI_CHRONY_TIME_SYNC.ino'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).replaceAll('\r\n', '\n');
  const reverted = source.replaceAll('\r\n', '\n')
    .replace(diagnostics.replaceAll('\r\n', '\n'), '')
    .replace('  json += ",\\"automaticWaterDiagnostics\\":";\n  json += spffAutomaticWaterDiagnostics();\n', '')
    .replace('// Observational only: never service outputs, refresh RTC, or update interlock here.\nString spffAutomaticWaterDiagnostics();\n', '')
    .replace('S2PFS MASTER SPFF FIRMWARE 1.4.35 AUTO DIAGNOSTICS CANDIDATE', 'S2PFS MASTER SPFF FIRMWARE 1.4.33 ORANGE PI CHRONY TIME SYNC')
    .replace('1.4.35-AUTO-DIAGNOSTICS-CANDIDATE', '1.4.33-OPI-CHRONY-TIME-SYNC')
    .replace('SOIL_DIAG_SINGLE_REGISTER_ONLY = true;', 'SOIL_DIAG_SINGLE_REGISTER_ONLY = false;');
  assert.equal(reverted, original);
});
