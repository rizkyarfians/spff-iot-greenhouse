# SPFF Adaptive AI — standalone local implementation

Project Python terpisah dari `D:\SPFF`, dengan virtual environment, port, konfigurasi,
API, dan penyimpanan sendiri. Default `http://127.0.0.1:5010`, `SHADOW_MODE`, tanpa
koneksi perangkat. Halaman awal berisi pemilih skenario; OpenAPI tersedia di `/docs`.

## Menjalankan di Windows

```powershell
cd D:\SPFF-AI
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
Copy-Item .env.example .env
.\start.ps1
```

Virtual environment dan `.env` sudah disiapkan pada pemasangan lokal awal.
Jangan menimpa `.env` yang sudah diisi. Untuk berhenti pada terminal foreground gunakan
Ctrl+C. Port dapat diubah melalui `AI_PORT`; host prototype dibatasi `127.0.0.1`.
Tidak perlu menyalakan backend Node, MQTT, atau ESP32 untuk mencoba simulasi.

```powershell
.\test.ps1
# Tambahan: seluruh suite dengan PostgreSQL sementara, terpisah dari SPFF.
.\.venv\Scripts\python.exe scripts/verify_postgres.py
```

## Yang tersedia

- Fuzzy Mamdani: trapezoid configurable, MIN, MAX, centroid numerik → liter air.
- Rule-based: kalender Asia/Jakarta, prioritas keselamatan, kewajiban tertua lebih dahulu.
- Kewajiban unik per program/tanggal tanam/tanggal aplikasi; revisi program tidak menduplikasi dosis.
- Planner sesi dengan kurva tandon non-linear, debit EMA, batas waktu, priming, dan cadangan flushing.
- Simulator sesi: priming → bukti aliran sintetis → injeksi → penghentian aman.
- Mass balance dari volume larutan per sesi × konsentrasi yang dibekukan saat kewajiban dibuat.
- EMA air/pupuk terpisah; durasi diperkirakan dari debit; histori serta deduplikasi hasil final.
- Auto-resume simulasi setelah level cukup, stabil, data segar, dan interval restart terpenuhi.
- Penyimpanan atomik SQLite lokal atau PostgreSQL schema `spff_ai`, dengan snapshot audit append-only.
- Adapter read-only untuk memeriksa tabel SPFF; penulisan keputusan shadow `HOLD` dengan alasan integrasi.
- API health/readiness, konfigurasi, daftar keputusan, audit sumber, dan skenario simulasi.

## Batas implementasi saat ini

**Ini implementasi lokal untuk simulasi dan pemeriksaan integrasi, belum pengendali
pompa produksi.** Tidak ada command serial/MQTT atau penulisan ke `spff.control_commands`.
`ACTIVE` ditolak saat startup. Kontrak command existing hanya `set_pump` ON/OFF;
kontrak sesi volume, arbitrasi relay, bukti selector/E-stop, dan recovery perangkat belum terverifikasi.
Adapter sumber menahan semua eksekusi dan tidak menganggap kolom keselamatan yang hilang sebagai aman.

Simulasi menjalankan algoritma memakai data sintetis di database memori terisolasi per request;
hasilnya tidak masuk ledger data nyata. Endpoint evaluasi HTTP juga hanya dry-run terisolasi.
Feedback HTTP untuk perangkat nyata sengaja tidak disediakan. Pemrosesan feedback engine saat ini
hanya digunakan simulator, belum adapter feedback perangkat yang diotorisasi.

State disimpan sebagai dokumen JSON per device/zone dengan audit setiap perubahan,
bukan duplikasi tabel domain SPFF. Struktur ini sesuai prototype; histori tidak dipangkas
otomatis dan akan tumbuh. Sebelum operasi jangka panjang, normalisasikan histori/indeks
dan tambahkan kebijakan arsip. Pemulihan restart memblokir sesi yang masih RUNNING;
rekonsiliasi perangkat serta workflow review operator belum diimplementasikan.

## Config terpisah

- `.env`: port, mode, DSN sumber dan state, scope site/device/zone, serta polling.
- `config/simulation.json`: parameter AI bertanda `simulation_only=true`, kurva tandon,
  membership/rule Fuzzy, alpha EMA, freshness, level start/stop, dan cadangan flushing.
- Data tanaman/jadwal/mode existing tetap dimiliki SPFF; tidak ada jadwal operasional duplikat.
- Angka pada profil simulasi adalah ilustrasi prompt. Tidak diklaim terkalibrasi.
- Jangan mengubah konsentrasi stok saat kewajiban masih terbuka. Perubahan batch perlu
  pencatatan batch dan rekonsiliasi; fitur batch belum tersedia.

Untuk koneksi source, isi `AI_SOURCE_DSN` dengan role read-only yang terpisah. API tidak
menampilkan DSN. `/source/audit` melakukan transaksi read-only dan memeriksa schema dulu.
Tidak ada pembacaan otomatis file `.env` milik SPFF.

Untuk state PostgreSQL, migrator menerapkan `migrations/001_ai_state.sql` pada database
yang dituju, kemudian isi `AI_STATE_DSN` dengan role khusus AI. Tidak ada migrasi otomatis
saat startup. Gunakan hak akses yang dicatat di migration. `AI_POLL_ENABLED=true`
memerlukan kedua DSN dan SHADOW_MODE; interval default 10 detik. Polling saat ini
menyimpan keputusan HOLD kompatibilitas, belum mengeksekusi perencanaan real-data.

## Kebijakan yang eksplisit

- HST = selisih tanggal kalender WIB dari tanggal tanam; hari tanam HST 0, sesuai SPFF.
- Jadwal kalender yang terlewat: buat kewajiban approved yang jatuh tempo, urut tertua,
  maksimum rentang HST 1000; ini kebijakan simulator yang harus ditinjau sebelum live.
- Jadwal sensor existing tidak otomatis dijadikan kewajiban harian; menghasilkan HOLD.
- Beberapa kewajiban tidak digabung; keputusan mencatat antrean serta kebijakan konflik.
- Manual, emergency stop, fault, dan status eksekusi hilang mengunci kewajiban terbuka
  ke REQUIRES_REVIEW. Tidak ada auto-resume dari kondisi tersebut.
- ACK tidak pernah digunakan untuk mengklaim volume atau dosis selesai.
- Feedback hanya berupa hasil final volume per sesi, bukan selisih cumulative meter lintas reboot.
- Pengukuran tidak valid atau shutdown belum aman tidak boleh menyelesaikan kewajiban atau melatih EMA.

## Orange Pi

Minimum Python 3.10, termasuk Python bawaan Ubuntu 22.04. Salin project tanpa `.venv`
Windows. Buat venv Linux dan install memakai `pip install -e /opt/spff-ai` agar pip
memilih dependency yang sesuai versi Python dan arsitektur ARM64. `requirements.lock.txt`
mencatat environment Windows pengujian awal, bukan lock universal untuk Orange Pi.
Paket `tzdata` menyediakan kalender WIB. Template service memakai user `spff-ai`;
boleh diganti ke user Linux existing dengan menyesuaikan User/Group dan izin direktori. Siapkan direktori
`/opt/spff-ai/data`, dan environment `/etc/spff-ai/engine.env`. Unit contoh ada di
`deploy/spff-ai-engine.service`. Jalankan `python -m app` untuk memeriksa startup sebelum
memasang unit. Gunakan `curl -f http://127.0.0.1:5010/ready` untuk health check.
Tidak ada unit gateway yang diubah, dihentikan, atau diganti oleh service ini.

Lihat `docs/audit.md` dan `docs/verification.md` untuk temuan aktual serta bukti pengujian.

## Pemulihan instalasi Python 3.10

Jika checkout awal gagal dengan `requires a different Python`, ambil update branch
`codex/standalone-ai-engine`, salin `standalone-ai/pyproject.toml` ke `/opt/spff-ai/`,
lalu ulangi `sudo /opt/spff-ai/.venv/bin/python -m pip install -e /opt/spff-ai`.
Venv Python 3.10 yang sudah dibuat dapat dipakai kembali. Tidak perlu mengganti Python
sistem, menghapus venv, atau mengulang clone. Jalankan foreground dahulu sebelum
mengaktifkan systemd. Dukungan sintaks 3.10 dan resolusi wheel Linux ARM64 diperiksa;
runtime Orange Pi tetap perlu diverifikasi di perangkat.
