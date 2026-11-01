# Kalibrasi lapangan kebutuhan air & fertigasi SPFF — tahap 1

Status: **worksheet pengukuran, BELUM profil operasional**. Dokumen ini tidak mengaktifkan pompa, menulis konfigurasi runtime AI, membuat command MQTT, atau mengubah PostgreSQL production.

## Kondisi awal (per 1 November 2026)

- Sumber kelembapan air: `soil_2_moisture`, revisi konfigurasi `108`, sudah ACK `applied`, mode perangkat **Manual**.
- Python AI development: `SHADOW_MODE`, `can_dispatch=false`, polling sumber OFF.
- `simulation-1`: debit air 220 L/menit; injeksi/pupuk 7 L/menit; kurva tandon air 0–5.000 L; stok 0–500 L; batas irigasi 500 L. **Semua hanya contoh model**, bukan hasil pengukuran.
- Skor Mamdani simulasi yang terbukti: kelembapan 24,7% → 0,844445; keluaran ilustratif 422,2225 L. **Dilarang menganggapnya volume lapangan**.
- Ada kewajiban pemupukan yang perlu rekonsiliasi; engine mendahulukan jalur `FERTIGATE`. Pengukuran hidraulik saja tidak menghapus status `HOLD`.

## Aturan keselamatan

1. Dokumentasikan hanya pengukuran nyata. Jangan mengedit `simulation.json` seolah-olah profil produksi. Jangan mengubah `simulation_only` menjadi `false` sebelum seluruh pengukuran, review, dan rencana safety disetujui.
2. **Tidak mengubah mode Manual**, tidak mengaktifkan aturan otomatis atau dispatch AI. Semua uji pompa fisik harus atas keputusan operator berwenang pada panel/dashboard produksi melalui alur perintah + ACK ESP32, dengan interlock, batas waktu, kecukupan air, posisi katup, dan pengawasan fisik.
3. Jangan mengukur dengan mengosongkan tandon hingga pompa kering. Buang cairan pengujian hanya sesuai prosedur, jangan membuang stok pupuk ke lingkungan.
4. Untuk **Venturi satu jenis pupuk**, bedakan debit air utama (`water_flow_lpm`) dari **debit sedot/injeksi larutan stok Venturi** (`fertilizer_flow_lpm`). Debit injeksi tergantung tekanan beda, setelan katup, konsentrasi, dan kondisi pipa. Angka nominal pompa tidak otomatis sama dengan debit stok.
5. Selama kalibrasi, AI hanya boleh memberi observasi/simulasi; `HOLD`, `can_dispatch=false`, dan audit sumber tetap berlaku.

## A. Pengukuran debit air yang benar-benar sampai ke jalur aplikasi

- Catat tanggal/jam WIB, operator, unit/zona, kondisi katup, tekanan, rute aliran (ke manifold/dripper atau bypass), serta pembacaan flowmeter sebelum/sesudah.
- Ukur volume nyata dengan wadah/alat ukur terkalibrasi **atau** metode selisih volume tandon yang telah dikalibrasi. Jangan menyamakan angka kumulatif sensor dengan referensi fisik tanpa pembandingan.
- Jalankan **minimum tiga ulangan terpisah**, dengan durasi dan volume masing-masing. Catat variasi, fluktuasi tekanan, kondisi kebocoran, dan titik aliran yang diukur.
- Untuk setiap ulangan: `debit_air_L_per_menit = (volume_akhir_L - volume_awal_L) / (durasi_detik / 60)`. Bila membaca air yang terkumpul di wadah, `volume_awal=0` dan `volume_akhir=volume_terkumpul`.
- Jika debit berubah menurut jumlah zona aktif, catat setiap konfigurasi zona terpisah. Jangan menyatukan hasil bypass dengan debit aktual di tanaman.

| Ulangan | Zona / posisi katup | Durasi (detik) | Volume fisik (L) | Flowmeter awal/akhir (L) | Tekanan / catatan |
|---|---|---:|---:|---|---|
| 1 | BELUM DIUKUR | — | — | — | — |
| 2 | BELUM DIUKUR | — | — | — | — |
| 3 | BELUM DIUKUR | — | — | — | — |

## B. Kurva tandon, **bukan** asumsi % = volume linier

- Catat dimensi/kapasitas nominal tandon air dan stok, tetapi validasi volume fisik pada beberapa ketinggian dengan pengukuran pengisian/pengeluaran yang aman.
- Ambil titik sensor 0%, 25%, 50%, 75%, 100% bila terjangkau dengan aman; boleh lebih rapat khusus tandon tak beraturan. Pastikan volume total serta level yang benar-benar dapat digunakan.
- `water_curve` dan `fertilizer_curve` adalah pasangan `[level_persen, volume_L]` yang meningkat; kontrak saat ini mengharuskan rentang 0..100. **Jangan mengisi endpoint dengan asumsi**. Bila belum dapat mengukur, tandai belum siap.
- Tentukan titik penghentian aman, cadangan bilas (`minimum_flush_reserve`) dan priming (`priming_water_l`) berdasarkan pengujian yang diawasi operator.

| Tandon | Pembacaan (%) | Volume fisik terverifikasi (L) | Metode ukur | Status |
|---|---:|---:|---|---|
| Air | 0 / 25 / 50 / 75 / 100 | BELUM DIUKUR | — | pending |
| Stok pupuk | 0 / 25 / 50 / 75 / 100 | BELUM DIUKUR | — | pending |

## C. Venturi & stok pupuk **satu jenis**

- Uji debit sedot Venturi dengan air/larutan uji aman yang dapat diukur, memakai **kondisi tekanan dan katup sama dengan operasi aktual**. Catat volume sumber tersedot selama durasi terukur; tiga kali pengulangan.
- `debit_injeksi_L_per_menit = volume_stok_terhisap_L / (durasi_detik / 60)`.
- Hitung `concentration_g_l = massa_pupuk_terlarut_gram / volume_akhir_larutan_stok_L`; gunakan massa dan volume **akhir** yang nyata, bukan volume awal air sebelum pupuk dilarutkan.
- Catat batch ID, produk, tanggal penyiapan, massa bahan, volume akhir, kelarutan, dan verifikasi. Kewajiban dosis program harus diikat eksplisit ke baris kegiatan sebelum ada planner `FERTIGATE` yang tepercaya.
- Jangan menduga bahwa catatan `selesai manual` berarti dosis fisik tersalurkan atau mengurangi sisa kewajiban secara otomatis.

| Ulangan | Durasi (detik) | Stok terhisap (L) | Tekanan/posisi katup | Status |
|---|---:|---:|---|---|
| 1 | — | — | — | pending |
| 2 | — | — | — | pending |
| 3 | — | — | — | pending |

## D. Kebutuhan tanaman dan validasi Fuzzy

- `max_irrigation_l` harus ditentukan dari luas/zona, jumlah tanaman aktif, debit emitter aktual, keadaan media, dan batas kebutuhan agronomis pada HST relevan. **Tidak sama dengan** `max_session_water_l` (batas hidraulik perangkat).
- Uji membership `LOW/MEDIUM/HIGH` memakai kalibrasi sensor tanah/media, titik kebutuhan air yang disetujui, serta eksperimen lapangan. Parameter `fuzzy_off_threshold` adalah parameter algoritmik, bukan jaminan aman.
- Rekomendasi `score × max_irrigation_l` adalah fungsi model; validasi dampak di area percobaan sebelum ada rekomendasi untuk keseluruhan greenhouse.

## E. Parameter runtime yang membutuhkan bukti

| Field Python `Config` / `StockBinding` | Sumber bukti | Status |
|---|---|---|
| `water_flow_lpm` | Ulangan debit nyata pada rute air operasional | pending |
| `fertilizer_flow_lpm` | Ulangan laju hisap larutan melalui Venturi | pending |
| `water_curve` | Pasangan level–volume fisik tandon air | pending |
| `fertilizer_curve` | Pasangan level–volume fisik tandon stok | pending |
| `water_level_start_threshold`, `water_level_stop_threshold` | Level sensor + batas aman alat | pending |
| `fertilizer_stop_percent` | Level aman stok Venturi/tandon | pending |
| `priming_water_l`, `minimum_flush_reserve` | Pengujian kebutuhan priming/bilas | pending |
| `max_session_seconds`, `max_session_water_l` | Batas aman firmware + hardware | pending |
| `max_irrigation_l` | Validasi kebutuhan per zona/tanaman; bukan tebakan | pending |
| `StockBinding.concentration_g_l` + `verified` | Bukti batch + volume akhir larutan | pending |

## F. Kriteria siap tahap berikutnya

1. Bukti ulangan fisik untuk debit air & hisap stok, beserta variasinya.
2. Kurva dua tandon dari volume nyata atau metode terverifikasi.
3. Nilai cadangan flushing, priming, level minimum dan timeout yang aman.
4. Konsentrasi batch satu pupuk, dipasangkan ke program/kegiatan, dengan rekonsiliasi manual/legacy.
5. Validasi agronomis batas air per zona/HST dan pemeriksaan kualitas sensor.
6. Review bahwa `simulation_only=false` hanya berlaku untuk profil terkalibrasi yang terversi; perubahan harus diuji di staging, tidak otomatis dipasang pada produksi. Dispatch tetap dilarang.

**Catatan integrasi:** `LiveEngine` saat ini hanya menghasilkan `plan_fertigation` bila ada kewajiban pupuk aktif dengan binding stok terverifikasi; jalur `fuzzy_volume` untuk irigasi dipakai hanya ketika tidak ada kewajiban pupuk. Kalibrasi sendiri tidak menjamin empat kartu rencana langsung terisi. Pengubahan arsitektur pengambilan keputusan perlu desain dan review terpisah.
