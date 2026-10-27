# Switch AI Fertigasi EC Tanah

Settings menyediakan satu switch per perangkat, di bawah Interlock Tandon Air,
dengan modal konfirmasi. Default **OFF**, tersimpan di PostgreSQL dan bertahan
setelah restart service. Ini izin sesi pulse EC tanah, bukan adaptive planner
EC larutan, bukan bypass interlock, dan bukan penjadwal sesi otomatis.

ON mengizinkan admin memulai sesi dari Program Fertigasi setelah kalibrasi.
Mode Automatic, ACK konfigurasi/jadwal, rule tanaman/HST, capability firmware,
sensor dan semua batas sesi tetap diperiksa seperti sebelumnya.

OFF disimpan dalam transaksi yang juga membatalkan sesi waiting/in_flight/fault
dan mengantrekan stop. API menolak start/advance, worker menolak publish pulse.
Publish worker dan perubahan switch berbagi advisory lock agar pulse tidak baru
dipublish setelah transaksi OFF selesai. Command yang sudah dipublish dapat
masih diterima MCU: stop dan batas waktu lokal tetap diperlukan.
Stop/release tetap dikirim saat izin atau flag deployment OFF. Mengaktifkan lagi
tidak melanjutkan sesi cancelled dan tidak menghapus guard satu sesi/hari.

Switch OFF menunjukkan izin server, **bukan konfirmasi fisik pompa OFF**.
Modal menampilkan sesi terminal tanpa ACK completed stop/release `pumpsOff=true`.
ACK hilang, ditolak atau kedaluwarsa perlu pemeriksaan perangkat; jangan
menganggap perubahan switch sebagai bukti aktuator sudah berhenti.

## Deploy Orange Pi

1. Backup database dan env, lalu checkout commit perubahan ini. Periksa
   migration yang sudah terpasang; migration 026 wajib ada. File 030 hanya
   menambahkan tabel setting dan grants dan dapat dipasang tanpa 028/029;
   jangan menjalankan ulang seluruh migration di produksi.
2. Terapkan sekali:

```bash
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/030_soil_ec_execution_switch.sql
```

3. Build dengan permission yang dapat dibaca user service:

```bash
(umask 022; npm run build)
```

4. Setelah commissioning firmware, set `SPFF_SOIL_EC_PULSES_ENABLED=true` pada
   `/etc/spff/api.env` dan `/etc/spff/mqtt-worker.env` satu kali. API juga perlu
   `AI_EVALUATION_ENABLED` tidak false. Flag ini tetap batas deployment;
   switch web tidak dapat melewatinya. Worker memerlukan flag-nya sendiri.
5. Restart API, worker dan edge, lalu verifikasi health port 3001 dengan retry.
   Setelah dukungan terpasang, ON/OFF sehari-hari cukup melalui Settings,
   tanpa edit env, rebuild atau flash ulang.

Tanpa migration 030, setting dilaporkan belum terpasang dan pulse gagal tertutup;
transport tetap dapat mengirim stop/release pada tabel 026.
Jangan downgrade server/worker lama saat mengandalkan switch OFF: versi lama
tidak mengenali izin ini. Sebelum rollback, stop dan buktikan OFF, nonaktifkan
flag deployment API/worker, baru jalankan software sebelumnya.

## Firmware trial

`firmware/SPFF_MASTER_1_4_35_SOIL_EC_PULSE_TRIAL/` kini melapor
`1.4.35-SOIL-EC-SINGLE-TRIAL`: pulse capability default 1, polling Soil
single-register-only true, diagnosis Auto tetap ada. Firmware tidak menyimpan
switch web: server adalah otoritas perhitungan dan izin sesi; firmware menjaga
deadline, dedup, NVS, mode/jadwal, flow dan interlock lokal.

Tidak ada binary siap flash atau bukti full board compile dalam perubahan ini.
Gunakan opsi board/flash yang sudah berhasil. Error `Octal Flash option selected,
but EFUSE not configured!` terjadi sebelum aplikasi berjalan dan perlu compile
ulang dengan konfigurasi flash sesuai hardware; tidak diselesaikan switch web.

## API dan verifikasi

- GET `/api/settings/soil-ec-execution?deviceId=...`: login; no-store.
- PUT endpoint sama: admin + CSRF; body `deviceId`, `expectedRevision`, `enabled`.
- CAS mencegah tab lama menimpa perubahan; retry HTTP yang sama tidak menambah revisi.
- Tabel `device_soil_ec_execution_configs` memiliki default OFF, audit actor/time
  dan grants baca worker, tulis API.
- Tes integrasi PGlite menguji default OFF, start ditolak, CAS/retry, worker gate,
  OFF saat sesi in-flight dan perangkat offline, stop tetap dikirim dengan
  deployment flag OFF, serta ON tidak melanjutkan sesi cancelled.
