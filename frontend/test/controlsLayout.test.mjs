import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../src/SecondaryPages.tsx', import.meta.url), 'utf8')
const controls = source.slice(source.indexOf('function ControlsPage('), source.indexOf('function LogsPage('))

test('controls keeps pump actions outside the shared automation dialog', () => {
  assert.ok(controls.indexOf('controls-actuators') < controls.indexOf('controls-automation'))
  const dialog = controls.slice(controls.indexOf('<dialog ref={settingsDialog}'), controls.indexOf('</dialog>'))
  assert.match(dialog, /id="automatic-settings-dialog"/)
  assert.match(dialog, /id="sensor-settings-button"[^>]+aria-controls="sensor-settings-panel"/)
  assert.match(dialog, /id="schedule-settings-button"[^>]+aria-controls="schedule-settings-panel"/)
  assert.doesNotMatch(dialog, /Emergency Stop|<ToggleButtons\s+aria-label=\{\x60Kontrol/)
  assert.match(controls, /<section[^>]+id="schedule-settings-panel"[^>]+hidden=\{controlTab !== 'schedule'\}/)
  assert.match(controls, /<section[^>]+id="sensor-settings-panel"[^>]+hidden=\{controlTab !== 'sensor'\}/)
  assert.doesNotMatch(controls, /Mode alat:|Pengaturan mode sudah diterapkan|operation-note/)
  assert.match(controls, /controlTab === 'schedule' &&/)
  assert.match(controls, /controlTab === 'sensor' &&/)
  assert.doesNotMatch(controls, /selectedMode === '(manual|automatic)' &&/)
  assert.doesNotMatch(controls, /Aktifkan Semua/)
})

test('schedule creation expands inline and closes after success', () => {
  assert.match(controls, /<section[^>]+id="schedule-form-panel"[^>]+hidden=\{!showScheduleForm\}/)
  assert.match(controls, /setShowScheduleForm\(!showScheduleForm\)/)
  assert.match(controls, /Jadwal berhasil disimpan\.[\s\S]*?setShowScheduleForm\(false\)/)
  assert.match(controls, /onSubmit=\{addSchedule\}/)
})

test('sensor forms retain both profiles and collapsible advanced inputs', () => {
  assert.match(controls, /hidden=\{sensorPump !== 'water'\}/)
  assert.match(controls, /hidden=\{sensorPump !== 'fertilizer'\}/)
  assert.equal((controls.match(/<details className="controls-advanced">/g) ?? []).length, 2)
  assert.match(controls, /automaticDraft.water.minFlowLpm/)
  assert.match(controls, /automaticDraft.fertilizer.maxDailyVolumeL/)
})
