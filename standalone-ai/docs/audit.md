# Audit compatibility — 31 Oktober 2026

Sumber dibaca dari `D:\SPFF`, branch aktif
`feature/fertigation-foundation-20261018`. Source SPFF tidak diubah. Archive ZIP
untracked milik pengguna tidak disentuh.

## Alur existing yang ditemukan di source

Dashboard → Express API → PostgreSQL `spff.control_commands` → MQTT Worker → broker →
Edge Gateway → ESP32. `mqtt-worker/src/commandDispatchService.ts` menerbitkan
`type=set_pump`, target pompa, dan `params.isActive`. Tidak ada target liter atau
rangkaian priming/injeksi/flushing pada kontrak tersebut. Mengirim dua ON tidak
memenuhi kebutuhan sesi fertigasi dan tidak digunakan oleh engine ini.

Gateway `edge-gateway/src/serialGateway.ts` adalah pemilik serial. Service Python
tidak mengimpor serial, tidak membuka tty/COM, dan tidak membuat koneksi MQTT.

## Data di source repository

| Kebutuhan | Struktur source existing |
|---|---|
| Sensor | `spff.telemetry_samples`, timestamp/message/sequence, level dan total flow terpisah |
| Sensor health | `sensor_health` dari migration 017 |
| Tanaman | `spff.site_crop_selections`, crop/zone |
| Program | `spff.fertigation_recipes`, revisions dan evaluations, migrations 020–025 |
| Jadwal | `application_mode=once/interval/sensor`, tanggal tanam/aplikasi dan HST |
| Mode | `device_automatic_control_configs`, desired/applied mode, revision dan ACK |
| Eksekusi | `fertigation_sessions`, `fertigation_session_events` |
| Relay/ACK | `actuator_state_events`, `command_ack_events`, `control_commands` |
| Interlock | `device_water_interlock_configs`, migration 027, firmware water-interlock policy |
| Planner | `fertigation_planner_profiles`, migration 029; existing planner selalu advisory |

Jumlah tanaman/dosis g per tanaman tidak boleh diasumsikan tersedia dari nilai contoh.
Program existing memiliki target liter stok dan konsentrasi g/L; kebutuhan gram dapat
diturunkan dari dua nilai tersebut jika keduanya valid. Profil baru untuk dosis per tanaman
perlu kontrak yang disepakati, bukan mengarang kolom di tabel lama.

`functions/src/services/fertigationSchedule.ts`: HST adalah selisih hari kalender WIB,
HST 0 pada tanggal tanam. Jadwal sensor adalah rentang aktif pemicu sensor; bukan
jadwal dosis wajib berulang. Dokumen `docs/adaptive-fertigation-planner.md` menegaskan
planner existing belum memberi izin dispatch.

## Database lokal yang benar-benar dibaca

Audit read-only berhasil terhadap database `spff`, role `spff_app`. Zona waktu sesi
database `Asia/Bangkok`; engine memakai kalender `Asia/Jakarta` secara eksplisit.
Tidak mengubah timezone database.

- `telemetry_samples`, `device_status_events`, `site_crop_selections` ada.
- `sensor_health` belum ada pada telemetry lokal.
- `fertigation_recipes`, `fertigation_sessions`, dan `device_automatic_control_configs`
  tidak ditemukan pada database lokal yang diperiksa.
- Script readiness SPFF juga melaporkan `device_schedule_sync_state` dan
  `schedule_sync_ack_events` belum ada, serta enam kolom sensor energi belum ada.
- Telemetry duplicate message groups = 0; aktuator terdaftar `pump_fert` dan `pump_water`.

Jadi schema DB lokal tertinggal dari source repository. Engine mengembalikan schema
incompatible/HOLD untuk kondisi ini. Tidak ada migration database operasional yang
diterapkan dalam pekerjaan ini. Urutan upgrade SPFF existing perlu mengikuti migrasi
SPFF, backup, dan pemeriksaan role, bukan menyalin ulang tabel dari project AI.

## Firmware

Source terbaru yang tersedia termasuk kandidat `1.4.35-AUTO-DIAG-FROM-1433`.
README-nya menyatakan kandidat belum terbukti identik dengan firmware yang berjalan.
Diagnostik `relayReady` bukan readback relay fisik. Engine tidak mengasumsikan dukungan
sesi berdasarkan nomor versi atau adanya telemetry saja.

Sebelum adapter ACTIVE dapat dibuat, kontrak perangkat perlu mendukung ID sesi unik,
deduplikasi, arbitrasi pengendali tunggal, priming dan bukti flow, target liter,
penghentian injeksi, cadangan flushing, stop reason, counter per sesi dan identitas
boot, hasil final tersimpan sampai ACK persistensi, serta rekonsiliasi restart.
Itu adalah kebutuhan ESP32 v2 yang perlu diuji; belum ada implementasi firmware atau flash.
