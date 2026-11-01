import type {UnifiedAiDashboard} from '@spff/contracts'

// Explain unavailable plan values, never invent them from an unrelated
// simulation configuration or a valid-but-unselected soil sensor.
export function aiCalculationReadiness(data: UnifiedAiDashboard): string[] {
  const reasons = data.decision.hold_reasons
  const messages: string[] = []
  const hasPlan = data.calculation.water_l !== null
    || data.calculation.stock_l !== null
    || data.calculation.fertilizer_mass_g !== null
    || data.calculation.duration_seconds !== null

  if (data.status === 'STALE') {
    messages.push('Keputusan kontrol AI sudah lama; kalkulasi kebutuhan hanya memakai sumber perencanaan terpisah yang memenuhi pemeriksaan kesegaran.')
  }
  if (data.status === 'NO_DECISION') {
    messages.push('Belum ada keputusan kontrol SHADOW tersimpan; simulasi kebutuhan tetap tidak mengendalikan pompa.')
    return messages
  }
  if (!hasPlan && reasons.includes('validated_planning_configuration_missing')) {
    messages.push('Profil debit, kurva tandon, dan batas volume operasional belum tervalidasi. Nilai perhitungan tidak boleh diambil dari profil simulasi.')
  } else if (!hasPlan && reasons.includes('planning_configuration_is_simulation_only')) {
    messages.push('Profil perhitungan masih untuk simulasi, belum untuk rencana operasional.')
  }
  if (data.calculation.stock_l === null && reasons.includes('verified_stock_concentration_missing')) {
    messages.push('Konsentrasi stok pupuk dan ikatan batch ke kegiatan belum diverifikasi; kilogram panduan tidak bisa langsung dikonversi menjadi liter injeksi.')
  }
  if (data.calculation.fuzzy_score === null && data.fuzzy_preview === null && data.decision.proposed_action === 'FERTIGATE') {
    messages.push('Engine sedang memprioritaskan kewajiban pemupukan; Fuzzy penyiraman berada di jalur IRRIGATE dan belum dihitung pada keputusan ini.')
  }
  if (data.calculation.fuzzy_score === null && data.fuzzy_preview === null && data.decision.proposed_action !== 'FERTIGATE'
      && !reasons.includes('validated_planning_configuration_missing')) {
    messages.push('Fuzzy belum tersedia untuk keputusan ini; periksa kualitas sensor kontrol, konfigurasi, dan data terbaru.')
  }
  if (data.sensors.control_moisture_source === 'soil_2_moisture'
      && data.sensors.soil_2_valid === true
      && data.calculation.fuzzy_score === null && data.fuzzy_preview === null) {
    messages.push('Sensor Tanah 2 sudah dipilih dan dilaporkan valid, tetapi itu saja belum menghasilkan rencana Fuzzy.')
  }
  if (reasons.includes('outstanding_obligation_requires_review')) {
    messages.push('Kegiatan pemupukan terdahulu perlu rekonsiliasi. Catatan selesai manual bukan bukti dosis fisik yang tersalurkan.')
  }
  if (messages.length === 0 && !hasPlan && data.calculation.fuzzy_score === null) {
    messages.push('Belum ada hasil perhitungan yang tersimpan pada keputusan ini.')
  }
  return messages
}
