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


## Tahap implementasi software — kalkulator Panduan + histori flowmeter

Branch development menyediakan kalkulator **read-only** pada `#/ai-needs`.
Tanpa mengubah firmware/hardware maupun profil kontrol, kalkulator:
- membaca volume **larutan akhir per kegiatan** dari `spff.guide_programs.plan` yang tersimpan, bukan dari profil simulasi;
- membaca target massa **satu pupuk** per kegiatan dari data Panduan;
- memilih jendela **minimal 3 delta positif berturut-turut** (minimal 60 detik, selisih timestamp per sampel 1–45 detik) dari histori counter air dan pupuk valid dalam 7 hari terakhir yang tersedia (maksimal 3000 sampel dibaca);
- menghitung debit historis masing-masing jalur dari `delta_liter * 60 / detik`, memutus urutan saat counter reset, tidak valid, stagnan atau jeda;
- menghitung **estimasi waktu aliran air** sebagai volume larutan akhir referensi / debit air historis. Ini bukan durasi aktuatir terkalibrasi;
- menghitung volume stok sebagai `massa_pupuk_gram / konsentrasi_stok_g_per_liter` hanya setelah ikatan resep stok ke produk Panduan terverifikasi. Tanpa ikatan itu, volume stok tidak ditampilkan;
- menampilkan estimasi waktu hisap stok terpisah, bukan menjumlahkan dua durasi karena alur Venturi tidak terverifikasi;
- memisahkan data kalkulator dari `calculation` operasional, Fuzzy simulasi, ledger, dan hasil dispatch.

**Jangan menyamakan angka historis dengan debit terkalibrasi.**
Jika Panduan tidak berisi volume, Fuzzy simulasi dari telemetry terkini bisa menampilkan volume irigasi ilustratif secara terpisah. Untuk metode irigasi yang sesuai, hasil ini dapat menjadi preview kegiatan berlabel simulasi. Untuk `Tabur`/`Semprot`, angka Fuzzy tidak diubah menjadi volume campuran.
Jika konsentrasi stok belum terikat ke produk Panduan, UI menampilkan `—` untuk volume stok. Semua nilai diberi label perencanaan sementara.
Tetap `SHADOW_MODE`, `can_dispatch=false`, dan `HOLD`. Tidak ada kontrol pompa otomatis.

### Verifikasi development (tanpa menyentuh produksi)

```bash
cd ~/spff-ai-dashboard-test
git pull --ff-only
npm run build
npm run lint
cd standalone-ai
source .venv/bin/activate
pg_virtualenv -v 14 bash <<'BASH'
export AI_TEST_DATABASE_DSN="dbname=postgres"
python -m unittest discover -s tests -q
BASH
```

Setelah tes lulus dan service staging aktif:
```bash
sudo systemctl restart spff-ai-dev-python spff-ai-dev-api spff-ai-dev-web
curl -fsS 'http://127.0.0.1:5002/api/unified-ai/dashboard' | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
for p in d["programs"]:
    for a in p["activities"]:
        print(p["crop_name"],a["title"],a["planning_preview"])
'
```

UI staging: `http://127.0.0.1:5174/#/ai-needs` via tunnel SSH.
`;


## Integrasi kalkulasi otomatis, pengamatan real, dan batas penggunaan (staging)

Pada halaman `#/ai-needs`, **operator tidak perlu mengisi volume air dan
konsentrasi stok setiap kunjungan**. Endpoint dashboard Python sekarang melakukan
`SPFFSource.inspect()` melalui transaksi PostgreSQL **READ ONLY** dan menyajikan
`planning_source`, `planning_status`, serta timestamp sampel secara terpisah
dari status **keputusan kontrol** historis (`CURRENT/STALE/NO_DECISION`).

- Kebutuhan satu produk dan HST berasal dari Panduan tersimpan, tanpa penggabungan beberapa pupuk.
- Jika Panduan tidak menyediakan volume, Fuzzy Mamdani pada konfigurasi `simulation_only`
  boleh menghasilkan **ilustrasi volume irigasi** hanya bila telemetry, receive timestamp,
  nilai raw, umur raw, health/control eligibility, konfigurasi sensor dan ACK valid serta segar.
  Tidak boleh mengisi volume campuran `Tabur` atau `Semprot` secara otomatis.
- Dashboard menampilkan volume Fuzzy terpisah ketika kegiatan Panduan bukan
  kegiatan irigasi yang sesuai. Hasil ini **bukan nilai terkalibrasi** dan **bukan perintah pompa**.
- Konfigurasi `spff.fertigation_recipes.stock_concentration_g_per_l` memang tersedia,
  tetapi saat ini **tidak ada ikatan terverifikasi `guide_programs.program_id +
  activity_id + source_row` ke resep stok**. Nama pupuk, HST, atau tanaman yang sama
  bukan bukti batch stok yang sama. Volume stok karena itu tetap `null` dan diberikan
  kode `saved_stock_recipe_not_bound_to_guide_product` bila resep tersimpan ada,
  atau `stock_concentration_not_provided` jika tidak ada referensi.
- Laju air/stok historis hanya contoh hitung matematis dan tetap memuat sumber interval.
- Seluruh hasil tetap `can_dispatch=false`, tidak membuat keputusan SHADOW baru,
  tidak menyentuh ledger, tidak memanggil MQTT, tidak mengubah produksi.

Untuk memverifikasi setelah update branch staging:

```bash
cd ~/spff-ai-dashboard-test
git pull --ff-only
npm run build
npm run lint
cd standalone-ai
source .venv/bin/activate
pg_virtualenv -v 14 bash <<'BASH'
export AI_TEST_DATABASE_DSN="dbname=postgres"
python -m unittest discover -s tests -q
BASH
sudo systemctl restart spff-ai-dev-python spff-ai-dev-api spff-ai-dev-web
curl -fsS --max-time 20 http://127.0.0.1:5011/dashboard/summary | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("planning:",d["planning_status"],d["planning_source"],d["planning_recorded_at"])
print("decision:",d["status"],d["decision"]["type"],"can_dispatch:",d["can_dispatch"])
print("fuzzy:",d["fuzzy_preview"],"blockers:",d["fuzzy_preview_blockers"])
for p in d["programs"]:
    for a in p["activities"][:3]:
        print(p["crop_name"],a["title"],a["planning_preview"]["water_source"],
              a["planning_preview"]["water_l"],a["planning_preview"]["reasons"])
'
```

**Catatan:** Pipeline kalkulator ini menggunakan data aktual yang dibaca, tetapi
profil Fuzzy masih simulasi, debit historis belum kalibrasi, dan ikatan stok
belum ada. Produksi tidak boleh didorong ke kontrol otomatis oleh output ini.
