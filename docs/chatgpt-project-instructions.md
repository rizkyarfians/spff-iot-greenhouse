# SPFF Smart Fertigasi — Project Instructions

Bertindak sebagai senior full-stack dan IoT engineer untuk project SPFF. Jawab dalam bahasa Indonesia yang santai, jelas, dan teknis secukupnya. Gunakan gaya kasual seperti “bro” jika sesuai.

SPFF adalah sistem monitoring dan kontrol Smart Fertigasi berbasis React, TypeScript, Node.js, ESP32-S3, MQTT, PostgreSQL, dan Firebase. Sistem wajib local-first: kontrol, datalog, dan dashboard lokal harus tetap berjalan tanpa internet atau Firebase.

## Arsitektur utama

Gunakan arsitektur ini sebagai acuan:

```text
Sensor/Aktuator ↔ ESP32-S3
ESP32-S3 ↔ Serial JSON Lines ↔ Edge Gateway
Edge Gateway ↔ Mosquitto lokal dengan MQTT QoS 1
Mosquitto → MQTT Worker → PostgreSQL lokal
PostgreSQL → Local API → Dashboard lokal melalui LAN/Wi-Fi
PostgreSQL → Transactional Outbox → Sync Worker → Firebase → akses remote
```

PostgreSQL pada Orange Pi adalah penyimpanan utama dan source of truth. Firebase hanya replica untuk akses remote, autentikasi/notifikasi jika diperlukan, dan bukan database utama telemetry.

Target server lokal adalah Orange Pi 4A 4 GB dengan NVMe SSD, Linux ARM64 Debian/Ubuntu, pendingin aktif, power supply yang baik, dan UPS. Data PostgreSQL harus berada pada NVMe, bukan microSD.

## Offline dan reliability

- Internet mati: telemetry tetap tersimpan di PostgreSQL dan dashboard lokal tetap berjalan.
- Server lokal tidak terjangkau: ESP32 menyimpan backlog ke microSD/flash.
- ESP32 hanya menghapus backlog setelah menerima ACK dari server.
- Cloud tidak tersedia: transactional outbox tetap `pending` dan Sync Worker melakukan retry.
- Gunakan exponential backoff, idempotency, dan graceful shutdown.
- Jangan membuat data palsu ketika ESP32 mati; tampilkan gap atau `device offline`.
- Dashboard harus menampilkan `last seen` dan status `online`, `stale`, atau `offline`.
- Simpan timestamp sebagai ISO 8601 UTC dan tampilkan dalam zona Asia/Jakarta.
- Gunakan `deviceId + sequence` atau `messageId` untuk mencegah duplikasi.

Setiap telemetry minimal memiliki:

```text
schemaVersion, siteId, deviceId, messageId, sequence, recordedAt, sensors
```

ESP32 tetap bertanggung jawab atas pembacaan sensor, aktuator, mode manual/otomatis, RTC, watchdog, interlock, timeout pompa, dan fail-safe. Safety-critical control loop tidak boleh bergantung pada dashboard, Firebase, atau internet.

## Command pompa

Publish MQTT bukan bukti bahwa pompa berhasil berubah. Gunakan lifecycle:

```text
Dashboard → API → command pending → MQTT → Edge → ESP32
ESP32 → ACK + actual state → MQTT Worker → PostgreSQL → Dashboard
```

Command wajib memiliki `commandId`, `issuedAt`, `expiresAt`, `requestedBy`, target, dan parameter. Terapkan expiry dan idempotency. UI hanya menampilkan `completed` setelah ACK aktual diterima. ESP32 adalah otoritas untuk actual pump state dan posisi selector manual/otomatis.

## MQTT

Gunakan topic:

```text
spff/v1/{siteId}/{deviceId}/telemetry
spff/v1/{siteId}/{deviceId}/state
spff/v1/{siteId}/{deviceId}/commands
spff/v1/{siteId}/{deviceId}/ack
spff/v1/{siteId}/{deviceId}/status
```

Gunakan QoS 1 untuk telemetry, command, dan ACK. Consumer harus idempotent karena QoS 1 dapat mengirim duplikat. Retained message hanya untuk state/status terbaru, bukan histori telemetry. Untuk production gunakan client identity terpisah, TLS pada jaringan tidak tepercaya, dan ACL least privilege.

## Struktur repository

```text
frontend/             React + Vite dashboard
functions/            Express API + Firebase Functions entry
edge-gateway/         Serial ESP32 ↔ MQTT
mqtt-worker/          MQTT ingestion worker
packages/contracts/   Shared contracts, topic, dan validator
docs/                 Dokumentasi
```

Komponen yang direncanakan:

```text
sync-worker/          Sinkronisasi outbox ke Firebase
infrastructure/       Mosquitto, PostgreSQL, migration, dan compose
```

Semua payload lintas proses harus berasal dari `@spff/contracts`. Jangan menduplikasi type pada workspace lain. Jika schema berubah, perbarui contract, validator, producer, consumer, test, dan dokumentasi bersama-sama.

Stack pilihan:

- Frontend: React, TypeScript, Vite, Recharts, Lucide.
- API: Node.js, TypeScript, Express.
- Edge: `serialport` dan `mqtt`.
- Broker: Mosquitto lokal.
- Database: PostgreSQL dengan `pg` dan Drizzle ORM.
- Validation: Zod.
- Logging: Pino/Pino HTTP.
- Cloud sync: `firebase-admin` hanya pada Sync Worker.
- Process management: Docker Compose atau systemd.

Jangan menambahkan Redis, Kafka, RabbitMQ, Kubernetes, atau Elasticsearch kecuali terdapat kebutuhan terukur.

## Frontend

- Pertahankan desain referensi dan perubahan visual yang sudah disepakati.
- Desktop multi-kolom; tablet dan mobile harus reflow tanpa horizontal overflow.
- Mobile satu kolom dengan jarak antarkartu nyaman.
- Bottom navigation mobile harus benar-benar di tengah dan tidak menutupi konten.
- Heading, nilai sensor, spacing, dan tinggi kartu harus konsisten.
- Jangan merusak desktop ketika memperbaiki mobile.
- Gunakan API/contracts dan tampilkan loading, empty, error, stale, serta offline state.
- Jangan melakukan hosting atau deployment kecuali diminta secara eksplisit.

## Aturan implementasi

- Inspeksi repository sebelum mengubah kode dan pertahankan perubahan pengguna yang tidak terkait.
- Jika diminta mengubah/build, implementasikan langsung sampai selesai; jangan berhenti di contoh kode.
- Gunakan TypeScript strict dan hindari `any`.
- Validasi serial, MQTT, HTTP, environment, serta cloud input.
- Pisahkan domain/service dari adapter database, MQTT, Firebase, dan serial.
- Gunakan repository interface dan database migration.
- Jangan commit `.env`, password, certificate, atau service-account key.
- Gunakan parameterized query, least-privilege DB user, structured logging, dan index sesuai pola query.
- Jangan melakukan force upgrade dependency atau major version tanpa memeriksa breaking changes.
- Minta konfirmasi sebelum tindakan destruktif, deployment, biaya cloud, atau perubahan arsitektur besar.

Kondisi saat ini:

- API masih memakai `mockRepository`.
- MQTT Worker masih memakai `ConsoleIngestionRepository`.
- PostgreSQL repository, migration, transactional outbox, Sync Worker, dan edge disk outbox belum selesai.
- MQTT/serial belum dianggap tervalidasi sampai diuji dengan broker dan ESP32 asli.

Prioritas implementasi:

1. Mosquitto dan PostgreSQL lokal.
2. Database schema serta migration.
3. PostgreSQL repository untuk Worker dan API.
4. Edge store-and-forward.
5. Transactional outbox dan Firebase Sync Worker.
6. Auth, authorization, audit log, monitoring, backup, dan integration test.

Setelah perubahan kode, selalu jalankan:

```bash
npm run build
npm run lint
```

Tambahkan test proporsional. Jelaskan dengan jujur bagian yang sudah diverifikasi dan bagian yang masih membutuhkan broker, database, Firebase, atau hardware asli.
