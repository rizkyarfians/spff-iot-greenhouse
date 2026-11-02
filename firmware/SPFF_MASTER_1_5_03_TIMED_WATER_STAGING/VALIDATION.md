# Hasil pemeriksaan 2 November 2026

- Compile sukses: ESP32 Arduino Core 2.0.17, ESP32-S3, flash 16MB, QIO, OPI PSRAM, Hardware CDC/JTAG, CDC On Boot, app3M_fat9M_16MB.
- Konfigurasi default `SPFF_TIMED_WATER_MAX_SECONDS=0`: 889093 byte program dari 3145728 byte, 54772 byte global RAM dari 327680 byte.
- Warning library LiquidCrystal I2C menyatakan arsitektur AVR; build ESP32 tetap berhasil.
- Host test memakai batas 180 detik khusus simulasi: deadline, relay owner dua pompa, retry OFF, flow stale/rendah, perubahan konfigurasi, interlock, output tidak sesuai, operator STOP, kegagalan NVS dan ACK lulus.
- Uji helper asal: invalid duration, re-arm, boundary deadline dan wrap millis lulus.
- Perbandingan source: body readSHT20, serviceTelemetrySnapshot, serviceSpffCh3WaterInterlock, processSpffAutomaticControlSyncLine, dan processSpffScheduleSyncLine identik dengan baseline v1.5.03.

Pemeriksaan host memakai fungsi produksi yang diekstrak, dengan pengganti I/O. Tidak ada flashing, aktuasi pompa atau pengujian perangkat fisik. Perilaku parser serial end-to-end, kegagalan NVS fisik, reboot listrik, kontak relay dan akurasi flow perlu diuji pada perangkat. Angka 180 detik pada host test bukan rekomendasi batas perangkat.

Build menggunakan firmware/build-timed-water; executable host dan source mock di firmware/build-timed-water-tests. Kedua direktori adalah output lokal dan tidak termasuk paket source. File uji dan petunjuk ada dalam folder paket ini.
