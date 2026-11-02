# Timed water terintegrasi di baseline v1.5.03

Sketch lengkap berada di `SPFF_MASTER_1_5_03_SHT20_TELEMETRY_SYNC/`, dengan versi runtime `1.5.03-TIMED-WATER-INTEGRATED`. Baseline asli di `firmware/baseline-1503/` tidak diubah. README_1503 dan manifest BASELINE adalah catatan versi asal, bukan hasil verifikasi paket baru.

## Pengaktifan

Isi `SPFF_TIMED_WATER_MAX_SECONDS` di `TimedWaterConfig.h` sesuai batas waktu pompa yang telah divalidasi. Default `0` menolak seluruh ON bertimer dan melaporkan `timedWaterCapable=false`. Ini sengaja tidak menggunakan angka ilustrasi 105 atau 180 detik sebagai batas perangkat.

Konfigurasi automatic-control harus tersimpan, mode Manual, dan `water.minFlowLpm` harus positif sesuai kalibrasi flow. Kedua pompa harus terbaca OFF, sensor flow slave harus valid dan berumur maksimum 25 detik, RTC valid, interlock CH3 aman, dan tidak ada pemilik adaptive/pulse atau window jadwal aktif. Tidak ada klaim pengukuran volume atau penghentian berdasarkan liter.

## Command

Gunakan kontrak `kind=command`, `type=set_pump` yang sudah ada, `targetId=pump_water`, `params.isActive=true`, dan `params.durationSec` berupa bilangan bulat positif sampai batas konfigurasi. Tambahkan `bootId` yang sama dengan `pulseBootId` pada device_status terbaru. Identitas, schemaVersion, commandId, requestedBy, issuedAt, dan expiresAt mengikuti kontrak baseline. Waktu harus berada dalam interval issuedAt/expiresAt dan rentang expiry maksimum 300 detik.

`durationSec` hanya berlaku untuk ON pompa air pada mode Manual. Nilai salah, target pupuk, OFF dengan duration, dan mode Auto ditolak secara eksplisit. Command ON biasa tanpa duration tetap mengikuti baseline, sehingga server harus memastikan capability dan selalu menyertakan duration untuk sesi bertimer.

ACK `accepted` tidak berarti timer selesai. Setelah ON terbaca, actuator_state dan device_status menyampaikan keadaan sesi. ACK `completed` command awal baru dikirim setelah deadline tercapai dan output OFF terverifikasi. Sesi yang dihentikan karena fault, perubahan mode/config, kehilangan flow, atau STOP mendapat terminal `rejected` dengan alasan. Ini memakai status ACK yang sudah dikenal baseline; dashboard harus membaca actual state dan terminal ACK tersebut.

OFF biasa tetap tersedia sebagai STOP dan membatalkan sesi; OFF salah satu target juga mengakhiri sesi air sebagai permintaan penghentian operator. Duplikat commandId sesi yang masih berjalan hanya mendapat ACK accepted ulang dan tidak memperpanjang deadline. Duplikat terminal mengikuti history baseline.

## Pencegahan bentrok dan penghentian

Selama sesi, pemilik timer mengunci ON kedua pompa di `setRelay`, termasuk jalur penulisan langsung. Satu izin ON awal hanya berlaku untuk pompa air. Controller otomatis dan timer jadwal lokal mengalah, start adaptive dan server pulse ditolak, serta seluruh OFF tetap diperbolehkan. Penggantian mode/config atau ON/OFF tak terduga mengakhiri sesi.

Timer menggunakan millis unsigned yang tahan wrap. Servisnya berjalan dari serviceSpffGatewaySerial, termasuk saat menunggu sensor/Modbus. Tidak ada penantian sepanjang durasi timer. Verifikasi output aktif dibatasi setiap 250 ms; deadline tetap diperiksa setiap panggilan servis. Ini batas software kooperatif, bukan hard real-time atau pengganti watchdog/hardware emergency stop.

Status pending ditulis ke NVS sebelum ON. Reboot tidak melanjutkan sesi dan akan mengunci fault bila ada pending yang belum terselesaikan; initRelay baseline membawa output ke OFF. Pemulihan kondisi pending setelah reboot memerlukan pemeriksaan dan penghapusan key `tw_pending` oleh teknisi setelah output fisik aman, kemudian penanganan fault baseline; tidak ada auto-reset. Jika OFF gagal, owner dipertahankan, fault shutdown dikunci, OFF diulang, dan ACK sukses tidak dikirim. Register relay bukan feedback mekanis kontaktor.

## Pemeriksaan

`test/run-integration-tests.py` menjalankan fungsi serviceTimedWater dan setRelay aktual dengan I/O tiruan, serta source uji deadline yang dikirim pengguna. Pengujian meliputi deadline, batas/wrap, owner kedua pompa, OFF retry, flow, perubahan konfigurasi, interlock, output tak terduga, STOP, kegagalan NVS, dan kegagalan ACK. Tidak menggantikan uji perangkat, kalibrasi flow, atau uji pemutusan daya. Source uji berada di luar folder sketch agar main() uji tidak masuk build Arduino.
