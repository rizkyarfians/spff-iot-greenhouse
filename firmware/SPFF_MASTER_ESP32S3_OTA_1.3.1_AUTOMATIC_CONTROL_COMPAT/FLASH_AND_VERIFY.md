# SPFF ESP32-S3 firmware 1.3.1 automatic control compatibility fix

Firmware ini menambahkan kontrol otomatis di ESP32 tanpa menghapus protocol
manual control dan schedule sync dari versi 1.2.1.

Patch 1.3.1 menerima payload lama yang masih membawa
`minTankLevelPercent`. Nilai tersebut divalidasi 0-100 tetapi belum dipakai
sebagai interlock. ACK tetap `applied` dengan reason
`tank_level_ignored`, sehingga switching Manual/Automatic tidak gagal.

## Fitur utama

- Menerima `automatic_control_sync` dari Orange Pi melalui USB Serial.
- Memvalidasi site, device, revision, mode, threshold, runtime, cooldown,
  jumlah sample, dan batas stale sensor.
- Menyimpan konfigurasi terakhir ke NVS dengan checksum.
- Mengirim `automatic_control_ack` berstatus `applied` atau `rejected`.
- Melaporkan mode yang benar melalui `device_status.mode`.
- Mode `manual`: command ON/OFF dan schedule berjalan seperti sebelumnya.
- Mode `automatic`: command ON manual ditolak dengan reason
  `automatic_mode`; command OFF tetap diterima sebagai emergency stop.
- Saat mode automatic, schedule device tidak boleh menimpa state machine.
- OTA, sensor stale, relay fault, flow fault, runtime, volume, dan threshold
  dipakai sebagai safety interlock.

## Logika pompa air

1. Baca `soil_1_moisture` atau `soil_2_moisture` sesuai konfigurasi.
2. Setelah N sample berturut-turut <= moisture low, pompa air ON.
3. Pompa OFF ketika moisture >= target, max runtime tercapai, sensor stale,
   minimum flow tidak tercapai setelah grace period, OTA aktif, atau mode keluar
   dari automatic.
4. Setelah OFF, pompa menunggu cooldown sebelum dapat mulai lagi.

## Logika pompa pupuk

1. Setelah N sample EC berturut-turut <= EC low, mulai satu dosing cycle.
2. Pompa pupuk ON selama dose pulse, lalu OFF selama mixing delay.
3. Setelah mixing wajib ada sample EC baru.
4. Pulse diulang hanya jika EC masih di bawah target dan seluruh interlock aman.
5. Cycle berhenti pada EC target/high, max dose volume, max daily volume,
   sensor/flow stale, flow minimum gagal, OTA, atau perubahan mode.

## Catatan level tangki

Firmware hardware saat ini mengirim jarak tangki dalam cm, belum level persen
yang terkalibrasi. `minTankLevelPercent` boleh kosong dan direkomendasikan
tetap kosong. Bila backend lama masih mengirim angka, firmware 1.3.1 menerima
config tetapi mengabaikan interlock tersebut secara eksplisit. Interlock baru
boleh benar-benar dijalankan setelah mapping jarak-ke-persen dikalibrasi.

## Target build

- Board: Waveshare ESP32-S3-ETH-8DI-8RO / ESP32-S3 yang sesuai.
- Arduino ESP32 Core: 2.0.17.
- Serial USB CDC: 115200 baud.
- External library: `LiquidCrystal_I2C`.

Folder sketch dan file `.ino` sudah memakai nama yang sama. Compile dengan
konfigurasi board yang sama seperti firmware 1.2.1, kemudian flash lewat USB
atau hasilkan application `.bin` untuk Web OTA.

## Setelah flash

```bash
cd /opt/spff
sudo systemctl restart spff-edge-gateway spff-mqtt-worker
sudo journalctl -f -u spff-edge-gateway -u spff-mqtt-worker -o cat
```

Log sinkronisasi yang benar:

```text
[automatic-control-sync] config published ...
[edge] Automatic control config forwarded to ESP32 ...
[repository] automatic control acknowledgement stored {
  status: 'applied',
  appliedMode: 'automatic'
}
```

Periksa versi dan actual mode:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT site_id, device_id, firmware_version, mode, recorded_at, received_at
FROM spff.latest_device_status
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01';
"
```

Periksa status config automatic:

```bash
sudo -u postgres psql -d spff -P pager=off -c "
SELECT revision, desired_mode, published_revision, acknowledged_revision,
       acknowledgement_status, applied_mode, acknowledgement_reason
FROM spff.device_automatic_control_configs
WHERE site_id = 'greenhouse-01'
  AND device_id = 'esp32-s3-01';
"
```

## Uji aman pertama

1. Biarkan kedua pompa OFF.
2. Simpan threshold uji dengan max runtime pendek dan volume kecil.
3. Pastikan field minimum level tangki kosong.
4. Aktifkan hanya satu automatic profile dahulu.
5. Klik mode Automatic di website dan tunggu ACK applied.
6. Simulasikan nilai sensor melewati low threshold selama N sample.
7. Pastikan pump ON, actual state masuk ke datalog, lalu OFF pada target atau
   safety limit.
8. Uji tombol OFF saat automatic; OFF harus tetap diterima.
9. Kembalikan ke Manual sebelum mengubah wiring atau melakukan maintenance.
