# Estimasi gram pupuk berbasis EC

Implementasi mengikuti Dokumen Teknis Formula Dosis Pupuk Berbasis EC versi 1.0:

```
gram_interval = max(0, EC_campuran - EC_air_baseline) / K * volume_campuran_interval
gram_fase = jumlah gram_interval valid
sisa_estimasi = max(0, target_gram_HST - gram_fase)
gram_per_tanaman = gram_fase / jumlah_tanaman_program
```

Flow meter 2 inci (`flow_water_*`) dibaca sebagai total campuran setelah venturi. `flow_fert_lpm` dipakai untuk memastikan injeksi berlangsung, tanpa ditambahkan lagi ke debit total. Volume memakai delta `flow_water_total_l` yang valid. Jika counter tidak tersedia, fallback memakai `flow_water_lpm × detik / 60`. Reset/penurunan counter tidak dijembatani dengan fallback.

## Parameter website

Di Pengaturan tersedia **Estimasi gram pupuk dari EC**. Pilih perangkat dan formulasi (Phonska atau Phonska plus), isi K, serta referensi kalibrasi. K disimpan terpisah per perangkat/formulasi. Tidak ada K produksi bawaan; 6400 hanya placeholder contoh dokumen.

Secara default kalibrasi belum diverifikasi: hasil tampil sebagai estimasi dan belum menyelesaikan fase. Checkbox verifikasi mengizinkan hasil terukur dipakai menentukan fase terpenuhi; referensi pengujian wajib diisi untuk pilihan ini. Penyimpanan pengaturan tidak mengirim command pompa.

K dibekukan untuk satu fase pada awal estimasi. Perubahan K tidak menghitung ulang fase berjalan secara diam-diam. Verifikasi/revokasi pada K yang sama berlaku pada fase berjalan. K berbeda menonaktifkan penyelesaian fase dari snapshot lama, dan digunakan saat estimasi fase berikutnya dimulai.

HST, target gram, dan jumlah tanaman memakai program Panduan. Tidak ada input ulang EC air, debit, waktu, atau gram per interval.

## Baseline dan sumber sensor

Baseline otomatis memakai tiga telemetri terakhir sebelum sesi, maksimal 15 menit sebelumnya. Jika baseline lama tidak tersedia, baseline baru dapat diambil saat air saja kembali mengalir stabil; perhitungan kemudian dimulai dari baseline baru tersebut, tanpa mengisi gram untuk periode sebelumnya. Air harus mengalir dan pupuk OFF; flow pupuk harus nol. Ketiga EC valid dan stabil dalam rentang `max(20 µS/cm, 5% rerata)` dengan rentang waktu minimal 40 detik dan jeda antar-sampel maksimal 120 detik. Ketiganya harus dari boot perangkat yang sama.

Status pompa dipasangkan dengan heartbeat pada/sebelum waktu sampel, maksimal 60 detik sebelumnya. Status yang datang sesudah sampel tidak dipakai untuk mengasumsikan kondisi sebelumnya. EC memakai `liquid_ec_us_cm`, bukan EC tanah.

Jika kedua pompa langsung ON tanpa baseline air yang memenuhi syarat sebelumnya, estimator tetap menunggu baseline dan tidak mengarang nilai EC air. Jalur ON/OFF yang ada tidak diganti menjadi urutan water-first oleh perubahan ini.

## Akumulasi dan audit

`ec_dose_estimates` menyimpan snapshot K/baseline, checkpoint telemetry ID, anchor interval, dan jumlah gram. `ec_dose_intervals` menyimpan hasil setiap sampel dengan kunci unik fase/telemetry ID. Penyimpanan ini satu transaksi dengan worker; polling berulang atau restart tidak menambahkan sampel yang sama lagi.

Interval invalid, jeda lebih dari 120 detik, reboot, dan counter turun tidak dikreditkan. Masa transisi sebelum kedua pompa terkonfirmasi ON juga tidak diisi dengan angka perkiraan. Setelah data kembali valid, estimator mulai dari anchor baru. Dashboard menampilkan jumlah interval tidak terukur; interval tersebut tidak ditambahkan ke gram terukur. Jika kalibrasi terverifikasi, hanya jumlah gram dari interval valid yang boleh mencapai target fase.

Fase yang sudah terpenuhi tidak dibuka ulang atau memicu ON ulang akibat perubahan pengaturan. Pengalihan ke Fuzzy tetap menunggu konfirmasi kedua pompa OFF. Formula ini tidak mengirim perintah OFF langsung ke firmware.

## Endpoint

- GET `/api/settings/ec-dose/:deviceId?product=Phonska` untuk operator/admin yang login.
- PUT `/api/settings/ec-dose/:deviceId` untuk admin dengan CSRF, memakai `expectedRevision`.
- GET `/api/fertigation/automatic-cycle?deviceId=...` menyertakan estimasi gram/tanaman, K, baseline, dan kualitas interval.

Deploy seluruh perubahan memakai `scripts/hst-orange-backend.sh deploy "$PWD"`, yang menyertakan migration 046, kontrak, controller, route, worker, dan frontend. Deploy mematikan izin START seperti sebelumnya. Tidak perlu perubahan firmware untuk rumus, selama telemetri EC, flow, boot, dan readback pompa yang diperlukan sudah tersedia.
