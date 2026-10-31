# Verifikasi lokal — 31 Oktober 2026

Lokasi: `D:\SPFF-AI`, Python 3.13.15, API loopback port 5010.

## Hasil yang dijalankan

- 48 automated tests **lolos**, tanpa skipped tests, saat dijalankan melalui
  `scripts/verify_postgres.py` dengan PostgreSQL 18 sementara.
- 37 tes core mencakup 20 skenario prompt serta validasi konfigurasi, dry-run,
  shadow/ACTIVE guard, konflik feedback, transaksi concurrent, dan Fuzzy/EMA.
- 8 tes API mencakup health/readiness, validasi input, isolasi simulasi, OpenAPI,
  sumber belum dikonfigurasi, serta tidak adanya endpoint feedback perangkat sembarang.
- 3 tes PostgreSQL mencakup persistensi/rollback, restart + feedback idempotent,
  serta source schema yang tidak lengkap menghasilkan penolakan kompatibilitas.
- Cluster tes dibuat baru dengan identitas `ai_test`, port loopback sementara,
  dan dihentikan dalam finally. Tidak menggunakan database operasional `spff`.
- Output suite tersimpan di `data/verification-tests.txt` (file lokal, tidak untuk git).

Ada warning deprecation non-fatal dari Starlette TestClient mengenai integrasi
httpx. Tidak ada kegagalan pengujian. Dependency yang terpasang dicatat dalam
`requirements.lock.txt`.

## Smoke HTTP pada service yang berjalan

- `GET /health`: 200, `SHADOW_MODE`, `can_dispatch=false`, `Asia/Jakarta`.
- `GET /ready`: 200, profile `local-simulator`, `hardware_ready=false`.
- `GET /status`: source belum dikonfigurasi, polling OFF, backend state SQLite lokal.
- `POST /simulations/complete`: COMPLETED, delivered 5.000 g, hardware_commands=0.
- `GET /decisions` setelah simulasi tetap kosong: simulasi tidak mencemari ledger nyata.
- Log uvicorn mengonfirmasi listener `http://127.0.0.1:5010`.

## Belum dibuktikan

Tidak ada uji hardware, kalibrasi lapangan, flash firmware, commissioning drip,
deployment Orange Pi, atau dispatch gateway. Tahap PRD/ACTIVE belum selesai:
schema SPFF lokal masih tertinggal dan kontrak sesi volume/otoritas relay belum
tersedia. Adapter live baru memeriksa sumber dan menyimpan keputusan HOLD;
perencanaan penuh dan pemrosesan feedback saat ini dibuktikan pada simulator.

File unit systemd adalah template yang belum diaktifkan/diuji di Orange Pi.
Engine tidak mengubah backend, dashboard SPFF, service gateway, mode kontrol
perangkat, database operasional, maupun archive firmware pengguna.


## Regresi Python 3.10 — perbaikan timestamp UTC

Log Orange Pi memperlihatkan HTTP 500 pada `/simulations/complete`: Pydantic
menserialkan waktu UTC dengan akhiran `Z`, sedangkan `datetime.fromisoformat`
Python 3.10 menolak format tersebut. Parser kini menormalkan akhiran `Z` menjadi
`+00:00` sebelum parsing; offset lain dipertahankan.

Error asli direproduksi pada CPython 3.10.11 Windows x64 yang terisolasi.
Sesudah perbaikan, seluruh **52 tes lolos**, termasuk 4 regresi timestamp,
semua skenario simulator, API, dan 3 tes PostgreSQL pada cluster sementara.
Ini pengujian runtime 3.10 Windows, bukan pengujian OS/arsitektur Orange Pi.
Resolusi wheel Python 3.10 Linux ARM64 diperiksa terpisah. Verifikasi endpoint
pada Orange Pi setelah update masih perlu dijalankan oleh operator.


## Adapter Program dari Panduan — 31 Oktober 2026

Adapter kini membaca snapshot migration 034 (`spff.guide_programs`) melalui
`GET /source/guide-programs` dan field `guide_programs` pada audit sumber.
Kebutuhan produk sudah dihitung web; reader tidak menskalakan ulang atau memakai
fixture demo sebagai dosis nyata. Izin SELECT tambahan diperlukan untuk
`guide_programs`, `protocol_guide_edits`, dan `guide_program_completions`.

Seluruh **66 tes lolos** pada CPython 3.10.11 Windows x64 dengan cluster PostgreSQL
18 disposable. Tes baru mencakup dosis 2,5 g × 20.000 tanaman = 50.000 g per produk,
konversi kg, populasi 2.000 tanpa double scaling, tanggal HST/WIB, scope site/device,
izin SELECT, transaksi read-only, penolakan UPDATE, perubahan revisi Panduan,
metode aplikasi, mL bukan gram, dan catatan manual bukan pengukuran dosis.
Tes database memakai migration SPFF 033/034 asli dari commit audit production.

Ini verifikasi lokal reader, belum verifikasi endpoint reader baru pada Orange Pi.
Belum ada pengubahan dosis web, kewajiban otomatis dari Panduan, atau dispatch
aktuator. Seluruh preview tetap can_dispatch=false; lihat docs/guide-source.md.


## Pilihan rute drip untuk seluruh pupuk

Operator memilih semua produk pupuk lewat pompa/drip. Pilihan ini sekarang
tersedia sebagai AI_FERTILIZER_DELIVERY_ROUTE=drip, dengan metode sumber dan dosis
web tetap dipertahankan. Override berlaku untuk kategori pupuk; tidak memperluas
izin ke kategori ZPT, pestisida, atau kategori tidak diketahui. Tidak mengubah
isi/struktur database atau mengaktifkan aktuator. Data batch stok, kesesuaian
formulasi drip, serta kontrak firmware sesi volume tetap belum terverifikasi.

Seluruh **70 tes lolos** pada CPython 3.10.11 Windows dengan PostgreSQL disposable.
Empat regresi baru memeriksa rute Tabur/Semprot, identitas/dosis tetap, kategori
produk, default tanpa override, dan penolakan konfigurasi rute tidak dikenal.
Verifikasi di Orange setelah pemasangan opsi baru masih perlu dilakukan.
