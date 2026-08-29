# SPFF ESP32-S3 firmware 1.2.0 full sync

## Perbaikan utama

- Menerima `command` `set_pump`, melakukan relay readback, lalu mengirim ACK `accepted` dan final `completed`/`rejected`.
- Menerima full snapshot `schedule_sync` sampai 64 jadwal.
- Menyimpan snapshot secara satu blob ke NVS dan memverifikasi checksum saat boot.
- Mengirim `schedule_sync_ack` `applied`/`rejected` beserta revision dan jumlah jadwal tersimpan.
- Authority `server`: ESP menyimpan snapshot, tetapi Orange Pi mengeksekusi jadwal melalui command.
- Authority `device`: ESP mengeksekusi jadwal NVS lokal untuk `pump_water` dan `pump_fert`.
- Timer lokal legacy tidak lagi menimpa relay command backend.
- RX Serial mendukung frame JSON Lines sampai 16 KiB.

## Target build

- Board: Waveshare ESP32-S3-ETH-8DI-8RO / ESP32-S3 yang sesuai dengan board tersebut.
- Arduino ESP32 Core: 2.0.17.
- Serial USB CDC: 115200 baud.
- External library: `LiquidCrystal_I2C`.

Folder sketch dan file `.ino` sudah memakai nama yang sama. Compile di Arduino IDE, pilih konfigurasi board yang sama dengan firmware 1.1.7, lalu flash melalui USB atau buat application `.bin` untuk Web OTA.

## Verifikasi di Orange Pi

Setelah ESP reboot dan Serial kembali terhubung:

```bash
cd /opt/spff
sudo systemctl restart spff-edge-gateway spff-mqtt-worker
sudo journalctl -f \
  -u spff-edge-gateway \
  -u spff-mqtt-worker \
  -o cat
```

Schedule yang benar akan menghasilkan log:

```text
[edge] Schedule snapshot forwarded to ESP32 ...
[repository] schedule sync acknowledgement stored {
  revision: 1,
  status: 'applied',
  storedScheduleCount: 6
}
```

Tekan tombol pompa dari frontend. Command yang benar akan menghasilkan:

```text
[edge] Command forwarded to ESP32 ...
[repository] acknowledgement stored { status: 'accepted' }
[repository] acknowledgement stored { status: 'completed' }
[repository] actuator state stored { state: 'active' }
```

Cek versi firmware yang dilaporkan:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT site_id, device_id, firmware_version, recorded_at, received_at
FROM spff.latest_device_status
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01';
"
```

Cek status sinkronisasi jadwal:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT revision, published_revision, acknowledged_revision,
       acknowledgement_status, stored_schedule_count
FROM spff.device_schedule_sync_state
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01';
"
```

Cek command terakhir dan actual state yang dikembalikan ESP:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT c.command_id, c.actuator_key, c.requested_is_active,
       c.status, a.actual_is_active, a.reason,
       a.acknowledged_at, a.received_at
FROM spff.control_commands c
LEFT JOIN LATERAL (
  SELECT actual_is_active, reason, acknowledged_at, received_at
  FROM spff.command_ack_events
  WHERE command_id = c.command_id
  ORDER BY received_at DESC
  LIMIT 1
) a ON true
WHERE c.site_id = 'greenhouse-01'
  AND c.device_id = 'esp32-s3-01'
ORDER BY c.created_at DESC
LIMIT 10;
"
```