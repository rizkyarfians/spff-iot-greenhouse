# Upgrade diagnostik dari 1.4.33

Paket ini berisi SOURCE, bukan binary siap flash. Belum diverifikasi dengan
compiler ESP32 atau hardware. Jangan gunakan binary lama dari arsip 1.4.34.

## Yang berubah

- Versi menjadi `1.4.35-AUTO-DIAG-FROM-1433`.
- Status ESP menambahkan `automaticWaterDiagnostics`: alasan Auto menunggu,
  umur sampel kelembapan asli, jumlah sampel pemicu, jadwal, jam RTC,
  pause, kesiapan relay, dan verifikasi OFF yang masih tertunda.
- Polling sensor tetap seperti 1.4.33: block read dengan fallback per register.
- Logika kontrol, parameter, mapping relay, Chrony/RTC dan pengaman tidak diubah.
- Ini membantu mencari penyebab Auto tidak menyala, BUKAN klaim perbaikan akar masalah.

## Buka dan compile

1. Ekstrak ZIP. Buka `SPFF_MASTER_1_4_35_AUTO_DIAGNOSTICS.ino` di folder
   `SPFF_MASTER_1_4_35_AUTO_DIAGNOSTICS` menggunakan Arduino IDE.
2. Gunakan board ESP32-S3, versi board package, library, flash size,
   partition scheme, PSRAM, USB CDC dan opsi lain yang sama dengan build
   1.4.33 yang sudah berhasil. Jangan menebak opsi partisi.
3. Tekan Verify terlebih dahulu. Bila gagal, simpan pesan error lengkap;
   jangan lanjut flash. Paket ini tidak menyertakan dependensi Arduino.
4. Setelah compile berhasil, gunakan prosedur upload/OTA yang sudah terbukti
   untuk board ini. Simpan binary dan source versi sebelumnya untuk rollback.

## Sebelum upload

Pastikan pompa berhenti dan aman secara fisik. Hilangnya komunikasi atau
restart gateway bukan jaminan relay OFF. Hentikan gateway agar tidak berebut
port dengan uploader:

```bash
sudo systemctl stop spff-edge-gateway
```

Jangan erase flash/NVS, ganti partition scheme, atau upload partitions/otadata
secara sembarang. Bila upload melalui komputer lain, lakukan dengan operator
site sesuai prosedur yang biasa dipakai. Paket ini tidak melakukan flash otomatis.

## Setelah upload

```bash
sudo systemctl start spff-edge-gateway
sudo journalctl -u spff-edge-gateway -n 50 --no-pager -o cat
```

Periksa versi dan diagnosis (status dikirim periodik, sekitar 30 detik):

```bash
sudo -u postgres psql -X -d spff -P pager=off -x -c "
SELECT recorded_at AT TIME ZONE 'Asia/Jakarta' AS waktu_wib,
       raw_payload->>'firmwareVersion' AS firmware,
       raw_payload->'automaticWaterDiagnostics' AS diagnosis
FROM spff.device_status_events
WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
ORDER BY received_at DESC,device_status_id DESC
LIMIT 3;"
```

Pastikan versi benar dan status/telemetry masuk sebelum uji jadwal baru.
Tidak perlu migration DB atau mengubah ambang sensor untuk memasang diagnosis.
Jangan melewati pengaman jika reason menunjukkan fault. `relayReady` hanya
flag firmware, bukan pembacaan hardware baru. Detail alasan ada di README.md.
