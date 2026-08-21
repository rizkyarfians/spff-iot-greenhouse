# SPFF Production Readiness

Dokumen ini membedakan **siap secara source/config** dari **sudah tervalidasi pada perangkat nyata**. PostgreSQL lokal tetap source of truth; Firebase hanya replica opsional.

## Jalur data yang ditargetkan

```text
Sensor/Aktuator <-> ESP32-S3
ESP32-S3 <-> Serial JSON Lines <-> Edge Gateway
Edge Gateway <-> Mosquitto lokal (QoS 1)
Mosquitto -> MQTT Worker -> PostgreSQL lokal
PostgreSQL -> Local API -> React Dashboard
PostgreSQL -> cloud_outbox -> Sync Worker -> Firebase (opsional)
```

## Yang sudah diimplementasikan di source

- 28 sensor key tunggal di `@spff/contracts`, DB, worker, API, dan frontend.
- Telemetry QoS 1 idempotent via `(site_id, device_id, message_id)`.
- Edge durable disk outbox: message disimpan ke disk sebelum publish MQTT dan hanya dihapus setelah PUBACK broker.
- MQTT Worker menyimpan telemetry/status/ACK ke PostgreSQL dan melakukan graceful shutdown.
- Command lifecycle: API membuat `pending`, MQTT Worker publish, ESP32 ACK memperbarui status + actual actuator state.
- HTTP command memakai `commandId` untuk idempotency dan menolak command kedua yang masih in-flight.
- Command expiry/timed-out dan schedule command generation lokal.
- Schedule + system setting persisten di PostgreSQL; auto-schedule bisa dimatikan dari setting.
- Frontend tidak memakai fake telemetry/alarm/history; chart membaca histori PostgreSQL.
- Device status diturunkan menjadi `online`, `stale`, atau `offline` dari heartbeat/last seen.
- `/api/health` untuk liveness dan `/api/ready` untuk DB/schema readiness.
- Transactional outbox PostgreSQL dan Sync Worker Firebase dengan retry exponential, dead letter, dan version guard agar retry lama tidak menimpa replica baru.
- Least-privilege role template, Nginx reverse proxy, systemd service, dan backup PostgreSQL harian.
- Nginx production template memakai Basic Auth; authenticated username diteruskan sebagai `X-SPFF-User`, dan endpoint mutasi menolak bypass tanpa proxy identity saat `TRUST_PROXY_AUTH=true`. Gunakan TLS bila jaringan tidak tepercaya.
- Local health-check timer memeriksa API readiness, PostgreSQL, service utama, disk usage, backup age, dan due transactional-outbox depth via journald.

## Yang wajib divalidasi di mesin/hardware sebelum go-live

1. Jalankan migration `001`, `002`, `003` pada PostgreSQL target dan `scripts/check-postgres.mjs`.
2. Jalankan security script sebagai admin, lalu uji login runtime `spff_app`, `spff_worker`, `spff_sync`, dan backup role.
3. Uji broker asli dengan ACL, restart broker, reconnect, dan duplicate QoS 1.
4. Uji serial ESP32 asli: framing JSON Lines, reconnect USB/UART, payload rusak, sequence reset, dan watchdog.
5. Uji command pompa dengan beban nyata: pending -> published -> accepted/completed/rejected/timed_out; actual state harus berasal dari ESP32.
6. Uji backlog firmware ESP32. Edge outbox sudah durable, tetapi aturan **ESP32 hanya menghapus backlog setelah ACK server** tetap harus dibuktikan pada firmware/protokol nyata.
7. Uji max runtime, manual/automatic selector, dry-run/interlock, emergency/fail-safe pada ESP32.
8. Uji power loss Orange Pi + UPS, PostgreSQL recovery, dan NVMe mount.
9. Restore satu backup PostgreSQL ke database test; backup yang belum pernah direstore belum dianggap tervalidasi.
10. Jika Firebase dipakai, uji credential, offline cloud, retry, dead letter, dan akses remote. Jalur lokal harus tetap sehat saat internet putus.
11. Buat `/etc/nginx/spff.htpasswd`, aktifkan Nginx config, verifikasi mutation tanpa `X-SPFF-User` ditolak oleh API production, dan gunakan HTTPS/TLS bila LAN/Wi-Fi tidak sepenuhnya tepercaya. Basic Auth memberi satu kelas operator; kalau butuh multi-role granular, tambahkan RBAC lokal sebelum membuka kontrol ke banyak pengguna.
12. Aktifkan `spff-health-check.timer` dan verifikasi warning/failure muncul di journald saat sengaja mematikan satu service, memenuhi disk threshold test, dan membuat backup menjadi stale. Tambahkan notifikasi eksternal bila operasi benar-benar unattended.

## Definisi go-live lokal

Deployment lokal dapat dianggap siap go-live ketika item source/config di atas sudah terpasang dan item hardware 1-9 sudah lulus pada Orange Pi + ESP32 target. Tanpa validasi hardware, status yang benar adalah **production-ready code path, hardware not commissioned**.
