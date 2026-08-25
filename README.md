# SPFF Smart Fertigasi Platform

SPFF adalah platform Smart Fertigasi local-first. PostgreSQL lokal di Orange Pi adalah source of truth; Firebase hanya replica opsional untuk akses remote.

## Workspace

```text
frontend/             React + Vite dashboard
functions/            Express Local API (+ legacy Firebase Functions entry)
edge-gateway/         Serial ESP32-S3 <-> MQTT + durable disk outbox
mqtt-worker/          MQTT ingestion + command/schedule dispatcher
sync-worker/          PostgreSQL transactional outbox -> Firebase
packages/contracts/   Shared payload/topic/validator
infrastructure/       PostgreSQL, Mosquitto, Nginx, systemd, backup
scripts/              Operational checks/smoke tests
```

## Development Windows/Linux

Install dependency dari root. Jangan membawa `node_modules` antar-OS/arsitektur.

```bash
npm install
npm run dev
```

`npm run dev` menjalankan contract watcher, frontend `http://localhost:5173`, dan Local API `http://localhost:5001`. Vite meneruskan `/api` ke API.

Untuk platform MQTT lokal:

```bash
npm run mqtt:configure
npm run mqtt:up
npm run mqtt:smoke
npm run dev:platform
```

`dev:platform` tidak menyalakan Firebase Sync Worker karena cloud replica bersifat opsional. Jalankan terpisah hanya bila credential Firebase sudah dikonfigurasi:

```bash
npm run dev:sync-worker
```

## PostgreSQL

Migration production saat ini:

```text
001_initial_schema.sql
002_production_readiness.sql
003_transactional_outbox.sql
```

Setelah migration, jalankan hardening role sebagai PostgreSQL admin:

```text
infrastructure/postgres/security/001_roles_and_grants.sql
```

Audit schema dari environment API:

```bash
npm run db:check
```

Endpoint operasional:

- `GET /api/health` — liveness API.
- `GET /api/ready` — PostgreSQL + schema/view/outbox readiness.
- `GET /api/bootstrap` — data dashboard dari PostgreSQL.

## Build, lint, test

```bash
npm run build
npm run lint
npm run test --workspace @spff/contracts
npm run test --workspace @spff/edge-gateway
```

Di Orange Pi lakukan fresh install (`npm ci`) supaya native dependency dibangun/diunduh untuk Linux ARM64. Jangan copy `node_modules` Windows.

## Command pump

Dashboard tidak melakukan optimistic actual-state update. Request membawa `commandId`, API menyimpan `pending`, MQTT Worker publish QoS 1, dan actual state hanya berubah dari ACK ESP32 yang disimpan ke PostgreSQL.

```text
Dashboard -> API -> PostgreSQL pending -> MQTT Worker -> Mosquitto -> Edge -> ESP32
ESP32 -> ACK + actual state -> Edge -> Mosquitto -> MQTT Worker -> PostgreSQL -> Dashboard
```

## Production deployment

Template Orange Pi tersedia di:

- `infrastructure/nginx/spff.conf`
- `infrastructure/systemd/`
- `infrastructure/backup/`
- `docs/production-readiness.md`

Template production Nginx sudah memakai Basic Auth dan meneruskan operator identity ke API; buat `/etc/nginx/spff.htpasswd` secara lokal dan gunakan TLS bila jaringan tidak tepercaya. Commissioning hardware tetap wajib sebelum kontrol pompa dianggap go-live. Tidak ada deployment yang dilakukan otomatis oleh repository ini.


## Hardening runtime Orange Pi

- API production bind ke `127.0.0.1`; akses LAN melewati Nginx.
- Nginx production membutuhkan `/etc/nginx/spff.htpasswd`. Contoh pembuatan di Orange Pi: `sudo apt install apache2-utils && sudo htpasswd -cB /etc/nginx/spff.htpasswd operator`. Jangan simpan file password di repository.
- `spff-health-check.timer` menjalankan health check lokal tiap 5 menit; lihat hasil dengan `journalctl -u spff-health-check.service`.
- Basic Auth tanpa HTTPS hanya layak di LAN yang benar-benar tepercaya. Untuk jaringan tidak tepercaya gunakan TLS.
