# Fase pemupukan dan penyiraman otomatis

Program Panduan terakhir yang disimpan untuk perangkat menjadi sumber fase. Fase memakai kegiatan Phonska/Phonska plus dengan metode Tabur. Target kg dikonversi ke gram untuk dashboard. Pada pemasangan pertama, sistem masuk fase HST terakhir yang sudah jatuh tempo; fase lama yang belum pernah dilacak tidak diputar ulang. Fase yang sudah dilacak dan belum terpenuhi tetap menahan Fuzzy meskipun tanggal berganti.

Rumus operator sekarang diterapkan melalui `mqtt-worker/src/fertilizerDelivery.ts` dan checkpoint di `mqtt-worker/src/ecDoseEstimator.ts`. Lihat [estimasi EC](ec-fertilizer-estimation.md) untuk parameter website, baseline otomatis, integrasi volume, kualitas data, dan audit.

Default belum memiliki koefisien K produksi. Operator mengisi K per perangkat/formulasi di Pengaturan. Sebelum K dan baseline tersedia, dashboard menunggu data. Kalibrasi yang belum diverifikasi hanya menghasilkan estimasi; kalibrasi terverifikasi mengizinkan gram valid yang terkumpul menentukan fase terpenuhi.

Setelah total gram mencapai target, ON pemupukan yang belum terkirim dibatalkan. Perangkat tetap mengendalikan akhir sesi pemupukan. Server menunggu readback kedua pompa OFF setelah batas kedaluwarsa ON sebelum menyerahkan tandon ke penyiraman Fuzzy. Pemupukan dikirim sekali per fase; hasil yang tidak terkonfirmasi tidak menyebabkan pengulangan ON otomatis.

Di luar fase, server membaca `production_fuzzy` dari AI lokal port `AI_LOCAL_PORT` (default 5010). Hasil simulasi tidak dipakai. Perangkat AI lokal ditentukan oleh `AI_SITE_ID` (default `greenhouse-01`) dan `AI_DEVICE_ID` (default `esp32-s3-01`); telemetri Tanah 2 harus sesuai waktu hasil tersebut. Fuzzy hanya menjalankan pompa air. Server mengirim OFF saat target liter tercapai, perangkat berhenti, kontrol Manual, bukti air tidak valid/terlambat, fase pemupukan dimulai, atau batas sesi dua jam tercapai. Proteksi firmware tetap berlaku.

GET `/api/fertigation/automatic-cycle?deviceId=esp32-s3-01` menyediakan mode, fase, target/terkirim/sisa gram, status formula, dan HST berikutnya. Endpoint ini hanya membaca status. Tombol ACC/SHADOW AI lama tetap tidak dipakai.

Deploy bersama UI, route, kontrak, worker, dan migration 045:

```bash
cd /home/orangepi/spff-hst-mode-preview &&
git fetch origin &&
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104 &&
sudo bash scripts/hst-orange-backend.sh deploy "$PWD"
```

Deploy mematikan izin START. Aktivasi setelah firmware mendukung command pada mode Otomatis:

```bash
sudo bash scripts/hst-orange-backend.sh enable-hst-schedule "$PWD"
```

Aktivasi ini mengaktifkan pemilihan fase dan Fuzzy di luar fase, sehingga dapat segera mengirim ON. K/baseline yang belum tersedia tidak menghalangi ON fase pertama; data tersebut diperlukan untuk menghitung progres. Verifikasi kalibrasi diperlukan agar estimasi boleh melepaskan fase setelah terpenuhi.
