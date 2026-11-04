# Fuzzy produksi berbasis Panduan

Perubahan ini memperbaiki profil dan perhitungan. Tidak mengaktifkan flag dispatch,
tidak mengirim command, tidak mengubah konsentrasi stok, dan tidak mem-flash ESP32.

## Dua jalur yang berbeda

- Air saja: Fuzzy memakai kelembapan sensor yang dipilih, lalu menghitung kebutuhan
  air dari maksimum liter pada satu aktivitas Panduan yang diverifikasi.
- Air + pupuk: HST menentukan kewajiban per produk; pengikatan stok, EC, hidrolik,
  ACC, revisi, pengunci perangkat, serta bukti hasil sesi tetap memakai jalur HST.

Kapasitas tandon 5.000 L tetap kapasitas penyimpanan. Batas kebutuhan tanaman
diambil dari reference_water_l Panduan, bukan dari kapasitas tandon.

## Perbaikan source

- HST approval membaca runtime_profiles dari scope source-shadow yang dipakai
  configure_live, bukan scope ledger source-shadow/hst-v1.
- Tidak ada pembacaan kembali blob histori development besar untuk mengambil profil.
- Fuzzy operasional memakai profil tersimpan yang terikat ke program, aktivitas,
  perangkat, tanggal tanam, hash sumber, dan revisi Panduan.
- Perubahan binding menandai profil REVIEW_REQUIRED. Profil simulator tidak
  dipromosikan hanya dengan mengganti label atau kapasitas tandon.
- Dashboard mempertahankan preview simulasi sebagai SIMULATION_PROFILE dan
  menandai hasil profil Panduan sebagai OPERATIONAL_PROFILE. Keduanya bukan izin pompa.

## Pemasangan Orange Pi

Jalankan backend terlebih dahulu agar kontrak respons baru sudah diterima:

```bash
cd /home/orangepi/spff-hst-mode-preview &&
git fetch origin &&
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104 &&
sudo bash scripts/hst-orange-backend.sh deploy "$PWD" &&
sudo bash scripts/deploy-ai-production-profile.sh "$PWD"
```

Installer Python memeriksa hash source 4 module yang disentuh. Jika source lokal
berbeda dari baseline small-state atau patch ini, ia berhenti tanpa menimpanya.
Module lain tetap dipertahankan. Pengujian berjalan pada salinan, sebelum
pemasangan. Restart/health failure mengembalikan module dari backup.
Jika unit yang dipakai bernama spff-ai.service, berikan sebagai argumen kedua.

Setelah sukses, inspeksi profil dan target Panduan tanpa mencetak DSN:

```bash
sudo python3 scripts/run-ai-profile.py
```

Perintah ini memakai environment dari proses service AI yang berjalan. Ia hanya
membaca profil dan target Panduan. Program/aktivitas dipilih eksplisit; target
tidak ditebak ketika ada beberapa aktivitas.

## Mengikat target yang diverifikasi

Memerlukan profil hidrolik operasional existing, atau file --base-profile yang
sudah diverifikasi. Tidak ada default produksi dari simulation-1. Jika profil
belum tersedia, CLI berhenti dan menyebut kebutuhan itu.

```bash
sudo python3 scripts/run-ai-profile.py --   --program-id PROGRAM_ID   --activity-id ACTIVITY_ID   --version production-guide-r1   --reference "Target liter Panduan diperiksa operator"   --actor admin
```

Tanpa --apply, hasilnya hanya JSON profil untuk ditinjau. Tambahkan --apply
untuk menyimpan profil dengan histori versi. Langkah ini tetap tidak mengirim
command pompa dan tidak mengubah flag dispatch.

Maksimum kebutuhan air dapat lebih besar dari kapasitas tersedia. Ini bukan
izin menghabiskan tandon: batas sesi, cadangan, kondisi aliran, waktu,
serta kemampuan firmware tetap diperiksa pada pelaksana.

## Batas perangkat yang sudah diperiksa

Source ZIP 1.5.07 yang tersedia di Downloads masih membatasi jalur AI ACC
water-trial pada 5 L dan 30 detik. AiAccSessionConfig.h bahkan default 0 detik
hingga commissioning. AdaptiveFertigationEngine.h memiliki sesi air+pupuk
dan menolak target pupuk nol.

Karena itu perhitungan air saja tidak boleh langsung dipetakan ke sesi adaptif
dengan dosis pupuk palsu, dan batas trial tidak dinaikkan untuk menjalankan
ratusan liter. Air saja dalam skala produksi memerlukan kontrak firmware sesi
volume air tersendiri dan verifikasi pengukuran, penghentian, restart, serta
arbitrasi relay. Jalur HST yang ada tetap memerlukan pengikatan stok/hidrolik
dan uji perangkatnya sendiri. Tidak ada klaim kedua mode sudah commissioned.

## Verifikasi

Suite Python: 234 tes, 6 skipped (integrasi eksternal opsional), termasuk
regresi scope profil, target Panduan, revisi berubah, sensor stale, serta
penolakan simulator sebagai profil operasional. Tes ini tidak menguji pompa fisik.

