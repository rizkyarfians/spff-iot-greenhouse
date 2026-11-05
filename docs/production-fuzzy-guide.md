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

Installer dan CLI profil mengambil direktori aktif dari MainPID service,
memastikan proses itu memiliki listener 5010, memakai entrypoint Python `-m app`,
dan memeriksa lokasi import paket. `/opt/spff-ai` tidak lagi diasumsikan sebagai
direktori yang aktif. Hasil inspeksi hanya berisi lokasi/PID, tanpa environment:

```bash
sudo python3 scripts/ai_service_runtime.py
```

Jika target source masih berbeda, hash guard tetap menghentikan pemasangan.
Jangan menyalin api.py secara paksa atau menghapus pengecekan hash.

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

## Hasil Fuzzy produksi untuk integrasi backend

`GET /dashboard/summary` (Python 5010) dan route terautentikasi
`GET /api/unified-ai/dashboard` menyediakan `production_fuzzy`.
Route Node mempertahankan envelope `data.production_fuzzy`.

- `status=READY`: perhitungan memakai profil operasional yang terikat ke target
  Panduan, aktivitas jatuh pada hari ini (Asia/Jakarta), dan sensor valid/segar.
- `dominant_input_classes`, `memberships`, dan `rule_outputs` berasal dari
  membership/rule profil tersimpan. LOW pada input berarti kelembapan rendah;
  HIGH pada output berarti kebutuhan air tinggi. Skor bukan probabilitas.
- `target_water_l` adalah kebutuhan hasil centroid dan batas Panduan, dengan
  aturan OFF dari profil. Ini bukan sisa dosis, anggaran satu sesi, atau durasi.
- `expires_at` memakai umur snapshot, maksimum 120 detik atau batas profil yang
  lebih ketat. Pembaca wajib mengecek ulang waktu saat menggunakan hasil.
- `status=BLOCKED` mengembalikan `target_water_l=null` dan kode `blockers`.
  Tidak mengambil hasil simulasi sebagai pengganti. Aktivitas yang selesai
  manual perlu rekonsiliasi; perubahan tanggal/revisi tidak memakai target lama.
- `can_dispatch=false` tetap berlaku. Pelaksana wajib memeriksa ACC, idempotensi,
  kunci perangkat, batas sesi, flowmeter, interlock dan firmware secara terpisah.
  GET tidak membuat ledger/sesi atau mengurangi sisa kebutuhan.

Contoh: kelembapan 19,9% dengan aturan existing menghasilkan skor sekitar
0,844445. Jika target Panduan yang diverifikasi 1.000 L, hasilnya sekitar
844,445 L. 1.000 L pada contoh ini bukan nilai yang dipasang ke perangkat.

Cek keluaran setelah pemasangan dan pengikatan profil:

```bash
curl -fsS --max-time 20 http://127.0.0.1:5010/dashboard/summary |
python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({k:d.get(k) for k in ["operational_profile","production_fuzzy"]},indent=2))'
```

## Verifikasi

Suite Python: 236 tes, 6 skipped (integrasi eksternal opsional), termasuk
regresi scope profil, target Panduan, revisi berubah, sensor stale, serta
penolakan simulator sebagai profil operasional. Tes ini tidak menguji pompa fisik.

