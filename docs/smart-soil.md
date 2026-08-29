# Smart Soil

Smart Soil adalah fitur monitoring dan rekomendasi tanaman. Fitur ini membaca
telemetry yang sudah tersimpan di PostgreSQL dan tidak mengirim command ke ESP32,
tidak mengubah relay, tidak mengaktifkan pompa, dan tidak mengubah schedule.

## Data yang ditampilkan

Snapshot memakai sensor canonical berikut:

- air_temp dan air_humidity
- soil_1_moisture dan soil_1_temp
- soil_1_ph dan soil_1_ec_us_cm
- soil_1_n, soil_1_p, dan soil_1_k

Status Baik, Terlambat, Sensor bermasalah, atau Tidak tersedia memakai status
sensor yang sama dengan dashboard utama. Jika firmware mengirim sensorValid false,
halaman memberi peringatan dan nilai hanya boleh dipakai untuk diagnosis.

## Rekomendasi tanaman

Dataset statis berisi Ubi Jalar, Pak Choi, Sawi, Bayam, Kangkung, Tomat, Cabai,
Timun, Terong, dan Selada. Baseline suhu dan pH mengacu pada FAO ECOCROP:

https://www.fao.org/geospatial/data-and-tools/data-portals/ecocrop/en

Skor memakai bobot:

- suhu: 40 persen, dibandingkan dengan baseline tanaman;
- pH tanah: 35 persen, dibandingkan dengan baseline tanaman;
- kelembapan udara: 25 persen, dibandingkan dengan rentang operasional lokasi
  dari Pengaturan.

Bobot dinormalisasi dari input yang tersedia. Kelembapan lokasi bukan baseline
spesifik tanaman. Moisture, EC, dan NPK ditampilkan sebagai konteks monitoring,
tetapi belum dimasukkan ke skor karena belum ada baseline per tanaman yang
tervalidasi. Sistem tidak mengarang threshold universal.

## API

- GET /api/smart-soil mengembalikan kondisi, profil, pilihan aktif, dan rekomendasi.
- PUT /api/smart-soil/selection menyimpan pilihan profil tanaman. Endpoint ini
  membutuhkan admin dan CSRF, tetapi tidak membuat command MQTT.

Contoh body pilihan:

    {
      "zoneId": "soil-1",
      "selectedCropId": "tomato"
    }

## Database

Jalankan migration 011_smart_soil.sql. Migrasi hanya membuat
spff.site_crop_selections, seed Ubi Jalar untuk soil-1, trigger updated_at, dan
grant API/backup. Tidak ada tabel konfigurasi irigasi, event irigasi, atau perubahan
constraint control command.

## Dampak ke firmware

Tidak ada perubahan firmware yang dibutuhkan. Firmware tetap mengirim telemetry,
device_status, actuator_state, command_ack, dan schedule_sync_ack seperti versi
yang sudah berjalan. Kontrol pompa manual dan schedule tetap menggunakan jalur
existing dan berada di luar Smart Soil.

## Verifikasi lokal

1. Build contract, backend, dan frontend.
2. Terapkan migration 011 ke database development.
3. Buka Smart Soil dan pastikan sembilan sensor muncul.
4. Ubah tanaman sebagai admin dan pastikan pilihan tetap tersimpan setelah refresh.
5. Pastikan tidak ada command baru pada control_commands hanya karena membuka atau
   menyimpan pilihan Smart Soil.
