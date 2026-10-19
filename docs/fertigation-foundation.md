# Program Fertigasi — Fondasi backend (simulasi saja)

## Kolom sumber pada form

Form tidak lagi meminta "Sumber aturan dan dosis". Metadata `sourceReference` tetap tersedia pada API tetapi opsional, dengan nilai kosong jika tidak diberikan. Saat program diperbarui tanpa sumber baru, repository mempertahankan sumber lama. Tidak ada sumber atau persetujuan yang dibuat otomatis. Persetujuan program tetap mengikuti alur yang sudah ada. Perubahan ini tidak memerlukan migrasi database.

## Pemicu sensor sepanjang rentang HST (migration 025)

Alur Rule-Based terbaru mengisi tanaman, tanggal tanam, rentang HST, dan ambang sekali saja. Form tidak lagi meminta tanggal aplikasi atau interval hari. Program yang disimpan memakai `applicationMode='sensor'` dan aktif sepanjang HST awal–akhir; rekomendasi penyiraman memerlukan kelembapan <= batas minimum. Untuk pupuk, syarat EC aturan juga harus dipenuhi. Tanggal tanam tetap dipakai menghitung HST menurut Asia/Jakarta.

Jalankan `025_fertigation_sensor_trigger.sql` setelah 024. Migrasi mempertahankan jadwal dan persetujuan program lama. Buka dan simpan ulang program lama untuk pindah ke pemicu sensor; perubahan tersebut mereset persetujuan. Mode once/interval tetap didukung untuk kompatibilitas data lama, tetapi tidak ditampilkan sebagai opsi pada form Rule-Based terbaru.

`triggerSampleCount` (1–20, awal 3) membutuhkan sampel telemetry berbeda berturut-turut, semuanya valid dan berumur maksimal 120 detik. Bacaan di atas ambang, hilang, atau invalid memutus konfirmasi; refresh HTTP tidak menambah hitungan. Jika telemetry jarang masuk, jumlah sampel harus sesuai jendela freshness. Pemeriksaan ini digunakan oleh evaluasi program maupun pemilihan otomatis.

Batas air per sesi dan target kelembapan tersimpan sebagai parameter. Pelaksanaan penghentian pompa, hysteresis saat sesi berlangsung, jeda meresap/mencampur, serta batas dosis harian belum diimplementasikan pada pelaksana Model 1. Evaluator tetap `canDispatch=false`; firmware lama tetap menjalankan pengaman dan kontrolnya sendiri. Tidak ada klaim penghematan air fisik sebelum pelaksana tersebut divalidasi.

## Jadwal aplikasi berulang (migration 024)

Setelah migrasi 020–023, jalankan `024_fertigation_recurring_schedule.sql` satu kali. Program lama tetap `applicationMode='once'` dengan tanggal aplikasi aslinya. Untuk sekali pengaturan, pilih jadwal berulang dan isi interval hari: 1 berarti setiap hari; 7 berarti HST awal, HST awal + 7, dan seterusnya hingga HST akhir. Perhitungan mengikuti kalender Asia/Jakarta dan tanggal tanam. Interval adalah konfigurasi pengguna, bukan rekomendasi agronomi bawaan. Hari terlewat tidak diulang secara otomatis. Mengubah jadwal mereset persetujuan sebagaimana perubahan program lainnya.

Form memiliki pilihan Air saja / Air dan pupuk. Pilihan pupuk membuka volume stok, nama pupuk, konsentrasi dan ambang EC; volume stok harus lebih dari nol. Program air saja disimpan dengan stok nol dan parameter pupuk kosong. Field pupuk tidak lagi menunggu pengguna mengubah volume stok sebelum dapat diketik.

Jadwal ini menentukan hari saat aturan dapat memberi rekomendasi. Ini belum merupakan pelaksana sesi, jaminan sekali per hari, atau pencatat dosis yang sudah dijalankan. `canDispatch` tetap false; firmware dan otoritas relay tetap mengikuti kontrol yang sudah ada.

## Pemisahan ambang Model 1

Model 1 dan pratinjau program menggunakan ambang kelembapan/EC dari aturan agronomi yang dipilih, bukan ambang kebutuhan tanaman pada konfigurasi Sensor-Based lama. Sensor yang digunakan masih mengikuti `water_sensor_key` perangkat. Pemeriksaan kesehatan/kesegaran sensor, level tandon, status online, mode otomatis, dan ACK revisi tetap berlaku. Endpoint evaluasi legacy tetap memakai ambang konfigurasi lama. Semua jalur ini tetap advisory-only; tidak ada perubahan otoritas relay atau firmware.

Tanggal tanam dan aplikasi dibaca dari PostgreSQL sebagai teks kalender `YYYY-MM-DD`, bukan timestamp UTC. Form administrasi internal memuat lima ambang agronomi; nilai kosong tetap null (draft belum lengkap), bukan angka default. Perubahan aturan tetap mereset persetujuan. Migrasi 023 tetap diperlukan; perbaikan ini tidak menambahkan migrasi baru.

Migration `020_fertigation_foundation.sql` introduces agronomic recipe metadata and session/event tables. No recipes are inserted by default; every recipe requires an agronomic source and explicit approval before a decision can be suggested.

## API
- `POST /api/fertigation/simulate` — authenticated operator/admin with CSRF; checks an existing recipe plus explicitly supplied observations; **advisory only**.
- `GET /api/fertigation/sessions?deviceId=...` — authenticated read-only session list, initially empty until device-origin session ingestion is implemented.

This release **does not ingest live session events**, create pump commands, publish MQTT, flash ESP32, or mark a device session as completed.

**Important**: simulated observations are supplied by the client and cannot be used to actuate hardware. The eventual production rule engine must load authenticated fresh sensor snapshots from PostgreSQL and fail closed on stale/invalid sensors, independent actuator safety, and unapproved dosing recipes. Device feedback must be authoritative for actual pump state. Record final counters before device reset.

Apply the migration *only after* review of database owner/permissions and backup on the Orange Pi. Do not automatically deploy or enable pump controls.

## Pengaturan Program Fertigasi (API saja, belum ada UI)
Run migration `021_editable_recipes_live_evaluation.sql` after migration 020 in a reviewed maintenance window. The service now supports:
- `GET /api/fertigation/recipes` — logged-in user, all recipes in active site.
- `POST /api/fertigation/recipes` — admin + CSRF, create draft. Body: `FertigationRecipeMutation` in `@spff/contracts`.
- `PUT /api/fertigation/recipes/:id` — admin + CSRF, requires `expectedRevision`. Any edit **resets approval**.
- `POST /api/fertigation/recipes/:id/approve` — admin + CSRF, `{expectedRevision,approvalReference}`, for agronomy-approved dosing only.
- `POST /api/fertigation/evaluate-site` — operator/admin + CSRF, body **only** `{recipeId,deviceId}`. No client-supplied sensor readings. Evaluates latest *single* telemetry sample, sensor health, device status and desired automatic mode from local PostgreSQL. Persists decision in `fertigation_evaluations`.

Always report `simulationOnly=true` and `publishable=false`. There is **no controller activation**. HST is calculated from `plantingDate` in Asia/Jakarta. `applicationDate` is a specific date, not a recurring schedule. No dosing is recommended when dates are missing. Device selector position is **not independently proven** by current status; approval from the UI cannot override hardware safety.

### Protokol demplot
The supplied workbook includes 6 crops: Ubi Jalar, Kacang Tanah, Jagung Manis, Terong, Buncis, Butternut Pumpkin. Units and methods vary (tabur, tugal, kocor, semprot). Do not automatically turn product gram/kg dose, solvent litres, or field total into Venturi stock targets. Keep agronomy protocol as reference until each recipe is converted and approved. No made-up values or auto-approval.

### Production prerequisites
- `npm run build`, `npm run lint`, `npm test`; migration review, permissions, and backup.
- Device-recorded volume feedback, session ingester, idempotent ACK/actual state, physical selector and measured flow calibration before enabling hardware control.
- Dynamic sensor freshness checks: currently 120s telemetry, 90s device status. Zero L/min is a legitimate idle reading; a stopped pump is not evidence of broken flow meter.
- The latest telemetry sample is used as a whole, not a cached last-known per-field value. Missing sample values cause DELAY.

## Integrasi Smart Soil → Rule-Based → strategi kontrol (migration 022)
- Jalankan `022_fertigation_smart_soil_binding.sql` **setelah** 020 dan 021 (backup dahulu, staging terlebih dahulu). Migration ini tidak mengubah konfigurasi legacy controller.
- Request pembuatan/perubahan resep kini mewajibkan `cropId` (ID katalog tanaman Smart Soil) di samping `cropName`. Nilai lama `cropId=NULL` tetap disimpan tetapi evaluasi menghasilkan `DELAY` hingga dipasangkan secara eksplisit.
- Scope zona saat ini khusus `soil-1`, sama dengan Smart Soil yang sudah ada. Tidak ada auto-mapping nama tanaman bebas untuk mencegah dosis salah.
- Evaluator membandingkan `cropId` dengan `spff.site_crop_selections.crop_id` dan membaca moisture dari sensor yang dipilih di Automatic Control, EC cairan, status kesehatan sensor, serta nilai ambang yang disetujui dalam konfigurasi yang sedang aktif.
- Pada resep air saja, kondisi moisture harus <= ambang bawah hysteresis. Untuk resep pupuk, moisture juga harus memenuhi kondisi tersebut **dan** EC cairan harus <= ambang bawah EC (dan tidak melewati batas tinggi). Ini merupakan gate konservatif tahap awal, bukan konversi otomatis agronomi.
- Status mode harus cocok dengan konfigurasi dan **ACK revision ESP32** terbaru; jadwal operasi yang terpasang di perangkat belum diverifikasi dalam evaluasi ini. Semua rekomendasi tetap `simulationOnly=true` dan `publishable=false`.
- Response menampilkan `controlStrategy.active='legacy_sensor'`, `deviceAuthority='esp32'`, `recipeMode='advisory_only'`, dan `canDispatch=false`. Firmware legacy adalah satu-satunya otoritas relay; **tidak ada dua pengendali yang bersaing**.
- Sensor yang hilang/stale, crop mismatch, pemilihan tanaman yang belum dikonfigurasi, atau recipe draft menghasilkan `DELAY`.
- **Masih dibutuhkan** kalibrasi sensor, pengukuran flow per sesi, interlock dan selector fisik, pengecekan schedule window aktual, validasi dosis dan mapping zona sebelum production closed-loop recipe mode bisa diaktifkan.

## Istilah untuk pengguna

Nama fitur yang ditampilkan kepada petani/operator adalah **Program Fertigasi**. Gunakan **Daftar Program Fertigasi**, **Buat Program Fertigasi**, **Ubah Program Fertigasi**, **Persetujuan Program Fertigasi**, dan **Evaluasi Program Fertigasi** pada UI nantinya. Nama internal database `fertigation_recipes`, `recipeId`, endpoint `/api/fertigation/recipes`, dan kontrak TypeScript tidak diganti demi kompatibilitas. Semua pesan HTTP untuk pengguna memakai istilah **Program Fertigasi**, bukan **Resep**.

## Automatic Control integration — staging only (migration 023)
- Migration `023_fertigation_program_thresholds.sql` adds nullable, validated per-program agronomic thresholds: `moisture_low_percent`, `moisture_target_percent`, `ec_low_us_cm`, `ec_target_us_cm`, `ec_high_us_cm`. NULL means **not approved/not set**, never silently copied from old settings.
- New backend endpoint `POST /api/fertigation/automatic-preview` (operator/admin with CSRF, `{recipeId,deviceId}`) returns the current strategy `legacy_sensor`, proposed `program_volume`, agronomic values, hold reasons, and **`canActivate:false`**. Nothing is written to `device_automatic_control_configs` or MQTT. This is deliberate safety behavior.
- Program input and versioned history now include moisture and EC agronomic thresholds. Operator need not manually re-enter them at every use; an agronomy-authorized admin defines them once in Program Fertigasi.
- Existing settings are still the legacy control thresholds. Device-level protections (tandon **in %**, max runtime, minimum flow, pulse/mixing/cooldown, interlocks) stay under authorized equipment configuration, not silently overridden by program data.
- A real `program_volume` implementation requires a new command and ACK contract, strategy arbitration and mutually exclusive relay ownership in ESP32, calibrated session volume counters, schedule/physical selector checks, and failure/restart persistence; **none are active here**.
- Validate migration 020–023 and run `npm run build`, `npm run lint` and `npm test` before merge; these were not executed in a checked-out repository in this environment.

## Automatic Control: Rule-Based Model 1 ONLY (19 October 2026)
- Fokus user: **Automatic → Rule-Based**, belum Random Forest. Tidak perlu halaman aktivasi `Program Fertigasi` terpisah.
- `GET /api/automatic-control/rule-based?deviceId=esp32-s3-01` membaca tanaman aktif site dari PostgreSQL, mencari **tepat satu** aturan agronomi approved yang cocok dengan tanggal/HST, lalu mengevaluasi data perangkat terbaru. Jika tidak ada/lebih dari satu kandidat, fail closed (`DELAY`).
- Resep/program di database sekarang diperlakukan sebagai **data aturan agronomi internal**; nama schema dan endpoint lama tetap dipertahankan demi kompatibilitas. Petani tidak memasukkan `recipeId` untuk keputusan Model 1.
- `canDispatch:false` selalu. Pemilih metode firmware **belum tersedia** di firmware Master 1.4.15. ESP32 masih menjalankan sensor-based scheduler/controller, sehingga model ini **belum benar-benar menggantikan controller itu** dan tidak boleh mengirim ON/OFF paralel.
- Sebelum eksekusi fisik: definisikan kontrol tunggal pada ESP32 (legacy vs rule-based), kontrak serta ACK mode/command dan expiry, selector fisik, safety tandon dalam persen (%), stop-on-fault, schedule validation, dan test broker + hardware. Tidak ada flash/deployment sekarang.

## Tahap 1 — Rule-Based sensor-health fail-closed (19 Oktober 2026)
- Backend mengevaluasi sensor terpilih berdasarkan `sensor_health[key].valid === true`, nilai numerik finite, dan batas fisik konservatif. `sensor_health` kosong, NULL, field hilang, dan `valid:false` semuanya menghasilkan status sensor tidak valid/keputusan `DELAY`.
- Berlaku untuk snapshot terbaru dan semua pembacaan berturut-turut dalam jendela konfirmasi 120 detik. Moisture dan level tandon dibatasi 0–100%; EC 0–100000 µS/cm; flow 0–10000 L/min.
- MQTT Worker tetap memproses telemetry lama menggunakan `deriveTelemetrySensorHealth`, termasuk `valid:true` untuk field yang dilaporkan tanpa status eksplisit dari device; backend hanya mempercayai status yang sudah tercatat di PostgreSQL, tidak membuat status sehat baru.
- Perubahan dibatasi di service evaluasi dan test. Tidak mengubah kontrol legacy pada ESP32, UI, schema, maupun MQTT. Jalur Model 1 tetap advisory-only (`canDispatch:false`).
- Sebelum deploy, cek versi migration, hasil status historis telemetry, `npm run build`, `npm run lint`, dan test dengan DB sesungguhnya.

## Tahap 2 — Read-only duplicate/repeat guard (19 Oktober 2026)
- Endpoint `GET /api/automatic-control/rule-based` sekarang membaca `spff.fertigation_sessions` dari PostgreSQL **sebelum** mengeluarkan status `suggested`. Jika bukti sesi gagal dibaca, request gagal; `evaluateAutomaticRuleBased` tanpa `repeatEvidence` menghasilkan `hold`.
- Perangkat masih satu-satunya sumber kebenaran status sesi: tidak ada catatan sesi sintetis dari evaluasi API. `started/running` (perangkat mana pun pada device) menahan aplikasi; `fault/aborted` dari program yang sama menahan retry sampai ada penanganan operator.
- Mode `once/interval` menolak duplikasi sesi pada tanggal aplikasi WIB, termasuk status yang belum selesai.
- Mode `sensor` setelah sesi completed memerlukan bukti moisture sehat mencapai target **setelah** sesi berakhir dan kemudian rangkaian sampel baru memenuhi ambang rendah. Jika riwayat recovery tidak tersedia, hasil `DELAY`; tidak memakai status moisture saat ini sebagai bukti pernah pulih.
- Sesi pupuk yang sudah completed pada perangkat pada tanggal WIB yang sama menahan dosis ulang lintas aturan.
- Riwayat yang tersedia hanya bisa membuktikan sesi yang memang sudah dikirim dan diingest ESP32; saat ini jalur device-origin session ingest **belum tervalidasi**. Karena itu pengunci ini tidak memberi jaminan at-most-once terhadap sesi yang tidak tercatat. Sebelum mengaktifkan aktuator wajib ada reservation atomik per aplikasi (`runId` unik), ACK perangkat, retry idempotent, dan uji restart/outage.
- Nilai `canDispatch:false` dan `simulationOnly:true` tetap berlaku. Tidak ada perubahan firmware, MQTT publish, UI, maupun deployment.
