# Edge Gateway

Proses lokal yang menjembatani serial JSON Lines ESP32-S3 dengan broker MQTT Mosquitto. Service berjalan langsung pada Orange Pi agar memiliki akses stabil ke perangkat serial.

## Konfigurasi lokal

Dari root repository, buat broker, edge, dan worker environment dengan kredensial yang sama:

```bash
npm run mqtt:configure
```

Default aman memakai `SERIAL_ENABLED=false`. Di Linux, cari path stabil controller lalu perbarui `edge-gateway/.env`:

```bash
ls -l /dev/serial/by-id/
```

Gunakan path `/dev/serial/by-id/...` bila tersedia, bukan `/dev/ttyACM0` yang dapat berubah setelah reboot. User service harus menjadi anggota grup `dialout`.

## Menjalankan

```bash
npm run mqtt:up
npm run mqtt:smoke
npm run build:edge
npm run dev:edge
```

Setelah broker sehat dan firmware siap, set `SERIAL_ENABLED=true`. Setiap frame serial wajib berupa satu JSON object UTF-8 diakhiri newline (`\n`) dan mengikuti contract `@spff/contracts`. Default batas satu frame adalah 16 KiB.

Gateway subscribe command device, menolak command kedaluwarsa, dan mengirimnya ke serial setelah write benar-benar ter-flush. Telemetry/ACK/status dari serial divalidasi dan identitas `siteId/deviceId` harus sesuai konfigurasi gateway.

Gateway memublikasikan status offline retained saat serial tidak tersedia atau proses shutdown. MQTT Last Will menangani putus koneksi gateway yang tidak bersih. Store-and-forward disk outbox belum diimplementasikan, jadi pengujian jaringan tidak stabil masih menjadi tahap berikutnya.