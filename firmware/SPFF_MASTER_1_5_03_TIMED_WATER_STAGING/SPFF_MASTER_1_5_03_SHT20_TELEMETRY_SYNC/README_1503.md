# SPFF MASTER v1.5.03 — SHT20 Telemetry Sync

## Ringkasan

Basis: firmware sketch lengkap **v1.5.02 SHT20 RS485 FIX** yang sudah digunakan di lapangan.
Seluruh file v1.5.02 tetap utuh di folder lama. V1.5.03 memiliki folder Arduino dan `.ino` baru.

**Bug yang diperbaiki**: Pada `uiDelay()` firmware tetap memanggil `serviceTelemetrySnapshot()` saat `readSHT20()` masih membaca Modbus. Pada awal transaksi `shtCycleOk=false` dan `sht.fresh=false`, sehingga snapshot 30 detik yang kebetulan jatuh selama poll salah menandai `air_temp` dan `air_humidity` sebagai `stale_or_missing` meski nilai valid baru segera menyusul. Hal ini sesuai dengan contoh intermiten `stale_or_missing_id3_hex...` yang terlihat di PostgreSQL.

**Patch**:
1. Flag `spffSht20PollInProgress` diset true selama seluruh `readSHT20()` berlangsung.
2. Penjaga scope C++ (`SpffSht20TelemetryGate`) otomatis melepas flag pada *setiap* jalur return (sukses atau gagal).
3. `serviceTelemetrySnapshot()` segera return saat flag aktif, **tanpa** mengubah tenggat 30 detik/`spffLastTelemetrySentMs`. Jadi snapshot tertunda akan dikirim setelah poll berakhir melalui scheduler rutin.
4. Keputusan `valid=true` tetap hanya berdasarkan data terbaru yang sah; jika sensor benar-benar gagal, telemetry sesudah poll tetap `valid=false`.
5. String versi di device status serta adaptive-fertigation telemetry diubah menjadi `1.5.03-SHT20-TELEMETRY-SYNC` agar versi mudah diidentifikasi.

**Tidak diubah**: SHT20 ID prioritas 3 / fallback 1 @9600, FC04 R1–R2, validasi suhu/RH, Soil 1/2 4800, PZEM, sensor cairan, slave ID5, jurnal NVS, jadwal, manual/auto, relay, proteksi pompa, interlock air, dan mekanisme AUTOHEAL.

## Status verifikasi

- Source patch diperiksa secara statis dan ZIP diuji integritasnya.
- **Belum compile Arduino pada ESP32 Core 2.0.17** karena toolchain tidak tersedia pada lingkungan pembuat paket.
- **Belum diuji pada ESP32-S3 fisik**; kenaikan keandalan merupakan hipotesis kuat yang harus diuji melalui telemetry lapangan.

## Build

Buka `SPFF_MASTER_1_5_03_SHT20_TELEMETRY_SYNC.ino` dari folder yang sama namanya.
Board: ESP32S3 Dev Module; ESP32 Arduino Core 2.0.17; Flash Size 16MB; Flash Mode QIO 80MHz; OPI PSRAM; USB Mode Hardware CDC/JTAG; CDC On Boot Enabled; Partition Scheme `app3M_fat9M_16MB`. Pastikan library yang sudah terpasang untuk v1.5.02 tersedia.
Arduino IDE: **Sketch -> Verify** lalu **Sketch -> Export Compiled Binary**.
Gunakan `.ino.bin` untuk app-only flash pada offset yang telah diverifikasi pada perangkat; **jangan** flash `.merged.bin` di offset aplikasi.

## Uji lapangan tanpa aktuasi

1. Pastikan dua pompa OFF, isolasi listrik motor, mode Manual, jadwal OFF; pastikan interlock dan relay tetap benar.
2. Catat `firmwareVersion` dari device status dan pastikan `1.5.03-SHT20-TELEMETRY-SYNC`.
3. Dalam 100 telemetry **setelah waktu flash**, cek `sensorHealth.air_temp.valid`, RH, `reason`. Cari `stale_or_missing_id3_hex...`. Nilai RH yang tidak masuk akal tetap **harus** gagal.
4. Bandingkan laju telemetry sekitar 30 detik; tidak boleh ada jeda berulang, crash, atau reset loop.
5. Verifikasi sensor Soil 1/2, Nutrisense, JSN, flow, PZEM; terutama error CRC Soil 1 yang sebelumnya masih sesekali muncul.
6. Jika tidak membaik, lanjut diagnosis bus/CRC dan timing RS485; jangan mengubah ID atau menghapus NVS sebagai jalan pintas.

File ini merupakan source firmware. Paket tidak menyediakan BIN hasil kompilasi.
