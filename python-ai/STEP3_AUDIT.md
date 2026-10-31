# STEP 3 — Integrasi Database dan Validasi AI

Branch: `feature/python-adaptive-ai-engine`. Semua keputusan SHADOW_MODE dan
can_dispatch=false. Tidak ada command, USB Serial, perubahan gateway/worker/
firmware/relay, database produksi, migration yang diterapkan, deployment,
commit atau push.

## A. PostgreSQL

**Integrasi PostgreSQL nyata belum terverifikasi.** `psql`, `postgres`, Docker
tidak ditemukan pada PATH; direktori instalasi standar PostgreSQL yang diperiksa
juga tidak ditemukan. Inventaris service Windows tidak dapat diakses. Tidak ada
upaya koneksi ke database existing, pembacaan kredensial produksi atau instalasi
server. Dependency psycopg tidak tersedia pada interpreter pengujian. Karena
fallback statis/mock diizinkan, semua validasi dilakukan tanpa database nyata.

### Query dan kontrak skema

Audit `repository.py`, `core.py`, `adapters.py`, serta migration 001–035:

| Operasi reader/writer | Sumber skema | Hasil audit |
| --- | --- | --- |
| Device enabled/site/device | 001 `devices` | Nama, identitas, boolean tersedia |
| Telemetry mentah, waktu, health, total/debit | 001,017,018 `telemetry_samples` | Field dan unit cocok; sensor_health JSONB |
| Status online/mode/firmware/raw payload | 001 `device_status_events` | Mode manual/automatic dan timestamp tersedia |
| Desired/applied mode, revision, water_sensor_key | 013,014,019 | Cocok; ACK revision harus identik |
| Crop/zone dan recipe HST/revision | 011,020–025 | Cocok; tanggal DATE, revision integer, target double |
| Sesi final dan event payload | 020 `fertigation_sessions`, `fertigation_session_events` | Cocok; event final dibandingkan dengan row sesi |
| Schedule aktuator/pulse owner | 002,026,032 | Terpisah dari kalender recipe; belum diambil alih Python |
| Actuator state/interlock | 001,027 | Field state/is_active/recorded_at dan ACK interlock cocok |
| INSERT/read kewajiban, evidence, EMA, decision | 034 | Nama/kolom/FK/unique sesuai definisi migration |
| Link sesi reviewed, flow state, feedback, calculation, evaluation_key | 035 | Tambahan shadow; diperlukan sebelum runtime versi ini |

`latest_telemetry` dan `latest_device_status` diperiksa definisinya. Reader tetap
memilih tabel mentah. View last-known telemetry tidak membuktikan freshness
setiap nilai. Tidak ditemukan salah nama tabel/kolom pada query Step 2 terhadap
migration yang tersedia; masalah yang diperbaiki terutama semantik pembacaan,
korelasi, satuan, pembelajaran dan idempotensi.

Static checker menginventarisasi 30 literal SQL query/transaksi (serta ada
statement SET LOCAL timeout), memeriksa semua relasi dan kolom INSERT terhadap
catalog yang diekstrak dari CREATE TABLE/ALTER ADD COLUMN. Ini **bukan parser
PostgreSQL penuh**, tidak memvalidasi execution plan/permission atau semua
constraint secara runtime. `core.py` dan `adapters.py` tidak menjalankan SQL.

### Perbaikan pembacaan

- Parameter sehat terbaru dipilih dalam window freshness; timestamp dan message
  ID asal disimpan per parameter. NULL/invalid/stale tidak menjadi nilai sah.
- Health individual menjadi sumber validitas; global sensor_valid tidak
  menggugurkan sensor 2 sehat hanya karena sensor 1 gagal, dan tidak bisa
  mengesahkan parameter yang health-nya invalid.
- Soil 1/2 moisture/temp/EC/pH, EC larutan, pH larutan, suhu udara, level kedua
  tandon, debit dan total kedua jalur mempunyai rentang eksplisit. Unit moisture/
  level %, suhu °C, EC µS/cm, debit L/min dan total L sesuai schema.
- Counter dipantau reset/rollover pada jalur learning. Untuk volume dosis sesi,
  review rekonsiliasi counter tetap wajib, bukan disimpulkan dari level tandon.
- Jadwal berasal dari row recipe PostgreSQL: planting/application date, HST,
  interval, application mode, revision, site/crop/zone; scope device berasal dari
  query konfigurasi, telemetry, sesi, dan kewajiban. Recipe sendiri bersifat site/
  zone/crop, tidak memiliki device_id; kewajiban menambahkan device scope.
- HST memakai tanggal Jakarta UTC+7, sama dengan helper backend. Uji batas UTC
  16:59:59.999999 ke 17:00 membuktikan pergantian tanggal WIB.
- Jadwal sensor dan program air saja belum mempunyai completion/trigger adapter;
  menghasilkan HOLD, tidak diganti jadwal hardcoded.

### Transaksi dan migration

034 tidak diubah pada Step 3. Migration baru 035 hanya menambah tabel/kolom/index
shadow. Tidak ada destructive DDL atau perubahan tabel domain existing.

Semua persistensi berada dalam transaksi REPEATABLE READ dengan advisory xact
lock per site/device. Snapshot stale pada instance bersaing dapat ditolak oleh
PostgreSQL; retry seluruh transaksi maksimal 3 kali untuk serialization/deadlock.
Unique key melindungi kewajiban, bukti session ID, feedback message/channel, dan
fingerprint decision. Fingerprint menyertakan input, konfigurasi engine tanpa
DSN, hasil/alasannya dan model; evaluasi identik setelah restart dibaca kembali
sebagai row yang sama. Kesalahan akhir rollback ledger, state, feedback dan
keputusan. Jejak numerik korup dicatat sebagai marker audit, bukan JSON NaN.

Mock menguji orchestration SQL reader/write/read-back, restart dedup, rollback,
dan retry yang disimulasikan. **Belum diuji:** penerapan migration, koneksi nyata,
permission least privilege, SQL runtime, FK/unique aktual, dua koneksi paralel,
lock/deadlock nyata, restart proses terhadap database persisten dan beban data.

## B. Fuzzy Mamdani

### Input dan membership default

Input inferensi hanya moisture dalam %. Suhu sengaja tidak menjadi input wajib
atau rule pada Step 3; argumen temperature lama diabaikan dan trace menyatakan
`temperature_used=false`. Ini menghilangkan pengaruh suhu yang tidak konsisten
pada rule Step 2 dan ketergantungan sensor suhu yang belum sehat.

Semua membership dapat dikonfigurasi lewat `FUZZY_PROFILE_JSON`. Titik berikut
merupakan **profil simulasi**, belum ambang agronomi final.

| Variabel / himpunan | Bentuk | Titik (x, membership) |
| --- | --- | --- |
| Moisture LOW/kering | left shoulder | (0,1), (20,1), (50,0), (100,0) |
| Moisture MEDIUM | triangle | (0,0), (25,0), (50,1), (75,0), (100,0) |
| Moisture HIGH/basah | right shoulder | (0,0), (50,0), (80,1), (100,1) |
| Output OFF | left shoulder | (0,1), (10,0), (100,0) |
| Output LOW | triangle | (0,0), (10,0), (25,1), (40,0), (100,0) |
| Output MEDIUM | triangle | (0,0), (25,0), (50,1), (75,0), (100,0) |
| Output HIGH | triangle | (0,0), (60,0), (80,1), (100,0) |

Aturan default seluruhnya:

1. IF moisture LOW THEN demand HIGH.
2. IF moisture MEDIUM THEN demand MEDIUM.
3. IF moisture HIGH THEN demand OFF.

Himpunan output LOW disediakan untuk profil rule terkonfigurasi, tidak dipakai
oleh tiga rule default. Tidak ada rule tersembunyi berbasis hujan, pupuk atau HST.
Fuzzification piecewise linear, implication MIN, aggregation MAX, defuzzification
centroid diskret pada x=0..100 dengan langkah 1. Jika tidak ada area/rule aktif,
hasil NO_RULE_ACTIVE -> HOLD dengan target null. Output negatif/di luar rentang
konfigurasi ditolak/dibatasi. Saat hanya rule OFF aktif, centroid mentah tetap
tersimpan (3 pada OFF penuh), demand akhir dipetakan 0 secara eksplisit.

### Contoh moisture 30%

- LOW = (50-30)/(50-20) = 0.6666667.
- MEDIUM = (30-25)/(50-25) = 0.2.
- HIGH = 0.
- Output HIGH di-clip 0.6666667, MEDIUM di-clip 0.2; OFF/LOW nol.
- Agregasi MAX pada 101 titik mempunyai area 24.6666667.
- Centroid = 70.1364865, satuan **persen dimensionless simulasi**.
- Kalibrasi default NOT_CALIBRATED; target_water_zone_l=null, target_unit=null.

Angka Step 2 sekitar 7.014 L berasal dari centroid dikalikan ceiling simulasi
10 L. Tidak ada bukti bahwa angka itu per tanaman, bedengan, atau zona. Klaim
liter tersebut dicabut. `IRRIGATION_MAX_L` lama ditolak agar konfigurasi lama
terdeteksi, bukan diam-diam dianggap kalibrasi.

Hanya profil dengan full_scale_zone_l, max_zone_l, zone_id dan referensi
kalibrasi lengkap menghasilkan `min(max_zone_l,full_scale_zone_l*demand/100)`
dalam **liter total satu zona**. Tidak dikalikan jumlah tanaman atau bedengan.
Semua output tetap shadow. Jejak menyimpan membership/rules/profile, derajat
keanggotaan, strength, 101 titik aggregate, area, centroid dan referensi.

Fuzzy tidak dijalankan saat ada kewajiban pupuk. Moisture basah tidak membatalkan
pemupukan. Suhu/pH/EC bukan gate agronomi baru yang dikarang. Kondisi keselamatan
independen tetap dapat menahan semua keputusan.

## C. EMA

`EMA_new = alpha*actual + (1-alpha)*previous`, default alpha=0.2 dan valid `(0,1]`.
Inisialisasi memakai actual pertama yang memenuhi bukti interval. Air dan pupuk
terpisah berdasarkan site/device/sensor, dengan sample count, timestamp, profile
revision dan audit accepted/rejected per message.

Actual berasal dari `(total_l_current-total_l_baseline)*60/interval_seconds`;
instantaneous L/min harus sehat dan masuk akal terhadap delta. State pompa
aktif terverifikasi harus mencakup interval. Default interval >=5 detik; stream
lebih cepat mengumpulkan baseline, bukan selamanya ditolak. Counter health
hilang, outlier, interval tak tercakup, stale/future, nol OFF dan replay tidak
melatih EMA. High-water counter tetap disimpan saat sampel invalid agar reset
tidak tersembunyi oleh celah data. Reset/rollover melatch review sampai revision
profil yang sudah direkonsiliasi. Revision konfigurasi perangkat memisahkan
model; kalibrasi/pompa diganti harus menaikkan EMA_PROFILE_REVISION.

Contoh deterministik yang diuji: previous 7 L/min, actual 6 L/min, alpha .3 ->
6.7 L/min. Durasi 100 L / 6.7 = 14.925373 menit (895.522388 detik).

Unique feedback `(site,device,sensor,message_id)` dan watermark mencegah update
dobel saat evaluasi ulang/restart. Model lama tetap bisa diaudit, tetapi estimate
stale/reset/profile lama tidak ditawarkan sebagai debit aktual segar. EMA tidak
mengurangi dosis atau menjadi bukti completion.

## D. Mass Balance

Rumus eksplisit pada `fertilizer_dose` dan `mass_balance`:

- target_g = plant_count * dose_g_per_plant.
- concentration_g_per_l = fertilizer_mass_g / FINAL_stock_volume_l.
- delivered_g = actual_stock_l * concentration_g_per_l.
- remaining_g = max(0,target_g-cumulative_delivered_g).

Uji wajib: 2.000 tanaman * 2.5 g = 5.000 g; 5.000 g / volume akhir 200 L =
25 g/L. Penyaluran aktual 100 L = 2.500 g, tersisa 2.500 g / 100 L stok.
Jumlah tanaman/dosis per tanaman belum otomatis dipetakan dari field recipe
existing; helper menerima input eksplisit. Runtime tetap memakai target_stock_l
dan konsentrasi recipe yang disnapshot, tidak mengarang plant_count.

Bukti fisik final disimpan satu kali berdasarkan source_session_id. Replay
identik tidak mengurangi sisa lagi. Row sesi wajib cocok final event (status,
waktu, actual air/stok, pumps-off), identity site/device/recipe dan link reviewed.
Link mengikat obligation ID, revision, konsentrasi, counter reconciliation dan
referensi/reviewer. Link dibuat di luar evaluator melalui workflow review yang
belum dibangun; tidak ada mutasi sesi perangkat atau pengakuan counter otomatis.

Bukti interrupted dapat memperbarui neraca jika final/reconciled, tetapi target
kewajiban tetap OUTSTANDING sampai seluruh volume tercapai. Fault/abort tidak
menjadi izin resume; RecoveryAdapter default menahan. Volume tidak terpercaya,
perubahan konsentrasi/revision, atau konflik final evidence -> REQUIRES_REVIEW.
Bukti lama tidak ditimpa. Kalkulasi status dan balance tersimpan pada tabel
kewajiban dan decision. Level tandon bukan pengukuran gram presisi.

Satu obligation ID menerima sesi-1 pada HST10 dan sesi-2 pada HST11 dengan link
yang sama. Hari pengisian ulang tidak membuat obligation baru. Kewajiban baru
jadwal berikutnya boleh tersimpan sebagai proyeksi shadow, tetapi tidak menimpa
kewajiban lama dan tidak mendapat prioritas di atas sisa dosis.

## E. Hasil pengujian dan skenario

**68 tes lulus, 0 gagal pada verifikasi akhir.** Test suite mencakup:

- Fuzzy dry/medium/wet, NULL/NaN/range, konfigurasi membership/rules, overlap,
  no-rule, seluruh grid moisture, target ceiling, unit dan calibration guard.
- EMA numerik wajib, count, replay/restart, channels terpisah, interval, OFF,
  outlier, future/stale, pump coverage, reset dan reset yang diselingi data invalid.
- Mass Balance duplicate/conflict/overshoot, contoh gram/liter, revision dan
  konsentrasi, kecocokan final event, partial, multi-session lintas hari.
- Mode/manual/safety, waiting/refill, priority debt, HST dan batas tengah malam WIB.
- Static schema/query checks dan full repository transaction mocks.

| Skenario sintetis | Hasil |
| --- | --- |
| HST1, moisture 30%, tanpa pupuk | NOT_CALIBRATED; raw 70.1365%, target liter null |
| HST2, moisture 95% | NO_WATER_NEEDED; demand 0 |
| HST10, moisture 95%, pupuk due | SCHEDULED_FERTIGATION; Fuzzy tidak dijalankan |
| HST10, air 10%, sudah tersalur 100 L | WAITING_FOR_WATER; obligation ID tetap |
| HST10, air cukup kembali | RESUME_FERTIGATION; sisa 100 L/2.500 g |
| HST11, sisa masih ada | RESUME_FERTIGATION pada obligation ID yang sama |
| HST11, dua sesi masing-masing 100 L | COMPLETED; sisa 0 |
| Sensor invalid atau safety belum terbukti | status HOLD |
| Mode Manual | MANUAL_HOLD; can_dispatch=false |
| Replay/Restart | Tidak menggandakan obligation/evidence/feedback/decision identik |

Contoh merupakan boundary simulation dengan asumsi safety/recovery/evidence
tersurat, bukan klaim bahwa firmware sudah menyediakan kontrak tersebut.

### File Step 3

Baru: migration 035; `src/spff_ai/fuzzy.py`, `learning.py`;
`tests/test_step3.py`, `test_schema_contract.py`, `test_transaction_mock.py`;
dan laporan `STEP3_AUDIT.md` ini.

Diubah: `core.py`, `repository.py`, `adapters.py`, `config.py`,
`tests/test_engine.py`, `tests/test_repository.py`, `.env.example`,
`examples/shadow_scenarios.py`, `README.md` dalam python-ai.

Artefak Step 2 masih berada di working tree belum commit: migration 034,
package/init/CLI serta perubahan README root dan .gitignore. Tidak dibuat commit.

## F. Rekomendasi Step 4

Fondasi siap untuk review dan penyusunan pengujian integrasi terisolasi berikutnya,
**belum siap mengaktifkan kontrol pompa**. Verifikasi PostgreSQL nyata adalah
prasyarat yang belum selesai, termasuk seluruh migration, role, concurrency,
rollback/restart dan load/retention. Query riwayat sesi/event/pulsa masih perlu
paginasi untuk device dengan riwayat besar.

Data kalibrasi zona yang diperlukan: definisi satu zona/jaringan drip yang aktif
bersamaan, debit aktual total pada tekanan kerja, distribusi/emitter dan
keseragaman 70 bedengan, volume terukur untuk perubahan moisture, batas volume
per aplikasi, pilihan sensor representatif, profil media/tanaman dan referensi
agronomi. Sekitar 2.000 tanaman/70 bedengan adalah konteks, bukan faktor pengali
otomatis. Diperlukan pula kalibrasi kedua flow meter, reset/epoch counter,
konsentrasi tiap batch stok berdasarkan volume akhir, dan bukti rekonsiliasi.

Dependency belum tersedia: safety/selector/emergency-stop/active execution
normalization, workflow reviewed session links, recovery fault, arbitrase
schedule/manual, trigger sensor dan completion program air saja, serta kontrak
executor firmware volume/pre-water/injeksi/flushing dan pause/resume fisik.
Tidak ada dependency tersebut yang diaktifkan atau disimulasikan sebagai aman
pada database existing. Seluruh hasil tetap SHADOW_MODE.
