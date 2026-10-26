# Planner Rule-Based Adaptive Fertigation pada server

Perubahan 26 Oktober 2026 hanya mencakup backend dan kontrak data. Firmware master/slave serta dashboard tidak diubah. Source dalam lampiran `master salve 1.4.30.rar` diperiksa sebagai referensi: handler pulse server tersedia tetapi macro default `SPFF_ENABLE_SERVER_SOIL_EC_PULSES=0`. Planner tidak menggunakan handler EC tanah untuk mengendalikan EC larutan.

## Perilaku

Endpoint Automatic Rule-Based sekarang menyertakan `adaptivePlan` saat satu aturan terpilih. Konfigurasi belum tersedia menghasilkan `not_configured`; syarat tidak terpenuhi menghasilkan `hold`; rencana lengkap menghasilkan `planned`. Semua hasil tetap `canDispatch=false`. Rencana bukan sesi perangkat, tidak mereservasi dosis, tidak memublikasikan MQTT, dan tidak mengubah mode maupun konfigurasi kontrol legacy.

Planner memanfaatkan pemilihan tanaman/HST, freshness, sensor health, mode/ACK dan repeat guard yang sudah ada. Ia menambahkan pemeriksaan ACK jadwal, sisa waktu jendela air dan pupuk, riwayat volume sesi, serta konflik sesi pulse tanah. Profil diikat pada revisi aturan: perubahan aturan mengharuskan verifikasi dan penyimpanan ulang profil. Sensor HTTP dari klien ditolak; observasi dibaca dari PostgreSQL.

Rumus menggunakan kalibrasi eksplisit, tanpa nilai agronomi bawaan:

```
air = min(batas air aturan,
          jumlah tanaman × min(batas air/tanaman,
            (target moisture − moisture aktual) × liter/tanaman/poin moisture))
stok diminta = jumlah tanaman × gram produk/tanaman ÷ gram produk/liter stok
stok target = min(stok diminta, batas stok aturan)
durasi pompa = liter ÷ debit kalibrasi × 60
pulse berikutnya = clamp(Kp × (target EC larutan − EC aktual), minPulse, maxPulse)
```

Koefisien kebutuhan air merupakan pendekatan linear terkalibrasi untuk media/zona terpasang, bukan konversi universal kelembapan menjadi liter. `fertilizerGPerPlant` harus menyatakan gram produk yang sama dengan pembilang `stockConcentrationGPerL`, bukan gram unsur hara yang berbeda. Aturan tanaman/HST yang dipilih menentukan profil kebutuhan yang digunakan.

Volume stok tersedia diinterpolasi dari kurva level persen → liter; tidak menganggap bentuk tandon linear. Debit stok harus berasal dari jalur stok sebelum injeksi, bukan debit campuran/booster. Estimasi waktu memakai debit hasil kalibrasi, sehingga debit nol saat idle tidak dianggap debit operasi. `flowBasis=calibrated_estimate` menandakan volume aktual belum terbukti.

Target air mencakup stabilisasi, injeksi/mixing, dan flushing. Flushing berasal dari pengukuran volume perpindahan sampai drip terjauh. Planner menahan rencana bila anggaran air, waktu, stok, atau sisa batas pupuk harian tidak cukup. Ia mencadangkan waktu mixing sesudah setiap pulse minimum, termasuk pulse terakhir. Pulse berikutnya dibatasi pula oleh dosis dan waktu tersedia; hasil di bawah pulse minimum ditahan. Hanya pulse pertama yang diperkirakan: belum ada loop sesi yang menghitung ulang setelah volume aktual dan feedback EC berikutnya.

Batas harian hanya memakai sesi perangkat yang tercatat. Sesi tidak lengkap atau sesi pulse tanah dengan dosis liter tidak diketahui menahan rencana. Ketiadaan catatan tidak membuktikan pompa legacy/manual belum memakai pupuk. Karena itu planner belum menjadi pengaman dosis fisik atau izin aktuasi.

## API lokal

| Endpoint | Hak akses | Input |
| --- | --- | --- |
| GET `/api/fertigation/planner-profile` | Operator/admin | query `deviceId`, `recipeId` |
| PUT `/api/fertigation/planner-profile` | Admin + CSRF | `deviceId`, `recipeId`, `expectedRevision`, `expectedRecipeRevision`, `profile` |
| POST `/api/fertigation/plan` | Operator/admin + CSRF | hanya `deviceId`, `recipeId` |
| GET `/api/automatic-control/rule-based` | Operator/admin | query `deviceId`; field tambahan `adaptivePlan` |

Untuk membuat profil, gunakan `expectedRevision=0`; edit memakai revisi hasil GET. Penulisan profil dan histori revisinya satu transaksi. Konflik revisi menghasilkan 409. Skema profil terdapat pada `packages/contracts/src/fertigationPlanner.ts`; seluruh parameter wajib dikalibrasi. Belum ada form dashboard baru untuk profil ini. Maintenance switch `AI_EVALUATION_ENABLED=false` juga memblokir endpoint plan.

## Pemasangan

Backup database dan pastikan migrations 001–028 sudah diterapkan. Terapkan hanya `029_adaptive_fertigation_planner.sql` dengan role migrator, build contracts/backend dari revisi yang sama, kemudian restart API lokal. Isi profil melalui API admin. Tidak memerlukan flash firmware. Sebelum migration 029, endpoint Automatic lama tetap memberi evaluasi dengan planner berstatus `not_configured`.

Belum dilakukan deployment Orange Pi atau uji pompa. Perubahan ini melengkapi perencanaan server; eksekusi otomatis penuh air–injeksi–flushing tetap memerlukan kontrak pelaksanaan yang didukung perangkat dan bukti hidraulik.

## Verifikasi

`npm run build:contracts`, `npm run test --workspace functions`, dan lint contracts/backend. Tes perhitungan mencakup konservasi volume air, batas dosis/waktu, kurva tandon, pulse EC larutan, air saja, dan sensor invalid.

Tes SQL terpisah memakai PostgreSQL sementara yang kosong, melalui `SPFF_TEST_PLANNER_DATABASE_URL`. Tes menerapkan seluruh migrations dan menguji revisi serentak, histori transaksi, jendela jadwal WIB, ACK jadwal, serta sesi dosis tidak lengkap. Jangan arahkan variabel tes ini ke database operasional.

Alternatif tanpa server PostgreSQL adalah `SPFF_TEST_PGLITE_MODULE` yang menunjuk `dist/index.js` PGlite (lihat dokumentasi pulse EC tanah). Adapter ini memakai database WASM sementara dan menserialkan transaksi pada satu koneksi. Uji planner dengan PGlite sudah lolos; ini bukan bukti pengujian database Orange Pi atau aktuator.

Hasil verifikasi lokal: build seluruh workspace lolos; lint seluruh workspace selesai dengan satu warning frontend yang sudah ada pada `SoilEcPulsePanel.tsx:49`. Suite backend dengan PGlite: 73 lolos, satu tes export yang memerlukan database terpisah dilewati. Suite contracts: 36 lolos. Firmware tidak diubah atau diuji ulang dalam perubahan server ini.
