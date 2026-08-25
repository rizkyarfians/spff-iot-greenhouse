# PostgreSQL SPFF

PostgreSQL lokal adalah source of truth SPFF. Semua timestamp domain menggunakan `timestamptz`; frontend menampilkan waktu Asia/Jakarta.

## Migration

Jalankan berurutan dan berhenti pada error:

### PowerShell / Windows

```powershell
psql -U spff_app -d spff -v ON_ERROR_STOP=1 -f infrastructure/postgres/migrations/001_initial_schema.sql
psql -U spff_app -d spff -v ON_ERROR_STOP=1 -f infrastructure/postgres/migrations/002_production_readiness.sql
psql -U spff_app -d spff -v ON_ERROR_STOP=1 -f infrastructure/postgres/migrations/003_transactional_outbox.sql
```

Untuk database yang sudah memiliki migration `001`, **jangan jalankan ulang 001**. Jalankan hanya migration yang belum pernah diterapkan. Karena repository belum memakai migration ledger, cek relation terlebih dahulu dengan `\dt spff.*` / `\dv spff.*` dan simpan catatan deployment.

Setelah seluruh migration selesai, hardening role harus dilakukan sebagai admin (`postgres`), bukan runtime role:

```powershell
psql -U postgres -d spff -v ON_ERROR_STOP=1 -f infrastructure/postgres/security/001_roles_and_grants.sql
```

Security script memindahkan ownership object dari runtime role ke `spff_owner` NOLOGIN dan memberi `spff_app` hanya role API. Setelah itu migration berikutnya harus dijalankan sebagai admin/role migrator yang boleh `SET ROLE spff_owner`.

## Runtime roles

Jangan simpan password di SQL/repository. Buat login dengan password kuat secara interaktif/admin, lalu grant role yang sesuai:

```sql
CREATE ROLE spff_worker LOGIN PASSWORD '<strong-secret>';
GRANT spff_worker_role TO spff_worker;

CREATE ROLE spff_sync LOGIN PASSWORD '<strong-secret>';
GRANT spff_sync_role TO spff_sync;

CREATE ROLE spff_backup LOGIN PASSWORD '<strong-secret>';
GRANT spff_backup_role TO spff_backup;
```

`spff_app` yang sudah ada mendapat `spff_api_role` dari security script. Runtime role tidak boleh Superuser/Create DB/Create Role.

## Relation production

Core:

- `spff.sites`
- `spff.devices`
- `spff.sensor_definitions`
- `spff.telemetry_samples`
- `spff.actuators`
- `spff.control_commands`
- `spff.command_ack_events`
- `spff.actuator_state_events`
- `spff.device_status_events`
- `spff.alarms`
- `spff.system_logs`

Schedule/settings:

- `spff.actuator_schedules`
- `spff.schedule_executions`
- `spff.site_settings`

Cloud replica:

- `spff.cloud_outbox`

Views:

- `spff.latest_telemetry`
- `spff.latest_actuator_states`
- `spff.latest_device_status`

## Transactional outbox

Trigger migration `003` membuat event outbox dalam transaksi yang sama dengan telemetry/command/status/alarm/schedule/settings. Sync Worker hanya membaca/update `cloud_outbox`; kegagalan Firebase tidak memblokir PostgreSQL, API, ingestion, atau dashboard lokal.

## Seed identitas hardware

Site/device/actuator bukan data dummy dashboard. Registrasikan hanya hardware yang benar-benar ada. Contoh berikut harus disesuaikan dengan commissioning:

```sql
INSERT INTO spff.sites (site_id, name)
VALUES ('greenhouse-01', 'Lokasi Utama')
ON CONFLICT (site_id) DO NOTHING;

INSERT INTO spff.devices (site_id, device_id, display_name, hardware_model)
VALUES ('greenhouse-01', 'esp32-s3-01', 'Controller Utama', 'ESP32-S3')
ON CONFLICT (site_id, device_id) DO NOTHING;

INSERT INTO spff.actuators
  (site_id, device_id, actuator_key, display_name, max_runtime_seconds)
VALUES
  ('greenhouse-01', 'esp32-s3-01', 'pump_water', 'Pompa Air', 900),
  ('greenhouse-01', 'esp32-s3-01', 'pump_fert', 'Pompa Pupuk', 900)
ON CONFLICT (site_id, device_id, actuator_key) DO NOTHING;
```

Nilai `max_runtime_seconds` hanya boleh ditetapkan setelah safety review hardware. Enforcement safety-critical tetap di ESP32.

## Audit

Setelah migration dan environment `functions/.env` benar:

```bash
npm run db:check
```

Audit manual yang berguna:

```sql
\dt spff.*
\dv spff.*
\du+
\dp spff.*
SHOW password_encryption;
```

Untuk Orange Pi, PostgreSQL idealnya bind ke `127.0.0.1`/network internal saja dan data directory harus berada di NVMe.
