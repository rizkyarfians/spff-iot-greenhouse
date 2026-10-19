import type { FertigationLiveDecision, FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';

const fresh = (date: Date | null, now: Date, seconds: number): boolean =>
  date !== null && now.getTime() - date.getTime() >= 0 && now.getTime() - date.getTime() <= seconds * 1000;

function jakartaDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (key: string) => parts.find(value => value.type === key)?.value ?? '';
  return [part('year'), part('month'), part('day')].join('-');
}

function calculateHst(plantingDate: string | null, today: string): number | null {
  if (!plantingDate) return null;
  const value = (Date.parse(today + 'T00:00:00Z') - Date.parse(plantingDate + 'T00:00:00Z')) / 86400000;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Evaluasi hanya rekomendasi. ESP32 legacy tetap pemegang satu-satunya otoritas relay. */
export function evaluateSiteFertigation(
  recipe: FertigationRecipe,
  deviceId: string,
  snapshot: SiteEvaluationSnapshot,
  now = new Date(),
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
  if (recipe.applicationDate !== jakartaDay(now)) reasons.push('Hari ini bukan jadwal aplikasi Program Fertigasi.');
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
      snapshot.moistureLowPercent === null || snapshot.moistureTargetPercent === null) {
    reasons.push('Moisture atau batas hysteresis Automatic Control tidak valid.');
  } else if (snapshot.moisture >= snapshot.moistureLowPercent) {
    reasons.push('Moisture belum mencapai ambang penyiraman; tunda aplikasi.');
  }
  if (recipe.targetStockL > 0) {
    if (!snapshot.liquidEcValid || snapshot.liquidEcUsCm === null ||
        snapshot.ecLowUsCm === null || snapshot.ecHighUsCm === null ||
        snapshot.ecLowUsCm >= snapshot.ecHighUsCm) {
      reasons.push('EC aktual atau batas EC otomatis tidak valid.');
    } else if (snapshot.liquidEcUsCm >= snapshot.ecHighUsCm) {
      reasons.push('EC sudah mencapai batas tinggi; jangan injeksi pupuk.');
    } else if (snapshot.liquidEcUsCm > snapshot.ecLowUsCm) {
      reasons.push('EC belum berada di bawah ambang pemupukan.');
    }
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
