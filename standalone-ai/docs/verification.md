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
