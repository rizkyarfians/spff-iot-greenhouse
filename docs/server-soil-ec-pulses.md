> Firmware `1.4.34-INDEPENDENT-AI` uses separate timed schedules and sensor-triggered AI. See [independent-soil-ec-ai.md](independent-soil-ec-ai.md). The schedule-window descriptions below apply to earlier firmware.

# Fertigasi pulse EC tanah — implementasi server

Status: implementasi staging, default OFF. Belum dikompilasi untuk board ESP32 atau diuji pada instalasi fisik. Tidak melakukan flash maupun deployment Orange Pi otomatis.

## Perilaku

Orange Pi memilih aturan disetujui untuk tanaman aktif zona `soil-1`, tanggal tanam/HST dan jadwal aplikasi. Aturan harus tunggal dan mempunyai EC mulai, target, serta batas tinggi. Data lama menggunakan label EC larutan: **nilainya tidak otomatis menjadi target EC tanah**. Sebelum sesi dibuat, admin wajib memverifikasi target dataset untuk sensor/metode EC tanah yang terpasang, serta memasukkan referensi kalibrasi. Evaluasi rekomendasi lama tetap memakai EC larutan dan tidak menjalankan sesi ini.

Sensor umpan balik adalah `soil_1_ec_us_cm`, bersama `soil_1_moisture` dan health tiap parameter. Nilai EC tanah tidak dikonversi menjadi liter atau gram pupuk. CH1 adalah booster Venturi langsung ke tanaman; posisi flow meter dan kebutuhan CH3 harus dibuktikan di instalasi. Debit hanya interlock aliran, bukan bukti volume stok terinjeksi.

Server menghitung:

```
error = targetEC - rataRataECtanahStabil
onDurationMs = clamp(round(Kp * error), minOnMs, maxOnMs)
```

Kp, batas pulse, waktu meresap, toleransi, batas cycle/runtime dan rentang moisture wajib berasal dari kalibrasi. Tidak ada nilai dosis bawaan. Ini kontrol proporsional berbatas dengan aturan keselamatan, bukan Random Forest, bukan model prediksi dosis pupuk. Contoh 400 → 1200 menghasilkan error 800 µS/cm; tes memakai Kp 10 sehingga pulse 8000 ms. Angka ini **hanya fixture pengujian**, bukan rekomendasi agronomi.

Satu pulse dikirim pada satu waktu. Setelah ACK `completed` dengan readback relay OFF, server menunggu `settleMs` sejak waktu penerimaan ACK di server, lalu menunggu 2–10 sampel berbeda yang benar-benar diambil setelah waktu tersebut. Sampel harus sehat, segar maksimal 120 detik dan stabil dalam rentang kalibrasi. Selisih EC berikutnya dihitung ulang; jumlah cycle tidak dipatok 4 dan target akhir tidak dibagi menjadi target kumulatif yang diasumsikan tercapai. Masing-masing pulse mempunyai durasi ON lebih kecil saat selisih mengecil, dibatasi minimum 1500 ms dan maksimum 30000 ms karena pemeriksaan flow lokal.

Semua sampel konfirmasi harus berada dalam toleransi target untuk menyelesaikan sesi. Tidak ada respons EC, EC menurun tak wajar/terlalu tinggi, kelembapan di luar rentang, tank/sensor invalid, batas cycle/runtime/hari, perubahan aturan/mode/jadwal/boot MCU, atau hasil pulse tak diketahui menghentikan sesi. Sesi dibatasi pada satu aplikasi per program/perangkat/hari WIB, sehingga sesi gagal juga tidak otomatis diulang hari itu. Rule dan profil sesi dibekukan untuk audit; perubahan revisi membatalkan sesi.

## Rantai eksekusi dan payload

API lokal → reservasi PostgreSQL → MQTT worker (QoS 1, non-retained) → edge serial → MCU → ACK perangkat → outbox edge → MQTT worker → PostgreSQL → evaluasi cycle berikutnya.

Contoh bentuk payload satu cycle (waktu/ID dan durasi adalah contoh, tidak bisa dipakai langsung):

```json
{
  "kind": "fertigation_pulse",
  "schemaVersion": 1,
  "siteId": "greenhouse-01",
  "deviceId": "esp32-s3-01",
  "bootId": "0123456789abcdef",
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "commandId": "00000000-0000-4000-8000-000000000002",
  "cycle": 1,
  "issuedAt": "2026-10-21T08:00:00.000Z",
  "expiresAt": "2026-10-21T08:00:15.000Z",
  "targetId": "pump_fert",
  "params": {
    "onDurationMs": 8000,
    "waterWithPulse": false,
    "minFlowLpm": 1,
    "flowSensorKey": "flow_fert_lpm"
  }
}
```

Cycle 2 dan seterusnya memakai `sessionId` sama, `commandId` baru dan `cycle` berurutan. Server menghitung kembali durasi setelah resap dan konfirmasi sensor; seluruh daftar pulse tidak dikirim sekaligus. MCU tidak menghitung target EC/HST/dosis atau memutuskan cycle berikutnya. MCU memeriksa expiry, boot, urutan, mode, jadwal, flow, freshness slave dan interlock yang sudah ada. RTC invalid menolak pulse. Durasi dipantau memakai `millis()` tanpa `delay(onDurationMs)`.

MCU menyimpan reservasi NVS sebelum relay ON. ID/payload identik mengulang ACK, bukan relay ON atau timer; ID sama dengan payload berbeda ditolak. Pulse terputus restart menjadi fault dan tidak dilanjutkan. Timer lokal dan pematian relay tidak bergantung koneksi server. Readback di sini adalah readback output relay, bukan pembuktian gerakan pompa atau volume pupuk fisik.

Database menyimpan runtime **yang diperintahkan/reserved**, tetap dihitung saat ACK hilang. Pengiriman ulang memakai command sama sampai expiry. ACK terminal tidak mundur menjadi accepted akibat pesan terlambat. Event ACK dideduplikasi per command/status. Tidak ada ACK palsu dari gateway.

## Kepemilikan relay dan operator

Sebelum mulai, nonaktifkan fertilizer sensor legacy dan tunggu config ACK applied. API serta MCU menolak pulse jika kontrol fertilizer legacy masih enabled; water legacy bisa tetap tersedia sebelum pulse pertama. Selama strategi server memiliki relay, otomatis sensor legacy diblokir; perintah manual ON juga diblokir. Interlock OFF tetap berjalan. Setelah selesai/stop/fault, kepemilikan tidak otomatis kembali ke legacy agar pompa tidak menyala di sela pengukuran atau sesudah kegagalan.

Panel Program Fertigasi menampilkan kalibrasi, status sesi, reservasi durasi ON, dan ACK pulse terakhir. Admin memulai sesi; operator/admin dapat stop. Status `cancelled` berarti stop diminta, **bukan bukti OFF**: periksa ACK command stop. Untuk kembali ke legacy: hentikan sesi, terapkan mode Manual sampai revision ACK applied, kemudian pilih **Lepas strategi pulse** dan verifikasi ACK release. Baru kemudian atur mode yang diinginkan. Bila stop/release timeout atau NVS fault, jangan anggap kepemilikan sudah lepas; perlu investigasi perangkat. API membaca riwayat 20 sesi terakhir.

## Komponen

- `packages/contracts/src/fertigationPulse.ts`: kontrak ketat dan fungsi keputusan murni.
- `functions/src/services/soilEcPulseService.ts`: pemilihan aturan, transaksi reservasi, loop 2 detik dan status sesi.
- `mqtt-worker/src/soilEcPulseTransport.ts`: retry command, expiry dan penyimpanan ACK.
- Edge meneruskan pulse tervalidasi dan ACK MCU melalui outbox.
- `026_server_soil_ec_pulses.sql`: sesi, command, ACK, indeks pengunci dan grants.
- Baseline kiriman pengguna tetap utuh: `firmware/SPFF_MASTER_1_4_28_SOIL_SINGLE_RX_DIAG/`.
- Versi gabungan: `firmware/SPFF_MASTER_1_4_29_SERVER_SOIL_EC_PULSE/` dengan `ServerSoilEcPulse.h` dan `PulseDeadline.h`.

API, di belakang login dan CSRF yang sudah ada:

| Metode/path | Hak akses | Tujuan |
| --- | --- | --- |
| GET `/fertigation/pulse-sessions?deviceId=...` | Login | Status dan command |
| POST `/fertigation/pulse-sessions` | Admin | `deviceId`, `recipeId`, UUID `requestId`, seluruh `profile` |
| POST `/fertigation/pulse-sessions/:id/stop` | Operator | Stop idempotent |
| POST `/fertigation/pulse-sessions/:id/release` | Admin | Lepas setelah Manual applied |

## Persiapan Orange Pi dan commissioning

1. Backup dan pastikan checkout/revisi yang benar. Terapkan hanya migration 026 bila 001–025 sudah ada, menggunakan role migrator/admin yang sesuai hardening DB (bukan runtime API). Tidak ada migration ledger otomatis di repo; jangan menjalankan ulang seluruh migration di produksi.
2. Build API, worker, edge, frontend dari commit yang sama. Flag `SPFF_SOIL_EC_PULSES_ENABLED=false` di API dan MQTT worker menjaga pulse tetap OFF. `AI_EVALUATION_ENABLED=false` juga menolak sesi baru dan membuat coordinator yang sedang berjalan menghentikan sesi. Coordinator dan pengiriman stop tetap berjalan setelah migration, termasuk saat flag OFF, agar sesi lama bisa dihentikan; pulse baru tidak dikirim. Mematikan flag lalu restart tidak menggantikan pemeriksaan ACK OFF.
3. Partner firmware harus compile sketch 1.4.29 dengan library, board/pin mapping dan partition NVS instalasi yang sebenarnya. Macro `SPFF_ENABLE_SERVER_SOIL_EC_PULSES` default `0`; status `serverPulseCapable` baru true saat macro `1`, storage sehat. Uji dulu dengan relay/pompa terisolasi; baseline 1.4.28 tidak memahami kontrak pulse baru.
4. Uji OFF deadline, duplikat/lost ACK, restart MCU/server/edge, MQTT terputus, RTC invalid, flow hilang, selector/interlock lokal, storage/readback gagal, jadwal ditutup dan mode berubah. Host harness tidak menggantikan full board build atau pengujian ini. Uji batas waktu loop firmware di board karena deadline diservis secara kooperatif.
5. Ukur respons EC tanah terhadap durasi pulse, waktu resap dan variasi moisture untuk tanaman/media/sensor terpasang. Pastikan target dataset memang EC tanah, bukan angka EC larutan. Verifikasi lokasi flow meter dan jalur Venturi/CH3, serta selector fisik. Server tidak mempunyai bukti langsung posisi selector fisik selain status/interlock firmware yang tersedia.
6. Setelah commissioning, aktifkan flag API/worker dan macro firmware, pastikan status fresh, mode Automatic applied dengan fertilizer legacy disabled dan jadwal ACK applied. Isi profil terverifikasi di panel. Tidak ada penjadwalan otomatis sesi baru: admin memulai satu sesi; cycle di dalamnya otomatis dihitung server.

## Pengujian software

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
```

Host firmware memerlukan `g++`; tes mengompilasi header handler produksi dengan stub IO/NVS. Jika CLI `tsx` di lingkungan sandbox gagal membuat IPC pipe, jalankan bagian TS worker dengan `node --import tsx --test mqtt-worker/test/*.test.ts` dari root (variabel dummy `DATABASE_URL`/`MQTT_URL` bila diperlukan). Ini tidak memerlukan broker atau database hidup.

Tes SQL integrasi opsional menggunakan PostgreSQL WASM dalam memori, bukan database produksi. Dependency dipasang terpisah dari lockfile aplikasi:

```sh
npm install --prefix /tmp/spff-pgtest @electric-sql/pglite@0.5.10
SPFF_TEST_PGLITE_MODULE=/tmp/spff-pgtest/node_modules/@electric-sql/pglite/dist/index.js node --test functions/test/soilEcPulse.integration.test.mjs
```

Build harus sudah selesai sebelum tes tersebut karena mengimpor output API/worker. Tes menerapkan semua migration pada database sementara, memeriksa idempotensi start, satu reservasi pulse, dispatch, identitas ACK, dedup ACK/late accepted, menunggu sampel baru, target stabil dan release hanya setelah Manual applied. Tanpa variabel ini, tes integrasi ditandai skipped, bukan diklaim lolos.
