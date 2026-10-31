# Read-only source: Program dari Panduan

Audit Orange Pi menunjukkan program `d17947b5-759b-42b2-adfc-d35a79d03fed`,
revisi 1, tanaman `ubi-jalar`, tanggal tanam 2026-10-18, basis plants, quantity
20000, device esp32-s3-01, guide_revision 0. Tidak ada override Panduan tersimpan.
Ini program berbeda dari sensor recipe yang mempunyai target_stock_l=0.

Kontrak yang dipakai berasal dari branch SPFF production
`feature/fertigation-foundation-20261018`, commit `219e444a09c92b7400a765e579f72780e71f1899`:
`packages/contracts/src/guidePrograms.ts`, `functions/src/services/guideProgramService.ts`,
serta migrations 033/034. Checkout SPFF Windows yang diaudit awal lebih lama.

`GET /source/guide-programs` membaca snapshot `spff.guide_programs.plan` yang sudah
dihitung dan diskalakan backend web. Tidak mengalikan ulang jumlah tanaman,
tidak menghitung ulang dari file Excel/JSON dasar, dan tidak menimpa program.
`GET /source/audit` juga menyertakan hasil ini pada field `guide_programs`.
`POST /source/evaluate` tetap menyimpan keputusan HOLD dan kini membawa observasi
program Panduan tersebut jika izin bacanya sudah tersedia.

Adapter mengecek schema/izin, membatasi site dan device, serta memeriksa binding
tanaman `ubi-jalar` → `sweet-potato` pada zona. Program tanpa device tetap ditampilkan
dengan binding belum terverifikasi. Tanaman lain belum dipetakan otomatis.
Jika tiga tabel belum tersedia atau role belum diizinkan SELECT, endpoint
mengembalikan NOT_READY dan daftar tabel yang diperlukan; audit sensor tetap tersedia.

HST dan tanggal aplikasi dihitung menurut Asia/Jakarta. Label PAST_DUE berarti
tanggal kalender lewat, bukan bukti pekerjaan belum dilakukan atau perintah untuk
mengejar dosis. Catatan `guide_program_completions` adalah pekerjaan manual dan
tidak digunakan sebagai bukti volume flow meter maupun dosis aktual terkirim.

Kebutuhan setiap produk tetap terpisah. `amount`/`unit` berasal dari plan tersimpan;
konversi kg→gram hanya menyamakan satuan. Dosis per tanaman dicocokkan dengan
populasi sebagai pemeriksaan, bukan mengganti kebutuhan tersimpan. Angka mL tidak
dianggap gram; tidak ada penjumlahan produk menjadi satu batch. Pelarut semprot
bukan konsentrasi stok injeksi. Kategori dan metode asli ikut ditampilkan.

Perubahan override Panduan sejak program disimpan ditandai. File sumber dasar
tidak dibaca ulang (`base_file_rechecked=false`); reader memakai snapshot program
yang telah disimpan, bukan menjanjikan bahwa file dasar saat ini identik.

Untuk instalasi Orange, tambahkan hanya izin baca:

```sql
GRANT SELECT ON spff.guide_programs,
                spff.protocol_guide_edits,
                spff.guide_program_completions
TO spff_ai_reader;
```

Tidak ada migration, INSERT, UPDATE, command pompa, atau perubahan konfigurasi web.
Muat `app/guide_programs.py`, `app/source.py`, dan `app/api.py` dari branch AI yang
sama, lalu restart service AI saja. Semua hasil tetap `can_dispatch=false`.
Metode tabur/semprot pada Panduan belum menjadi izin fertigasi drip; perubahan
rute aplikasi dan kontrak pelaksanaan volume tetap memerlukan validasi tersendiri.

Fixtures SQL pada tests/fixtures/033.sql dan 034.sql adalah salinan migration
SPFF pada commit audit di atas, dipakai hanya pada cluster PostgreSQL disposable.
