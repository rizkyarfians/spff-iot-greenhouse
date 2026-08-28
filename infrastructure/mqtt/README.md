# SPFF local MQTT stack

Stack ini menjalankan Mosquitto sebagai broker lokal di Orange Pi. Edge gateway tetap berjalan langsung di host supaya dapat mengakses serial ESP32 secara stabil.

## Quick start

Persyaratan: Node.js 22, npm, Docker Engine, dan Docker Compose v2.

```bash
npm run mqtt:configure
npm run mqtt:up
npm run mqtt:smoke
npm run build:edge
npm run dev:edge
```

> **Safety:** `mqtt:smoke` memublikasikan command `set_pump` untuk menguji ACL dan jalur command/ACK. Jalankan hanya ketika Edge Gateway berhenti atau `SERIAL_ENABLED=false`. Jangan menjalankannya saat aktuator live.

`mqtt:configure` membuat tiga file `.env` privat dengan password acak dan tidak akan menimpa file yang sudah ada:

- `infrastructure/mqtt/.env`
- `edge-gateway/.env`
- `mqtt-worker/.env`

Serial tetap dinonaktifkan. Setelah port ESP32 sudah dipastikan, ubah `SERIAL_PORT` ke path stabil dari `/dev/serial/by-id/`, lalu set `SERIAL_ENABLED=true`.

```bash
ls -l /dev/serial/by-id/
sudo usermod -aG dialout spff
```

Logout/login diperlukan setelah mengubah membership grup `dialout`.

## MQTT identities dan ACL

| Identity | Publish | Subscribe |
|---|---|---|
| Edge gateway | telemetry, state, ACK, status milik device | command dan retained schedule milik device |
| Ingestion worker | command dan retained schedule milik device | telemetry, state, ACK, status semua device |
| Command API | command milik device | ACK milik device |
| Health check | tidak ada | `$SYS/broker/uptime` |

Anonymous connection dinonaktifkan. Telemetry, command, schedule, dan ACK menggunakan QoS 1. Status terakhir serta snapshot schedule retained; telemetry tidak retained. Broker menyimpan session dan queued QoS messages pada Docker volume `spff-mqtt_mqtt-data`.

## Rollout executor jadwal ESP32

Gunakan `SCHEDULE_EXECUTION_MODE=server` selama firmware masih dikembangkan. Dalam mode ini snapshot tetap dikirim dan disimpan ESP32, tetapi hanya Schedule Evaluator Orange Pi yang boleh mengeksekusi.

Setelah firmware berhasil mengirim `schedule_sync_ack: applied`, lakukan cutover pada maintenance window:

1. Set `SCHEDULE_EXECUTION_MODE=device` di environment MQTT Worker.
2. Restart `spff-mqtt-worker`.
3. Worker menaikkan revision karena authority berubah dan memublikasikan snapshot retained baru.
4. Pastikan log menunjukkan ACK `applied` untuk revision baru sebelum mengandalkan eksekusi offline ESP32.

Jangan menjalankan evaluator server dan executor ESP32 untuk jadwal yang sama. Mode `device` otomatis menonaktifkan Schedule Evaluator Orange Pi; manual command tetap berjalan.

## Operasi

```bash
npm run mqtt:up
npm run mqtt:logs
npm run mqtt:smoke
npm run mqtt:down
```

`mqtt:down` menghentikan container tanpa menghapus volume. Jangan memakai `docker compose down -v` kecuali data broker memang boleh dihapus.

Template systemd untuk Orange Pi tersedia di `infrastructure/systemd/`. Template mengasumsikan repository berada di `/opt/spff`, user service bernama `spff`, dan executable Node berada di `/usr/bin/node`.

## Batas keamanan dan verifikasi

Listener default bind ke semua interface agar API/dashboard LAN dapat mengakses broker. Batasi port 1883 dengan firewall ke subnet/perangkat tepercaya. Username/password MQTT tidak terenkripsi pada port 1883; gunakan listener TLS (`mqtts://`) sebelum melewati jaringan yang tidak tepercaya.

Smoke test memverifikasi jalur authenticated QoS 1 untuk telemetry, command, ACK, dan retained status. Pengujian serial dan perilaku pompa tetap harus dilakukan dengan ESP32 asli menggunakan prosedur aman di [panduan integrasi hardware](../../docs/hardware-integration-guide.md). Edge disk outbox, telemetry storage receipt, dan repository PostgreSQL worker belum termasuk pada tahap ini.
