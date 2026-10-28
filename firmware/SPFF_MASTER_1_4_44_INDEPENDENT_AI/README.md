# SPFF 1.4.44 INDEPENDENT AI — SOIL FAST PACING

Paket sumber lengkap untuk ESP32-S3 Master (Waveshare ESP32-S3-ETH-8DI-8RO).

Basis: 1.4.34 / 1.4.36. Perubahan tunggal di versi ini: slot polling sensor
tanah dipersingkat dari 1500 ms menjadi **150 ms**, sehingga kedua sensor
tanah dipoll hampir terus-menerus. Tidak ada perubahan pada logika pompa,
interlock air, jadwal, OTA, maupun protokol ke Orange Pi.

## Hasil uji lapangan (28 Oktober 2026)

| Versi | Perubahan | Field tanah valid |
|---|---|---|
| 1.4.36 | slot 1500 ms | 8–13 dari 14, umur data 1–5 menit |
| 1.4.42 | retry 3x per slot | setara 1.4.36 |
| 1.4.43 | + settle 1,5 ms + framing 8N2 | **0 valid** (8N2 merusak pembacaan) |
| **1.4.44** | **slot 150 ms saja** | **13–14 dari 14, umur data 8–25 detik** |

Catatan: akar masalah bus RS485 sensor tanah (frame sering korup) belum
terselesaikan dan kemungkinan besar bersifat fisik (tegangan suplai, alamat
Modbus kembar, atau kabel/terminasi). Versi ini hanya memaksimalkan peluang
mendapat frame yang valid.

## Isi paket

```
SPFF_MASTER_1_4_44_INDEPENDENT_AI_FASTONLY.ino   sketch utama
SpffBuildCheck.h                                 guard profil build
PulseDeadline.h                                  header pulse server
ServerSoilEcPulse.h                              header pulse EC tanah
IndependentScheduleOutput.h                      header output jadwal
BUILD_PROFILE.json                               profil build yang dipakai
PANDUAN.md                                       panduan operasional 1.4.34
VERIFICATION.json                                bukti build
SHA256SUMS.txt                                   checksum semua file
binary/*.bin                                     firmware aplikasi (offset 0x10000)
binary/*.elf                                     ELF hasil build (untuk debug)
```

## Profil build

- Core: `esp32:esp32@2.0.17`
- FQBN: `esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB,USBMode=hwcdc,CDCOnBoot=cdc`
- Library tambahan: `Ethernet` (2.0.2), `LiquidCrystal_I2C`, `ArduinoJson`

## Cara upload

Arduino IDE: buka folder ini (nama folder harus sama dengan nama .ino), pilih
board **ESP32S3 Dev Module** dengan pengaturan pada profil di atas, lalu Upload.

Lewat Orange Pi (aplikasi saja, alamat 0x10000, jangan 0x0):

```bash
sudo systemctl stop spff-edge-gateway
sudo /home/orangepi/esptool-venv/bin/python -m esptool --chip esp32s3 \
  --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 \
  binary/SPFF_MASTER_1_4_44_INDEPENDENT_AI_FASTONLY.ino.bin
sudo systemctl start spff-edge-gateway
```

Pastikan kedua pompa OFF secara fisik sebelum upload. Jangan erase-flash,
jangan menulis ke 0x0.
