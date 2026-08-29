import { z } from 'zod'

export const cropIds = [
  'sweet-potato',
  'pak-choi',
  'mustard-greens',
  'amaranth',
  'water-spinach',
  'tomato',
  'chili-pepper',
  'cucumber',
  'eggplant',
  'lettuce',
] as const

export const cropIdSchema = z.enum(cropIds)
export type CropId = z.infer<typeof cropIdSchema>
export const defaultCropId: CropId = 'sweet-potato'

const finiteNumber = z.number().finite()

export const cropProfileSchema = z.object({
  id: cropIdSchema,
  commonName: z.string().trim().min(1),
  scientificName: z.string().trim().min(1),
  temperature: z.object({
    optimalMinC: finiteNumber,
    optimalMaxC: finiteNumber,
  }),
  soil: z.object({
    optimalPhMin: finiteNumber,
    optimalPhMax: finiteNumber,
  }),
  growth: z
    .object({
      minDays: z.number().int().positive(),
      maxDays: z.number().int().positive(),
    })
    .optional(),
  source: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        reference: z.string().url(),
      }),
    )
    .min(1),
})

export type CropProfile = z.infer<typeof cropProfileSchema>

const ecocropSource = {
  name: 'FAO ECOCROP',
  reference: 'https://www.fao.org/geospatial/data-and-tools/data-portals/ecocrop/en',
} as const

export const cropProfiles = [
  { id: 'sweet-potato', commonName: 'Ubi Jalar', scientificName: 'Ipomoea batatas', temperature: { optimalMinC: 18, optimalMaxC: 28 }, soil: { optimalPhMin: 5, optimalPhMax: 7 }, growth: { minDays: 80, maxDays: 170 }, source: [ecocropSource] },
  { id: 'pak-choi', commonName: 'Pak Choi', scientificName: 'Brassica rapa subsp. chinensis', temperature: { optimalMinC: 20, optimalMaxC: 25 }, soil: { optimalPhMin: 5.5, optimalPhMax: 7 }, source: [ecocropSource] },
  { id: 'mustard-greens', commonName: 'Sawi', scientificName: 'Brassica juncea', temperature: { optimalMinC: 15, optimalMaxC: 28 }, soil: { optimalPhMin: 5.5, optimalPhMax: 6.5 }, source: [ecocropSource] },
  { id: 'amaranth', commonName: 'Bayam', scientificName: 'Amaranthus spp.', temperature: { optimalMinC: 22, optimalMaxC: 30 }, soil: { optimalPhMin: 5.5, optimalPhMax: 7.5 }, source: [ecocropSource] },
  { id: 'water-spinach', commonName: 'Kangkung', scientificName: 'Ipomoea aquatica', temperature: { optimalMinC: 15, optimalMaxC: 35 }, soil: { optimalPhMin: 5, optimalPhMax: 7 }, source: [ecocropSource] },
  { id: 'tomato', commonName: 'Tomat', scientificName: 'Solanum lycopersicum', temperature: { optimalMinC: 20, optimalMaxC: 27 }, soil: { optimalPhMin: 5.5, optimalPhMax: 6.8 }, source: [ecocropSource] },
  { id: 'chili-pepper', commonName: 'Cabai', scientificName: 'Capsicum annuum', temperature: { optimalMinC: 17, optimalMaxC: 30 }, soil: { optimalPhMin: 5.5, optimalPhMax: 6.8 }, source: [ecocropSource] },
  { id: 'cucumber', commonName: 'Timun', scientificName: 'Cucumis sativus', temperature: { optimalMinC: 18, optimalMaxC: 32 }, soil: { optimalPhMin: 6, optimalPhMax: 7.5 }, source: [ecocropSource] },
  { id: 'eggplant', commonName: 'Terong', scientificName: 'Solanum melongena', temperature: { optimalMinC: 20, optimalMaxC: 35 }, soil: { optimalPhMin: 5.5, optimalPhMax: 6.8 }, source: [ecocropSource] },
  { id: 'lettuce', commonName: 'Selada', scientificName: 'Lactuca sativa', temperature: { optimalMinC: 12, optimalMaxC: 21 }, soil: { optimalPhMin: 6, optimalPhMax: 7 }, source: [ecocropSource] },
] as const satisfies readonly CropProfile[]

export const selectedCropInputSchema = z.object({
  zoneId: z.string().trim().min(1),
  selectedCropId: cropIdSchema,
})
export type SelectedCropInput = z.infer<typeof selectedCropInputSchema>

export const cropRecommendationInputSchema = z.object({
  airTemperatureC: finiteNumber.nullable().optional(),
  soilTemperatureC: finiteNumber.nullable().optional(),
  soilPh: finiteNumber.nullable().optional(),
  airHumidityPercent: finiteNumber.min(0).max(100).nullable().optional(),
  humidityMinPercent: finiteNumber.min(0).max(100).nullable().optional(),
  humidityMaxPercent: finiteNumber.min(0).max(100).nullable().optional(),
})
export type CropRecommendationInput = z.infer<typeof cropRecommendationInputSchema>

export const cropRecommendationReasonSchema = z.object({
  parameter: z.enum(['temperature', 'ph', 'humidity']),
  status: z.enum(['optimal', 'acceptable', 'outside']),
  message: z.string().trim().min(1),
})

export const cropRecommendationSchema = z.object({
  cropId: cropIdSchema,
  score: z.number().finite().min(0).max(100),
  suitability: z.enum(['excellent', 'good', 'marginal', 'unsuitable']),
  reasons: z.array(cropRecommendationReasonSchema),
  evaluatedParameters: z.array(z.enum(['temperature', 'ph', 'humidity'])),
})
export type CropRecommendation = z.infer<typeof cropRecommendationSchema>

type ScoreStatus = 'optimal' | 'acceptable' | 'outside'
type ParameterScore = { value: number; status: ScoreStatus }

function rangeScore(current: number, min: number, max: number, tolerance: number): ParameterScore {
  if (current >= min && current <= max) return { value: 100, status: 'optimal' }
  const distance = current < min ? min - current : current - max
  if (distance <= tolerance) {
    return { value: Math.max(50, 100 - (distance / tolerance) * 50), status: 'acceptable' }
  }
  return { value: Math.max(0, 50 - ((distance - tolerance) / tolerance) * 50), status: 'outside' }
}

function suitabilityFromScore(score: number): CropRecommendation['suitability'] {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'marginal'
  return 'unsuitable'
}

export function recommendCrops(
  input: CropRecommendationInput,
  profiles: readonly CropProfile[] = cropProfiles,
): CropRecommendation[] {
  const parsed = cropRecommendationInputSchema.parse(input)
  const temperature = parsed.airTemperatureC ?? parsed.soilTemperatureC
  const humidityRangeValid =
    parsed.humidityMinPercent != null &&
    parsed.humidityMaxPercent != null &&
    parsed.humidityMinPercent <= parsed.humidityMaxPercent

  return profiles
    .map((profile, index) => {
      const weighted: Array<{ weight: number; score: ParameterScore }> = []
      const reasons: CropRecommendation['reasons'] = []
      const evaluatedParameters: CropRecommendation['evaluatedParameters'] = []

      if (temperature != null) {
        const score = rangeScore(temperature, profile.temperature.optimalMinC, profile.temperature.optimalMaxC, 8)
        weighted.push({ weight: 40, score })
        evaluatedParameters.push('temperature')
        reasons.push({
          parameter: 'temperature',
          status: score.status,
          message:
            score.status === 'optimal'
              ? ['Suhu ', temperature, ' °C berada pada baseline optimal tanaman.'].join('')
              : score.status === 'acceptable'
                ? ['Suhu ', temperature, ' °C dekat dengan baseline optimal tanaman.'].join('')
                : ['Suhu ', temperature, ' °C berada di luar baseline optimal tanaman.'].join(''),
        })
      }

      if (parsed.soilPh != null) {
        const score = rangeScore(parsed.soilPh, profile.soil.optimalPhMin, profile.soil.optimalPhMax, 1.5)
        weighted.push({ weight: 35, score })
        evaluatedParameters.push('ph')
        reasons.push({
          parameter: 'ph',
          status: score.status,
          message:
            score.status === 'optimal'
              ? ['pH tanah ', parsed.soilPh, ' berada pada baseline optimal tanaman.'].join('')
              : score.status === 'acceptable'
                ? ['pH tanah ', parsed.soilPh, ' dekat dengan baseline optimal tanaman.'].join('')
                : ['pH tanah ', parsed.soilPh, ' berada di luar baseline optimal tanaman.'].join(''),
        })
      }

      if (parsed.airHumidityPercent != null && humidityRangeValid) {
        const score = rangeScore(
          parsed.airHumidityPercent,
          parsed.humidityMinPercent as number,
          parsed.humidityMaxPercent as number,
          15,
        )
        weighted.push({ weight: 25, score })
        evaluatedParameters.push('humidity')
        reasons.push({
          parameter: 'humidity',
          status: score.status,
          message:
            score.status === 'optimal'
              ? ['Kelembapan udara ', parsed.airHumidityPercent, '% berada pada rentang operasional lokasi.'].join('')
              : score.status === 'acceptable'
                ? ['Kelembapan udara ', parsed.airHumidityPercent, '% dekat dengan rentang operasional lokasi.'].join('')
                : ['Kelembapan udara ', parsed.airHumidityPercent, '% berada di luar rentang operasional lokasi.'].join(''),
        })
      }

      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
      if (totalWeight === 0) return null
      const score = Math.round(
        weighted.reduce((sum, item) => sum + item.weight * item.score.value, 0) / totalWeight,
      )
      return {
        recommendation: {
          cropId: profile.id,
          score,
          suitability: suitabilityFromScore(score),
          reasons,
          evaluatedParameters,
        } satisfies CropRecommendation,
        index,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.recommendation.score - left.recommendation.score || left.index - right.index)
    .map((item) => item.recommendation)
}

export interface SmartSoilSensorCondition {
  id: string
  type: string
  name: string
  groupName: string
  value: number | null
  unit: string
  status: 'good' | 'warning' | 'critical' | 'offline'
  updatedAt: string | null
}

export interface SmartSoilSnapshot {
  siteId: string
  zoneId: string
  deviceId: string
  deviceStatus: 'online' | 'stale' | 'offline'
  conditions: {
    sensors: SmartSoilSensorCondition[]
    recordedAt: string | null
    sensorValid: boolean | null
  }
  humidityTarget: {
    minPercent: number | null
    maxPercent: number | null
  }
  profiles: CropProfile[]
  selectedCropId: CropId
  selectedCrop: CropProfile
  recommendations: CropRecommendation[]
}
