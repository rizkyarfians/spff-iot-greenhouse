import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropProfiles, fertigationRecipeMutationSchema } from '@spff/contracts'

const page = readFileSync(new URL('../src/FertigationPage.tsx', import.meta.url), 'utf8')

test('program form explicitly selects a catalog crop without guessing historical names', () => {
  assert.match(page, /cropId: ''/)
  assert.match(page, /select required value=\{form.cropId\}/)
  assert.match(page, /input.cropId = form.cropId/)
  assert.match(page, /input.cropName = cropProfiles.find/)
  assert.match(page, /!selected.cropId/)
  assert.match(page, /cropProfiles.map/)
})

test('catalog-backed program payload meets the new contract; unbound crops fail', () => {
  // Synthetic validation fixture only; never persisted or approved.
  const crop = cropProfiles.find(item => item.id === 'eggplant')
  const input = {
    cropId: crop.id, cropName: crop.commonName, hstFrom: 1, hstTo: 2,
    targetWaterL: 1, targetStockL: 0, fertilizerName: null,
    stockConcentrationGPerL: null, minWaterTankPercent: 10, minStockTankPercent: 10,
    sourceReference: 'Synthetic contract test only', plantingDate: null, applicationDate: null,
  }
  assert.equal(fertigationRecipeMutationSchema.safeParse(input).success, true)
  assert.equal(fertigationRecipeMutationSchema.safeParse({...input, cropId: ''}).success, false)
  assert.equal(fertigationRecipeMutationSchema.safeParse({...input, cropId: null}).success, false)
})

test('program UI exposes observed sensor values and stays advisory only', () => {
  assert.match(page, /result.observations.soilMoisturePercent/)
  assert.match(page, /result.observations.liquidEcUsCm/)
  assert.match(page, /tidak mengirim perintah pompa/)
  assert.match(page, /fertigationLiveDecisionSchema.parse/)
  assert.doesNotMatch(page, /updateActuator|saveAutomaticControl|Resep|resep/)
})

test('internal form preserves all agronomic thresholds when editing a program', () => {
  for (const key of ['moistureLowPercent', 'moistureTargetPercent', 'ecLowUsCm', 'ecTargetUsCm', 'ecHighUsCm']) {
    assert.ok(page.includes(`${key}: ''`))
    assert.ok(page.includes(`key: '${key}'`))
  }
})
