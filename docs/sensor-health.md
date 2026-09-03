# Sensor Health per Parameter

Telemetry tetap disimpan ketika sebagian sensor bermasalah. Nilai `0` adalah nilai
valid selama pembacaan sensor berhasil; firmware tidak boleh memakai angka nol saja
sebagai indikator fault.

Payload firmware yang direkomendasikan:

```json
{
  "kind": "telemetry",
  "schemaVersion": 1,
  "siteId": "greenhouse-01",
  "deviceId": "esp32-s3-01",
  "messageId": "msg-esp32-s3-01-1",
  "sequence": 1,
  "recordedAt": "2026-09-03T11:27:16.000Z",
  "sensorValid": false,
  "sensorHealth": {
    "soil_1_moisture": { "valid": true },
    "tank_water_distance_cm": {
      "valid": false,
      "reason": "timeout"
    }
  },
  "sensors": {
    "soil_1_moisture": 0
  }
}
```

`reason` adalah kode singkat maksimal 100 karakter, misalnya `timeout`,
`crc_error`, `out_of_range`, `stale`, atau `not_reported`.

Untuk kompatibilitas firmware lama, server membentuk health otomatis:

- parameter yang hadir dan finite dianggap valid, termasuk nilai nol;
- parameter wajib firmware lama yang tidak hadir dianggap `not_reported` hanya
  ketika `sensorValid=false`; level persen tandon dan baterai tetap opsional;
- `sensorHealth` eksplisit selalu memiliki prioritas.

Kontrol otomatis pada firmware harus mengecek health sensor yang dipakai oleh loop
tersebut. Pompa air tidak boleh diblokir oleh fault NPK atau sensor tandon yang tidak
menjadi interlock konfigurasi.
