# SPFF v1.5.03 + timed water

TimedWaterDeadline telah terhubung ke command parser, service loop, relay owner, dan penghentian pompa di program utama.

Detail protokol, konfigurasi batas durasi, penanganan fault, serta cara menjalankan pemeriksaan ada di [INTEGRATION.md](INTEGRATION.md).

Default fitur menolak timed ON sampai `SPFF_TIMED_WATER_MAX_SECONDS` di `TimedWaterConfig.h` diisi dengan batas perangkat yang tervalidasi. Uji fisik belum dilakukan.
