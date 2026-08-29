import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cropProfiles,
  defaultCropId,
  recommendCrops,
  selectedCropInputSchema,
} from '../dist/index.js'

test('crop dataset contains ten profiles with sweet potato as default', () => {
  assert.equal(cropProfiles.length, 10)
  assert.equal(defaultCropId, 'sweet-potato')
  assert.equal(cropProfiles[0].scientificName, 'Ipomoea batatas')
  assert.ok(cropProfiles.every((profile) => profile.source.length > 0))
})

test('recommendation uses available temperature and soil pH deterministically', () => {
  const result = recommendCrops({
    soilTemperatureC: 24,
    soilPh: 6.2,
  })
  assert.equal(result.length, 10)
  assert.ok(result[0].score >= result[1].score)
  assert.deepEqual(result[0].evaluatedParameters, ['temperature', 'ph'])
  assert.ok(result.every((recommendation) => recommendation.reasons.length === 2))
  assert.deepEqual(recommendCrops({}), [])
})

test('air temperature is preferred while soil temperature remains a fallback', () => {
  const airOnly = recommendCrops({ airTemperatureC: 14 })
  const both = recommendCrops({ airTemperatureC: 14, soilTemperatureC: 24 })
  assert.deepEqual(both, airOnly)
})

test('air humidity is evaluated only against configured site range', () => {
  const withoutSiteRange = recommendCrops({ airHumidityPercent: 70, airTemperatureC: 24 })
  assert.deepEqual(withoutSiteRange[0].evaluatedParameters, ['temperature'])

  const withSiteRange = recommendCrops({
    airHumidityPercent: 70,
    humidityMinPercent: 60,
    humidityMaxPercent: 80,
    airTemperatureC: 24,
  })
  assert.deepEqual(withSiteRange[0].evaluatedParameters, ['temperature', 'humidity'])
  assert.ok(
    withSiteRange[0].reasons.some((reason) =>
      reason.message.includes('rentang operasional lokasi'),
    ),
  )
})

test('crop selection accepts known profile and rejects unknown crop', () => {
  assert.equal(
    selectedCropInputSchema.safeParse({
      zoneId: 'soil-1',
      selectedCropId: 'tomato',
    }).success,
    true,
  )
  assert.equal(
    selectedCropInputSchema.safeParse({
      zoneId: 'soil-1',
      selectedCropId: 'invented-crop',
    }).success,
    false,
  )
})
