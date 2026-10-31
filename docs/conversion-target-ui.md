# Hasil konversi EC pada Kebutuhan tanaman

Panel baru ditampilkan setelah daftar kegiatan pada komponen AdaptiveRecommendation,
sebelum ringkasan status kegiatan. Nilainya mengikuti program dan kegiatan yang
sedang dipilih, bukan sesi IDLE atau target default firmware. Data dibaca dari
endpoint existing `/api/guide-programs/:id/ec-conversion` tanpa mutasi.

Tampilan berisi hasil EC dalam mS/cm dan µS/cm, konsentrasi larutan g/L dari
konversi server, dan EC air baku tersimpan pada konfigurasi program. Target yang
belum tersedia, gagal dimuat, atau blocked menampilkan alasan yang diberikan
server; tidak menggunakan angka sintetis atau otomatis mengubah metode aplikasi.
Pergantian kegiatan/program menyembunyikan hasil lama sampai data baru diterima.
Kartu bisa ditampilkan sebelum sesi dimulai dan untuk kegiatan manual maupun
otomatis. Tampilan ini tidak menjamin hasil konversi telah dikirim ke perangkat.

File AdaptiveDevicePanel di Orange belum ada di branch GitHub production saat
diperiksa. Karena itu pemasang hanya menyisipkan import + kartu di
AdaptiveRecommendation existing dan mempertahankan panel alat tambahan serta
perubahan lokal di file tersebut. Tiga asset baru ditambahkan; GuidePrograms
mendapat ekstensi import `.tsx` eksplisit agar komponen GuideSchedule tidak
bertabrakan dengan helper guideSchedule pada Windows.

## Pemasangan Orange

Gunakan checkout patch terpisah `~/spff-1503-fix` branch
`codex/firmware-1503-compat`. Jalankan pemeriksaan:

```bash
python3 ~/spff-1503-fix/scripts/apply-conversion-target-ui.py --target /opt/spff
```

Jika READY, jalankan command yang sama dengan `--apply`, lalu dari `/opt/spff`
jalankan `npm run build:frontend`. Backup dibuat di
`~/spff-conversion-backups/<timestamp>-<id>`. Pemasang memeriksa anchor layout,
menolak asset baru yang bentrok, dan tidak menimpa file .env, API, backend, firmware,
atau panel alat custom. Build ulang frontend saja; service API/worker/gateway
tidak perlu direstart. Static hosting yang memakai frontend/dist akan membaca
hasil build baru setelah browser dimuat ulang.

Perhatian: update UI ini terpisah dari pemasangan backend firmware sebelumnya.
Menjalankan installer UI tidak ikut menerapkan patch backend.

## Verifikasi

- Build frontend TypeScript dan Vite lolos; warning ukuran bundle existing tetap.
- 81 tes frontend lolos, termasuk nilai konversi kedua satuan, nilai nol,
  angka invalid, status blocked dan hasil milik kegiatan lain.
- Render SSR memakai Vite dan React memverifikasi markup ready, blocked,
  wrong-activity, loading dan error.
- Smoke installer memverifikasi lima perubahan, marker panel perangkat custom
  tetap tersimpan, pemasangan ulang idempotent, dan benturan asset ditolak.
- Belum diverifikasi secara visual pada web Orange setelah pemasangan.
