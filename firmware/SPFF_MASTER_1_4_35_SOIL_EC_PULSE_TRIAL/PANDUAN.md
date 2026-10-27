# Trial pulse fertigasi EC tanah — 1.4.35

Varian khusus trial dari `SPFF_MASTER_1_4_35_AUTO_DIAGNOSTICS`.
Versi status: `1.4.35-SOIL-EC-PULSE-TRIAL`.
Paket berisi SOURCE; belum dikompilasi untuk ESP32-S3 atau diuji di hardware.

## Perubahan

Hanya judul, string versi, dan default `SPFF_ENABLE_SERVER_SOIL_EC_PULSES`
menjadi `1`. Handler pulse yang sudah ada kini diaktifkan; seluruh pengaman
tetap berlaku. Macro dari build flags dapat menimpa default ini.
`serverPulseCapable` baru true jika pulse aktif dan storage NVS sehat.
Mengaktifkan capability tidak memulai sesi atau menyalakan pompa dengan sendirinya.

Diagnosis Auto tetap ada. Polling RS485 mengikuti source diagnostik 1.4.35
(block read dengan fallback per register), bukan konfigurasi single-only 1.4.34.
Mapping relay, waktu/RTC, interlock, dan logika kontrol tidak diubah.
Perhitungan target dan durasi pulse tetap di server; firmware menjalankan pulse
berbatas waktu. Ini bukan executor adaptive planner EC larutan.

## Compile dan upload

1. Simpan source dan binary firmware yang sedang berjalan untuk rollback.
2. Buka `SPFF_MASTER_1_4_35_SOIL_EC_PULSE_TRIAL.ino` di folder bernama sama.
   Seluruh handler berada di sketch; tidak perlu menyalin header dari versi lain.
3. Gunakan board ESP32-S3, library, board package, partisi, flash size,
   PSRAM dan USB CDC yang sama dengan build instalasi yang sudah berhasil.
   Verify dahulu; jika gagal jangan flash dan simpan error lengkap.
4. Pastikan pompa berhenti dan terisolasi secara fisik untuk trial pertama.
   Restart atau koneksi terputus bukan bukti relay OFF. Hentikan gateway
   sebelum uploader mengambil port serial:

```bash
sudo systemctl stop spff-edge-gateway
```

5. Upload memakai prosedur yang sudah terbukti di instalasi. Jangan erase NVS
   atau mengubah partisi. Sesudah upload berhasil:

```bash
sudo systemctl start spff-edge-gateway
sudo journalctl -u spff-edge-gateway -n 50 --no-pager -o cat
```

Biarkan `SPFF_SOIL_EC_PULSES_ENABLED=false` pada API dan worker selama verifikasi
awal. Tunggu status periodik, lalu lihat seluruh status terbaru agar filter
capability tidak menyembunyikan status baru:

```bash
sudo -u postgres psql -X -d spff -P pager=off -c "
SELECT received_at,
       raw_payload->>'firmwareVersion' AS firmware,
       raw_payload->>'serverPulseCapable' AS pulse_capable,
       raw_payload->>'pulseBootId' AS boot_id
FROM spff.device_status_events
WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
ORDER BY received_at DESC, device_status_id DESC
LIMIT 10;"
```

Harus ada status MCU yang baru diterima, versi `1.4.35-SOIL-EC-PULSE-TRIAL`,
`pulse_capable=true`, dan boot ID 16 digit hex. Baris status gateway dapat tidak
memuat ketiganya. Record lama tidak membuktikan hasil upload baru.
Jika capability false, periksa build flags dan storage; jangan melewati pemeriksaan.

## Sebelum sesi pertama

Tidak perlu migration baru hanya untuk firmware ini. Backend pulse memerlukan
migration 026 yang sebelumnya sudah diterapkan, serta build API/worker/edge/web
yang mendukung pulse. Jangan menjalankan ulang seluruh migration produksi.

Setelah capability terbukti dan commissioning siap:

- Aktifkan `SPFF_SOIL_EC_PULSES_ENABLED=true` pada `/etc/spff/api.env` dan
  `/etc/spff/mqtt-worker.env`. Pastikan `AI_EVALUATION_ENABLED` API tidak false.
  Restart API dan worker; tunggu health `http://127.0.0.1:3001/api/health`.
- Pilih Automatic, nonaktifkan fertilizer legacy dan tunggu ACK applied.
  Pastikan jadwal fertilizer terbuka serta ACK applied; bila CH3 ikut dipakai,
  jadwal air juga harus terbuka. Mode Automatic sendiri tidak memulai sesi pulse.
- Pastikan tanaman/HST zona soil-1, rule disetujui dan target EC tanah cocok
  dengan sensor/metode terpasang. Target EC larutan tidak boleh langsung dipakai.
- Di Program Fertigasi, isi kalibrasi serta batas sesi berdasarkan pengukuran:
  Kp, durasi ON minimum/maksimum, waktu resap, toleransi, sampel stabil,
  batas cycle/runtime dan rentang moisture. Verifikasi flow meter, tank,
  jalur Venturi dan kebutuhan CH3. Jangan memakai angka contoh sebagai dosis.
- Mulai satu sesi lewat **Mulai sesi pulse**. Trial komunikasi/relay terisolasi
  tidak membuktikan respons EC: tanpa respons EC sesi dapat fault dan tidak
  otomatis diulang pada program/perangkat/hari WIB yang sama. Jangan menghapus
  guard database untuk mengulang. Trial basah membutuhkan kalibrasi instalasi.
- Pantau ACK accepted/completed, output OFF dan sampel EC baru setelah waktu
  resap. Uji stop/OFF, koneksi putus, flow hilang dan restart sebelum trial basah.
  Status cancelled hanya permintaan stop; verifikasi ACK stop dan kondisi fisik.

## Berhenti dan rollback

Stop sesi di web dan buktikan pompa OFF. Untuk melepas strategi pulse, terapkan
Manual sampai ACK applied, lalu **Lepas strategi pulse** dan periksa ACK release.
Menonaktifkan flag atau me-restart service bukan pengganti bukti OFF.
Setelah aman, flag API/worker dapat dikembalikan false dan firmware sebelumnya
di-upload memakai konfigurasi instalasi yang sama, tanpa erase NVS.

Detail kontrak dan commissioning: `docs/server-soil-ec-pulses.md` di root repo.
