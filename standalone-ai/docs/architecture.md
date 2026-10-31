# Arsitektur standalone

```text
Browser / HTTP localhost:5010
       |
       +-- /simulations/* --> engine + mock session --> SQLite memory per request
       |                          |                        (isolated, discarded)
       |                    rules / fuzzy / EMA / mass balance
       |
       +-- /source/audit --> read-only SPFF PostgreSQL adapter
       +-- /source/evaluate + optional poll --> compatibility HOLD --> own state store
                                                                    |
                                               SQLite local or PostgreSQL spff_ai
```

Loop background hanya aktif jika dikonfigurasi, dan belum mengirim command.
FastAPI/uvicorn menangani API serta graceful shutdown. Transaksi SQLite memakai
BEGIN IMMEDIATE dan lock thread; PostgreSQL memakai advisory xact lock per scope.
Semua perubahan ledger disimpan atomik bersama snapshot audit. DRY_RUN memakai
salinan state privat yang dibuang setelah perhitungan.

Ledger tidak memakai revision konfigurasi sebagai identitas kewajiban. Perubahan
konfigurasi tidak menghilangkan sisa dosis; EMA dipisah per versi konfigurasi.
Identitas kewajiban berdasarkan program, tanggal tanam, dan tanggal aplikasi.
Sesi berjalan memblokir sesi kedua. Sesi/obligation yang memerlukan review tidak
dilanjutkan tanpa rekonsiliasi. Workflow operator untuk rekonsiliasi masih tahap berikutnya.

Target 5.000 gram pada konsentrasi 25 g/L berarti 200 L larutan. Dengan batas sesi
air 4.500 L, priming 20 L, flushing 100 L, debit 220/7 L per menit:

```
Anggaran air injeksi = 4.500 - 20 - 100 = 4.380 L
Stok sesi maksimum = 4.380 / 220 × 7 ≈ 139,36 L
Massa sesi maksimum ≈ 3.484,09 g
```

Itu estimasi rencana. Mass balance setelah sesi hanya menerima volume aktual yang
valid. Jika actual stok 100 L, massa 2.500 g dan sisa 2.500 g. Pengukuran flow air
dalam simulasi diasumsikan air baku sebelum injeksi. Jika flow existing setelah
venturi mengukur campuran, adapter harus mengubah basis perhitungan dan menguji
konservasi volume; basis itu belum dibuktikan pada perangkat lapangan.
