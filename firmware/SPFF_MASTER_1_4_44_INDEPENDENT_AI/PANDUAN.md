# Jadwal dan AI EC tanah sebagai pemicu terpisah

Implementasi ini menggantikan aturan lama “jadwal DAN sensor” untuk firmware
`1.4.34-INDEPENDENT-AI`. Firmware lama tetap memakai perilaku lamanya.

| Kondisi | Perilaku firmware baru |
| --- | --- |
| Jadwal aktif, AI OFF | Jadwal menyalakan target dari jam ON sampai OFF, dengan interlock lokal tetap berlaku. |
| Di luar jadwal, AI ON dan profil terverifikasi tersimpan | Server mengevaluasi EC tanah setiap sekitar 10 detik dan membuat sesi bila sampel stabil di bawah batas mulai. |
| Tidak ada jadwal aktif, EC normal atau sensor tidak valid | Tidak ada sesi/pulse baru; alasan tercatat pada profil otomatis. |
| Jadwal dimulai ketika AI bekerja | Pulse dihentikan secara lokal, sesi dibatalkan dengan alasan `schedule_priority`; setelah ACK stop/OFF dan release, jadwal mengambil alih. Pergantian memerlukan komunikasi server/perangkat. |
| Sesi normal selesai atau switch AI dimatikan | Server meminta stop, menunggu ACK OFF, lalu mengembalikan kontrol jadwal dengan release. |
| Fault atau operator menekan Hentikan sesi | Kontrol ditahan; operator perlu memeriksa fault dan melakukan recovery Manual. Stop operator juga menonaktifkan arming profil otomatis. |

Mode Manual, jeda operator, interlock tangki air, OTA, dan fault lokal tetap
menghalangi ON. Kedua jalur menggunakan relay yang sama dengan satu pemilik.
Jadwal yang selesai tidak dijalankan susulan. Jendela yang sedang berlangsung
boleh dilanjutkan setelah pergantian kepemilikan, selama belum melewati OFF.
Jika stop/release tidak dikonfirmasi, sistem menahan kontrol; firmware tidak
menganggap pergantian selesai hanya berdasarkan switch atau status database.

## Konfigurasi sekali melalui web

1. Pilih program EC tanah zona `soil-1`, crop/HST dan aturan yang disetujui.
2. Mode Automatic harus applied, fertilizer sensor legacy harus disabled.
   Konfigurasi legacy water tetap diperlukan oleh validasi mode yang sudah ada;
   pulse EC tanah server dan jadwal baru tidak memakai algoritma fertilizer legacy.
3. Di **Kalibrasi dan batas sesi**, isi nilai terukur, centang verifikasi, lalu
   pilih **Simpan kalibrasi untuk AI otomatis**. Tidak ada angka dosis tebakan.
4. Aktifkan **AI Fertigasi EC Tanah**. Setelah itu tidak perlu memulai sesi manual.
   Tombol mulai sekali tetap tersedia untuk pengujian.
5. Bila aturan direvisi, verifikasi lalu simpan ulang profil. Profil terikat pada
   revision aturan saat disimpan. Setelah stop operator, simpan profil lagi untuk
   mengaktifkan kembali evaluasi otomatis (sesudah recovery ownership).

Profil dan alasan evaluasi disimpan di `spff.soil_ec_automatic_profiles`.
`PUT /api/fertigation/automatic-profile` memerlukan admin dan CSRF, dengan shape
request yang sama seperti start sesi manual (termasuk requestId).
GET pulse-sessions menambahkan objek `automatic`.

Beberapa sesi sensor per hari diizinkan, tetap mengikuti cooldown dan batas
akumulasi durasi ON harian semua sesi pulse. Batas ini mencatat waktu yang
*diperintahkan*, bukan liter aktual. Jadwal timer adalah jalur terpisah; durasi
jadwal tidak masuk budget pulse AI. Atur durasi jadwal berdasarkan kebutuhan
lapangan dan batas peralatan. Tidak ada perubahan perhitungan agronomi di MCU.

## Update Orange Pi dan ESP32

Hentikan eksekusi dan isolasi daya pompa sebelum update terkoordinasi: **jadwal
pada firmware baru menjadi pemicu timer langsung**, tidak lagi menunggu sensor.
Simpan binary lama untuk rollback. Jangan erase NVS atau burn eFuse.

Pada Orange Pi:

```bash
cd /opt/spff
git fetch origin feature/fertigation-foundation-20261018
git merge --ff-only origin/feature/fertigation-foundation-20261018
sudo systemctl stop spff-api spff-mqtt-worker spff-edge-gateway
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/032_independent_soil_ec_ai.sql
npm ci
npm run build
```

Migration 031 harus sudah diterapkan untuk perbaikan izin settings sebelumnya.
Migration 032 dijalankan sekali. Migration tidak mengaktifkan AI atau membuat
kalibrasi baru. MQTT worker yang ada tetap mempublikasikan snapshot authority
`device`; tidak perlu mengubah `SCHEDULE_EXECUTION_MODE`.

Upload sketch `firmware/SPFF_MASTER_1_4_34_INDEPENDENT_AI/` dengan board/core
baseline: ESP32S3 Dev Module, core 2.0.17, QIO 80 MHz, flash 16 MB, OPI PSRAM,
partisi app3M_fat9M_16MB, Hardware CDC/JTAG dan CDC On Boot Enabled.
Semua file header dalam folder wajib ikut. `SpffBuildCheck.h` menolak profil
Octal Flash yang pernah menyebabkan restart loop.

Setelah upload:

```bash
sudo systemctl start spff-edge-gateway spff-mqtt-worker spff-api
sudo -u postgres psql -X -d spff -P pager=off -c "
SELECT received_at, raw_payload->>'firmwareVersion' AS firmware,
       raw_payload->>'serverPulseCapable' AS pulse_capable,
       raw_payload->>'independentSoilEcCapable' AS independent,
       raw_payload->>'pulseBootId' AS boot_id
FROM spff.device_status_events
WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
ORDER BY received_at DESC,device_status_id DESC LIMIT 3;"
```

Target: versi `1.4.34-INDEPENDENT-AI`, kedua capability true, boot ID terisi,
telemetry fresh, mode dan jadwal ACK applied. Server menolak firmware trial lama
untuk eksekusi baru karena tidak mengiklankan capability independen.

Bangun frontend baru dan sajikan `frontend/dist` melalui prosedur web deployment
yang sedang digunakan. `npm run build` hanya membangun file; tidak memublikasikan
hosting eksternal secara otomatis.

Uji dengan daya pompa diisolasi: jadwal ON/OFF ketika AI OFF; EC rendah di luar
jadwal; target tercapai; sensor stale; jadwal masuk ketika AI bekerja; OFF switch;
operator stop/fault dan Manual recovery. Verifikasi event relay/ACK dan log
sebelum menghubungkan kembali daya pompa. Compile dan tes lokal bukan bukti
perangkat lapangan telah diuji atau di-update.

## Validasi lokal

Build contracts/API/frontend/worker dan compile ESP32-S3 QIO/OPI berhasil.
Tes integrasi PostgreSQL-WASM memakai seluruh migration: profil persisten,
prioritas jadwal, sesi otomatis pada EC rendah tanpa jadwal, EC normal/stale
tidak memulai, dedup, daily pulse budget, stop/OFF, release, dan stop operator.
Tes host menjalankan header produksi pulse dan timer schedule; memeriksa
kepemilikan, interlock, reboot, kegagalan storage, dan recovery fault.

Release ACK dengan state journal `5` mengulang bukti OFF yang diverifikasi saat
release selesai, walau jadwal sudah menyalakan relay sesudahnya. Status relay
terkini tetap ditentukan oleh event/status aktuator; ACK release bukan klaim
bahwa relay akan terus OFF setelah kontrol dikembalikan.
