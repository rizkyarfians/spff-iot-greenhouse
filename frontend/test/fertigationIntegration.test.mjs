import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropProfiles, fertigationRecipeMutationSchema } from '@spff/contracts'

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
