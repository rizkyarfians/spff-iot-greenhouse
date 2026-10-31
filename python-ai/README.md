# SPFF Adaptive AI Engine v1.0.0 — SHADOW_MODE

Engine evaluasi PostgreSQL lokal, **belum siap ACTIVE**. Semua hasil mempunyai
`execution_mode=SHADOW_MODE` dan `can_dispatch=false`. Tidak ada transport MQTT,
USB Serial, command ESP32, scheduler service, deployment atau migration runner.
Satu invokasi membaca snapshot, menghitung, menyimpan hasil, lalu keluar.

Laporan lengkap perubahan dan batas verifikasi: [STEP3_AUDIT.md](STEP3_AUDIT.md).

## Struktur

```text
python-ai/
  pyproject.toml / .env.example
  src/spff_ai/
    core.py          HST, freshness/health, prioritas, EMA dasar, Mass Balance
    fuzzy.py         membership configurable, MIN–MAX–centroid, jejak inferensi
    learning.py      EMA counter-backed, interval, outlier, reset latch, watermark
    adapters.py      interface safety/recovery/delivery dan implementasi konservatif
    config.py        environment; hanya SHADOW_MODE
    repository.py    query PostgreSQL, transaksi dan persistensi shadow
    __main__.py      satu evaluasi
  tests/             pure, static schema, repository dan transaction mocks
  examples/shadow_scenarios.py
```

## Test tanpa database/perangkat

Jalankan dari root repository (Python >=3.11):

```powershell
$env:PYTHONPATH = 'python-ai/src'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m unittest discover -s python-ai/tests -v
python -B python-ai/examples/shadow_scenarios.py
```

Pengujian dan contoh memakai standard library, tanpa membaca `.env`. Contoh
merupakan fixture sintetis; bukan bukti kondisi perangkat atau database nyata.

Untuk evaluasi database TEST yang telah dipersiapkan secara terpisah, pasang
package `python -m pip install -e ./python-ai`, lalu jalankan `spff-ai-shadow`.
Environment dimuat oleh pemanggil, tidak otomatis dari `.env`. Gunakan role khusus
shadow, jangan owner/API/worker. Berikan SELECT pada tabel domain yang dibaca;
SELECT/INSERT/UPDATE hanya pada tabel shadow yang benar-benar ditulis. Tabel
`adaptive_ai_session_links` hanya perlu SELECT untuk evaluator. Jangan berikan
hak menulis command, konfigurasi kontrol, atau sesi perangkat.

## Migration

Migration 034 adalah fondasi empat tabel shadow. Tambahan 035 menyediakan mapping
sesi-ke-kewajiban yang ditinjau, flow learning state, log feedback unik, sample
count/profile EMA, status perhitungan kewajiban dan unique key evaluasi.
Keduanya **belum diterapkan**. Tidak ada perubahan destruktif pada tabel existing,
trigger kontrol atau pemberian role otomatis. Database produksi tidak diakses.
Perlu uji migration lengkap sesuai urutan di database disposable yang terisolasi.

## Konfigurasi dan satuan Fuzzy

Input wajib Fuzzy hanya moisture parameter yang dipilih oleh `water_sensor_key`
dari konfigurasi perangkat. Suhu bukan input inferensi dan tidak wajib sehat.
Membership/rules serta kalibrasi opsional dibaca dari `FUZZY_PROFILE_JSON`.
Default `{}` berarti **NOT_CALIBRATED**: raw output persen simulasi, target liter
`null`. Skala contoh Step 2 sebesar 10 L dicabut. Environment lama
`IRRIGATION_MAX_L` ditolak; ceiling saja tidak membuktikan satuan zona.

Contoh konfigurasi kalibrasi **hanya untuk unit test**, bukan rekomendasi lahan:

```json
{"zone_id":"soil-1","full_scale_zone_l":1000,"max_zone_l":600,"calibration_reference":"TEST ONLY"}
```

Jika dan hanya jika profil kalibrasi lengkap, target adalah liter total satu
zona: `min(max_zone_l, full_scale_zone_l * demand_percent / 100)`. Tidak ada
perkalian dengan 2.000 tanaman/70 bedengan. Semua titik membership, rules,
keanggotaan, strengths, area, dan agregasi 101 titik tersimpan pada trace.

## Pembacaan data dan prioritas

Pembacaan memakai tabel mentah `telemetry_samples`, bukan last-known view yang
mencampur umur nilai. Setiap parameter dipilih dari sampel aktual sehat terbaru
dalam freshness window, dengan timestamp dan message ID asalnya. Tidak ada
relabel nilai lama sebagai telemetry baru. Health parameter harus `valid=true`,
finite, dan dalam rentang; `sensor_valid` global tidak menimpa health individual.
Timestamp adalah waktu pesan, bukan klaim waktu pembacaan register yang belum
tersedia. Sensor 1/2 divalidasi terpisah; program tetap terikat zone `soil-1`.

Prioritas: safety/manual -> sisa pupuk -> program HST jatuh tempo -> Fuzzy.
HST 0 adalah tanggal tanam, tanggal Jakarta UTC+7 konsisten backend. `once` dan
`interval` dibaca dari recipe database; mode `sensor` belum ditafsirkan sebagai
jadwal kalender. Program air saja, schedule aktuator enabled dan riwayat pulsa
EC tanpa liter ditahan sampai adapter terkait tersedia. Pemupukan tidak memakai
moisture/suhu/hujan sebagai gate kebutuhan, tetapi safety tetap wajib.

Safety default memerlukan envelope future `raw_payload.adaptiveAiSafety`:
`safe=true`, `emergencyStop/otaActive/shutdownFault/operatorStop/relayOwnerActive=false`,
`selectorMode=automatic`, dan `activeExecutionId=null`. **Firmware existing belum
menerbitkan kontrak ini.** Tidak ada produsen envelope yang dibuat atau status
aman palsu yang ditulis. Konfigurasi water interlock enabled dan ACK revision
harus sesuai; kedua pompa harus OFF dengan feedback segar. Default runtime
existing akan HOLD. `SafetyAdapter` dan `RecoveryAdapter` memungkinkan integrasi
terverifikasi kemudian; default fault/abort memerlukan review operator.

## EMA aktual

Air/pupuk memiliki state terpisah berdasarkan site/device/sensor. Sumber aktual
adalah delta counter liter dibagi interval waktu, dibandingkan debit L/min,
health dan state pompa terkait selama interval. Bukan estimasi hasil keputusan.
Default interval minimum 5 detik, outlier factor 3, alpha 0.2; dapat dikonfigurasi.

Watermark timestamp dan unique message ID mencegah double update. Count, profile,
state/baseline, reset latch dan setiap feedback accepted/rejected disimpan.
Reset/rollover counter mengunci learning sampai rekonsiliasi dan revision profil
baru. Bump `EMA_PROFILE_REVISION` setelah perubahan pompa/kalibrasi yang ditinjau;
revision konfigurasi perangkat juga memisahkan model. Perubahan profil tidak
mengulang sampel lama. Sampel nol saat OFF diabaikan, bukan fault pompa.

## Mass Balance dan kelanjutan

Identitas kewajiban UUID deterministik per site/device/recipe/hari aplikasi;
revision tidak membuat dosis baru. Snapshot recipe tidak diganti saat diedit.
Riwayat target/volume tidak dikurangi oleh keputusan shadow, EC, EMA, atau level
tandon. Bukti final memakai session ID unik, kedua volume aktual non-null,
pumps-off, serta kecocokan final event dengan row sesi materialized.

Pemetaan lintas hari menggunakan `adaptive_ai_session_links` yang ditinjau:
obligation ID, recipe revision, konsentrasi, rekonsiliasi counter, reviewer dan
referensi. Evaluator hanya membaca link. Tanggal sesi saja tidak cukup. Satu
kewajiban dapat menerima banyak sesi final dari beberapa hari. Duplikat identik
tidak dihitung dua kali; konflik volume/konsentrasi, bukti hilang atau tidak
terpercaya menghasilkan `REQUIRES_REVIEW` tanpa menimpa bukti lama.

`DELIVERY_EVIDENCE_COMPLETE=false` adalah default. Attestasi kelengkapan riwayat
seluruh device diperlukan untuk menganggap absence of evidence sebagai nol.
Itu tidak menghilangkan gate lain. Kewajiban shadow lama tetap dipertahankan;
jadwal baru tidak menimpa sisa lama. Hari terlewat tanpa sesi tidak direplay.

## Transaksi dan batas verifikasi

Satu transaksi REPEATABLE READ mencakup pembacaan, advisory xact lock per device,
ledger, flow state, feedback, dan decision. Unique constraints menjaga kewajiban,
bukti sesi, feedback dan fingerprint evaluasi. Input/hasil identik tidak membuat
row decision ganda. Perubahan waktu yang membuat data stale menghasilkan hasil
berbeda; timestamp evaluasi baru tidak sendirinya membentuk keputusan baru.
Serialization/deadlock mengulang seluruh transaksi maksimal tiga kali. Exception
lain rollback. Tidak ada mutex Python sebagai pengaman tunggal.

Pengujian nyata PostgreSQL, permission, konkurensi dua koneksi dan DDL belum
terverifikasi. Static checker bukan parser PostgreSQL penuh, dan mock transaksi
bukan bukti perilaku locking database. Query sesi/event/pulsa masih membaca
riwayat device; perlu paginasi/retention. Review link sesi, recovery fault,
kalibrasi zona/flow, konsentrasi tiap batch stok, safety envelope, arbitrase
jadwal dan executor volume firmware adalah pekerjaan lanjutan sebelum ACTIVE.
