# SPFF ESP32-S3 firmware 1.3.2 sensor health

Firmware ini meneruskan seluruh fitur versi 1.3.1: manual control, schedule
sync, automatic control, ACK aktual aktuator, dan kompatibilitas
`minTankLevelPercent`. Perubahan 1.3.2 memisahkan kesehatan setiap parameter
sensor agar satu sensor yang gagal tidak membuat semua data dianggap rusak.

## Perubahan 1.3.2

- Telemetry membawa `sensorHealth` per parameter.
- Nilai angka `0` tetap dianggap data valid; status fault tidak ditentukan dari
  besar atau kecil nilainya.
- Parameter yang belum pernah terbaca atau sudah stale ditandai
  `valid: false` dengan reason `stale_or_missing`.
- SHT20 yang gagal pada siklus terbaru ditandai `read_error`; nilai last-known
  masih boleh dikirim untuk diagnosis sampai masa cache habis.
- `systemState` bernilai `monitoring` bila seluruh 25 parameter sehat,
  `degraded` bila hanya sebagian sehat, dan `sensor_fault` bila tidak ada satu
  pun parameter sehat setelah perangkat sebelumnya pernah menerima data.
- `sensorValid` global dipertahankan untuk kompatibilitas dan hanya `true` bila
  semua parameter sehat. Backend baru memakai `sensorHealth` sebagai sumber
  status utama.
- Kontrol otomatis tetap memakai validitas parameter yang benar-benar menjadi
  input kontrol: kelembapan tanah untuk pompa air dan EC untuk pompa pupuk.

Contoh potongan telemetry:

```json
{
  "kind": "telemetry",
  "sensorValid": false,
  "sensorHealth": {
    "air_temp": { "valid": true },
    "soil_1_moisture": { "valid": true },
    "tank_water_distance_cm": {
      "valid": false,
      "reason": "stale_or_missing"
    }
  },
  "sensors": {
    "air_temp": 30.7,
    "soil_1_moisture": 0.0
  }
}
```

`soil_1_moisture: 0.0` di atas tetap valid. Hanya parameter dengan
`sensorHealth.valid: false` yang ditandai bermasalah di backend/dashboard.

## Fitur kontrol yang tetap tersedia

- Mode manual: command ON/OFF dan schedule berjalan seperti versi sebelumnya.
- Mode automatic: command ON manual ditolak; command OFF tetap diterima sebagai
  emergency stop.
- Pompa air memakai hysteresis moisture low/target, max runtime, cooldown,
  minimum flow, dan batas stale sensor.
- Pompa pupuk memakai EC low/target/high, dose pulse, mixing delay, batas volume,
  minimum flow, dan batas stale sensor.
- Konfigurasi dan schedule disimpan ke NVS serta dikonfirmasi dengan ACK.
- OTA, relay readback, dan protocol JSON Lines tetap dipertahankan.

## Target build

- Board: Waveshare ESP32-S3-ETH-8DI-8RO / ESP32-S3 yang sesuai.
- Arduino ESP32 Core: 2.0.17.
- USB CDC On Boot: enabled.
- Serial USB CDC: 115200 baud.
- External library: `LiquidCrystal_I2C`.

Folder sketch dan file `.ino` sudah memakai nama yang sama. Compile dengan
konfigurasi board yang sama seperti firmware aktif, lalu flash lewat USB atau
hasilkan application `.bin` untuk Web OTA.

## Setelah flash

Di Orange Pi:

```bash
cd /opt/spff
sudo systemctl restart spff-edge-gateway spff-mqtt-worker
sudo journalctl -f -u spff-edge-gateway -u spff-mqtt-worker -o cat
```

Pastikan versi baru diterima:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT site_id, device_id, firmware_version, mode, system_state,
       sensor_valid, recorded_at, received_at
FROM spff.latest_device_status
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01';
"
```

Output yang diharapkan memuat `firmware_version = 1.3.2`. Kondisi satu atau
beberapa sensor tidak tersedia boleh menghasilkan `system_state = degraded`
dan `sensor_valid = false`; itu bukan lagi alasan untuk menolak data sensor
lain yang sehat.

## Urutan deploy server

Firmware 1.3.2 boleh di-flash setelah backend berikut terpasang. Terapkan
migration 017 satu kali, kemudian build dan restart service:

```bash
cd /opt/spff
sudo -u postgres psql -d spff -v ON_ERROR_STOP=1 -f infrastructure/postgres/migrations/017_sensor_health_per_parameter.sql
npm run build
sudo systemctl restart spff-api spff-mqtt-worker spff-edge-gateway
```

Periksa data health terbaru:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT sequence, sensor_valid, sensor_health, received_at
FROM spff.telemetry_samples
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01'
ORDER BY received_at DESC
LIMIT 1;
"
```

## Uji cepat

1. Pastikan telemetry dan status perangkat tetap masuk.
2. Putuskan satu sensor uji atau gunakan kondisi sensor yang saat ini missing.
3. Pastikan telemetry lain tetap tersimpan dan dashboard tetap memperbaruinya.
4. Pastikan hanya parameter tersebut yang memiliki `valid: false`.
5. Uji nilai `0` yang memang dikirim firmware; nilainya harus tersimpan tanpa
   otomatis dianggap fault.
6. Uji tombol ON/OFF, ACK state aktual, schedule, dan switching Manual/Otomatis.
7. Saat automatic, pastikan pompa hanya memakai parameter inputnya yang sehat.
