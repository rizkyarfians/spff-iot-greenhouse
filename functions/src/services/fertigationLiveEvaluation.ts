import type { FertigationLiveDecision, FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';

import { applicationDue, calculateHst, jakartaDay } from './fertigationSchedule.js';

const fresh = (date: Date | null, now: Date, seconds: number): boolean =>
  date !== null && now.getTime() - date.getTime() >= 0 && now.getTime() - date.getTime() <= seconds * 1000;

/** Evaluasi hanya rekomendasi. ESP32 legacy tetap pemegang satu-satunya otoritas relay. */
export function evaluateSiteFertigation(
  recipe: FertigationRecipe,
  deviceId: string,
  snapshot: SiteEvaluationSnapshot,
  now = new Date(),
  demandThresholds = recipe.applicationMode === 'sensor' ? recipe : {
    moistureLowPercent: snapshot.moistureLowPercent,
    moistureTargetPercent: snapshot.moistureTargetPercent,
    ecLowUsCm: snapshot.ecLowUsCm,
    ecHighUsCm: snapshot.ecHighUsCm,
  },
): FertigationLiveDecision {
  const reasons: string[] = [];
  const hst = calculateHst(recipe.plantingDate, jakartaDay(now));
  const telemetryFresh = fresh(snapshot.telemetryRecordedAt, now, 120);
  const deviceFresh = fresh(snapshot.deviceRecordedAt, now, 90);
  const cropMatches = recipe.cropId !== null && recipe.zoneId === 'soil-1'
    && recipe.cropId === snapshot.activeCropId;
  if (recipe.approvalStatus !== 'approved' || !recipe.approvalReference) reasons.push('Program Fertigasi belum disetujui tim agronomi.');
  if (!cropMatches) reasons.push('Tanaman pada Program Fertigasi tidak cocok dengan tanaman aktif Smart Soil soil-1 atau belum dipilih.');
  if (hst === null || hst < recipe.hstFrom || hst > recipe.hstTo) reasons.push('Umur tanaman (HST) di luar rentang Program Fertigasi.');
  if (!applicationDue(recipe, jakartaDay(now))) reasons.push('Hari ini bukan jadwal aplikasi Program Fertigasi.');
  if (!telemetryFresh) reasons.push('Telemetry tidak tersedia atau stale.');
  if (!deviceFresh || snapshot.deviceOnline !== true) reasons.push('ESP32 offline atau status stale.');
  if (snapshot.deviceMode !== 'automatic' || snapshot.automaticMode !== 'automatic' ||
      snapshot.appliedMode !== 'automatic' || snapshot.configRevision === null ||
      snapshot.acknowledgedRevision !== snapshot.configRevision ||
      snapshot.acknowledgementStatus !== 'applied') {
    reasons.push('Mode otomatis terbaru belum dikonfirmasi melalui ACK ESP32.');
  }
  if (!snapshot.flowWaterValid || (recipe.targetStockL > 0 && !snapshot.flowStockValid))
    reasons.push('Status sensor debit tidak valid.');
  if (!snapshot.waterTankValid || snapshot.waterTankPercent === null ||
      snapshot.waterTankPercent < recipe.minWaterTankPercent)
    reasons.push('Level tandon air tidak valid atau di bawah batas.');
  if (recipe.targetStockL > 0 && (!snapshot.stockTankValid || snapshot.stockTankPercent === null ||
      snapshot.stockTankPercent < recipe.minStockTankPercent))
    reasons.push('Level tandon pupuk tidak valid atau di bawah batas.');

  if (!snapshot.moistureValid || snapshot.moisture === null || !Number.isFinite(snapshot.moisture) ||
      snapshot.moisture < 0 || snapshot.moisture > 100 ||
      demandThresholds.moistureLowPercent === null || demandThresholds.moistureTargetPercent === null ||
      demandThresholds.moistureLowPercent >= demandThresholds.moistureTargetPercent) {
    reasons.push('Kelembapan atau batas penyiraman tidak valid.');
  } else if (snapshot.moisture > demandThresholds.moistureLowPercent) {
    reasons.push('Moisture belum mencapai ambang penyiraman; tunda aplikasi.');
  }
  if (recipe.targetStockL > 0) {
    if (!snapshot.liquidEcValid || snapshot.liquidEcUsCm === null ||
        demandThresholds.ecLowUsCm === null || demandThresholds.ecHighUsCm === null ||
        demandThresholds.ecLowUsCm >= demandThresholds.ecHighUsCm) {
      reasons.push('EC aktual atau batas EC otomatis tidak valid.');
    } else if (snapshot.liquidEcUsCm >= demandThresholds.ecHighUsCm) {
      reasons.push('EC sudah mencapai batas tinggi; jangan injeksi pupuk.');
    } else if (snapshot.liquidEcUsCm > demandThresholds.ecLowUsCm) {
      reasons.push('EC belum berada di bawah ambang pemupukan.');
    }
  }

  if (recipe.applicationMode === 'sensor') {
    const count = recipe.triggerSampleCount;
    const samples = snapshot.recentSamples ?? [];
    const latest = samples.slice(0, count);
    const distinct = new Set(latest.map(sample => sample.recordedAt.getTime()));
    const confirmed = Number.isInteger(count) && count >= 1 && count <= 20 &&
      latest.length === count && distinct.size === count &&
      latest[0]?.recordedAt.getTime() === snapshot.telemetryRecordedAt?.getTime() &&
      latest.every(sample => {
        const age = now.getTime() - sample.recordedAt.getTime();
        return age >= 0 && age <= 120000 && sample.moistureValid &&
          sample.moisture !== null && Number.isFinite(sample.moisture) && sample.moisture >= 0 &&
          recipe.moistureLowPercent !== null && sample.moisture <= recipe.moistureLowPercent &&
          (recipe.targetStockL === 0 || (sample.ecValid && sample.ec !== null &&
            Number.isFinite(sample.ec) && sample.ec >= 0 && recipe.ecLowUsCm !== null &&
            sample.ec <= recipe.ecLowUsCm));
      });
    if (!confirmed) reasons.push(`Menunggu ${count} pembacaan sensor terbaru berturut-turut mencapai batas minimum.`);
  }

  const ready = reasons.length === 0;
  return {
    recipeId: recipe.recipeId, deviceId, source: 'site-postgresql',
    siteObservedAt: now.toISOString(), hst,
    telemetryRecordedAt: snapshot.telemetryRecordedAt?.toISOString() ?? null,
    deviceRecordedAt: snapshot.deviceRecordedAt?.toISOString() ?? null,
    activeCropId: snapshot.activeCropId === recipe.cropId ? recipe.cropId : null,
    observations: {
      moistureSensorKey: snapshot.moistureSensorKey,
      soilMoisturePercent: snapshot.moisture,
      liquidEcUsCm: snapshot.liquidEcUsCm,
    },
    controlStrategy: {
      active: 'legacy_sensor', deviceAuthority: 'esp32', recipeMode: 'advisory_only',
      canDispatch: false,
      reason: 'Firmware saat ini menggunakan kontrol sensor lama. Rekomendasi Program Fertigasi tidak mengirim perintah relay.',
    },
    decision: {
      modelId: 'rule-based-v1', simulationOnly: true,
      status: ready ? 'suggested' : 'hold',
      action: ready ? (recipe.targetStockL > 0 ? 'FERTIGATE' : 'IRRIGATE') : 'DELAY',
      targetWaterL: ready ? recipe.targetWaterL : null,
      targetStockL: ready ? recipe.targetStockL : null,
      reasons: ready ? ['Kondisi memenuhi syarat rekomendasi; bukan izin eksekusi pompa.'] : reasons,
      requiresApproval: true, publishable: false,
    },
  };
}
