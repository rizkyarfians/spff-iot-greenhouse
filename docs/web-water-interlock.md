# Switch interlock tandon air CH3 dari Settings

Settings → Interlock tandon air → pilih perangkat → switch → Simpan interlock. Khusus admin, login + CSRF mengikuti API lama. Operator hanya membaca. Pengaturan terpisah per perangkat, bukan seluruh greenhouse sekaligus.

Default **enabled**. Enabled mempertahankan perilaku firmware 1.4.28/29: tinggi air ≤20 cm atau JSN invalid/stale memblokir CH3; level ≥25 cm melepas latch setelah OFF terverifikasi. Disabled hanya melewati pemeriksaan level tandon/validitas JSN tersebut. Proteksi flow, runtime, OTA/shutdown, kepemilikan relay dan kegagalan output tetap berjalan. Gate tandon minimum dalam evaluasi server/recipe juga tidak dinonaktifkan oleh switch CH3 ini.

Saat setting berubah, firmware menghentikan output dan memverifikasi relay OFF sebelum menyimpan perubahan. Tidak ada perintah ON dari perubahan setting. Trigger moisture lama dibuang; pompa memerlukan keputusan kontrol/command berikutnya. Selama OFF belum terverifikasi, flag pending tetap memblokir CH3 meskipun switch disabled.

## Status yang terlihat

- Permintaan server: enabled/disabled, revisi.
- Menunggu diterapkan: tersimpan di database, belum mendapat ACK yang cocok.
- Ditolak perangkat: ACK rejected beserta alasan.
- Pernah dikonfirmasi; menunggu status terbaru: ACK applied ada, tetapi belum ada laporan fresh yang cocok.
- Sudah diterapkan dan dilaporkan perangkat: ACK applied dan status perangkat fresh mengonfirmasi nilai + revisi yang sama.

Status perangkat dianggap fresh selama 90 detik. Menyimpan saat perangkat offline/firmware lama hanya mengantrekan permintaan; tidak dianggap sudah mengubah pompa. UI mempertahankan nilai edit selama polling dan memakai expectedRevision agar edit dari dua admin tidak saling menimpa. Batalkan perubahan/muat ulang untuk menyelesaikan konflik.

## Kontrak dan ketahanan

GET `/api/settings/water-interlock?deviceId=...`; PUT body `{deviceId, expectedRevision, enabled}`. Admin+CSRF untuk PUT. Migration 027 menyimpan konfigurasi default enabled per device yang sudah ada, identitas admin, revisi, hasil ACK dan histori ACK. Device baru tanpa row terbaca enabled dengan revisi virtual 0; PUT pertamanya menciptakan revisi 1. Histori mutation memakai audit middleware yang sudah ada.

Worker mengirim konfigurasi dengan QoS 1 **non-retained pada topic commands yang sudah ada**. Tidak membutuhkan topic/ACL MQTT baru, tidak menimpa retained automatic-control/schedule. Retry pending setiap 5 detik, refresh paling lambat 30 detik, dan publish ulang saat worker reconnect. Jika migration 027 belum ada, service sinkronisasi ini tidak dimulai.

```json
{"kind":"water_interlock_sync","schemaVersion":1,"siteId":"greenhouse-01","deviceId":"esp32-s3-01","revision":2,"enabled":false}
```

MCU menolak revisi lebih lama atau revisi sama dengan nilai berbeda. Duplikat sama mengulang ACK tanpa menulis NVS atau menghentikan output lagi. ACK hanya berasal dari MCU; gateway tidak membuat ACK applied. ACK melewati outbox edge; bila ACK hilang sebelum tersimpan, refresh konfigurasi menghasilkan ACK ulang. Database memvalidasi site/device/revisi/nilai, dedup event, dan tidak membiarkan ACK lama/rejected terlambat menghapus hasil applied revisi terbaru.

```json
{"kind":"water_interlock_ack","schemaVersion":1,"siteId":"greenhouse-01","deviceId":"esp32-s3-01","revision":2,"status":"applied","appliedRevision":2,"enabled":false,"acknowledgedAt":"2026-10-21T06:00:00Z","reason":"interlock_config_applied"}
```

NVS memakai key tersendiri `ch3_il_cfg`, tanpa mengubah layout automatic control atau pulse journal. Konfigurasi disabled yang sudah disimpan tetap disabled setelah restart. NVS kosong/corrupt boot enabled; write gagal tidak menonaktifkan proteksi dan membalas rejected. Storage corrupt dapat dipulihkan dengan apply enabled yang berhasil disimpan. Firmware melaporkan `waterInterlockConfigCapable`, `waterInterlockEnabled`, `waterInterlockRevision`.

## Firmware

Pakai folder `firmware/SPFF_MASTER_1_4_30_WEB_WATER_INTERLOCK/`, termasuk seluruh header di dalamnya. Berbasis 1.4.29 dengan pulse code tetap tersedia dan `SPFF_ENABLE_SERVER_SOIL_EC_PULSES=0` secara default. Switch interlock berfungsi independen dari enable pulse. Firmware 1.4.28/29 belum memahami setting ini.

Host tests mengompilasi header produksi `WaterInterlockPolicy.h` dan `WaterInterlockSettings.h` dengan stub relay/NVS. Menguji level/histeresis, invalid sensor, disable, reboot persistence, duplicate/conflict/stale revision, OFF verification dan storage failure. Tes pulse handler juga dijalankan terhadap header 1.4.30. Ini bukan full ESP32 board build atau bukti uji hardware.

## Apply Orange Pi

Setelah backup database/build/environment seperti deployment sebelumnya:

1. Cherry-pick commit fitur ini dan `npm run build` dari `/opt/spff`.
2. Terapkan **hanya migration 027** jika belum ada (001–026 harus sudah terpasang), sebagai postgres/admin/migrator sesuai instalasi. Jangan menjalankan ulang migration lama.
3. Restart `spff-api`, `spff-mqtt-worker`, `spff-edge-gateway`; refresh browser. Environment aktif instalasi pengguna: `/etc/spff/api.env`, `/etc/spff/mqtt-worker.env`, `/etc/spff/edge-gateway.env`. Port API aktual: 3001.
4. Compile firmware 1.4.30 untuk board/library/pin mapping yang sebenarnya, uji dengan pompa terisolasi, lalu flash melalui prosedur perangkat yang sesuai. Verifikasi default enabled, apply disabled, ACK + status, reboot, dan apply enabled kembali. Periksa OFF dan proteksi lain di hardware sebelum penggunaan operasional.
5. `SPFF_SOIL_EC_PULSES_ENABLED` tetap false selama commissioning pulse belum selesai. Jangan menganggap menyimpan switch interlock mengaktifkan AI/pulse.

Tidak ada koneksi SSH/flash otomatis dari implementasi ini. Belum ada uji board fisik. Jangan mengubah mode Automatic hanya untuk menguji switch; sinkronisasi bekerja juga dalam mode Manual.

## Verifikasi software

`npm run build`, `npm run lint`, suite contracts/API/frontend/edge/MQTT dan `npm run test:pulse-firmware`.

Integrasi SQL opsional memakai dependency PGlite sementara (lihat `docs/server-soil-ec-pulses.md`), bukan database produksi:

```sh
SPFF_TEST_PGLITE_MODULE=/tmp/spff-pgtest/node_modules/@electric-sql/pglite/dist/index.js node --test functions/test/waterInterlock.integration.test.mjs functions/test/soilEcPulse.integration.test.mjs
```

Tes menjalankan seluruh migration pada PostgreSQL WASM sementara, default seed, grants role, controller validation/revision conflict/retry, publish, ACK identity/value, stale ACK, late rejection, dan status perangkat. Tanpa environment opsional, dua tes SQL tersebut skipped; jangan mengklaim sudah diuji pada PostgreSQL produksi.
