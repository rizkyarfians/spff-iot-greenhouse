import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../src/SecondaryPages.tsx', import.meta.url), 'utf8')
const controls = source.slice(source.indexOf('function ControlsPage('), source.indexOf('function LogsPage('))

test('controls keeps pumps visible and opens automation inline below its buttons', () => {
  assert.ok(controls.indexOf('controls-actuators') < controls.indexOf('controls-automation'))
  assert.match(controls, /<section[^>]+id="controls-settings-panel"[^>]+hidden=\{!controlTab\}/)
  assert.ok(controls.indexOf('controls-automation') < controls.indexOf('<section className="controls-settings-panel'))
  assert.doesNotMatch(controls, /showModal|<dialog/)
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
