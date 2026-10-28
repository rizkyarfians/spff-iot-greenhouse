# Catatan Diagnosa Sensor Tanah — 28 Oktober 2026

Ringkasan kerja hari ini di SPFF Master (ESP32-S3) + Orange Pi, untuk masalah
pembacaan sensor tanah 7-in-1 yang sering `invalid_response` / `crc_error`.

## Status akhir

| Item | Nilai |
|---|---|
| Firmware terpasang | **1.4.46-INDEPENDENT-AI** (pinned retry 8x) — konfigurasi terbaik dari 6 varian |
| File di Orange Pi | `/home/orangepi/firmware_v1446_pin8.bin` |
| Cara flash | `write-flash 0x10000` lewat `/home/orangepi/esptool-venv/bin/python`, gateway distop dulu |
| Hasil akhir | **13 dari 14 field valid**, umur data 29–163 detik, sukses per frame ±36% |

## Gejala

- Sensor tanah membalas, tetapi frame-nya rusak: panjang benar (6–7 byte),
  isi acak, hanya ~15–20% yang CRC-valid.
- Sensor 9600 (SHT20, Nutri, Slave ID5) di bus yang sama **selalu lancar**.
- Tidak ada restart loop, telemetry rapat 30 detik, kontrol pompa normal.

## Uji yang sudah dilakukan dan hasilnya

| Uji | Build | Hasil | Kesimpulan |
|---|---|---|---|
| Block read 7 register sekaligus | 1.4.35 | 0 sukses / 20 percobaan | Bukan soal jumlah transaksi |
| Jeda 1,5 detik antar frame | 1.4.36 | valid 5,7 → 9,7 dari 14 | Bus lengang tidak menyembuhkan |
| Baud 9600 | 1.4.37 | **0 byte, timeout total** | Sensor memang 4800 |
| Dengar bus saat idle 2 detik | 1.4.38 | **0 byte** | Tidak ada noise / tidak ada perangkat lain bicara |
| Kirim ke alamat 10 (tidak ada) | 1.4.39 | **0 byte** | Tidak ada echo dari modul RS485 |
| Hanya sensor tanah (Nutri/SHT20/Slave dimatikan) | 1.4.40 | tetap ~20% | Perangkat lain bukan penyebab |
| Hanya sensor 1 (sensor 2 tidak dipoll) | 1.4.41 | 1–3 sukses / 12 | Bukan tabrakan antar dua sensor |
| Retry 3x per slot | 1.4.42 | setara 1.4.36 | Menambah trafik tanpa hasil |
| Settle 1,5 ms + 8N2 + slot 150 ms | 1.4.43 | **0 field valid** | 8N2 merusak pembacaan; jangan dipakai |
| Slot 150 ms saja (tanpa 8N2) | 1.4.44 | 13–14 valid, umur 46–120 s | Pacing cepat menolong |
| Pinned retry 5x | 1.4.45 | 12–14 valid, umur 40–120 s | Membantu field tertinggal |
| **Pinned retry 8x, gap 80 ms** | **1.4.46** | **13 valid, umur 29–80 s, maks 77–163 s** | **TERBAIK — dipakai** |
| Tanpa ganti baud + slot 80 ms + timeout 260 | 1.4.47 | 7–9 valid, sukses turun ke 7% | Bus tanpa jeda membuat sensor kelelahan |
| 1.4.46 + timeout 260 ms + pin 10x | 1.4.48 | 6–8 valid | Timeout 260 ms terlalu pendek; sensor kadang >260 ms |
| 1.4.46 + pilih sensor paling tua | 1.4.49 | 11–13 valid, umur 115–150 s | Memilih yang tertua membuat sensor lain kelaparan |

## Bukti kunci: byte-nya yang salah, bukan parsing-nya

`extractRegisters()` memindai seluruh buffer dari offset mana pun dan wajib
CRC cocok, jadi frame yang bergeser tetap ketemu. Contoh tangkapan mentah:

```
valid   : 01 03 02 01 0C B9 D1
rusak   : 41 07 22 03 1C B9 F4     (bit acak)
rusak   : 40 D0 50 10 2C 8B
```

Karena CRC gagal pada byte yang masuk, kesalahannya ada di jalur fisik
sensor → master, bukan di software.

## Kesimpulan

Akar masalah ada di sisi lapangan (tidak bisa diperbaiki dari software):

1. **Tegangan suplai sensor.** Perangkat memakai catu 24 V. Jika label sensor
   tertulis 5–12 V, regulator internal kepanasan → driver RS485 melemah.
2. **Alamat Modbus ganda.** Jika dua sensor memakai alamat sama, keduanya
   menjawab bersamaan dan hasilnya satu frame bertabrakan (7 byte, isi acak).
3. **Kabel / terminasi / ground** pada jalur 4800.

Enam varian firmware sudah diuji (1.4.44 sampai 1.4.49). Batas atas yang bisa
dicapai dari software adalah **13 dari 14 field valid dengan umur data di bawah
3 menit**, karena hanya ±36% frame yang lolos CRC. Untuk mendapatkan 14/14
yang segar, jalur fisiknya harus diperbaiki lebih dulu.

Temuan tambahan: `soil_2_ph` pernah tercatat 0 sukses dari 18 percobaan,
menandakan register pH pada unit sensor 2 kemungkinan bermasalah sendiri.

## Tindakan lapangan yang disarankan (saat ada orang di lokasi)

1. Baca label sensor: 5–12 V atau 12–24 V. Jika 5–12 V, turunkan catu ke 12 V.
2. Cabut kabel A/B **sensor 2** saja, lihat 3 menit:
   - sensor 1 jadi lancar → alamat Modbus bentrok, set ulang salah satu;
   - tetap ~15% → masalah kabel/daya.
3. Pasang terminasi 120 Ω di ujung bus dan pastikan GND master–sensor tersambung.
4. Ganti kabel sensor dengan potongan pendek 1–2 m sebagai uji banding.

## Yang tidak perlu diulang

- Mengubah baud (sudah pasti 4800).
- Menambah/mengurangi jumlah register per transaksi.
- Memperpanjang jeda antar transaksi.
- Mematikan perangkat 9600 lain di bus.

## Perintah operasional

Flash ulang v1.4.44 (build terpasang sekarang):

```bash
ssh orangepi@100.89.145.98
sudo systemctl stop spff-edge-gateway
sudo /home/orangepi/esptool-venv/bin/python -m esptool --chip esp32s3 \
  --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 \
  /home/orangepi/firmware_v1444_fastonly.bin
sudo systemctl start spff-edge-gateway
```

Rollback ke v1.4.36 jika perlu:

```bash
... write-flash 0x10000 /home/orangepi/firmware_v1436_soilslow.bin
```

Cek cepat status tanah:

```sql
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
        WHERE k LIKE 'soil%' AND v->>'valid'='true') AS valid
FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 5;
```
