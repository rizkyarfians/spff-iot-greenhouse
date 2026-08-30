
/*
  =============================================================================
  S2PFS MASTER SPFF FIRMWARE 1.3.0 AUTOMATIC CONTROL OTA
  Based on S2PFS Master V8.9.1 Edge Contract
  Waveshare ESP32-S3-ETH-8DI-8RO
  =============================================================================

  TUJUAN
  - Firmware master production dengan heartbeat dan Web OTA aman.
  - Menerima command set_pump JSON Lines dari Orange Pi dengan validation,
    expiry, dedup commandId, ACK accepted/completed/rejected, dan relay readback.
  - actuator_state hanya dikirim saat boot, actual state berubah, atau fault.
  - Mengirim device_status JSON Lines setelah init, setiap 30 detik, dan saat
    mode/sensor/system state berubah tanpa bergantung pada telemetry.
  - Telemetry snapshot dikirim tiap 30 detik dari last-valid per parameter (maks 300 detik / 5 menit).
  - Membaca:
      1) Nutrisense EC/pH       ID1 @ 9600, FC03
      2) SHT20 RS485            ID3 @ 9600, FC04
      3) ESP32 Slave PCB        ID5 @ 9600, FC03
      4) Soil 7-in-1 #1         ID1, adaptive sekitar 4800
      5) Soil 7-in-1 #2         ID2, adaptive sekitar 4800
  - LCD 20x4 + 4 tombol.
  - RTC onboard PCF85063/compatible @ I2C 0x51.
  - SHT20 terhubung langsung ke main RS485 A/B.
  - Sensor tetap dipoll terus; snapshot memakai last-good per field dengan batas umur 300 detik / 5 menit.
  - Fungsi THC15A diimplementasikan sebagai TIMER SOFTWARE di LCD.
  - Tidak ada sambungan fisik THC15A ke Master.
  - Full snapshot schedule_sync divalidasi, disimpan atomik ke NVS, dan dibalas
    schedule_sync_ack applied/rejected dengan revision dan storedScheduleCount.
  - automatic_control_sync disimpan ke NVS dan menjalankan hysteresis moisture
    serta closed-loop EC dosing dengan runtime/flow/volume/cooldown interlock.
  - Authority server: Orange Pi mengeksekusi jadwal melalui command set_pump.
  - Authority device: ESP32 mengeksekusi snapshot NVS untuk kedua pompa.
  - Timer mingguan lokal legacy tetap tersimpan tetapi tidak menulis relay.
  - Slave RS485 final memakai MAX485 MANUAL: RE+DE -> GPIO4.

  HARDWARE MASTER
  - RS485 onboard: RX GPIO18, TX GPIO17
  - I2C: SDA GPIO42, SCL GPIO41
  - LCD: 0x27 atau 0x3F
  - RTC: 0x51
  - TCA9554 relay: 0x20
  - DI1 GPIO4  = CANCEL
  - DI2 GPIO5  = OK
  - DI3 GPIO6  = UP
  - DI4 GPIO7  = DOWN
  - Tombol INPUT_PULLUP, ACTIVE LOW

  SLAVE ID5 REGISTER
  HR0 = jarak tandon air cm x10
  HR1 = jarak tandon pupuk cm x10
  HR2 = flow air L/min x100
  HR3 = flow pupuk L/min x100
  HR4 = total air mL high word
  HR5 = total air mL low word
  HR6 = total pupuk mL high word
  HR7 = total pupuk mL low word

  LIBRARY EKSTERNAL MASTER
  - LiquidCrystal_I2C
  Built-in:
  - Wire
  - Preferences

  Serial protocol: 115200 JSON Lines
  =============================================================================
*/

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Update.h>
#include <esp_system.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

// =============================================================================
// PRODUCTION SERIAL POLICY
// =============================================================================
// USB Serial dipakai eksklusif untuk SPFF JSON Lines. Human-readable debug,
// plotter, dan compact output dihapus dari build produksi agar tidak mencemari
// protokol Edge Gateway dan tidak menarik formatter/format string yang besar.

// ESP32 Arduino Core 2.0.x compatibility:
// - user-defined button types are declared before Arduino-generated prototypes
// - String(float, decimals) uses an explicit unsigned-int cast

// =============================================================================
// CONFIG
// =============================================================================
static constexpr uint8_t RS485_RX_PIN = 18;
static constexpr uint8_t RS485_TX_PIN = 17;

static constexpr uint8_t I2C_SDA_PIN = 42;
static constexpr uint8_t I2C_SCL_PIN = 41;

static constexpr uint8_t BTN_CANCEL_PIN = 4;
static constexpr uint8_t BTN_OK_PIN     = 5;
static constexpr uint8_t BTN_UP_PIN     = 6;
static constexpr uint8_t BTN_DOWN_PIN   = 7;

// Waveshare ESP32-S3-ETH-8DI-8RO onboard buzzer.
// Board ini membutuhkan PWM/tone pada GPIO46.
// API di bawah kompatibel dengan ESP32 Arduino Core lama
// (ledcSetup + ledcAttachPin), sesuai core yang sedang dipakai.
static constexpr uint8_t BUZZER_PIN = 46;
static constexpr uint8_t BUZZER_CHANNEL = 0;
static constexpr uint32_t BUZZER_FREQ_HZ = 2700UL;
static constexpr uint8_t BUZZER_RESOLUTION_BITS = 8;

// Bunyi tombol pendek dan NON-BLOCKING agar UI tetap responsif.
static constexpr uint32_t BUTTON_BEEP_MS = 35UL;


static constexpr uint8_t NUTRI_ID = 1;
static constexpr uint8_t SHT20_ID = 3;
static constexpr uint8_t SOIL1_ID = 1;
static constexpr uint8_t SOIL2_ID = 2;
static constexpr uint8_t SLAVE_ID = 5;

static constexpr uint32_t BAUD_9600 = 9600UL;
static constexpr uint32_t SOIL_DEFAULT_BAUD = 4800UL;

// V8.4.1 SOIL FIX:
// Satu sensor Modbus mempunyai SATU baud, bukan baud berbeda per register.
// Kedua soil 7-in-1 dipoll sebagai satu blok FC03 R0..R6 @4800.
static constexpr uint32_t SOIL_FIXED_BAUD = 4850UL;
static constexpr uint32_t SOIL_SINGLE_TIMEOUT_MS = 260UL;

// FAST + ACCURATE rolling soil:
// tidak memaksa 7 register fresh pada cycle yang sama.
// Tiga register per sensor dicoba setiap cycle, hasil CRC-valid disimpan.
// Freshness internal Soil tetap 60 detik untuk health/priority polling.
// Telemetry snapshot boleh membawa last-valid field sampai 300 detik / 5 menit.
static constexpr uint8_t SOIL_REGS_PER_CYCLE = 3;
static constexpr uint8_t SOIL_ACQUIRE_RETRY = 5;
static constexpr uint8_t SOIL_MAINTENANCE_RETRY = 2;
static constexpr uint32_t SOIL_FIELD_MAX_AGE_MS = 60000UL;

static constexpr uint32_t SENSOR_CYCLE_INTERVAL_MS = 2000UL;
static constexpr uint32_t LCD_REFRESH_MS = 250UL;


// Kalau satu polling Slave gagal tetapi data valid terakhir masih <=60 detik,
// data tetap boleh dipakai sebagai CACHE. Ini tidak memalsukan data baru;
// hanya menjaga tampilan/monitoring tidak jatuh ke STALE karena satu timeout.
static constexpr uint32_t SLAVE_CACHE_MAX_AGE_MS = 60000UL;

// V8.4.8:
// Sensor lambat tidak dinilai dari satu request saja.
// Fresh read tetap diutamakan, tetapi last-good singkat tetap dianggap sehat.
static constexpr uint32_t NUTRI_CACHE_MAX_AGE_MS = 60000UL;

// =============================================================================
// SOFTWARE CALIBRATION HOOKS - NUTRISENSE
// =============================================================================
// Default = identity, jadi TIDAK mengubah pembacaan sampai hasil kalibrasi
// terhadap larutan/alat referensi sudah tersedia.
// corrected = raw * GAIN + OFFSET
static constexpr float NUTRI_PH_GAIN = 1.0f;
static constexpr float NUTRI_PH_OFFSET = 0.0f;
static constexpr float NUTRI_EC_GAIN = 1.0f;
static constexpr float NUTRI_EC_OFFSET = 0.0f;
static constexpr float NUTRI_TEMP_GAIN = 1.0f;
static constexpr float NUTRI_TEMP_OFFSET = 0.0f;

// Status Soil ditentukan dari komunikasi sensor secara keseluruhan,
// bukan apakah semua 7 register berhasil refresh bersamaan.
// Jika tidak ada register valid selama 60 detik, sensor dianggap tidak current.
static constexpr uint32_t SOIL_SENSOR_MAX_SILENCE_MS = 60000UL;

static constexpr uint8_t TCA9554_ADDR = 0x20;
static constexpr uint8_t TCA_OUTPUT_REG = 0x01;
static constexpr uint8_t TCA_POLARITY_REG = 0x02;
static constexpr uint8_t TCA_CONFIG_REG = 0x03;

// FINAL ACTUATOR MAPPING - SESUAI WIRING FISIK PANEL
// CH1 = Pompa Nutrisi / Pupuk
// CH2 = Kosong
// CH3 = Pompa Penyiraman / Air
// CH4 = Kosong
// CH5..CH8 = Cadangan
//
// SHT20 terhubung LANGSUNG ke main RS485 A/B.
// Tidak ada relay isolasi SHT pada versi final ini.
static constexpr uint8_t RELAY_NUTRIENT = 1;    // CH1
static constexpr uint8_t RELAY_IRRIGATION = 3;  // CH3

static constexpr uint8_t PUMP_FERTILIZER_RELAY = RELAY_NUTRIENT;
static constexpr uint8_t PUMP_WATER_RELAY = RELAY_IRRIGATION;

static constexpr uint8_t RTC_ADDR = 0x51;

// PCF85063 register map:
// 0x00 Control_1
// 0x01 Control_2
// 0x02 Offset
// 0x03 RAM byte
// 0x04 Seconds
// 0x05 Minutes
// 0x06 Hours
// 0x07 Days
// 0x08 Weekdays
// 0x09 Months
// 0x0A Years
static constexpr uint8_t RTC_SECONDS_REG = 0x04;

static constexpr uint8_t SOIL_REG_COUNT = 7;

// =============================================================================
// GLOBAL
// =============================================================================
HardwareSerial RS485(1);
Preferences prefs;

// Forward declaration: nilai SSID dipakai oleh LCD sebelum implementasi WiFi/OTA.
extern String fieldWifiSsid;

uint32_t activeBaud = 0;
uint32_t lastCycleStartMs = 0;


// =============================================================================
// SPFF EDGE GATEWAY - USB SERIAL JSON LINES
// =============================================================================
// Sesuai panduan integrasi:
// ESP32-S3 <-> USB Serial JSON Lines <-> Orange Pi Edge Gateway <-> MQTT
//
// Orange Pi:
//   Serial baud : 115200
//
// ESP32 TIDAK connect langsung ke MQTT.
static constexpr char SPFF_SITE_ID[] = "greenhouse-01";
static constexpr char SPFF_DEVICE_ID[] = "esp32-s3-01";
static constexpr char SPFF_FIRMWARE_VERSION[] = "1.3.0";

// Timer LCD/NVS legacy tidak boleh menjadi writer relay bersamaan dengan
// backend atau snapshot device. Data legacy tetap dipertahankan untuk rollback.
static constexpr bool SPFF_DISABLE_LEGACY_LOCAL_TIMER = true;

// Satu frame JSON termasuk terminator LF tidak boleh melebihi 16 KiB.
static constexpr size_t SPFF_SERIAL_FRAME_MAX = 16384;

// Arduino ESP32 Core 2.0.17 memakai RX queue USB CDC default 256 byte.
// Command set_pump sekitar 309 byte dan schedule_sync bisa mendekati 16 KiB,
// jadi queue harus dibesarkan sebelum Serial.begin() agar frame tidak terpotong.
static constexpr size_t SPFF_SERIAL_RX_QUEUE_BYTES = SPFF_SERIAL_FRAME_MAX;

// Heartbeat device hidup terpisah dari jadwal polling/pengiriman telemetry.
static constexpr uint32_t SPFF_STATUS_HEARTBEAT_INTERVAL_MS = 30000UL;
static constexpr uint32_t SPFF_STATUS_TIME_RETRY_INTERVAL_MS = 1000UL;
static constexpr uint32_t SPFF_SENSOR_VALID_MAX_SILENCE_MS = 300000UL;

// Telemetry snapshot dipublish setiap 30 detik. Sensor tetap dipoll terus
// mengikuti scheduler existing; publish tidak menunggu pembacaan dimulai.
static constexpr uint32_t SPFF_TELEMETRY_PUBLISH_INTERVAL_MS = 30000UL;

// Last-valid per parameter boleh dibawa ke snapshot berikutnya selama maksimal
// 300 detik / 5 menit. Setelah lewat batas ini field di-omit, bukan diisi nilai dummy.
// Cache ini hanya untuk TELEMETRY SNAPSHOT/dashboard. Safety, interlock, dan
// automatic control tetap memakai state pembacaan sensor current yang existing.
static constexpr uint32_t SPFF_TELEMETRY_SNAPSHOT_MAX_AGE_MS = 300000UL;
static constexpr uint8_t SPFF_SUPPORTED_TELEMETRY_FIELD_COUNT = 25;

// RTC Master saat ini dianggap waktu lokal WIB / UTC+7.
// recordedAt untuk gateway harus UTC ISO-8601 dengan akhiran Z.
static constexpr int16_t SPFF_LOCAL_UTC_OFFSET_MINUTES = 7 * 60;

// schedule_sync adalah full snapshot dan dapat mendekati batas Serial 16 KiB.
// Reserve awal tetap kecil; String tumbuh hanya ketika snapshot besar diterima.
static constexpr size_t SPFF_RX_LINE_MAX = SPFF_SERIAL_FRAME_MAX - 1U;
static constexpr size_t SPFF_RX_INITIAL_RESERVE = 2048U;
static constexpr uint8_t SPFF_JSON_MAX_DEPTH = 8;
static constexpr size_t SPFF_COMMAND_ID_MAX = 96;
static constexpr size_t SPFF_COMMAND_TARGET_MAX = 20;
static constexpr size_t SPFF_COMMAND_REASON_MAX = 32;
static constexpr uint8_t SPFF_COMMAND_HISTORY_SIZE = 16;
static constexpr uint32_t SPFF_ACTUATOR_STATE_POLL_INTERVAL_MS = 1000UL;

enum SpffSystemState : uint8_t {
  SPFF_SYSTEM_WAITING_TELEMETRY = 0,
  SPFF_SYSTEM_MONITORING = 1,
  SPFF_SYSTEM_SENSOR_FAULT = 2
};

String spffRxLine;
bool spffRxDroppingOversize = false;

char spffBootId[17] = {0};
uint32_t spffStatusCounter = 0;
uint32_t spffLastStatusSentMs = 0;
uint32_t spffLastStatusAttemptMs = 0;
uint32_t spffLastValidSensorMs = 0;
uint8_t spffObservedTimerMode = 0;
bool spffStatusEverSent = false;
bool spffStatusDirty = true;
bool spffStatusInitialized = false;
bool spffStatusModeInitialized = false;
bool spffLastStatusAttemptFailed = false;
bool spffSensorValid = false;
bool spffTelemetryEverValid = false;
SpffSystemState spffSystemState = SPFF_SYSTEM_WAITING_TELEMETRY;


struct SpffActuatorStateTracker {
  bool initialized = false;
  bool stateKnown = false;
  bool isActive = false;
};

struct SpffCommandHistoryEntry {
  bool used = false;
  char commandId[SPFF_COMMAND_ID_MAX + 1] = {0};
  char targetId[SPFF_COMMAND_TARGET_MAX + 1] = {0};
  char acknowledgedAt[25] = {0};
  char status[10] = {0};
  bool actualStateKnown = false;
  bool actualActive = false;
  char reason[SPFF_COMMAND_REASON_MAX + 1] = {0};
};

SpffActuatorStateTracker spffWaterStateTracker;
SpffActuatorStateTracker spffFertStateTracker;
SpffCommandHistoryEntry spffCommandHistory[SPFF_COMMAND_HISTORY_SIZE];
uint8_t spffCommandHistoryCursor = 0;
uint32_t spffActuatorStateCounter = 0;
uint32_t spffLastActuatorStatePollMs = 0;
String spffCurrentCommandIssuedAt;

static constexpr uint8_t SPFF_SYNCED_SCHEDULE_MAX = 64;
static constexpr uint32_t SPFF_SCHEDULE_STORE_MAGIC = 0x53504646UL;
static constexpr uint16_t SPFF_SCHEDULE_STORE_FORMAT = 1U;
static constexpr char SPFF_SCHEDULE_NVS_KEY[] = "srv_sched";

enum SpffScheduleAuthority : uint8_t {
  SPFF_SCHEDULE_AUTHORITY_SERVER = 0,
  SPFF_SCHEDULE_AUTHORITY_DEVICE = 1
};

enum SpffScheduleTarget : uint8_t {
  SPFF_SCHEDULE_TARGET_WATER = 1,
  SPFF_SCHEDULE_TARGET_FERT = 2
};

enum SpffScheduleRepeat : uint8_t {
  SPFF_SCHEDULE_REPEAT_DAILY = 1,
  SPFF_SCHEDULE_REPEAT_WEEKDAYS = 2,
  SPFF_SCHEDULE_REPEAT_WEEKENDS = 3,
  SPFF_SCHEDULE_REPEAT_ONCE = 4
};

struct SpffSyncedSchedule {
  uint32_t scheduleIdHash = 0;
  uint32_t onSecond = 0;
  uint32_t offSecond = 0;
  uint16_t runYear = 0;
  uint8_t runMonth = 0;
  uint8_t runDay = 0;
  uint8_t target = 0;
  uint8_t repeatRule = 0;
  uint8_t enabled = 0;
  uint8_t reserved = 0;
};

struct SpffSyncedScheduleStore {
  uint32_t magic = 0;
  uint16_t formatVersion = 0;
  uint8_t authority = SPFF_SCHEDULE_AUTHORITY_SERVER;
  uint8_t count = 0;
  uint32_t revision = 0;
  SpffSyncedSchedule schedules[SPFF_SYNCED_SCHEDULE_MAX];
  uint32_t checksum = 0;
};

SpffSyncedScheduleStore spffSyncedScheduleStore;
bool spffSyncedScheduleLoaded = false;

static constexpr uint32_t SPFF_AUTO_STORE_MAGIC = 0x4155544FUL;
static constexpr uint16_t SPFF_AUTO_STORE_FORMAT = 1U;
static constexpr char SPFF_AUTO_NVS_KEY[] = "auto_ctrl";
static constexpr char SPFF_AUTO_DAILY_NVS_KEY[] = "auto_daily";
static constexpr uint32_t SPFF_AUTO_DAILY_STORE_MAGIC = 0x4441494CUL;
static constexpr uint32_t SPFF_AUTO_EVAL_INTERVAL_MS = 500UL;
static constexpr uint32_t SPFF_AUTO_FLOW_GRACE_MS = 5000UL;

enum SpffOperatingMode : uint8_t {
  SPFF_MODE_MANUAL = 0,
  SPFF_MODE_AUTOMATIC = 1
};

enum SpffAutoFertState : uint8_t {
  SPFF_FERT_IDLE = 0,
  SPFF_FERT_DOSING = 1,
  SPFF_FERT_MIXING = 2
};

struct SpffWaterAutomaticConfig {
  uint8_t enabled = 0;
  uint8_t sensor = 1;
  uint8_t triggerSampleCount = 3;
  uint8_t reserved = 0;
  float moistureLowPercent = 0;
  float moistureTargetPercent = 0;
  float minFlowLpm = 0;
  uint32_t maxRuntimeSeconds = 0;
  uint32_t cooldownSeconds = 0;
  uint32_t sensorStaleSeconds = 120;
};

struct SpffFertilizerAutomaticConfig {
  uint8_t enabled = 0;
  uint8_t triggerSampleCount = 3;
  uint16_t reserved = 0;
  float ecLowUsCm = 0;
  float ecTargetUsCm = 0;
  float ecHighUsCm = 0;
  float maxDoseVolumeL = 0;
  float maxDailyVolumeL = 0;
  float minFlowLpm = 0;
  uint32_t dosePulseSeconds = 0;
  uint32_t mixingDelaySeconds = 0;
  uint32_t cooldownSeconds = 0;
  uint32_t sensorStaleSeconds = 120;
};

struct SpffAutomaticControlStore {
  uint32_t magic = 0;
  uint16_t formatVersion = 0;
  uint8_t desiredMode = SPFF_MODE_MANUAL;
  uint8_t reserved = 0;
  uint32_t revision = 0;
  SpffWaterAutomaticConfig water;
  SpffFertilizerAutomaticConfig fertilizer;
  uint32_t checksum = 0;
};

struct SpffAutomaticDailyStore {
  uint32_t magic = SPFF_AUTO_DAILY_STORE_MAGIC;
  uint16_t dateKey = 0;
  uint16_t reserved = 0;
  uint32_t fertilizerStartTotalMl = 0;
  uint32_t checksum = 0;
};

SpffAutomaticControlStore spffAutomaticControl;
bool spffAutomaticControlLoaded = false;
uint32_t spffLastAutoEvaluationMs = 0;
uint32_t spffWaterLastSampleMs = 0;
uint8_t spffWaterLowSampleCount = 0;
bool spffWaterAutoActive = false;
uint32_t spffWaterStartedMs = 0;
uint32_t spffWaterCooldownStartedMs = 0;
uint32_t spffFertLastSampleMs = 0;
uint8_t spffFertLowSampleCount = 0;
SpffAutoFertState spffFertState = SPFF_FERT_IDLE;
bool spffFertCycleLatched = false;
uint32_t spffFertStateStartedMs = 0;
uint32_t spffFertCooldownStartedMs = 0;
uint32_t spffFertPulseStartTotalMl = 0;
uint32_t spffFertCycleStartTotalMl = 0;
uint32_t spffFertDailyStartTotalMl = 0;
uint16_t spffFertDailyDateKey = 0;


LiquidCrystal_I2C lcd27(0x27, 20, 4);
LiquidCrystal_I2C lcd3F(0x3F, 20, 4);
LiquidCrystal_I2C *lcd = nullptr;
bool lcdReady = false;

bool relayReady = false;
uint8_t relayState = 0;

bool rtcReady = false;

// =============================================================================
// DATA TYPES
// =============================================================================
struct RTCDateTime {
  uint8_t second = 0;
  uint8_t minute = 0;
  uint8_t hour = 0;
  uint8_t day = 1;
  uint8_t weekday = 0;
  uint8_t month = 1;
  uint8_t year = 0; // 00..99 = 2000..2099
  bool valid = false;
  bool oscillatorStopped = false;
};

RTCDateTime rtcNow;

struct NutriData {
  float ph = NAN;
  float ec = NAN;
  float temp = NAN;
  bool hasValue = false;
  bool fresh = false;
  uint32_t lastGoodMs = 0;
};

struct SHTData {
  float temp = NAN;
  float rh = NAN;
  bool hasValue = false;
  bool fresh = false;
  uint32_t lastGoodMs = 0;
};

struct SoilData {
  uint16_t raw[SOIL_REG_COUNT] = {0,0,0,0,0,0,0};
  bool has[SOIL_REG_COUNT] = {false,false,false,false,false,false,false};
  bool freshField[SOIL_REG_COUNT] = {false,false,false,false,false,false,false};
  uint32_t regBaud[SOIL_REG_COUNT] = {
    SOIL_DEFAULT_BAUD, SOIL_DEFAULT_BAUD, SOIL_DEFAULT_BAUD,
    SOIL_DEFAULT_BAUD, SOIL_DEFAULT_BAUD, SOIL_DEFAULT_BAUD,
    SOIL_DEFAULT_BAUD
  };
  uint32_t fallbackBaud = SOIL_DEFAULT_BAUD;
  bool complete = false;
  bool fresh = false;
  uint32_t lastGoodMs = 0;
};

struct SlaveData {
  float waterDistanceCm = NAN;
  float fertDistanceCm = NAN;
  float waterFlowLpm = NAN;
  float fertFlowLpm = NAN;
  uint32_t waterTotalMl = 0;
  uint32_t fertTotalMl = 0;
  bool waterDistanceValid = false;
  bool fertDistanceValid = false;
  bool totalsAvailable = false;
  bool hasValue = false;
  bool fresh = false;
  uint32_t lastGoodMs = 0;
};

// =============================================================================
// TELEMETRY SNAPSHOT CACHE
// =============================================================================
// Cache ini menyimpan last-valid PER PARAMETER beserta waktu pembacaan aslinya.
// Timestamp cache TIDAK diperbarui jika sensor gagal dibaca, sehingga nilai lama
// tidak pernah dibuat terlihat lebih fresh dari kondisi sebenarnya.
struct CachedFloatValue {
  float value = NAN;
  uint32_t updatedMs = 0;
  bool hasValue = false;
};

struct CachedUIntValue {
  uint32_t value = 0;
  uint32_t updatedMs = 0;
  bool hasValue = false;
};

struct TelemetrySnapshotCache {
  CachedFloatValue liquidPh;
  CachedFloatValue liquidEcUsCm;
  CachedFloatValue liquidTemp;
  CachedFloatValue airTemp;
  CachedFloatValue airHumidity;

  CachedFloatValue soil1Moisture;
  CachedFloatValue soil1Temp;
  CachedUIntValue soil1EcUsCm;
  CachedFloatValue soil1Ph;
  CachedUIntValue soil1N;
  CachedUIntValue soil1P;
  CachedUIntValue soil1K;

  CachedFloatValue soil2Moisture;
  CachedFloatValue soil2Temp;
  CachedUIntValue soil2EcUsCm;
  CachedFloatValue soil2Ph;
  CachedUIntValue soil2N;
  CachedUIntValue soil2P;
  CachedUIntValue soil2K;

  CachedFloatValue tankWaterDistanceCm;
  CachedFloatValue tankFertDistanceCm;
  CachedFloatValue flowWaterLpm;
  CachedFloatValue flowFertLpm;
  CachedFloatValue flowWaterTotalL;
  CachedFloatValue flowFertTotalL;
};


// =============================================================================
// WEEKLY TIMER SOFTWARE - PENGGANTI THC15A
// =============================================================================
// Fitur:
// - 16 program mingguan.
// - Jam aktif dan jam nonaktif masing-masing sampai presisi menit.
// - Mode OTOMATIS / PAKSA AKTIF / PAKSA NONAKTIF.
// - Atur jam & tanggal RTC dari LCD.
// - Hapus satu program / hapus semua program.
// - Semua pengaturan timer disimpan ke NVS.
//
// CATATAN KESELAMATAN:
// Output timer MENGENDALIKAN relay penyiraman CH3 (PUMP_WATER_RELAY).
// CH1 pompa nutrisi TIDAK pernah ikut timer penyiraman.
// Saat timer tidak aktif, CH3 dipaksa OFF. Saat timer aktif, CH3 dipaksa ON.

struct WeeklySchedule {
  bool enabled = false;
  uint8_t daysMask = 0x3F;   // Senin-Sabtu
  uint16_t startMinute = 360; // 06:00
  uint16_t endMinute = 390;   // 06:30
};

static constexpr uint8_t WEEKLY_SCHEDULE_COUNT = 16;

// Hari memakai bit:
// bit0 Senin, bit1 Selasa, bit2 Rabu, bit3 Kamis,
// bit4 Jumat, bit5 Sabtu, bit6 Minggu.
struct DayPreset {
  const char *name;
  uint8_t mask;
};

const DayPreset DAY_PRESETS[] = {
  {"Setiap Hari", 0x7F},
  {"Senin-Jumat", 0x1F},
  {"Senin-Sabtu", 0x3F},
  {"Senin", 0x01},
  {"Selasa", 0x02},
  {"Rabu", 0x04},
  {"Kamis", 0x08},
  {"Jumat", 0x10},
  {"Sabtu", 0x20},
  {"Minggu", 0x40}
};

static constexpr uint8_t DAY_PRESET_COUNT =
  sizeof(DAY_PRESETS) / sizeof(DAY_PRESETS[0]);

enum TimerMode : uint8_t {
  TIMER_MODE_AUTO = 0,
  TIMER_MODE_FORCE_ON = 1,
  TIMER_MODE_FORCE_OFF = 2
};

WeeklySchedule weeklySchedules[WEEKLY_SCHEDULE_COUNT];
WeeklySchedule editSchedule;

TimerMode timerMode = TIMER_MODE_AUTO;
TimerMode editTimerMode = TIMER_MODE_AUTO;

uint8_t scheduleMenuIndex = 0;
uint8_t scheduleEditIndex = 0;
uint8_t scheduleEditField = 0;
bool scheduleValueEditing = false;

RTCDateTime editRtc;
uint8_t rtcEditField = 0;
bool rtcValueEditing = false;

uint8_t clearProgramIndex = 0;
bool clearProgramConfirm = false;
bool clearAllConfirm = false;


// IMPORTANT:
// Button types are intentionally declared before the first function.
// Arduino IDE auto-generates function prototypes; keeping these types here
// prevents "ButtonState does not name a type" on ESP32 Arduino Core 2.0.x.
enum ButtonId : uint8_t {
  BUTTON_CANCEL,
  BUTTON_OK,
  BUTTON_UP,
  BUTTON_DOWN
};

struct ButtonState {
  uint8_t pin;
  bool stablePressed;
  bool lastRawPressed;
  uint32_t rawChangedMs;

  // Untuk fungsi tahan tombol (auto-repeat).
  uint32_t pressedSinceMs;
  uint32_t lastRepeatMs;

  explicit ButtonState(uint8_t buttonPin)
    : pin(buttonPin),
      stablePressed(false),
      lastRawPressed(false),
      rawChangedMs(0),
      pressedSinceMs(0),
      lastRepeatMs(0) {
  }
};

NutriData nutri;
SHTData sht;
SoilData soil1;
SoilData soil2;
SlaveData slaveData;
bool slaveCycleOk = false;
bool nutriCycleOk = false;
bool shtCycleOk = false;

TelemetrySnapshotCache telemetrySnapshot;
uint32_t spffLastTelemetrySentMs = 0;

uint32_t soil1RegLastGoodMs[SOIL_REG_COUNT] = {0};
uint32_t soil2RegLastGoodMs[SOIL_REG_COUNT] = {0};

uint8_t soil1AcquireCursor = 0;
uint8_t soil2AcquireCursor = 0;

// =============================================================================
// FORWARD DECLARATIONS
// =============================================================================
// Explicit declarations ini penting untuk Arduino ESP32 Core 2.0.17.
// Tanpa ini, Arduino preprocessor kadang membuat prototype sebelum struct
// RTCDateTime / SoilData / WeeklySchedule / ButtonState dideklarasikan.

void appSetup();
void appLoop();

void serviceSpffGatewaySerial();
void initializeSpffDeviceStatus();
String buildDeviceStatusPayload();
bool sendDeviceStatus();
bool shouldSendStatusHeartbeat();
void serviceDeviceStatus();
void updateSystemState(bool currentSensorValid);
void captureTelemetrySnapshot();
bool telemetrySnapshotHasAnyValidData();
uint8_t telemetrySnapshotValidFieldCount();
bool shouldPublishTelemetrySnapshot();
void serviceTelemetrySnapshot();
void sendTelemetryIfValid();
const char* spffModeText();
const char* spffSystemStateText();
bool spffWriteJsonLine(const String &json);
bool sendSpffTelemetry();
bool sendSpffActuatorStateEvent(
  const char *targetId,
  bool stateKnown,
  bool actualActive,
  const String &commandId,
  const char *reason
);
void serviceSpffActuatorStateChanges(bool forcePoll = false);
void processSpffCommandLine(const String &line);
void processSpffScheduleSyncLine(
  const String &line,
  size_t rootStart,
  size_t rootEnd
);
void processSpffAutomaticControlSyncLine(
  const String &line,
  size_t rootStart,
  size_t rootEnd
);
void loadSpffSyncedSchedules();
void serviceSpffSyncedScheduleOutput();
void loadSpffAutomaticControl();
void loadSpffAutomaticDailyState();
void serviceSpffAutomaticControl();
bool sendSpffActuatorAckAt(
  const String &commandId,
  const String &targetId,
  const char *acknowledgedAt,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason
);
bool sendSpffActuatorAck(
  const String &commandId,
  const String &targetId,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason,
  String *acknowledgedAtOut = nullptr
);
String spffUtcIso8601();
uint32_t spffUtcEpoch();

bool rtcRead(RTCDateTime &dt);
bool rtcWrite(const RTCDateTime &dt);
RTCDateTime compileDateTime();
bool rtcDateLooksSane(const RTCDateTime &dt);

bool scheduleDayEnabled(
  const WeeklySchedule &schedule,
  uint8_t weekdayIndex
);

bool buttonRawPressed(
  const ButtonState &b
);

void handleButton(
  ButtonId id
);

void serviceOneButton(
  ButtonState &b,
  ButtonId id
);

uint8_t countFreshSoil(
  const SoilData &soil
);

uint8_t countSoilHave(
  const SoilData &soil
);

bool allSoilHaveData(
  const SoilData &soil
);

String staleSoilRegs(
  const SoilData &soil
);

void refreshSoilFreshFlags(
  uint8_t number,
  SoilData &soil
);

bool registerAlreadyChosen(
  uint8_t reg,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount
);

bool chooseMissingRegister(
  uint8_t number,
  const SoilData &soil,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount,
  uint8_t &regOut
);

bool chooseOldestRegister(
  uint8_t number,
  const SoilData &soil,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount,
  uint8_t &selected
);

uint8_t buildSoilTargetList(
  uint8_t number,
  const SoilData &soil,
  uint8_t target[SOIL_REGS_PER_CYCLE]
);

bool readSoil(
  uint8_t number,
  uint8_t sensorId,
  SoilData &soil
);

String soilStateText(
  const SoilData &soil
);

void renderSoilDetail(
  uint8_t number,
  const SoilData &soil
);

void loadSoilNVS(
  uint8_t number,
  SoilData &soil
);

void serviceButtons();
void renderUI();

void initBuzzer();
void serviceBuzzer();
void beepButton();
void serviceLCDRefresh();
void uiDelay(uint32_t ms);
String rtcTimeText(bool withSeconds = true);
String rtcDateText();

WeeklySchedule defaultScheduleFor(uint8_t index);
void loadWeeklyTimerNVS();
void saveScheduleNVS(uint8_t index);
void saveTimerModeNVS();
void clearProgram(uint8_t index);
void clearAllPrograms();

bool weeklyScheduleActive(uint8_t index);
int8_t activeScheduleIndex();
bool timerOutputActive();
void serviceIrrigationTimerOutput();

const char* timerModeText(TimerMode mode);

void openScheduleEditor(uint8_t index);
void changeScheduleValue(int delta);
void commitScheduleEditor();

void openRtcEditor();
void changeRtcValue(int delta);
bool saveRtcEditor();

uint8_t daysInMonth(uint8_t month, uint8_t year2);

// =============================================================================
// UTILITY
// =============================================================================
bool i2cExists(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

uint8_t bcdToDec(uint8_t value) {
  return ((value >> 4) * 10U) + (value & 0x0F);
}

uint8_t decToBcd(uint8_t value) {
  return ((value / 10U) << 4) | (value % 10U);
}

String pad2(uint8_t value) {
  if (value < 10) return "0" + String(value);
  return String(value);
}

// =============================================================================
// RTC PCF85063 @ 0x51
// =============================================================================
bool rtcRead(RTCDateTime &dt) {
  if (!rtcReady) return false;

  Wire.beginTransmission(RTC_ADDR);
  Wire.write(RTC_SECONDS_REG);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  uint8_t requested = Wire.requestFrom((int)RTC_ADDR, 7);
  if (requested != 7) return false;

  uint8_t secRaw = Wire.read();
  uint8_t minRaw = Wire.read();
  uint8_t hourRaw = Wire.read();
  uint8_t dayRaw = Wire.read();
  uint8_t weekRaw = Wire.read();
  uint8_t monthRaw = Wire.read();
  uint8_t yearRaw = Wire.read();

  dt.oscillatorStopped = (secRaw & 0x80) != 0;
  dt.second = bcdToDec(secRaw & 0x7F);
  dt.minute = bcdToDec(minRaw & 0x7F);
  dt.hour = bcdToDec(hourRaw & 0x3F);
  dt.day = bcdToDec(dayRaw & 0x3F);
  dt.weekday = weekRaw & 0x07;
  dt.month = bcdToDec(monthRaw & 0x1F);
  dt.year = bcdToDec(yearRaw);

  dt.valid =
    dt.second < 60 &&
    dt.minute < 60 &&
    dt.hour < 24 &&
    dt.day >= 1 && dt.day <= 31 &&
    dt.month >= 1 && dt.month <= 12 &&
    dt.year <= 99;

  return dt.valid;
}

bool rtcWrite(const RTCDateTime &dt) {
  if (!rtcReady) return false;

  Wire.beginTransmission(RTC_ADDR);
  Wire.write(RTC_SECONDS_REG);
  Wire.write(decToBcd(dt.second) & 0x7F);
  Wire.write(decToBcd(dt.minute) & 0x7F);
  Wire.write(decToBcd(dt.hour) & 0x3F);
  Wire.write(decToBcd(dt.day) & 0x3F);
  Wire.write(dt.weekday & 0x07);
  Wire.write(decToBcd(dt.month) & 0x1F);
  Wire.write(decToBcd(dt.year));

  return Wire.endTransmission() == 0;
}

uint8_t compileMonth(const char *month3) {
  static const char *months[] = {
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  };

  for (uint8_t i = 0; i < 12; i++) {
    if (strncmp(month3, months[i], 3) == 0) return i + 1;
  }

  return 1;
}

RTCDateTime compileDateTime() {
  RTCDateTime dt;

  char month[4] = {__DATE__[0], __DATE__[1], __DATE__[2], '\0'};
  dt.month = compileMonth(month);

  dt.day =
    (__DATE__[4] == ' ' ? 0 : (__DATE__[4] - '0') * 10) +
    (__DATE__[5] - '0');

  int fullYear =
    (__DATE__[7] - '0') * 1000 +
    (__DATE__[8] - '0') * 100 +
    (__DATE__[9] - '0') * 10 +
    (__DATE__[10] - '0');

  dt.year = (uint8_t)(fullYear % 100);

  dt.hour = (__TIME__[0] - '0') * 10 + (__TIME__[1] - '0');
  dt.minute = (__TIME__[3] - '0') * 10 + (__TIME__[4] - '0');
  dt.second = (__TIME__[6] - '0') * 10 + (__TIME__[7] - '0');
  dt.weekday = 0;
  dt.valid = true;
  dt.oscillatorStopped = false;

  return dt;
}

bool rtcDateLooksSane(const RTCDateTime &dt) {
  // Project deployed in 2026; values such as year 00 normally mean the RTC
  // has never been initialized. Keep a broad lower bound so the RTC remains
  // battery-backed after a normal reboot.
  return
    dt.valid &&
    dt.year >= 24 &&
    dt.year <= 99;
}

void initRTC() {
  rtcReady = i2cExists(RTC_ADDR);

  if (!rtcReady) {
    return;
  }

  RTCDateTime dt;

  bool readOk = rtcRead(dt);

  if (
    !readOk ||
    dt.oscillatorStopped ||
    !rtcDateLooksSane(dt)
  ) {
    RTCDateTime compiled = compileDateTime();

    if (rtcWrite(compiled)) {
      rtcNow = compiled;
    } else {
    }
  } else {
    rtcNow = dt;
  }

}

void updateRTC() {
  RTCDateTime dt;
  if (rtcRead(dt)) rtcNow = dt;
}

String rtcTimeText(bool withSeconds) {
  if (!rtcReady || !rtcNow.valid) return "--:--:--";

  String value = pad2(rtcNow.hour) + ":" + pad2(rtcNow.minute);
  if (withSeconds) value += ":" + pad2(rtcNow.second);
  return value;
}

String rtcDateText() {
  if (!rtcReady || !rtcNow.valid) return "--/--/--";
  return pad2(rtcNow.day) + "/" + pad2(rtcNow.month) + "/" + pad2(rtcNow.year);
}


// =============================================================================
// WEEKLY TIMER LOGIC
// =============================================================================
uint8_t weekdayMondayZero(
  uint8_t year2,
  uint8_t month,
  uint8_t day
) {
  // Sakamoto: 0=Sunday .. 6=Saturday.
  static const uint8_t t[] = {
    0, 3, 2, 5, 0, 3,
    5, 1, 4, 6, 2, 4
  };

  int year =
    2000 +
    year2;

  if (month < 3) {
    year -= 1;
  }

  uint8_t sundayZero =
    (uint8_t)(
      (
        year +
        year / 4 -
        year / 100 +
        year / 400 +
        t[month - 1] +
        day
      ) %
      7
    );

  // Monday=0 .. Sunday=6.
  return
    sundayZero == 0
    ? 6
    : sundayZero - 1;
}

uint8_t previousWeekday(
  uint8_t dayIndex
) {
  return
    dayIndex == 0
    ? 6
    : dayIndex - 1;
}

uint16_t buildMinute(
  uint8_t hour,
  uint8_t minute
) {
  return
    (uint16_t)(
      (hour % 24U) *
      60U +
      (minute % 60U)
    );
}

uint8_t scheduleHour(
  uint16_t minuteOfDay
) {
  return
    (minuteOfDay % 1440U) /
    60U;
}

uint8_t scheduleMinutePart(
  uint16_t minuteOfDay
) {
  return
    (minuteOfDay % 1440U) %
    60U;
}

uint8_t findDayPreset(
  uint8_t mask
) {
  for (
    uint8_t i = 0;
    i < DAY_PRESET_COUNT;
    i++
  ) {
    if (
      DAY_PRESETS[i].mask ==
      mask
    ) {
      return i;
    }
  }

  return 0;
}

bool scheduleDayEnabled(
  const WeeklySchedule &schedule,
  uint8_t weekdayIndex
) {
  if (
    weekdayIndex >
    6
  ) {
    return false;
  }

  return
    (
      schedule.daysMask &
      (uint8_t)(
        1U <<
        weekdayIndex
      )
    ) !=
    0;
}

WeeklySchedule defaultScheduleFor(
  uint8_t index
) {
  WeeklySchedule defaults;

  defaults.enabled =
    false;

  defaults.daysMask =
    0x3F;

  // Waktu default berurutan supaya 16 program mudah dibedakan.
  // Semua tetap NONAKTIF sampai operator mengaktifkannya.
  defaults.startMinute =
    (uint16_t)(
      (
        360U +
        (uint16_t)index *
        30U
      ) %
      1440U
    );

  defaults.endMinute =
    (uint16_t)(
      (
        defaults.startMinute +
        30U
      ) %
      1440U
    );

  return defaults;
}

bool weeklyScheduleActive(
  uint8_t index
) {
  if (
    index >=
      WEEKLY_SCHEDULE_COUNT ||
    !rtcReady ||
    !rtcNow.valid
  ) {
    return false;
  }

  const WeeklySchedule &schedule =
    weeklySchedules[index];

  if (
    !schedule.enabled
  ) {
    return false;
  }

  uint8_t today =
    weekdayMondayZero(
      rtcNow.year,
      rtcNow.month,
      rtcNow.day
    );

  uint16_t nowMinute =
    (uint16_t)rtcNow.hour *
    60U +
    rtcNow.minute;

  uint16_t start =
    schedule.startMinute %
    1440U;

  uint16_t finish =
    schedule.endMinute %
    1440U;

  // Jam aktif == jam nonaktif dianggap program kosong.
  if (
    start ==
    finish
  ) {
    return false;
  }

  // Jadwal dalam hari yang sama.
  if (
    start <
    finish
  ) {
    return
      scheduleDayEnabled(
        schedule,
        today
      ) &&
      nowMinute >=
        start &&
      nowMinute <
        finish;
  }

  // Jadwal melewati tengah malam.
  // Contoh Senin 23:00 -> Selasa 01:00.
  if (
    nowMinute >=
    start
  ) {
    return
      scheduleDayEnabled(
        schedule,
        today
      );
  }

  return
    nowMinute <
      finish &&
    scheduleDayEnabled(
      schedule,
      previousWeekday(
        today
      )
    );
}

int8_t activeScheduleIndex() {
  for (
    uint8_t i = 0;
    i < WEEKLY_SCHEDULE_COUNT;
    i++
  ) {
    if (
      weeklyScheduleActive(
        i
      )
    ) {
      return
        (int8_t)i;
    }
  }

  return -1;
}

const char* timerModeText(
  TimerMode mode
) {
  if (SPFF_DISABLE_LEGACY_LOCAL_TIMER) {
    return "BACKEND";
  }

  switch (mode) {
    case TIMER_MODE_FORCE_ON:
      return "PAKSA AKTIF";

    case TIMER_MODE_FORCE_OFF:
      return "PAKSA NONAKTIF";

    case TIMER_MODE_AUTO:
    default:
      return "OTOMATIS";
  }
}

bool timerOutputActive() {
  switch (timerMode) {
    case TIMER_MODE_FORCE_ON:
      return true;

    case TIMER_MODE_FORCE_OFF:
      return false;

    case TIMER_MODE_AUTO:
    default:
      return
        activeScheduleIndex() >=
        0;
  }
}

// Nama lama dipertahankan supaya integrasi berikutnya tidak perlu dirombak.
void loadWeeklyTimerNVS() {
  for (
    uint8_t i = 0;
    i < WEEKLY_SCHEDULE_COUNT;
    i++
  ) {
    WeeklySchedule defaults =
      defaultScheduleFor(i);

    String prefix =
      "j" +
      String(i + 1);

    weeklySchedules[i].enabled =
      prefs.getBool(
        (prefix + "en").c_str(),
        defaults.enabled
      );

    weeklySchedules[i].daysMask =
      prefs.getUChar(
        (prefix + "day").c_str(),
        defaults.daysMask
      );

    weeklySchedules[i].startMinute =
      prefs.getUShort(
        (prefix + "start").c_str(),
        defaults.startMinute
      );

    weeklySchedules[i].endMinute =
      prefs.getUShort(
        (prefix + "end").c_str(),
        defaults.endMinute
      );

    if (
      weeklySchedules[i].daysMask ==
        0 ||
      weeklySchedules[i].daysMask >
        0x7F
    ) {
      weeklySchedules[i].daysMask =
        defaults.daysMask;
    }

    weeklySchedules[i].startMinute %=
      1440U;

    weeklySchedules[i].endMinute %=
      1440U;
  }

  uint8_t storedMode =
    prefs.getUChar(
      "timer_mode",
      (uint8_t)TIMER_MODE_AUTO
    );

  if (
    storedMode >
    (uint8_t)TIMER_MODE_FORCE_OFF
  ) {
    storedMode =
      (uint8_t)TIMER_MODE_AUTO;
  }

  timerMode =
    (TimerMode)storedMode;

  editTimerMode =
    timerMode;
}

void saveScheduleNVS(
  uint8_t index
) {
  if (
    index >=
    WEEKLY_SCHEDULE_COUNT
  ) {
    return;
  }

  String prefix =
    "j" +
    String(index + 1);

  prefs.putBool(
    (prefix + "en").c_str(),
    weeklySchedules[index].enabled
  );

  prefs.putUChar(
    (prefix + "day").c_str(),
    weeklySchedules[index].daysMask
  );

  prefs.putUShort(
    (prefix + "start").c_str(),
    weeklySchedules[index].startMinute
  );

  prefs.putUShort(
    (prefix + "end").c_str(),
    weeklySchedules[index].endMinute
  );
}

void saveTimerModeNVS() {
  prefs.putUChar(
    "timer_mode",
    (uint8_t)timerMode
  );
}

void clearProgram(
  uint8_t index
) {
  if (
    index >=
    WEEKLY_SCHEDULE_COUNT
  ) {
    return;
  }

  weeklySchedules[index] =
    defaultScheduleFor(
      index
    );

  saveScheduleNVS(
    index
  );

}

void clearAllPrograms() {
  for (
    uint8_t i = 0;
    i < WEEKLY_SCHEDULE_COUNT;
    i++
  ) {
    weeklySchedules[i] =
      defaultScheduleFor(i);

    saveScheduleNVS(i);
  }

}

void openScheduleEditor(
  uint8_t index
) {
  if (
    index >=
    WEEKLY_SCHEDULE_COUNT
  ) {
    return;
  }

  scheduleEditIndex =
    index;

  editSchedule =
    weeklySchedules[index];

  scheduleEditField =
    0;

  scheduleValueEditing =
    false;
}

void changeScheduleValue(
  int delta
) {
  uint8_t startHour =
    scheduleHour(
      editSchedule.startMinute
    );

  uint8_t startMinute =
    scheduleMinutePart(
      editSchedule.startMinute
    );

  uint8_t endHour =
    scheduleHour(
      editSchedule.endMinute
    );

  uint8_t endMinute =
    scheduleMinutePart(
      editSchedule.endMinute
    );

  switch (
    scheduleEditField
  ) {
    case 0:
      editSchedule.enabled =
        !editSchedule.enabled;
      break;

    case 1: {
      uint8_t preset =
        findDayPreset(
          editSchedule.daysMask
        );

      int next =
        (int)preset +
        delta;

      if (
        next <
        0
      ) {
        next =
          DAY_PRESET_COUNT -
          1;
      }

      if (
        next >=
        DAY_PRESET_COUNT
      ) {
        next = 0;
      }

      editSchedule.daysMask =
        DAY_PRESETS[next].mask;
      break;
    }

    case 2: {
      int next =
        (int)startHour +
        delta;

      if (
        next <
        0
      ) {
        next = 23;
      }

      if (
        next >
        23
      ) {
        next = 0;
      }

      editSchedule.startMinute =
        buildMinute(
          (uint8_t)next,
          startMinute
        );
      break;
    }

    case 3: {
      int next =
        (int)startMinute +
        delta;

      if (
        next <
        0
      ) {
        next = 59;
      }

      if (
        next >
        59
      ) {
        next = 0;
      }

      editSchedule.startMinute =
        buildMinute(
          startHour,
          (uint8_t)next
        );
      break;
    }

    case 4: {
      int next =
        (int)endHour +
        delta;

      if (
        next <
        0
      ) {
        next = 23;
      }

      if (
        next >
        23
      ) {
        next = 0;
      }

      editSchedule.endMinute =
        buildMinute(
          (uint8_t)next,
          endMinute
        );
      break;
    }

    case 5: {
      int next =
        (int)endMinute +
        delta;

      if (
        next <
        0
      ) {
        next = 59;
      }

      if (
        next >
        59
      ) {
        next = 0;
      }

      editSchedule.endMinute =
        buildMinute(
          endHour,
          (uint8_t)next
        );
      break;
    }
  }
}

void commitScheduleEditor() {
  if (
    scheduleEditIndex >=
    WEEKLY_SCHEDULE_COUNT
  ) {
    return;
  }

  weeklySchedules[
    scheduleEditIndex
  ] =
    editSchedule;

  saveScheduleNVS(
    scheduleEditIndex
  );

}

bool leapYear(
  uint16_t fullYear
) {
  return
    (
      fullYear %
      400U
    ) ==
      0U ||
    (
      (
        fullYear %
        4U
      ) ==
        0U &&
      (
        fullYear %
        100U
      ) !=
        0U
    );
}

uint8_t daysInMonth(
  uint8_t month,
  uint8_t year2
) {
  static const uint8_t days[] = {
    31, 28, 31, 30,
    31, 30, 31, 31,
    30, 31, 30, 31
  };

  if (
    month <
      1 ||
    month >
      12
  ) {
    return 31;
  }

  if (
    month ==
      2 &&
    leapYear(
      2000U +
      year2
    )
  ) {
    return 29;
  }

  return
    days[
      month -
      1
    ];
}

void normalizeRtcEditDay() {
  uint8_t maximum =
    daysInMonth(
      editRtc.month,
      editRtc.year
    );

  if (
    editRtc.day <
    1
  ) {
    editRtc.day =
      maximum;
  }

  if (
    editRtc.day >
    maximum
  ) {
    editRtc.day =
      1;
  }
}

void openRtcEditor() {
  if (
    rtcReady &&
    rtcNow.valid
  ) {
    editRtc =
      rtcNow;
  } else {
    editRtc =
      compileDateTime();
  }

  editRtc.second =
    0;

  rtcEditField =
    0;

  rtcValueEditing =
    false;
}

void changeRtcValue(
  int delta
) {
  switch (
    rtcEditField
  ) {
    case 0: {
      int next =
        (int)editRtc.day +
        delta;

      uint8_t maximum =
        daysInMonth(
          editRtc.month,
          editRtc.year
        );

      if (
        next <
        1
      ) {
        next =
          maximum;
      }

      if (
        next >
        maximum
      ) {
        next = 1;
      }

      editRtc.day =
        (uint8_t)next;
      break;
    }

    case 1: {
      int next =
        (int)editRtc.month +
        delta;

      if (
        next <
        1
      ) {
        next = 12;
      }

      if (
        next >
        12
      ) {
        next = 1;
      }

      editRtc.month =
        (uint8_t)next;

      normalizeRtcEditDay();
      break;
    }

    case 2: {
      int next =
        (int)editRtc.year +
        delta;

      if (
        next <
        24
      ) {
        next = 99;
      }

      if (
        next >
        99
      ) {
        next = 24;
      }

      editRtc.year =
        (uint8_t)next;

      normalizeRtcEditDay();
      break;
    }

    case 3: {
      int next =
        (int)editRtc.hour +
        delta;

      if (
        next <
        0
      ) {
        next = 23;
      }

      if (
        next >
        23
      ) {
        next = 0;
      }

      editRtc.hour =
        (uint8_t)next;
      break;
    }

    case 4: {
      int next =
        (int)editRtc.minute +
        delta;

      if (
        next <
        0
      ) {
        next = 59;
      }

      if (
        next >
        59
      ) {
        next = 0;
      }

      editRtc.minute =
        (uint8_t)next;
      break;
    }
  }
}

bool saveRtcEditor() {
  if (
    !rtcReady
  ) {

    return false;
  }

  normalizeRtcEditDay();

  editRtc.second =
    0;

  editRtc.weekday =
    weekdayMondayZero(
      editRtc.year,
      editRtc.month,
      editRtc.day
    );

  editRtc.valid =
    true;

  editRtc.oscillatorStopped =
    false;

  if (
    !rtcWrite(
      editRtc
    )
  ) {

    return false;
  }

  rtcNow =
    editRtc;


  return true;
}


String rtcHeader() {
  return rtcTimeText(true) + " " + rtcDateText();
}

// =============================================================================
// BUTTONS
// =============================================================================
ButtonState btnCancel(BTN_CANCEL_PIN);
ButtonState btnOk(BTN_OK_PIN);
ButtonState btnUp(BTN_UP_PIN);
ButtonState btnDown(BTN_DOWN_PIN);

// Lebih responsif daripada nilai lama 60 ms, tetapi masih aman dari bounce.
static constexpr uint32_t BUTTON_DEBOUNCE_MS = 25UL;

// Tahan UP/DOWN:
// - satu aksi langsung saat ditekan
// - setelah 320 ms mulai auto-repeat
// - makin lama ditahan, repeat makin cepat
static constexpr uint32_t BUTTON_HOLD_START_MS = 320UL;
static constexpr uint32_t BUTTON_REPEAT_NORMAL_MS = 95UL;
static constexpr uint32_t BUTTON_REPEAT_FAST_MS = 55UL;
static constexpr uint32_t BUTTON_REPEAT_TURBO_MS = 35UL;
static constexpr uint32_t BUTTON_FAST_AFTER_MS = 1200UL;
static constexpr uint32_t BUTTON_TURBO_AFTER_MS = 2800UL;

uint32_t buzzerOffAtMs = 0;
bool buzzerIsOn = false;

void initBuzzer() {
  // ESP32 Arduino Core lama:
  // setup channel -> attach pin -> tone OFF.
  ledcSetup(
    BUZZER_CHANNEL,
    BUZZER_FREQ_HZ,
    BUZZER_RESOLUTION_BITS
  );
  ledcAttachPin(
    BUZZER_PIN,
    BUZZER_CHANNEL
  );
  ledcWriteTone(
    BUZZER_CHANNEL,
    0
  );

  buzzerIsOn = false;
  buzzerOffAtMs = 0;
}

void beepButton() {
  // Restart tone setiap kali ada PRESS fisik.
  ledcWriteTone(
    BUZZER_CHANNEL,
    BUZZER_FREQ_HZ
  );

  buzzerIsOn = true;
  buzzerOffAtMs =
    millis() + BUTTON_BEEP_MS;
}

void serviceBuzzer() {
  if (
    buzzerIsOn &&
    (int32_t)(millis() - buzzerOffAtMs) >= 0
  ) {
    ledcWriteTone(
      BUZZER_CHANNEL,
      0
    );

    buzzerIsOn = false;
  }
}

enum UIScreen {
  UI_MAIN,

  // Menu utama baru:
  // 1) Monitoring seluruh sensor
  // 2) Status seluruh sensor
  // 3) Pengaturan
  UI_MONITOR,
  UI_SENSOR_STATUS,
  UI_SETTINGS,

  // Screen legacy tetap dipertahankan agar fungsi lama tidak rusak.
  UI_SOIL_MENU,
  UI_SOIL1,
  UI_SOIL2,
  UI_TANK_FLOW,
  UI_SYSTEM,

  UI_TIMER_MENU,
  UI_TIMER_MODE,
  UI_SCHEDULE_EDIT,
  UI_RTC_EDIT,
  UI_CLEAR_PROGRAM,
  UI_CLEAR_ALL,
  UI_TIMER_STATUS,

  UI_CALIBRATION_MENU,
  UI_CALIBRATION_INFO,
  UI_WIFI_OTA,

  UI_BUTTON_TEST,
  UI_ABOUT
};

UIScreen uiScreen =
  UI_MAIN;

UIScreen rtcReturnScreen =
  UI_TIMER_MENU;

const char *MAIN_ITEMS[] = {
  "Monitoring",
  "Status Sensor",
  "Pengaturan"
};

static constexpr uint8_t MAIN_COUNT =
  3;

const char *SOIL_ITEMS[] = {
  "Sensor Tanah 1",
  "Sensor Tanah 2"
};

const char *SETTING_ITEMS[] = {
  "Timer Mingguan",
  "Waktu & Tanggal",
  "Kalibrasi Sensor",
  "WiFi & OTA",
  "Tes Tombol",
  "Tentang"
};

static constexpr uint8_t SETTING_COUNT =
  6;

const char *CALIB_ITEMS[] = {
  "Nutrisi pH/EC/T",
  "Udara T/RH",
  "Tanah 1 (7-in-1)",
  "Tanah 2 (7-in-1)",
  "Level Tandon",
  "Flow Air/Pupuk"
};

static constexpr uint8_t CALIB_COUNT =
  6;

uint8_t calibIndex = 0;

const char *TIMER_ITEMS[] = {
  "Mode Timer",
  "Program 1",
  "Program 2",
  "Program 3",
  "Program 4",
  "Program 5",
  "Program 6",
  "Program 7",
  "Program 8",
  "Program 9",
  "Program 10",
  "Program 11",
  "Program 12",
  "Program 13",
  "Program 14",
  "Program 15",
  "Program 16",
  "Atur Jam & Tanggal",
  "Hapus Program",
  "Hapus Semua",
  "Status Timer"
};

static constexpr uint8_t TIMER_MENU_COUNT =
  21;

uint8_t mainIndex =
  0;

uint8_t soilIndex =
  0;

uint8_t settingIndex =
  0;

bool buttonRawPressed(
  const ButtonState &b
) {
  return
    digitalRead(
      b.pin
    ) ==
    LOW;
}

void initButtons() {
  pinMode(
    BTN_CANCEL_PIN,
    INPUT_PULLUP
  );

  pinMode(
    BTN_OK_PIN,
    INPUT_PULLUP
  );

  pinMode(
    BTN_UP_PIN,
    INPUT_PULLUP
  );

  pinMode(
    BTN_DOWN_PIN,
    INPUT_PULLUP
  );

  delay(100);

  btnCancel.lastRawPressed =
    buttonRawPressed(
      btnCancel
    );

  btnOk.lastRawPressed =
    buttonRawPressed(
      btnOk
    );

  btnUp.lastRawPressed =
    buttonRawPressed(
      btnUp
    );

  btnDown.lastRawPressed =
    buttonRawPressed(
      btnDown
    );

  // Sinkronkan stable state saat boot.
  btnCancel.stablePressed = btnCancel.lastRawPressed;
  btnOk.stablePressed     = btnOk.lastRawPressed;
  btnUp.stablePressed     = btnUp.lastRawPressed;
  btnDown.stablePressed   = btnDown.lastRawPressed;

}

void moveSelection(
  uint8_t &index,
  uint8_t count,
  int delta
) {
  if (
    count ==
    0
  ) {
    return;
  }

  int next =
    (int)index +
    delta;

  if (
    next <
    0
  ) {
    next =
      count -
      1;
  }

  if (
    next >=
    count
  ) {
    next = 0;
  }

  index =
    (uint8_t)next;
}

void handleButton(
  ButtonId id
) {
  switch (
    uiScreen
  ) {
    case UI_MAIN:
      if (
        id ==
        BUTTON_UP
      ) {
        moveSelection(
          mainIndex,
          MAIN_COUNT,
          -1
        );
      }

      if (
        id ==
        BUTTON_DOWN
      ) {
        moveSelection(
          mainIndex,
          MAIN_COUNT,
          +1
        );
      }

      if (
        id ==
        BUTTON_OK
      ) {
        switch (
          mainIndex
        ) {
          case 0:
            uiScreen =
              UI_MONITOR;
            break;

          case 1:
            uiScreen =
              UI_SENSOR_STATUS;
            break;

          case 2:
            uiScreen =
              UI_SETTINGS;
            break;
        }
      }
      break;

    case UI_MONITOR:
    case UI_SENSOR_STATUS:
    case UI_TANK_FLOW:
    case UI_SYSTEM:
    case UI_SOIL1:
    case UI_SOIL2:
    case UI_BUTTON_TEST:
    case UI_ABOUT:
      if (
        id ==
        BUTTON_CANCEL
      ) {
        uiScreen =
          UI_MAIN;
      }
      break;

    case UI_SOIL_MENU:
      if (
        id ==
        BUTTON_UP
      ) {
        moveSelection(
          soilIndex,
          2,
          -1
        );
      }

      if (
        id ==
        BUTTON_DOWN
      ) {
        moveSelection(
          soilIndex,
          2,
          +1
        );
      }

      if (
        id ==
        BUTTON_CANCEL
      ) {
        uiScreen =
          UI_MAIN;
      }

      if (
        id ==
        BUTTON_OK
      ) {
        uiScreen =
          soilIndex ==
            0
          ? UI_SOIL1
          : UI_SOIL2;
      }
      break;

    case UI_SETTINGS:
      if (
        id ==
        BUTTON_UP
      ) {
        moveSelection(
          settingIndex,
          SETTING_COUNT,
          -1
        );
      }

      if (
        id ==
        BUTTON_DOWN
      ) {
        moveSelection(
          settingIndex,
          SETTING_COUNT,
          +1
        );
      }

      if (
        id ==
        BUTTON_CANCEL
      ) {
        uiScreen =
          UI_MAIN;
      }

      if (
        id ==
        BUTTON_OK
      ) {
        switch (
          settingIndex
        ) {
          case 0:
            uiScreen =
              UI_TIMER_MENU;
            break;

          case 1:
            rtcReturnScreen =
              UI_SETTINGS;

            openRtcEditor();

            uiScreen =
              UI_RTC_EDIT;
            break;

          case 2:
            uiScreen =
              UI_CALIBRATION_MENU;
            break;

          case 3:
            uiScreen =
              UI_WIFI_OTA;
            break;

          case 4:
            uiScreen =
              UI_BUTTON_TEST;
            break;

          case 5:
            uiScreen =
              UI_ABOUT;
            break;
        }
      }
      break;

    case UI_CALIBRATION_MENU:
      if (id == BUTTON_UP) {
        moveSelection(
          calibIndex,
          CALIB_COUNT,
          -1
        );
      }

      if (id == BUTTON_DOWN) {
        moveSelection(
          calibIndex,
          CALIB_COUNT,
          +1
        );
      }

      if (id == BUTTON_CANCEL) {
        uiScreen =
          UI_SETTINGS;
      }

      if (id == BUTTON_OK) {
        uiScreen =
          UI_CALIBRATION_INFO;
      }
      break;

    case UI_CALIBRATION_INFO:
      if (
        id == BUTTON_CANCEL ||
        id == BUTTON_OK
      ) {
        uiScreen =
          UI_CALIBRATION_MENU;
      }
      break;

    case UI_WIFI_OTA:
      if (id == BUTTON_CANCEL) {
        uiScreen =
          UI_SETTINGS;
      }
      break;

    case UI_TIMER_MENU:
      if (
        id ==
        BUTTON_UP
      ) {
        moveSelection(
          scheduleMenuIndex,
          TIMER_MENU_COUNT,
          -1
        );
      }

      if (
        id ==
        BUTTON_DOWN
      ) {
        moveSelection(
          scheduleMenuIndex,
          TIMER_MENU_COUNT,
          +1
        );
      }

      if (
        id ==
        BUTTON_CANCEL
      ) {
        uiScreen =
          UI_SETTINGS;
      }

      if (
        id ==
        BUTTON_OK
      ) {
        if (
          scheduleMenuIndex ==
          0
        ) {
          editTimerMode =
            timerMode;

          uiScreen =
            UI_TIMER_MODE;
        }
        else if (
          scheduleMenuIndex >=
            1 &&
          scheduleMenuIndex <=
            16
        ) {
          openScheduleEditor(
            scheduleMenuIndex -
            1
          );

          uiScreen =
            UI_SCHEDULE_EDIT;
        }
        else if (
          scheduleMenuIndex ==
          17
        ) {
          rtcReturnScreen =
            UI_TIMER_MENU;

          openRtcEditor();

          uiScreen =
            UI_RTC_EDIT;
        }
        else if (
          scheduleMenuIndex ==
          18
        ) {
          clearProgramConfirm =
            false;

          uiScreen =
            UI_CLEAR_PROGRAM;
        }
        else if (
          scheduleMenuIndex ==
          19
        ) {
          clearAllConfirm =
            false;

          uiScreen =
            UI_CLEAR_ALL;
        }
        else {
          uiScreen =
            UI_TIMER_STATUS;
        }
      }
      break;

    case UI_TIMER_MODE:
      if (
        id ==
        BUTTON_UP
      ) {
        int next =
          (int)editTimerMode -
          1;

        if (
          next <
          0
        ) {
          next =
            (int)TIMER_MODE_FORCE_OFF;
        }

        editTimerMode =
          (TimerMode)next;
      }

      if (
        id ==
        BUTTON_DOWN
      ) {
        int next =
          (int)editTimerMode +
          1;

        if (
          next >
          (int)TIMER_MODE_FORCE_OFF
        ) {
          next =
            (int)TIMER_MODE_AUTO;
        }

        editTimerMode =
          (TimerMode)next;
      }

      if (
        id ==
        BUTTON_CANCEL
      ) {
        editTimerMode =
          timerMode;

        uiScreen =
          UI_TIMER_MENU;
      }

      if (
        id ==
        BUTTON_OK
      ) {
        timerMode =
          editTimerMode;

        saveTimerModeNVS();


        uiScreen =
          UI_TIMER_MENU;
      }
      break;

    case UI_SCHEDULE_EDIT:
      if (
        scheduleValueEditing
      ) {
        if (
          id ==
          BUTTON_UP
        ) {
          changeScheduleValue(
            +1
          );
        }

        if (
          id ==
          BUTTON_DOWN
        ) {
          changeScheduleValue(
            -1
          );
        }

        if (
          id ==
            BUTTON_OK ||
          id ==
            BUTTON_CANCEL
        ) {
          scheduleValueEditing =
            false;
        }
      } else {
        if (
          id ==
          BUTTON_UP
        ) {
          moveSelection(
            scheduleEditField,
            7,
            -1
          );
        }

        if (
          id ==
          BUTTON_DOWN
        ) {
          moveSelection(
            scheduleEditField,
            7,
            +1
          );
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          uiScreen =
            UI_TIMER_MENU;
        }

        if (
          id ==
          BUTTON_OK
        ) {
          if (
            scheduleEditField ==
            6
          ) {
            commitScheduleEditor();

            uiScreen =
              UI_TIMER_MENU;
          } else {
            scheduleValueEditing =
              true;
          }
        }
      }
      break;

    case UI_RTC_EDIT:
      if (
        rtcValueEditing
      ) {
        if (
          id ==
          BUTTON_UP
        ) {
          changeRtcValue(
            +1
          );
        }

        if (
          id ==
          BUTTON_DOWN
        ) {
          changeRtcValue(
            -1
          );
        }

        if (
          id ==
            BUTTON_OK ||
          id ==
            BUTTON_CANCEL
        ) {
          rtcValueEditing =
            false;
        }
      } else {
        if (
          id ==
          BUTTON_UP
        ) {
          moveSelection(
            rtcEditField,
            6,
            -1
          );
        }

        if (
          id ==
          BUTTON_DOWN
        ) {
          moveSelection(
            rtcEditField,
            6,
            +1
          );
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          uiScreen =
            rtcReturnScreen;
        }

        if (
          id ==
          BUTTON_OK
        ) {
          if (
            rtcEditField ==
            5
          ) {
            if (
              saveRtcEditor()
            ) {
              uiScreen =
                UI_TIMER_MENU;
            }
          } else {
            rtcValueEditing =
              true;
          }
        }
      }
      break;

    case UI_CLEAR_PROGRAM:
      if (
        !clearProgramConfirm
      ) {
        if (
          id ==
          BUTTON_UP
        ) {
          moveSelection(
            clearProgramIndex,
            WEEKLY_SCHEDULE_COUNT,
            -1
          );
        }

        if (
          id ==
          BUTTON_DOWN
        ) {
          moveSelection(
            clearProgramIndex,
            WEEKLY_SCHEDULE_COUNT,
            +1
          );
        }

        if (
          id ==
          BUTTON_OK
        ) {
          clearProgramConfirm =
            true;
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          uiScreen =
            UI_TIMER_MENU;
        }
      } else {
        if (
          id ==
          BUTTON_OK
        ) {
          clearProgram(
            clearProgramIndex
          );

          clearProgramConfirm =
            false;

          uiScreen =
            UI_TIMER_MENU;
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          clearProgramConfirm =
            false;
        }
      }
      break;

    case UI_CLEAR_ALL:
      if (
        !clearAllConfirm
      ) {
        if (
          id ==
          BUTTON_OK
        ) {
          clearAllConfirm =
            true;
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          uiScreen =
            UI_TIMER_MENU;
        }
      } else {
        if (
          id ==
          BUTTON_OK
        ) {
          clearAllPrograms();

          clearAllConfirm =
            false;

          uiScreen =
            UI_TIMER_MENU;
        }

        if (
          id ==
          BUTTON_CANCEL
        ) {
          clearAllConfirm =
            false;
        }
      }
      break;

    case UI_TIMER_STATUS:
      if (
        id ==
        BUTTON_CANCEL
      ) {
        uiScreen =
          UI_TIMER_MENU;
      }
      break;
  }

  renderUI();
}

void serviceOneButton(ButtonState &b, ButtonId id) {
  bool raw = buttonRawPressed(b);
  uint32_t now = millis();

  if (raw != b.lastRawPressed) {
    b.lastRawPressed = raw;
    b.rawChangedMs = now;
  }

  // Perubahan state yang sudah lolos debounce.
  if (
    raw != b.stablePressed &&
    (uint32_t)(now - b.rawChangedMs) >= BUTTON_DEBOUNCE_MS
  ) {
    b.stablePressed = raw;

    if (b.stablePressed) {
      b.pressedSinceMs = now;
      b.lastRepeatMs = now;

      // Setiap PRESS fisik berbunyi satu kali.
      // Non-blocking: tidak ada delay() untuk buzzer.
      beepButton();

      handleButton(id);
    } else {
      b.pressedSinceMs = 0;
      b.lastRepeatMs = 0;
    }

    return;
  }

  // Auto-repeat HANYA untuk UP dan DOWN.
  // OK/CANCEL sengaja one-shot agar tidak double-save / double-delete
  // ketika tombol tidak sengaja ditahan.
  if (
    b.stablePressed &&
    raw &&
    (
      id == BUTTON_UP ||
      id == BUTTON_DOWN
    )
  ) {
    uint32_t heldMs =
      (uint32_t)(now - b.pressedSinceMs);

    if (heldMs < BUTTON_HOLD_START_MS) {
      return;
    }

    uint32_t repeatMs = BUTTON_REPEAT_NORMAL_MS;

    if (heldMs >= BUTTON_TURBO_AFTER_MS) {
      repeatMs = BUTTON_REPEAT_TURBO_MS;
    } else if (heldMs >= BUTTON_FAST_AFTER_MS) {
      repeatMs = BUTTON_REPEAT_FAST_MS;
    }

    if (
      (uint32_t)(now - b.lastRepeatMs) >= repeatMs
    ) {
      b.lastRepeatMs = now;

      // Tidak beep pada setiap repeat supaya buzzer tidak "machine-gun".
      handleButton(id);
    }
  }
}

void serviceButtons() {
  serviceOneButton(btnCancel, BUTTON_CANCEL);
  serviceOneButton(btnOk, BUTTON_OK);
  serviceOneButton(btnUp, BUTTON_UP);
  serviceOneButton(btnDown, BUTTON_DOWN);
}

// =============================================================================
// RELAY / TCA9554
// =============================================================================
bool tcaWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool tcaRead(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);

  if (
    Wire.endTransmission(false) !=
    0
  ) {
    return false;
  }

  if (
    Wire.requestFrom(
      (int)TCA9554_ADDR,
      1
    ) !=
    1
  ) {
    return false;
  }

  value =
    Wire.read();

  return true;
}

bool setRelay(uint8_t channel, bool on) {
  if (!relayReady || channel < 1 || channel > 8) return false;

  uint8_t mask = (uint8_t)(1U << (channel - 1));
  uint8_t nextState = relayState;

  if (on) {
    nextState |= mask;
  } else {
    nextState &= (uint8_t)~mask;
  }

  if (
    !tcaWrite(
      TCA_OUTPUT_REG,
      nextState
    )
  ) {
    return false;
  }

  relayState =
    nextState;

  return true;
}

bool relayOutputReadback(
  uint8_t channel,
  bool &isActive
) {
  if (
    !relayReady ||
    channel < 1 ||
    channel > 8
  ) {
    return false;
  }

  uint8_t value = 0;

  if (
    !tcaRead(
      TCA_OUTPUT_REG,
      value
    )
  ) {
    return false;
  }

  relayState =
    value;

  uint8_t mask =
    (uint8_t)(
      1U <<
      (channel - 1)
    );

  isActive =
    (value & mask) !=
    0;

  return true;
}

bool setPumpOutput(
  uint8_t channel,
  bool requestedActive,
  bool &actualActive
) {
  if (
    !setRelay(
      channel,
      requestedActive
    )
  ) {
    return false;
  }

  // Beri waktu singkat untuk output expander berubah.
  // Gunakan delay biasa agar command handler tidak re-enter ke parser serial.
  delay(60);

  if (
    !relayOutputReadback(
      channel,
      actualActive
    )
  ) {
    return false;
  }

  return
    actualActive ==
    requestedActive;
}

// =============================================================================
// WEEKLY TIMER -> RELAY PENYIRAMAN CH3
// =============================================================================
// Timer software hanya mengendalikan PUMP_WATER_RELAY, yang pada wiring fisik
// adalah CH3. Pompa nutrisi CH1 tidak disentuh oleh fungsi ini.
//
// Prioritas pada mode timer:
// - OTOMATIS          : CH3 mengikuti jadwal mingguan.
// - PAKSA AKTIF       : CH3 ON terus.
// - PAKSA NONAKTIF    : CH3 OFF terus.
//
// Pada build legacy fungsi ini menulis CH3 terus-menerus. Build server-control
// menonaktifkan writer tersebut agar command manual dan schedule Orange Pi
// menjadi satu-satunya sumber perubahan output pompa.
void serviceIrrigationTimerOutput() {
  // Backend server mengevaluasi jadwal dan mengirim set_pump untuk ON/OFF.
  // Guard ini mencegah timer lokal membatalkan command remote pump_water.
  if (SPFF_DISABLE_LEGACY_LOCAL_TIMER) {
    serviceSpffSyncedScheduleOutput();
    return;
  }

  if (!relayReady) {
    return;
  }

  const bool requestedActive = timerOutputActive();
  const uint8_t mask =
    (uint8_t)(1U << (PUMP_WATER_RELAY - 1));

  const bool currentActive =
    (relayState & mask) != 0;

  // Hindari write I2C berulang jika state sudah sesuai.
  if (currentActive == requestedActive) {
    return;
  }

  bool actualActive = false;
  const bool ok = setPumpOutput(
    PUMP_WATER_RELAY,
    requestedActive,
    actualActive
  );

  if (ok) {
  } else {
  }
}

// SHT20 sekarang terhubung langsung ke bus RS485.
// Fungsi ini dipertahankan sebagai NO-OP agar alur polling sensor lama
// tidak perlu diubah besar-besaran.
void initRelay() {
  relayReady =
    i2cExists(
      TCA9554_ADDR
    );

  if (!relayReady) {
    return;
  }

  // Fail-safe boot: semua relay OFF.
  relayState = 0;

  bool ok =
    tcaWrite(
      TCA_OUTPUT_REG,
      relayState
    );

  ok =
    tcaWrite(
      TCA_POLARITY_REG,
      0x00
    ) &&
    ok;

  ok =
    tcaWrite(
      TCA_CONFIG_REG,
      0x00
    ) &&
    ok;

  if (!ok) {
    relayReady = false;


    return;
  }

}

// =============================================================================
// MODBUS CORE
// =============================================================================
uint16_t modbusCRC(const uint8_t *data, size_t len) {
  uint16_t crc = 0xFFFF;

  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];

    for (uint8_t bit = 0; bit < 8; bit++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }

  return crc;
}

bool validCRC(const uint8_t *frame, size_t len) {
  if (len < 4) return false;

  uint16_t expected =
    (uint16_t)frame[len - 2] |
    ((uint16_t)frame[len - 1] << 8);

  return modbusCRC(frame, len - 2) == expected;
}

void clearBus() {
  while (RS485.available()) RS485.read();
}

void setBusBaud(uint32_t baud, bool force = false) {
  if (!force && activeBaud == baud) {
    clearBus();
    return;
  }

  RS485.end();
  delay(50);

  RS485.begin(
    baud,
    SERIAL_8N1,
    RS485_RX_PIN,
    RS485_TX_PIN,
    false
  );

  activeBaud = baud;

  uiDelay(180);
  clearBus();
}

size_t modbusReadRaw(
  uint32_t baud,
  uint8_t id,
  uint8_t functionCode,
  uint16_t startReg,
  uint16_t count,
  uint8_t *rx,
  size_t rxCapacity,
  uint32_t timeoutMs
) {
  setBusBaud(baud);

  uint8_t request[8] = {
    id,
    functionCode,
    highByte(startReg),
    lowByte(startReg),
    highByte(count),
    lowByte(count),
    0,
    0
  };

  uint16_t crc = modbusCRC(request, 6);
  request[6] = lowByte(crc);
  request[7] = highByte(crc);

  clearBus();
  uiDelay(35);

  RS485.write(request, sizeof(request));
  RS485.flush();

  size_t rxLen = 0;
  bool gotAny = false;
  uint32_t started = millis();
  uint32_t lastByte = started;

  while ((uint32_t)(millis() - started) < timeoutMs) {
    while (RS485.available()) {
      uint8_t b = (uint8_t)RS485.read();

      if (rxLen < rxCapacity) {
        rx[rxLen++] = b;
      }

      gotAny = true;
      lastByte = millis();
    }

    if (gotAny && (uint32_t)(millis() - lastByte) >= 45UL) {
      break;
    }

    serviceSpffGatewaySerial();
    serviceDeviceStatus();
    serviceBuzzer();
    serviceButtons();
    serviceLCDRefresh();
    delay(1);
  }

  return rxLen;
}

bool extractRegisters(
  const uint8_t *rx,
  size_t rxLen,
  uint8_t id,
  uint8_t functionCode,
  uint16_t *regs,
  uint16_t count
) {
  uint8_t byteCount = (uint8_t)(count * 2);
  size_t frameLen = 3 + byteCount + 2;

  for (size_t start = 0; start + frameLen <= rxLen; start++) {
    const uint8_t *frame = &rx[start];

    if (frame[0] != id) continue;
    if (frame[1] != functionCode) continue;
    if (frame[2] != byteCount) continue;
    if (!validCRC(frame, frameLen)) continue;

    for (uint16_t i = 0; i < count; i++) {
      regs[i] =
        ((uint16_t)frame[3 + i * 2] << 8) |
        frame[4 + i * 2];
    }

    return true;
  }

  return false;
}

// =============================================================================
// NUTRISENSE
// =============================================================================
bool parseNutri(const uint8_t *rx, size_t rxLen) {
  uint16_t reg[3];

  if (!extractRegisters(rx, rxLen, NUTRI_ID, 0x03, reg, 3)) {
    return false;
  }

  float rawPh = reg[0] / 100.0f;
  float rawEc = (float)reg[1];
  float rawTemp = ((int16_t)reg[2]) / 10.0f;

  // Reject frame aneh yang pernah muncul T=0.0 C.
  // Plausibility dicek pada data RAW agar setting kalibrasi tidak
  // menyamarkan frame Modbus yang memang rusak.
  if (rawPh < 0.0f || rawPh > 14.0f) return false;
  if (reg[2] == 0) return false;
  if (rawTemp < -10.0f || rawTemp > 80.0f) return false;

  float ph = rawPh * NUTRI_PH_GAIN + NUTRI_PH_OFFSET;
  float ec = rawEc * NUTRI_EC_GAIN + NUTRI_EC_OFFSET;
  float temp = rawTemp * NUTRI_TEMP_GAIN + NUTRI_TEMP_OFFSET;

  nutri.ph = ph;
  nutri.ec = ec;
  nutri.temp = temp;
  nutri.hasValue = true;
  nutri.fresh = true;
  nutri.lastGoodMs = millis();

  return true;
}

bool nutriCacheUsable() {
  if (!nutri.hasValue || nutri.lastGoodMs == 0) return false;

  return
    (uint32_t)(millis() - nutri.lastGoodMs) <=
    NUTRI_CACHE_MAX_AGE_MS;
}

const char* nutriStateText() {
  return nutriCycleOk ? "OK" : "NO";
}

bool readNutri() {
  nutriCycleOk = false;
  nutri.fresh = false;
  setBusBaud(BAUD_9600);
  uiDelay(100);

  for (uint8_t attempt = 1; attempt <= 4; attempt++) {
    uint8_t rx[48];

    size_t len = modbusReadRaw(
      BAUD_9600, NUTRI_ID, 0x03, 0, 3,
      rx, sizeof(rx), 450UL
    );

    if (len > 0 && parseNutri(rx, len)) {
      nutriCycleOk = true;


      return true;
    }

    uiDelay(70);
  }

  // Satu recovery UART jika empat request awal tidak lolos.
  setBusBaud(BAUD_9600, true);
  uiDelay(250);

  for (uint8_t attempt = 1; attempt <= 2; attempt++) {
    uint8_t rx[48];

    size_t len = modbusReadRaw(
      BAUD_9600, NUTRI_ID, 0x03, 0, 3,
      rx, sizeof(rx), 450UL
    );

    if (len > 0 && parseNutri(rx, len)) {
      nutriCycleOk = true;


      return true;
    }

    uiDelay(80);
  }

  if (nutriCacheUsable()) {
    nutriCycleOk = true;

    return true;
  }

  return false;
}

// =============================================================================
// SHT20 RS485
// =============================================================================
// SHT20 memakai Modbus RTU langsung: ID3, 9600 8N1, FC04, register
// 0x0001 (temperature) dan 0x0002 (humidity). Current read tetap menentukan
// health cycle. Last-valid boleh dibawa telemetry snapshot maksimal 300 detik / 5 menit.

void initSHT20() {
  sht.temp = NAN;
  sht.rh = NAN;
  sht.hasValue = false;
  sht.fresh = false;
  sht.lastGoodMs = 0;
  shtCycleOk = false;

  setBusBaud(BAUD_9600, true);
  clearBus();
}

bool shtTelemetryValid() {
  return
    shtCycleOk &&
    sht.hasValue &&
    sht.fresh &&
    isfinite(sht.temp) &&
    isfinite(sht.rh) &&
    sht.temp >= -20.0f &&
    sht.temp <= 80.0f &&
    sht.rh >= 0.0f &&
    sht.rh <= 100.0f;
}

void logSHT20Failure(
  const char *reason,
  size_t rxLength
) {
  // Serial adalah port protokol JSON Lines ke Orange Pi. Jangan campur debug
  // text ke port itu. Saat USB CDC On Boot aktif, Serial0 tetap UART0 dan
  // dipakai khusus debug hardware SHT20 (115200 8N1).
#if ARDUINO_USB_CDC_ON_BOOT
  Serial0.printf(
    "[SHT20] READ FAILED | id=%u baud=9600 fc=04 reg=0001 count=2 reason=%s rx=%u\n",
    (unsigned int)SHT20_ID,
    reason,
    (unsigned int)rxLength
  );
#else
  (void)reason;
  (void)rxLength;
#endif
}

const char* shtStateText() {
  return shtTelemetryValid() ? "OK" : "NO";
}

bool readSHT20() {
  shtCycleOk = false;
  sht.fresh = false;

  // Standard SHT20-RS485 Modbus tidak memerlukan preamble ASCII STOP.
  // Langsung query input registers agar tidak mengubah mode sensor sebelum read.
  setBusBaud(BAUD_9600, true);
  clearBus();

  const char *failureReason = "no_response";
  size_t lastRxLength = 0;

  for (uint8_t attempt = 1; attempt <= 3; attempt++) {
    uint8_t rx[32] = {0};
    uint16_t reg[2] = {0, 0};

    const size_t len = modbusReadRaw(
      BAUD_9600,
      SHT20_ID,
      0x04,
      0x0001,
      2,
      rx,
      sizeof(rx),
      500UL
    );

    lastRxLength = len;

    if (len == 0) {
      failureReason = "no_response";
      uiDelay(70);
      continue;
    }

    if (!extractRegisters(
      rx,
      len,
      SHT20_ID,
      0x04,
      reg,
      2
    )) {
      failureReason = "invalid_modbus_frame_or_crc";
      uiDelay(70);
      continue;
    }

    const float temp =
      static_cast<int16_t>(reg[0]) / 10.0f;

    const float rh =
      reg[1] / 10.0f;

    if (
      !isfinite(temp) ||
      !isfinite(rh) ||
      temp < -20.0f ||
      temp > 80.0f ||
      rh < 0.0f ||
      rh > 100.0f
    ) {
      failureReason = "value_out_of_range";
      uiDelay(70);
      continue;
    }

    sht.temp = temp;
    sht.rh = rh;
    sht.hasValue = true;
    sht.fresh = true;
    sht.lastGoodMs = millis();
    shtCycleOk = true;

    return true;
  }

  // Gagal pada cycle ini: current health tetap gagal, tetapi last-valid dan
  // timestamp aslinya dipertahankan untuk snapshot maksimal 300 detik / 5 menit. Nilai
  // tersebut tidak pernah diberi timestamp cache baru ketika read gagal.
  sht.fresh = false;
  shtCycleOk = false;

  logSHT20Failure(
    failureReason,
    lastRxLength
  );

  return false;
}

// =============================================================================
// SLAVE ID 5
// =============================================================================
bool applySlaveRegs(const uint16_t *reg, uint8_t count) {
  if (count < 4) return false;

  slaveData.waterDistanceValid = reg[0] != 0xFFFF;
  slaveData.fertDistanceValid = reg[1] != 0xFFFF;

  slaveData.waterDistanceCm =
    slaveData.waterDistanceValid ? reg[0] / 10.0f : NAN;

  slaveData.fertDistanceCm =
    slaveData.fertDistanceValid ? reg[1] / 10.0f : NAN;

  slaveData.waterFlowLpm = reg[2] / 100.0f;
  slaveData.fertFlowLpm = reg[3] / 100.0f;

  slaveData.totalsAvailable = count >= 8;

  if (slaveData.totalsAvailable) {
    slaveData.waterTotalMl =
      ((uint32_t)reg[4] << 16) | reg[5];

    slaveData.fertTotalMl =
      ((uint32_t)reg[6] << 16) | reg[7];
  }

  slaveData.hasValue = true;
  slaveData.fresh = true;
  slaveData.lastGoodMs = millis();

  return true;
}

bool trySlaveRead(uint8_t count, uint8_t attempts) {
  for (uint8_t attempt = 1; attempt <= attempts; attempt++) {
    uint8_t rx[64];
    uint16_t reg[8] = {0};

    size_t len = modbusReadRaw(
      BAUD_9600, SLAVE_ID, 0x03, 0, count,
      rx, sizeof(rx), 450UL
    );

    if (
      len > 0 &&
      extractRegisters(rx, len, SLAVE_ID, 0x03, reg, count) &&
      applySlaveRegs(reg, count)
    ) {
      return true;
    }

    uiDelay(80);
  }

  return false;
}

String distanceText(bool valid, float value) {
  return valid ? String(value, 1) + "cm" : "NO-ECHO";
}

bool slaveCacheUsable() {
  if (!slaveData.hasValue || slaveData.lastGoodMs == 0) {
    return false;
  }

  return
    (uint32_t)(millis() - slaveData.lastGoodMs) <=
    SLAVE_CACHE_MAX_AGE_MS;
}

const char* slaveStateText() {
  return slaveCycleOk ? "OK" : "NO";
}

bool readSlave() {
  slaveCycleOk = false;
  slaveData.fresh = false;
  setBusBaud(BAUD_9600);

  // Sedikit lebih sabar daripada V8.4.5.
  bool ok = trySlaveRead(8, 3);

  // Fallback kompatibel dengan firmware lama HR0..HR3.
  if (!ok) {
    ok = trySlaveRead(4, 2);
  }

  // Re-open UART sekali jika frame masih gagal.
  if (!ok) {
    setBusBaud(BAUD_9600, true);
    uiDelay(100);
    ok = trySlaveRead(8, 3);
  }

  if (ok) {
    slaveCycleOk = true;
    return true;
  }

  // Satu timeout tidak perlu membuat log/status terlihat error besar.
  // Nilai tetap last-good dan hanya dipakai sampai 60 detik.
  if (slaveCacheUsable()) {
    slaveCycleOk = true;
    return true;
  }

  return false;
}

// =============================================================================
// SOIL 7-IN-1 - PRIORITY CACHE + SENSOR HEALTH
// =============================================================================
//
// - Prioritas register yang belum pernah berhasil dibaca.
// - Setelah lengkap, refresh register dengan umur last-good paling tua.
// - 2 target per Soil per cycle.
// - Missing register max 5 retry.
// - Maintenance register max 3 retry.
// - Freshness per field untuk health/polling tetap 60 detik.
// - Snapshot telemetry dapat membawa last-valid field maksimal 300 detik / 5 menit.
// - Baud tetap 4850.
//
bool soilPlausible(uint8_t reg, uint16_t raw) {
  switch (reg) {
    case 0:
      return raw <= 1000;

    case 1: {
      int16_t t = (int16_t)raw;
      return t >= -200 && t <= 700;
    }

    case 2:
      return raw <= 20000;

    case 3:
      return raw <= 140;

    case 4:
    case 5:
    case 6:
      return raw <= 5000;
  }

  return false;
}

uint32_t *soilRegTimeArray(uint8_t number) {
  return number == 1
    ? soil1RegLastGoodMs
    : soil2RegLastGoodMs;
}

uint8_t &soilAcquireCursor(uint8_t number) {
  return number == 1
    ? soil1AcquireCursor
    : soil2AcquireCursor;
}

bool readSoilSingleRegister(
  uint8_t sensorId,
  uint8_t reg,
  uint16_t &value,
  uint8_t attempts
) {
  for (uint8_t attempt = 1; attempt <= attempts; attempt++) {
    uint8_t rx[24];
    uint16_t tmp[1] = {0};

    size_t len = modbusReadRaw(
      SOIL_FIXED_BAUD,
      sensorId,
      0x03,
      reg,
      1,
      rx,
      sizeof(rx),
      SOIL_SINGLE_TIMEOUT_MS
    );

    if (
      len > 0 &&
      extractRegisters(
        rx,
        len,
        sensorId,
        0x03,
        tmp,
        1
      ) &&
      soilPlausible(reg, tmp[0])
    ) {
      value = tmp[0];
      return true;
    }

    clearBus();

    if (attempt < attempts) {
      uiDelay(45);
    }
  }

  return false;
}

uint8_t countFreshSoil(const SoilData &soil) {
  uint8_t count = 0;

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    if (soil.freshField[reg]) {
      count++;
    }
  }

  return count;
}

uint8_t countSoilHave(const SoilData &soil) {
  uint8_t count = 0;

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    if (soil.has[reg]) {
      count++;
    }
  }

  return count;
}

bool allSoilHaveData(const SoilData &soil) {
  return countSoilHave(soil) == SOIL_REG_COUNT;
}

String staleSoilRegs(const SoilData &soil) {
  String s;

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    if (!soil.freshField[reg]) {
      if (s.length()) s += ",";
      s += "R";
      s += reg;
    }
  }

  return s;
}

void refreshSoilFreshFlags(
  uint8_t number,
  SoilData &soil
) {
  uint32_t now = millis();
  uint32_t *last = soilRegTimeArray(number);

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    if (!soil.has[reg] || last[reg] == 0) {
      soil.freshField[reg] = false;
      continue;
    }

    soil.freshField[reg] =
      (uint32_t)(now - last[reg]) <=
      SOIL_FIELD_MAX_AGE_MS;
  }

  soil.complete = allSoilHaveData(soil);
  soil.fresh =
    soil.complete &&
    countFreshSoil(soil) == SOIL_REG_COUNT;
}

bool registerAlreadyChosen(
  uint8_t reg,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount
) {
  for (uint8_t i = 0; i < chosenCount; i++) {
    if (chosen[i] == reg) {
      return true;
    }
  }

  return false;
}

bool chooseMissingRegister(
  uint8_t number,
  const SoilData &soil,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount,
  uint8_t &regOut
) {
  uint8_t &cursor = soilAcquireCursor(number);

  for (uint8_t step = 0; step < SOIL_REG_COUNT; step++) {
    uint8_t reg =
      (uint8_t)((cursor + step) % SOIL_REG_COUNT);

    if (
      !soil.has[reg] &&
      !registerAlreadyChosen(reg, chosen, chosenCount)
    ) {
      regOut = reg;
      cursor =
        (uint8_t)((reg + 1) % SOIL_REG_COUNT);
      return true;
    }
  }

  return false;
}

bool chooseOldestRegister(
  uint8_t number,
  const SoilData &soil,
  const uint8_t chosen[SOIL_REGS_PER_CYCLE],
  uint8_t chosenCount,
  uint8_t &regOut
) {
  uint32_t *last = soilRegTimeArray(number);
  uint32_t now = millis();

  bool found = false;
  uint32_t bestAge = 0;

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    if (!soil.has[reg]) continue;
    if (registerAlreadyChosen(reg, chosen, chosenCount)) continue;

    uint32_t age =
      last[reg] == 0
      ? 0xFFFFFFFFUL
      : (uint32_t)(now - last[reg]);

    if (!found || age > bestAge) {
      found = true;
      bestAge = age;
      regOut = reg;
    }
  }

  return found;
}

uint8_t buildSoilTargetList(
  uint8_t number,
  const SoilData &soil,
  uint8_t target[SOIL_REGS_PER_CYCLE]
) {
  uint8_t count = 0;

  while (count < SOIL_REGS_PER_CYCLE) {
    uint8_t reg = 0;

    if (
      !chooseMissingRegister(
        number,
        soil,
        target,
        count,
        reg
      )
    ) {
      break;
    }

    target[count++] = reg;
  }

  while (count < SOIL_REGS_PER_CYCLE) {
    uint8_t reg = 0;

    if (
      !chooseOldestRegister(
        number,
        soil,
        target,
        count,
        reg
      )
    ) {
      break;
    }

    target[count++] = reg;
  }

  return count;
}

bool readSoil(uint8_t number, uint8_t sensorId, SoilData &soil) {

  setBusBaud(SOIL_FIXED_BAUD);
  uiDelay(80);
  clearBus();

  uint32_t *last =
    soilRegTimeArray(number);

  uint8_t target[SOIL_REGS_PER_CYCLE] = {0};
  uint8_t targetCount =
    buildSoilTargetList(
      number,
      soil,
      target
    );

  bool anySuccessThisCycle = false;

  for (uint8_t slot = 0; slot < targetCount; slot++) {
    uint8_t reg = target[slot];

    bool acquiring =
      !soil.has[reg];

    uint8_t attempts =
      acquiring
      ? SOIL_ACQUIRE_RETRY
      : SOIL_MAINTENANCE_RETRY;

    uint16_t value = 0;

    if (
      readSoilSingleRegister(
        sensorId,
        reg,
        value,
        attempts
      )
    ) {
      soil.raw[reg] = value;
      soil.has[reg] = true;
      soil.regBaud[reg] = SOIL_FIXED_BAUD;
      last[reg] = millis();
      soil.lastGoodMs = millis();
      anySuccessThisCycle = true;
    }
  }

  soil.fallbackBaud = SOIL_FIXED_BAUD;

  refreshSoilFreshFlags(number, soil);

  bool sensorAlive =
    soil.lastGoodMs != 0 &&
    (uint32_t)(millis() - soil.lastGoodMs) <=
    SOIL_SENSOR_MAX_SILENCE_MS;

  if (!soil.complete) {

    return false;
  }

  if (anySuccessThisCycle || sensorAlive) {

    return true;
  }

  return false;
}

// =============================================================================
// LCD
// =============================================================================
void initLCD() {
  if (i2cExists(0x27)) lcd = &lcd27;
  else if (i2cExists(0x3F)) lcd = &lcd3F;
  else {
    return;
  }

  lcd->init();
  lcd->backlight();
  lcd->clear();

  lcdReady = true;
}

void lcdLine(uint8_t row, String text) {
  if (!lcdReady) return;

  if (text.length() > 20) text = text.substring(0, 20);
  while (text.length() < 20) text += ' ';

  lcd->setCursor(0, row);
  lcd->print(text);
}

String valueOrDash(float value, uint8_t decimals, bool valid) {
  if (!valid || isnan(value)) return "--";
  return String(value, (unsigned int)decimals);
}

String soilStateText(const SoilData &soil) {
  if (!soil.complete) return "NO";

  if (
    soil.lastGoodMs != 0 &&
    (uint32_t)(millis() - soil.lastGoodMs) <=
    SOIL_SENSOR_MAX_SILENCE_MS
  ) {
    return "OK";
  }

  return "HOLD";
}

// =============================================================================
// HUMAN-READABLE SERIAL MONITOR
// =============================================================================
// Fungsi ini hanya MEMBACA nilai yang sudah dihitung oleh program utama.
// Tidak melakukan polling tambahan dan tidak mengubah state sensor/aktuator.

// =============================================================================
// COMPACT SERIAL MONITOR
// =============================================================================
// Satu baris per cycle agar mudah dibaca saat commissioning.
// Hanya membaca state yang sudah ada; TIDAK melakukan polling tambahan.
// =============================================================================
// ARDUINO SERIAL PLOTTER
// =============================================================================
// Hanya membaca nilai yang SUDAH diperoleh oleh polling program utama.
// Tidak melakukan transaksi RS485 tambahan dan tidak mengubah data sensor.
//
// Catatan scaling grafik:
// - EC dibagi 100 agar pH/suhu/moisture tetap terlihat pada plot yang sama.
// - N/P/K dibagi 10 untuk alasan visual yang sama.
// - Nilai asli di struct/program utama TIDAK diubah.
void renderMenu(const char **items, uint8_t count, uint8_t selected) {
  lcdLine(0, rtcHeader());

  uint8_t first = 0;
  if (selected >= 3) first = selected - 2;

  for (uint8_t row = 1; row <= 3; row++) {
    uint8_t index = first + row - 1;

    if (index < count) {
      lcdLine(row, String(index == selected ? ">" : " ") + items[index]);
    } else {
      lcdLine(row, "");
    }
  }
}

void renderMonitor() {
  // Monitoring seluruh sistem sensor, berganti halaman otomatis.
  // CANCEL kembali ke menu utama.
  uint8_t page =
    (uint8_t)(
      (millis() / 2600UL) %
      6UL
    );

  lcdLine(
    0,
    rtcHeader()
  );

  switch (page) {
    case 0:
      lcdLine(1, "NUTRISI");
      lcdLine(
        2,
        "pH:" +
        valueOrDash(nutri.ph, 2, nutri.hasValue) +
        " EC:" +
        valueOrDash(nutri.ec, 0, nutri.hasValue)
      );
      lcdLine(
        3,
        "T:" +
        valueOrDash(nutri.temp, 1, nutri.hasValue) +
        "C " +
        nutriStateText()
      );
      break;

    case 1:
      lcdLine(1, "UDARA SHT20");
      lcdLine(
        2,
        "T:" +
        valueOrDash(sht.temp, 1, sht.hasValue) +
        "C RH:" +
        valueOrDash(sht.rh, 1, sht.hasValue) +
        "%"
      );
      lcdLine(
        3,
        String("Status: ") +
        shtStateText()
      );
      break;

    case 2:
      lcdLine(
        1,
        "TANAH 1 " +
        soilStateText(soil1)
      );

      if (soil1.complete) {
        lcdLine(
          2,
          "M:" +
          String(soil1.raw[0] / 10.0f, 1) +
          "% T:" +
          String(((int16_t)soil1.raw[1]) / 10.0f, 1)
        );
        lcdLine(
          3,
          "pH:" +
          String(soil1.raw[3] / 10.0f, 1) +
          " EC:" +
          String(soil1.raw[2])
        );
      } else {
        lcdLine(
          2,
          "Register:" +
          String(countSoilHave(soil1)) +
          "/7"
        );
        lcdLine(3, "Menunggu data...");
      }
      break;

    case 3:
      lcdLine(
        1,
        "TANAH 2 " +
        soilStateText(soil2)
      );

      if (soil2.complete) {
        lcdLine(
          2,
          "M:" +
          String(soil2.raw[0] / 10.0f, 1) +
          "% T:" +
          String(((int16_t)soil2.raw[1]) / 10.0f, 1)
        );
        lcdLine(
          3,
          "pH:" +
          String(soil2.raw[3] / 10.0f, 1) +
          " EC:" +
          String(soil2.raw[2])
        );
      } else {
        lcdLine(
          2,
          "Register:" +
          String(countSoilHave(soil2)) +
          "/7"
        );
        lcdLine(3, "Menunggu data...");
      }
      break;

    case 4:
      lcdLine(1, "TANDON");
      lcdLine(
        2,
        "Air:" +
        distanceText(
          slaveData.waterDistanceValid,
          slaveData.waterDistanceCm
        )
      );
      lcdLine(
        3,
        "Nutr:" +
        distanceText(
          slaveData.fertDistanceValid,
          slaveData.fertDistanceCm
        )
      );
      break;

    default:
      lcdLine(1, "FLOW & OUTPUT");
      lcdLine(
        2,
        "A:" +
        valueOrDash(
          slaveData.waterFlowLpm,
          2,
          slaveData.hasValue
        ) +
        " N:" +
        valueOrDash(
          slaveData.fertFlowLpm,
          2,
          slaveData.hasValue
        )
      );
      lcdLine(
        3,
        String("CH3:") +
        (
          (relayState & (1U << (PUMP_WATER_RELAY - 1)))
          ? "ON"
          : "OFF"
        ) +
        " CH1:" +
        (
          (relayState & (1U << (PUMP_FERTILIZER_RELAY - 1)))
          ? "ON"
          : "OFF"
        )
      );
      break;
  }
}

void renderSensorStatus() {
  uint8_t page =
    (uint8_t)(
      (millis() / 3000UL) %
      2UL
    );

  lcdLine(
    0,
    "STATUS SENSOR"
  );

  if (page == 0) {
    lcdLine(
      1,
      "Nutri:" +
      String(nutriStateText()) +
      " Air:" +
      String(shtStateText())
    );

    lcdLine(
      2,
      "Soil1:" +
      soilStateText(soil1)
    );

    lcdLine(
      3,
      "Soil2:" +
      soilStateText(soil2)
    );
  } else {
    lcdLine(
      1,
      "Slave:" +
      String(slaveStateText()) +
      " RTC:" +
      String(rtcReady ? "OK" : "NO")
    );

    lcdLine(
      2,
      "WiFi:" +
      String(
        WiFi.status() == WL_CONNECTED
        ? "OK"
        : "NO"
      )
    );

    lcdLine(
      3,
      "Sensor total aktif"
    );
  }
}

void renderCalibrationMenu() {
  renderMenu(
    CALIB_ITEMS,
    CALIB_COUNT,
    calibIndex
  );
}

void renderCalibrationInfo() {
  lcdLine(
    0,
    "KALIBRASI SENSOR"
  );

  switch (calibIndex) {
    case 0:
      lcdLine(1, "Nutrisi pH/EC/T");
      lcdLine(
        2,
        "pH:" +
        valueOrDash(nutri.ph, 2, nutri.hasValue) +
        " EC:" +
        valueOrDash(nutri.ec, 0, nutri.hasValue)
      );
      break;

    case 1:
      lcdLine(1, "Udara T/RH");
      lcdLine(
        2,
        "T:" +
        valueOrDash(sht.temp, 1, sht.hasValue) +
        " RH:" +
        valueOrDash(sht.rh, 1, sht.hasValue)
      );
      break;

    case 2:
      lcdLine(1, "Tanah 1");
      lcdLine(
        2,
        "Valid:" +
        String(countSoilHave(soil1)) +
        "/7"
      );
      break;

    case 3:
      lcdLine(1, "Tanah 2");
      lcdLine(
        2,
        "Valid:" +
        String(countSoilHave(soil2)) +
        "/7"
      );
      break;

    case 4:
      lcdLine(1, "Level Tandon");
      lcdLine(
        2,
        distanceText(
          slaveData.waterDistanceValid,
          slaveData.waterDistanceCm
        ) +
        "/" +
        distanceText(
          slaveData.fertDistanceValid,
          slaveData.fertDistanceCm
        )
      );
      break;

    default:
      lcdLine(1, "Flow Air/Nutrisi");
      lcdLine(
        2,
        valueOrDash(
          slaveData.waterFlowLpm,
          2,
          slaveData.hasValue
        ) +
        "/" +
        valueOrDash(
          slaveData.fertFlowLpm,
          2,
          slaveData.hasValue
        )
      );
      break;
  }

  lcdLine(
    3,
    "Web: /calibration"
  );
}

void renderWifiOta() {
  bool page =
    ((millis() / 3000UL) % 2UL) == 0UL;

  if (page) {
    lcdLine(
      0,
      "WIFI ROUTER"
    );

    lcdLine(
      1,
      fieldWifiSsid.length()
      ? fieldWifiSsid
      : "Belum diatur"
    );

    lcdLine(
      2,
      String("Status:") +
      (
        WiFi.status() == WL_CONNECTED
        ? "CONNECTED"
        : "OFFLINE"
      )
    );

    lcdLine(
      3,
      WiFi.status() == WL_CONNECTED
      ? WiFi.localIP().toString()
      : "AP 192.168.4.1"
    );
  } else {
    lcdLine(
      0,
      "OTA PROGRAM"
    );

    lcdLine(
      1,
      "Router:/update"
    );

    lcdLine(
      2,
      "AP:192.168.4.1"
    );

    lcdLine(
      3,
      "WiFi:/wifi"
    );
  }
}

void renderSoilDetail(
  uint8_t number,
  const SoilData &soil
) {
  lcdLine(
    0,
    "Sensor Tanah " +
    String(number) +
    " " +
    soilStateText(soil)
  );

  if (!soil.complete) {
    lcdLine(1, "Menunggu data valid");
    lcdLine(
      2,
      "Data valid " +
      String(
        countSoilHave(soil)
      ) +
      "/7"
    );
    lcdLine(3, "CANCEL untuk kembali");
    return;
  }

  bool page =
    ((millis() / 3000UL) % 2UL) == 0UL;

  if (page) {
    lcdLine(
      1,
      "Kelembapan:" +
      String(
        soil.raw[0] / 10.0f,
        1
      ) +
      "%"
    );

    lcdLine(
      2,
      "Suhu:" +
      String(
        ((int16_t)soil.raw[1]) /
        10.0f,
        1
      ) +
      "C"
    );

    lcdLine(
      3,
      "pH:" +
      String(
        soil.raw[3] / 10.0f,
        1
      ) +
      " EC:" +
      String(
        soil.raw[2]
      )
    );
  } else {
    lcdLine(
      1,
      "Nitrogen:" +
      String(
        soil.raw[4]
      )
    );

    lcdLine(
      2,
      "Fosfor:" +
      String(
        soil.raw[5]
      )
    );

    lcdLine(
      3,
      "Kalium:" +
      String(
        soil.raw[6]
      )
    );
  }
}

void renderTankFlow() {
  lcdLine(0, rtcHeader());

  bool page =
    ((millis() / 3000UL) % 2UL) == 0UL;

  if (page) {
    lcdLine(
      1,
      "Jarak Air:" +
      distanceText(
        slaveData.waterDistanceValid,
        slaveData.waterDistanceCm
      )
    );

    lcdLine(
      2,
      "Jarak Pupuk:" +
      distanceText(
        slaveData.fertDistanceValid,
        slaveData.fertDistanceCm
      )
    );

    lcdLine(
      3,
      "Slave:" +
      String(
        slaveStateText()
      )
    );
  } else {
    lcdLine(
      1,
      "Flow Air:" +
      valueOrDash(
        slaveData.waterFlowLpm,
        2,
        slaveData.hasValue
      )
    );

    lcdLine(
      2,
      "Flow Pupuk:" +
      valueOrDash(
        slaveData.fertFlowLpm,
        2,
        slaveData.hasValue
      )
    );

    if (
      slaveData.totalsAvailable
    ) {
      lcdLine(
        3,
        "Total:" +
        String(
          slaveData.waterTotalMl /
          1000.0f,
          1
        ) +
        "/" +
        String(
          slaveData.fertTotalMl /
          1000.0f,
          1
        ) +
        "L"
      );
    } else {
      lcdLine(
        3,
        "Slave:" +
        String(
          slaveStateText()
        )
      );
    }
  }
}

void renderSystem() {
  lcdLine(0, rtcHeader());

  lcdLine(
    1,
    "Nutrisi:" +
    String(
      nutriStateText()
    ) +
    " SHT20:" +
    String(
      shtStateText()
    )
  );

  lcdLine(
    2,
    "Slave:" +
    String(
      slaveStateText()
    ) +
    " Tanah1:" +
    soilStateText(
      soil1
    )
  );

  lcdLine(
    3,
    "Tanah2:" +
    soilStateText(
      soil2
    ) +
    " RTC:" +
    String(
      rtcReady
      ? "OK"
      : "NO"
    )
  );
}

void renderTimerMode() {
  lcdLine(
    0,
    "Mode Timer"
  );

  lcdLine(
    1,
    String(
      editTimerMode ==
        TIMER_MODE_AUTO
      ? ">"
      : " "
    ) +
    "OTOMATIS"
  );

  lcdLine(
    2,
    String(
      editTimerMode ==
        TIMER_MODE_FORCE_ON
      ? ">"
      : " "
    ) +
    "PAKSA AKTIF"
  );

  lcdLine(
    3,
    String(
      editTimerMode ==
        TIMER_MODE_FORCE_OFF
      ? ">"
      : " "
    ) +
    "PAKSA NONAKTIF"
  );
}

void renderScheduleEditor() {
  String fields[7];

  fields[0] =
    String("Program: ") +
    (
      editSchedule.enabled
      ? "AKTIF"
      : "NONAKTIF"
    );

  fields[1] =
    String("Hari: ") +
    DAY_PRESETS[
      findDayPreset(
        editSchedule.daysMask
      )
    ].name;

  fields[2] =
    String("Jam Aktif: ") +
    pad2(
      scheduleHour(
        editSchedule.startMinute
      )
    );

  fields[3] =
    String("Menit Aktif: ") +
    pad2(
      scheduleMinutePart(
        editSchedule.startMinute
      )
    );

  fields[4] =
    String("Jam Nonaktif: ") +
    pad2(
      scheduleHour(
        editSchedule.endMinute
      )
    );

  fields[5] =
    String("Menit Nonaktif: ") +
    pad2(
      scheduleMinutePart(
        editSchedule.endMinute
      )
    );

  fields[6] =
    "Simpan Program";

  lcdLine(
    0,
    "Atur Program " +
    String(
      scheduleEditIndex +
      1
    )
  );

  uint8_t first =
    0;

  if (
    scheduleEditField >=
    3
  ) {
    first =
      scheduleEditField -
      2;
  }

  for (
    uint8_t row = 1;
    row <= 3;
    row++
  ) {
    uint8_t item =
      first +
      row -
      1;

    if (
      item <
      7
    ) {
      String prefix =
        item ==
          scheduleEditField
        ? (
            scheduleValueEditing
            ? "*"
            : ">"
          )
        : " ";

      lcdLine(
        row,
        prefix +
        fields[item]
      );
    } else {
      lcdLine(
        row,
        ""
      );
    }
  }
}

void renderRtcEditor() {
  lcdLine(
    0,
    "Atur Jam & Tanggal"
  );

  String fields[6];

  fields[0] =
    "Tanggal: " +
    pad2(
      editRtc.day
    );

  fields[1] =
    "Bulan: " +
    pad2(
      editRtc.month
    );

  fields[2] =
    "Tahun: 20" +
    pad2(
      editRtc.year
    );

  fields[3] =
    "Jam: " +
    pad2(
      editRtc.hour
    );

  fields[4] =
    "Menit: " +
    pad2(
      editRtc.minute
    );

  fields[5] =
    "Simpan RTC";

  uint8_t first =
    0;

  if (
    rtcEditField >=
    3
  ) {
    first =
      rtcEditField -
      2;
  }

  for (
    uint8_t row = 1;
    row <= 3;
    row++
  ) {
    uint8_t item =
      first +
      row -
      1;

    if (
      item <
      6
    ) {
      String prefix =
        item ==
          rtcEditField
        ? (
            rtcValueEditing
            ? "*"
            : ">"
          )
        : " ";

      lcdLine(
        row,
        prefix +
        fields[item]
      );
    } else {
      lcdLine(
        row,
        ""
      );
    }
  }
}

void renderClearProgram() {
  lcdLine(
    0,
    "Hapus Program"
  );

  lcdLine(
    1,
    "Program: " +
    String(
      clearProgramIndex +
      1
    )
  );

  if (
    clearProgramConfirm
  ) {
    lcdLine(
      2,
      "Yakin hapus?"
    );

    lcdLine(
      3,
      "OK=Hapus CANCEL=Batal"
    );
  } else {
    lcdLine(
      2,
      "UP/DOWN pilih"
    );

    lcdLine(
      3,
      "OK=Lanjut CANCEL=Balik"
    );
  }
}

void renderClearAll() {
  lcdLine(
    0,
    "Hapus Semua Program"
  );

  if (
    clearAllConfirm
  ) {
    lcdLine(
      1,
      "Yakin hapus semua?"
    );

    lcdLine(
      2,
      "OK=Hapus Semua"
    );

    lcdLine(
      3,
      "CANCEL=Batal"
    );
  } else {
    lcdLine(
      1,
      "16 program dihapus"
    );

    lcdLine(
      2,
      "OK=Lanjut"
    );

    lcdLine(
      3,
      "CANCEL=Kembali"
    );
  }
}

void renderTimerStatus() {
  int8_t active =
    activeScheduleIndex();

  lcdLine(
    0,
    "Status Timer"
  );

  lcdLine(
    1,
    String("Mode: ") +
    timerModeText(
      timerMode
    )
  );

  if (
    active >=
    0
  ) {
    lcdLine(
      2,
      "Jadwal: Program " +
      String(
        active +
        1
      )
    );
  } else {
    lcdLine(
      2,
      "Jadwal: Tidak Ada"
    );
  }

  lcdLine(
    3,
    String("Output Timer: ") +
    (
      timerOutputActive()
      ? "AKTIF"
      : "NONAKTIF"
    )
  );
}


void renderButtonTest() {
  lcdLine(0, rtcHeader());

  lcdLine(
    1,
    "Cancel:" +
    String(
      buttonRawPressed(
        btnCancel
      )
    ) +
    " OK:" +
    String(
      buttonRawPressed(
        btnOk
      )
    )
  );

  lcdLine(
    2,
    "Atas:" +
    String(
      buttonRawPressed(
        btnUp
      )
    ) +
    " Bawah:" +
    String(
      buttonRawPressed(
        btnDown
      )
    )
  );

  lcdLine(
    3,
    "CANCEL untuk kembali"
  );
}

void renderAbout() {
  lcdLine(0, "S2PFS FIELD V9");
  lcdLine(1, "RS485 + Timer + OTA");
  lcdLine(2, "Router + Orange Pi");
  lcdLine(3, "CANCEL untuk kembali");
}

void renderUI() {
  if (!lcdReady) return;

  updateRTC();

  switch (uiScreen) {
    case UI_MAIN:
      renderMenu(MAIN_ITEMS, MAIN_COUNT, mainIndex);
      break;

    case UI_MONITOR:
      renderMonitor();
      break;

    case UI_SENSOR_STATUS:
      renderSensorStatus();
      break;

    case UI_SOIL_MENU:
      renderMenu(SOIL_ITEMS, 2, soilIndex);
      break;

    case UI_SOIL1:
      renderSoilDetail(1, soil1);
      break;

    case UI_SOIL2:
      renderSoilDetail(2, soil2);
      break;

    case UI_TANK_FLOW:
      renderTankFlow();
      break;

    case UI_SYSTEM:
      renderSystem();
      break;

    case UI_SETTINGS:
      renderMenu(
        SETTING_ITEMS,
        SETTING_COUNT,
        settingIndex
      );
      break;

    case UI_CALIBRATION_MENU:
      renderCalibrationMenu();
      break;

    case UI_CALIBRATION_INFO:
      renderCalibrationInfo();
      break;

    case UI_WIFI_OTA:
      renderWifiOta();
      break;

    case UI_TIMER_MENU:
      renderMenu(
        TIMER_ITEMS,
        TIMER_MENU_COUNT,
        scheduleMenuIndex
      );
      break;

    case UI_TIMER_MODE:
      renderTimerMode();
      break;

    case UI_SCHEDULE_EDIT:
      renderScheduleEditor();
      break;

    case UI_RTC_EDIT:
      renderRtcEditor();
      break;

    case UI_CLEAR_PROGRAM:
      renderClearProgram();
      break;

    case UI_CLEAR_ALL:
      renderClearAll();
      break;

    case UI_TIMER_STATUS:
      renderTimerStatus();
      break;

    case UI_BUTTON_TEST:
      renderButtonTest();
      break;

    case UI_ABOUT:
      renderAbout();
      break;
  }
}

void serviceLCDRefresh() {
  static uint32_t lastRefresh = 0;
  uint32_t now = millis();

  if ((uint32_t)(now - lastRefresh) >= LCD_REFRESH_MS) {
    lastRefresh = now;
    renderUI();
  }
}

void uiDelay(uint32_t ms) {
  uint32_t started = millis();

  while ((uint32_t)(millis() - started) < ms) {
    // Tetap layani command Orange Pi / tester walau firmware sedang
    // menunggu sensor, UI, atau jeda Modbus.
    serviceSpffGatewaySerial();
    serviceDeviceStatus();
    serviceTelemetrySnapshot();

    serviceBuzzer();
    serviceButtons();
    serviceLCDRefresh();
    delay(1);
  }
}

// =============================================================================
// NVS
// =============================================================================
void loadSoilNVS(uint8_t number, SoilData &soil) {
  (void)number;

  soil.fallbackBaud = SOIL_FIXED_BAUD;

  for (uint8_t reg = 0; reg < SOIL_REG_COUNT; reg++) {
    soil.regBaud[reg] = SOIL_FIXED_BAUD;
  }
}

// =============================================================================
// STATUS LOG
// =============================================================================


// =============================================================================
// FIELD NETWORK - ROUTER + FALLBACK AP
// =============================================================================
// Arsitektur lapangan:
//   Router lapangan
//      |- Orange Pi
//      `- ESP32-S3 MASTER
//
// ESP32 menggunakan mode AP+STA:
// - STA  : tersambung ke router yang sama dengan Orange Pi.
// - AP   : fallback maintenance jika router mati / credential belum diatur.
//
// Credential router disimpan di NVS dari halaman:
//   http://192.168.4.1/wifi
// setelah terhubung ke AP fallback S2PFS-MASTER-SETUP.
static constexpr char FIELD_HOSTNAME[] = "s2pfs-master";
static constexpr char FALLBACK_AP_SSID[] = "S2PFS-MASTER-SETUP";
static constexpr char FALLBACK_AP_PASSWORD[] = "S2PFS2026!";

String fieldWifiSsid;
String fieldWifiPassword;

uint32_t lastWifiReconnectMs = 0;
static constexpr uint32_t WIFI_RECONNECT_MS = 10000UL;

const char* wifiStateText() {
  switch (WiFi.status()) {
    case WL_CONNECTED:
      return "CONNECTED";
    case WL_NO_SSID_AVAIL:
      return "SSID NOT FOUND";
    case WL_CONNECT_FAILED:
      return "AUTH FAILED";
    case WL_CONNECTION_LOST:
      return "LOST";
    case WL_DISCONNECTED:
    default:
      return "DISCONNECTED";
  }
}

void loadFieldWifiConfig() {
  fieldWifiSsid =
    prefs.getString(
      "wifi_ssid",
      ""
    );

  fieldWifiPassword =
    prefs.getString(
      "wifi_pass",
      ""
    );
}

void saveFieldWifiConfig(
  const String &ssid,
  const String &password
) {
  fieldWifiSsid = ssid;
  fieldWifiPassword = password;

  prefs.putString(
    "wifi_ssid",
    fieldWifiSsid
  );

  prefs.putString(
    "wifi_pass",
    fieldWifiPassword
  );
}

void connectFieldWifi() {
  if (
    fieldWifiSsid.length() == 0
  ) {
    return;
  }


  WiFi.begin(
    fieldWifiSsid.c_str(),
    fieldWifiPassword.c_str()
  );

  lastWifiReconnectMs = millis();
}

// =============================================================================
// WEB OTA - AUTHENTICATED ROUTER STA + FALLBACK AP
// =============================================================================
// OTA maintenance path only. Telemetry and commands remain Serial JSON Lines;
// ESP32 never connects directly to MQTT.
//
// Access:
//   Router LAN  : http://<ESP32-IP>/update
//   Fallback AP : http://192.168.4.1/update
//   Basic auth  : admin / S2PFS2026!
//
// Safety policy:
// - OTA starts only when both pump outputs are confirmed OFF.
// - Pump ON commands are rejected while OTA/restart is active.
// - Heartbeat and serial command parsing remain serviced during upload.
static constexpr char OTA_AUTH_USER[] = "admin";

WebServer otaServer(80);

enum OtaUploadResult : uint8_t {
  OTA_RESULT_IDLE = 0,
  OTA_RESULT_SUCCESS,
  OTA_RESULT_ERROR,
  OTA_RESULT_ABORTED,
  OTA_RESULT_UNAUTHORIZED,
  OTA_RESULT_UNSAFE_OUTPUT
};

bool otaUploading = false;
bool otaRestartPending = false;
uint32_t otaRestartAtMs = 0;
OtaUploadResult otaUploadResult = OTA_RESULT_IDLE;

bool otaMaintenanceActive() {
  return otaUploading || otaRestartPending;
}

bool otaAuthorized() {
  return otaServer.authenticate(
    OTA_AUTH_USER,
    FALLBACK_AP_PASSWORD
  );
}

bool otaRequireAuth() {
  if (otaAuthorized()) {
    return true;
  }

  otaServer.requestAuthentication();
  return false;
}

bool otaPumpOutputsSafe() {
  bool waterActive = false;
  bool fertilizerActive = false;

  if (!relayReady) {
    return false;
  }

  if (
    !relayOutputReadback(
      PUMP_WATER_RELAY,
      waterActive
    ) ||
    !relayOutputReadback(
      PUMP_FERTILIZER_RELAY,
      fertilizerActive
    )
  ) {
    return false;
  }

  return !waterActive && !fertilizerActive;
}

String otaPageHtml() {
  String html;
  html.reserve(1350);

  html += F(
    "<!doctype html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>SPFF OTA</title>"
    "<style>body{font-family:Arial;margin:24px;background:#f4f6f8}"
    ".c{max-width:520px;margin:auto;background:#fff;padding:20px;border-radius:12px}"
    "input,button{width:100%;box-sizing:border-box;padding:12px;margin-top:12px}"
    "button{background:#17324d;color:#fff;border:0;border-radius:7px}</style>"
    "</head><body><div class='c'><h2>SPFF Web OTA</h2>"
  );

  html += F("<p><b>Device:</b> ");
  html += SPFF_DEVICE_ID;
  html += F("<br><b>Firmware:</b> ");
  html += SPFF_FIRMWARE_VERSION;
  html += F("<br><b>WiFi:</b> ");
  html += wifiStateText();
  html += F("<br><b>IP Router:</b> ");

  if (WiFi.status() == WL_CONNECTED) {
    html += WiFi.localIP().toString();
  } else {
    html += '-';
  }

  html += F("<br><b>IP AP:</b> ");
  html += WiFi.softAPIP().toString();
  html += F("<br><b>App size:</b> ");
  html += String(ESP.getSketchSize());
  html += F(" byte</p>");
  html += F(
    "<p>Matikan kedua pompa sebelum update. Gunakan file aplikasi <b>.bin</b>, "
    "bukan bootloader atau partitions.</p>"
    "<form method='POST' action='/update' enctype='multipart/form-data'>"
    "<input type='file' name='firmware' accept='.bin' required>"
    "<button type='submit'>UPLOAD FIRMWARE</button></form>"
    "<p><a href='/wifi'>WiFi</a></p></div></body></html>"
  );

  return html;
}

String wifiPageHtml() {
  String html;
  html.reserve(1100);

  html += F(
    "<!doctype html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>SPFF WiFi</title>"
    "<style>body{font-family:Arial;margin:24px;background:#f4f6f8}"
    ".c{max-width:520px;margin:auto;background:#fff;padding:20px;border-radius:12px}"
    "input,button{width:100%;box-sizing:border-box;padding:11px;margin:7px 0}"
    "button{background:#17324d;color:#fff;border:0;border-radius:7px}</style>"
    "</head><body><div class='c'><h2>WiFi Lapangan</h2><p><b>Status:</b> "
  );

  html += wifiStateText();
  html += F("<br><b>SSID:</b> ");
  html += fieldWifiSsid.length() ? fieldWifiSsid : "(belum diatur)";
  html += F("</p><form method='POST' action='/wifi'>");
  html += F("<label>SSID</label><input name='ssid' maxlength='32' value='");
  html += fieldWifiSsid;
  html += F("' required><label>Password</label>");
  html += F("<input type='password' name='pass' maxlength='64' placeholder='kosong = tetap'>");
  html += F("<button type='submit'>SIMPAN</button></form>");
  html += F("<p><a href='/update'>OTA Firmware</a></p></div></body></html>");

  return html;
}

void handleOtaUpload() {
  HTTPUpload &upload = otaServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    otaUploading = false;
    otaUploadResult = OTA_RESULT_IDLE;

    if (!otaAuthorized()) {
      otaUploadResult = OTA_RESULT_UNAUTHORIZED;
      return;
    }

    if (!otaPumpOutputsSafe()) {
      otaUploadResult = OTA_RESULT_UNSAFE_OUTPUT;
      return;
    }

    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
      otaUploadResult = OTA_RESULT_ERROR;
      return;
    }

    otaUploading = true;
    return;
  }

  if (upload.status == UPLOAD_FILE_WRITE) {
    if (!otaUploading || Update.hasError()) {
      return;
    }

    if (
      Update.write(
        upload.buf,
        upload.currentSize
      ) != upload.currentSize
    ) {
      otaUploadResult = OTA_RESULT_ERROR;
    }
    return;
  }

  if (upload.status == UPLOAD_FILE_END) {
    if (!otaUploading) {
      return;
    }

    const bool updateOk =
      otaUploadResult != OTA_RESULT_ERROR &&
      !Update.hasError() &&
      Update.end(true);

    otaUploading = false;
    otaUploadResult =
      updateOk
      ? OTA_RESULT_SUCCESS
      : OTA_RESULT_ERROR;
    return;
  }

  if (upload.status == UPLOAD_FILE_ABORTED) {
    otaUploading = false;
    otaUploadResult = OTA_RESULT_ABORTED;
  }
}

void handleOtaComplete() {
  otaServer.sendHeader("Connection", "close");
  otaServer.sendHeader("Cache-Control", "no-store");

  if (!otaAuthorized()) {
    otaServer.requestAuthentication();
    return;
  }

  if (otaUploadResult == OTA_RESULT_UNSAFE_OUTPUT) {
    otaServer.send(
      409,
      "text/plain",
      "OTA ditolak: relay tidak siap atau pompa masih aktif. Matikan kedua pompa lalu ulangi."
    );
    return;
  }

  if (otaUploadResult == OTA_RESULT_SUCCESS) {
    otaServer.send(
      200,
      "text/html",
      "<html><body><h2>OTA berhasil</h2><p>ESP32 akan restart.</p></body></html>"
    );

    otaRestartPending = true;
    otaRestartAtMs = millis() + 1800UL;
    return;
  }

  if (otaUploadResult == OTA_RESULT_ABORTED) {
    otaServer.send(400, "text/plain", "OTA dibatalkan.");
    return;
  }

  otaServer.send(500, "text/plain", "OTA gagal. Upload ulang file aplikasi .bin.");
}

void initWebOTA() {
  IPAddress localIp(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.mode(WIFI_AP_STA);
  WiFi.setHostname(FIELD_HOSTNAME);
  loadFieldWifiConfig();

  WiFi.softAPConfig(localIp, gateway, subnet);
  WiFi.softAP(
    FALLBACK_AP_SSID,
    FALLBACK_AP_PASSWORD
  );

  connectFieldWifi();

  otaServer.on("/", HTTP_GET, []() {
    if (!otaRequireAuth()) return;
    otaServer.sendHeader("Cache-Control", "no-store");
    otaServer.send(200, "text/html", otaPageHtml());
  });

  otaServer.on("/update", HTTP_GET, []() {
    if (!otaRequireAuth()) return;
    otaServer.sendHeader("Cache-Control", "no-store");
    otaServer.send(200, "text/html", otaPageHtml());
  });

  otaServer.on("/wifi", HTTP_GET, []() {
    if (!otaRequireAuth()) return;
    otaServer.sendHeader("Cache-Control", "no-store");
    otaServer.send(200, "text/html", wifiPageHtml());
  });

  otaServer.on("/wifi", HTTP_POST, []() {
    if (!otaRequireAuth()) return;

    String ssid = otaServer.arg("ssid");
    String pass = otaServer.arg("pass");
    ssid.trim();

    if (ssid.length() == 0) {
      otaServer.send(400, "text/plain", "SSID tidak boleh kosong.");
      return;
    }

    if (pass.length() == 0) {
      pass = fieldWifiPassword;
    }

    saveFieldWifiConfig(ssid, pass);
    WiFi.disconnect(false, false);
    connectFieldWifi();
    otaServer.send(200, "text/plain", "WiFi tersimpan. Tunggu koneksi lalu buka /wifi.");
  });

  otaServer.on(
    "/update",
    HTTP_POST,
    handleOtaComplete,
    handleOtaUpload
  );

  otaServer.onNotFound([]() {
    if (!otaRequireAuth()) return;
    otaServer.send(404, "text/plain", "Buka /update");
  });

  otaServer.begin();
}

void serviceWebOTA() {
  otaServer.handleClient();

  if (
    fieldWifiSsid.length() > 0 &&
    WiFi.status() != WL_CONNECTED &&
    (uint32_t)(millis() - lastWifiReconnectMs) >= WIFI_RECONNECT_MS
  ) {
    WiFi.disconnect(false, false);
    connectFieldWifi();
  }

  if (
    otaRestartPending &&
    (int32_t)(millis() - otaRestartAtMs) >= 0
  ) {
    ESP.restart();
  }
}


// =============================================================================
// SPFF SERIAL JSON PROTOCOL
// =============================================================================
bool spffLeapYear(
  uint16_t year
) {
  return
    (
      year % 400U
    ) == 0U ||
    (
      (
        year % 4U
      ) == 0U &&
      (
        year % 100U
      ) != 0U
    );
}

uint8_t spffDaysInMonth(
  uint16_t year,
  uint8_t month
) {
  static const uint8_t days[] = {
    31, 28, 31, 30,
    31, 30, 31, 31,
    30, 31, 30, 31
  };

  if (
    month < 1 ||
    month > 12
  ) {
    return 31;
  }

  if (
    month == 2 &&
    spffLeapYear(year)
  ) {
    return 29;
  }

  return
    days[month - 1];
}

void spffPreviousDay(
  uint16_t &year,
  uint8_t &month,
  uint8_t &day
) {
  if (day > 1) {
    day--;
    return;
  }

  if (month > 1) {
    month--;
  } else {
    month = 12;
    year--;
  }

  day =
    spffDaysInMonth(
      year,
      month
    );
}

void spffNextDay(
  uint16_t &year,
  uint8_t &month,
  uint8_t &day
) {
  uint8_t maximum =
    spffDaysInMonth(
      year,
      month
    );

  if (day < maximum) {
    day++;
    return;
  }

  day = 1;

  if (month < 12) {
    month++;
  } else {
    month = 1;
    year++;
  }
}

bool spffGetUtcParts(
  uint16_t &year,
  uint8_t &month,
  uint8_t &day,
  uint8_t &hour,
  uint8_t &minute,
  uint8_t &second
) {
  if (
    !rtcReady ||
    !rtcNow.valid
  ) {
    return false;
  }

  year =
    2000U +
    rtcNow.year;

  month =
    rtcNow.month;

  day =
    rtcNow.day;

  second =
    rtcNow.second;

  int32_t minuteOfDay =
    (int32_t)rtcNow.hour *
    60L +
    rtcNow.minute -
    SPFF_LOCAL_UTC_OFFSET_MINUTES;

  while (minuteOfDay < 0) {
    minuteOfDay += 1440L;

    spffPreviousDay(
      year,
      month,
      day
    );
  }

  while (minuteOfDay >= 1440L) {
    minuteOfDay -= 1440L;

    spffNextDay(
      year,
      month,
      day
    );
  }

  hour =
    (uint8_t)(
      minuteOfDay /
      60L
    );

  minute =
    (uint8_t)(
      minuteOfDay %
      60L
    );

  return true;
}

String spffUtcIso8601() {
  uint16_t year;
  uint8_t month;
  uint8_t day;
  uint8_t hour;
  uint8_t minute;
  uint8_t second;

  if (
    !spffGetUtcParts(
      year,
      month,
      day,
      hour,
      minute,
      second
    )
  ) {
    return "";
  }

  char text[32];

  snprintf(
    text,
    sizeof(text),
    "%04u-%02u-%02uT%02u:%02u:%02u.000Z",
    year,
    month,
    day,
    hour,
    minute,
    second
  );

  return
    String(text);
}

uint32_t spffUtcEpoch() {
  uint16_t year;
  uint8_t month;
  uint8_t day;
  uint8_t hour;
  uint8_t minute;
  uint8_t second;

  if (
    !spffGetUtcParts(
      year,
      month,
      day,
      hour,
      minute,
      second
    )
  ) {
    return 0;
  }

  uint32_t days = 0;

  for (
    uint16_t y = 1970;
    y < year;
    y++
  ) {
    days +=
      spffLeapYear(y)
      ? 366UL
      : 365UL;
  }

  for (
    uint8_t m = 1;
    m < month;
    m++
  ) {
    days +=
      spffDaysInMonth(
        year,
        m
      );
  }

  days +=
    (uint32_t)(
      day -
      1U
    );

  return
    days *
      86400UL +
    (uint32_t)hour *
      3600UL +
    (uint32_t)minute *
      60UL +
    second;
}

void spffAppendKey(
  String &json,
  const char *key,
  bool &first
) {
  if (!first) {
    json += ',';
  }

  first = false;

  json += '"';
  json += key;
  json += "\":";
}

void spffAppendFloat(
  String &json,
  const char *key,
  float value,
  bool valid,
  uint8_t decimals,
  bool &first
) {
  // Kontrak Edge Gateway hanya menerima sensor bernilai NUMBER.
  // Kalau sensor tidak fresh/valid, field DIHILANGKAN — jangan kirim null.
  if (
    !valid ||
    !isfinite(value)
  ) {
    return;
  }

  spffAppendKey(
    json,
    key,
    first
  );

  json +=
    String(
      value,
      (unsigned int)decimals
    );
}

void spffAppendUInt(
  String &json,
  const char *key,
  uint32_t value,
  bool valid,
  bool &first
) {
  // Sama seperti float: sensor invalid tidak dikirim.
  if (!valid) {
    return;
  }

  spffAppendKey(
    json,
    key,
    first
  );

  json +=
    String(value);
}

bool spffSoilValid(
  uint8_t number,
  const SoilData &soil
) {
  (void)number;

  if (
    !soil.complete ||
    soil.lastGoodMs == 0
  ) {
    return false;
  }

  return
    (uint32_t)(
      millis() -
      soil.lastGoodMs
    ) <=
    SOIL_SENSOR_MAX_SILENCE_MS;
}

bool spffWriteJsonLine(
  const String &json
) {
  const size_t payloadLength =
    json.length();

  if (
    payloadLength == 0 ||
    payloadLength + 1U >
      SPFF_SERIAL_FRAME_MAX
  ) {
    return false;
  }

  size_t written =
    Serial.write(
      reinterpret_cast<const uint8_t *>(
        json.c_str()
      ),
      payloadLength
    );

  written +=
    Serial.write(
      static_cast<uint8_t>('\n')
    );

  return
    written ==
    payloadLength + 1U;
}

const char* spffModeText() {
  return
    spffAutomaticControlLoaded &&
    spffAutomaticControl.desiredMode == SPFF_MODE_AUTOMATIC
      ? "automatic"
      : "manual";
}

const char* spffSystemStateText() {
  switch (spffSystemState) {
    case SPFF_SYSTEM_MONITORING:
      return "monitoring";

    case SPFF_SYSTEM_SENSOR_FAULT:
      return "sensor_fault";

    case SPFF_SYSTEM_WAITING_TELEMETRY:
    default:
      return "waiting_telemetry";
  }
}

void updateSystemState(
  bool currentSensorValid
) {
  if (currentSensorValid) {
    spffTelemetryEverValid = true;
    spffLastValidSensorMs = millis();
  }

  SpffSystemState nextState =
    SPFF_SYSTEM_WAITING_TELEMETRY;

  if (currentSensorValid) {
    nextState =
      SPFF_SYSTEM_MONITORING;
  } else if (spffTelemetryEverValid) {
    nextState =
      SPFF_SYSTEM_SENSOR_FAULT;
  }

  if (
    currentSensorValid !=
      spffSensorValid ||
    nextState !=
      spffSystemState
  ) {
    spffStatusDirty = true;
  }

  spffSensorValid =
    currentSensorValid;

  spffSystemState =
    nextState;
}

void initializeSpffDeviceStatus() {
  const uint32_t randomHigh =
    esp_random();

  const uint32_t randomLow =
    esp_random();

  snprintf(
    spffBootId,
    sizeof(spffBootId),
    "%08lx%08lx",
    static_cast<unsigned long>(randomHigh),
    static_cast<unsigned long>(randomLow)
  );

  spffStatusCounter = 0;
  spffLastStatusSentMs = 0;
  spffLastStatusAttemptMs = 0;
  spffLastValidSensorMs = 0;
  spffStatusEverSent = false;
  spffStatusDirty = true;
  spffStatusInitialized = true;
  spffStatusModeInitialized = true;
  spffLastStatusAttemptFailed = false;
  spffObservedTimerMode =
    spffAutomaticControlLoaded
      ? spffAutomaticControl.desiredMode
      : SPFF_MODE_MANUAL;
  spffSensorValid = false;
  spffTelemetryEverValid = false;
  spffSystemState =
    SPFF_SYSTEM_WAITING_TELEMETRY;
}

String buildDeviceStatusPayload() {
  // Ambil RTC terbaru hanya ketika status memang akan dikirim.
  updateRTC();

  const String recordedAt =
    spffUtcIso8601();

  // Jangan membuat timestamp fallback/palsu. Status tetap pending dan akan
  // dicoba lagi ketika RTC sudah valid.
  if (recordedAt.length() == 0) {
    return "";
  }

  uint32_t nextCounter =
    spffStatusCounter + 1U;

  if (nextCounter == 0) {
    nextCounter = 1U;
  }

  String messageId;
  messageId.reserve(48);
  messageId += "status-";
  messageId += spffBootId;
  messageId += '-';
  messageId += String(nextCounter);

  String json;
  json.reserve(360);

  json +=
    "{\"kind\":\"device_status\"";

  json +=
    ",\"schemaVersion\":1";

  json +=
    ",\"siteId\":\"";
  json +=
    SPFF_SITE_ID;
  json +=
    "\"";

  json +=
    ",\"deviceId\":\"";
  json +=
    SPFF_DEVICE_ID;
  json +=
    "\"";

  json +=
    ",\"messageId\":\"";
  json +=
    messageId;
  json +=
    "\"";

  json +=
    ",\"recordedAt\":\"";
  json +=
    recordedAt;
  json +=
    "\"";

  json +=
    ",\"online\":true";

  json +=
    ",\"mode\":\"";
  json +=
    spffModeText();
  json +=
    "\"";

  json +=
    ",\"firmwareVersion\":\"";
  json +=
    SPFF_FIRMWARE_VERSION;
  json +=
    "\"";

  json +=
    ",\"systemState\":\"";
  json +=
    spffSystemStateText();
  json +=
    "\"";

  json +=
    ",\"sensorValid\":";
  json +=
    spffSensorValid
    ? "true"
    : "false";

  json +=
    "}";

  if (
    json.length() + 1U >
      SPFF_SERIAL_FRAME_MAX
  ) {
    return "";
  }

  spffStatusCounter =
    nextCounter;

  return json;
}

bool sendDeviceStatus() {
  const String payload =
    buildDeviceStatusPayload();

  if (payload.length() == 0) {
    return false;
  }

  if (!spffWriteJsonLine(payload)) {
    return false;
  }

  spffStatusEverSent = true;
  spffStatusDirty = false;
  spffLastStatusSentMs = millis();

  return true;
}

bool shouldSendStatusHeartbeat() {
  if (
    !spffStatusEverSent ||
    spffStatusDirty
  ) {
    return true;
  }

  return
    (uint32_t)(
      millis() -
      spffLastStatusSentMs
    ) >=
    SPFF_STATUS_HEARTBEAT_INTERVAL_MS;
}

void serviceDeviceStatus() {
  if (!spffStatusInitialized) {
    return;
  }

  const uint32_t now =
    millis();

  if (
    spffSensorValid &&
    spffLastValidSensorMs != 0 &&
    (uint32_t)(
      now -
      spffLastValidSensorMs
    ) >
      SPFF_SENSOR_VALID_MAX_SILENCE_MS
  ) {
    updateSystemState(false);
  }

  const uint8_t currentTimerMode =
    spffAutomaticControlLoaded
      ? spffAutomaticControl.desiredMode
      : SPFF_MODE_MANUAL;

  if (!spffStatusModeInitialized) {
    spffObservedTimerMode =
      currentTimerMode;
    spffStatusModeInitialized = true;
    spffStatusDirty = true;
  } else if (
    currentTimerMode !=
      spffObservedTimerMode
  ) {
    spffObservedTimerMode =
      currentTimerMode;
    spffStatusDirty = true;
  }

  if (!shouldSendStatusHeartbeat()) {
    return;
  }

  if (
    spffLastStatusAttemptFailed &&
    (uint32_t)(
      now -
      spffLastStatusAttemptMs
    ) <
      SPFF_STATUS_TIME_RETRY_INTERVAL_MS
  ) {
    return;
  }

  spffLastStatusAttemptMs =
    now;

  spffLastStatusAttemptFailed =
    !sendDeviceStatus();
}

bool telemetryCacheTimestampUsable(uint32_t updatedMs) {
  if (updatedMs == 0) {
    return false;
  }

  return
    (uint32_t)(millis() - updatedMs) <=
    SPFF_TELEMETRY_SNAPSHOT_MAX_AGE_MS;
}

bool cachedFloatValid(const CachedFloatValue &cached) {
  return
    cached.hasValue &&
    telemetryCacheTimestampUsable(cached.updatedMs) &&
    isfinite(cached.value);
}

bool cachedUIntValid(const CachedUIntValue &cached) {
  return
    cached.hasValue &&
    telemetryCacheTimestampUsable(cached.updatedMs);
}

void cacheFloatValue(
  CachedFloatValue &cached,
  float value,
  bool valid,
  uint32_t sourceUpdatedMs
) {
  if (
    !valid ||
    sourceUpdatedMs == 0 ||
    !isfinite(value)
  ) {
    return;
  }

  cached.value = value;
  cached.updatedMs = sourceUpdatedMs;
  cached.hasValue = true;
}

void cacheUIntValue(
  CachedUIntValue &cached,
  uint32_t value,
  bool valid,
  uint32_t sourceUpdatedMs
) {
  if (
    !valid ||
    sourceUpdatedMs == 0
  ) {
    return;
  }

  cached.value = value;
  cached.updatedMs = sourceUpdatedMs;
  cached.hasValue = true;
}

void captureTelemetrySnapshot() {
  // Nutrisense: ketiga nilai berasal dari frame yang sama.
  cacheFloatValue(
    telemetrySnapshot.liquidPh,
    nutri.ph,
    nutri.hasValue,
    nutri.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.liquidEcUsCm,
    nutri.ec,
    nutri.hasValue,
    nutri.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.liquidTemp,
    nutri.temp,
    nutri.hasValue,
    nutri.lastGoodMs
  );

  // SHT20: cache hanya diperbarui saat pernah ada frame valid.
  cacheFloatValue(
    telemetrySnapshot.airTemp,
    sht.temp,
    sht.hasValue,
    sht.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.airHumidity,
    sht.rh,
    sht.hasValue,
    sht.lastGoodMs
  );

  // Soil memakai timestamp last-good per register. Jangan menggunakan
  // soil.lastGoodMs untuk semua field karena tiap register dipoll bergiliran.
  const uint32_t *soil1Last = soil1RegLastGoodMs;
  const uint32_t *soil2Last = soil2RegLastGoodMs;

  cacheFloatValue(telemetrySnapshot.soil1Moisture, soil1.raw[0] / 10.0f, soil1.has[0], soil1Last[0]);
  cacheFloatValue(telemetrySnapshot.soil1Temp, ((int16_t)soil1.raw[1]) / 10.0f, soil1.has[1], soil1Last[1]);
  cacheUIntValue(telemetrySnapshot.soil1EcUsCm, soil1.raw[2], soil1.has[2], soil1Last[2]);
  cacheFloatValue(telemetrySnapshot.soil1Ph, soil1.raw[3] / 10.0f, soil1.has[3], soil1Last[3]);
  cacheUIntValue(telemetrySnapshot.soil1N, soil1.raw[4], soil1.has[4], soil1Last[4]);
  cacheUIntValue(telemetrySnapshot.soil1P, soil1.raw[5], soil1.has[5], soil1Last[5]);
  cacheUIntValue(telemetrySnapshot.soil1K, soil1.raw[6], soil1.has[6], soil1Last[6]);

  cacheFloatValue(telemetrySnapshot.soil2Moisture, soil2.raw[0] / 10.0f, soil2.has[0], soil2Last[0]);
  cacheFloatValue(telemetrySnapshot.soil2Temp, ((int16_t)soil2.raw[1]) / 10.0f, soil2.has[1], soil2Last[1]);
  cacheUIntValue(telemetrySnapshot.soil2EcUsCm, soil2.raw[2], soil2.has[2], soil2Last[2]);
  cacheFloatValue(telemetrySnapshot.soil2Ph, soil2.raw[3] / 10.0f, soil2.has[3], soil2Last[3]);
  cacheUIntValue(telemetrySnapshot.soil2N, soil2.raw[4], soil2.has[4], soil2Last[4]);
  cacheUIntValue(telemetrySnapshot.soil2P, soil2.raw[5], soil2.has[5], soil2Last[5]);
  cacheUIntValue(telemetrySnapshot.soil2K, soil2.raw[6], soil2.has[6], soil2Last[6]);

  // Slave ID5: satu frame memperbarui distance/flow/totals bersama-sama.
  cacheFloatValue(
    telemetrySnapshot.tankWaterDistanceCm,
    slaveData.waterDistanceCm,
    slaveData.waterDistanceValid,
    slaveData.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.tankFertDistanceCm,
    slaveData.fertDistanceCm,
    slaveData.fertDistanceValid,
    slaveData.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.flowWaterLpm,
    slaveData.waterFlowLpm,
    slaveData.hasValue,
    slaveData.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.flowFertLpm,
    slaveData.fertFlowLpm,
    slaveData.hasValue,
    slaveData.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.flowWaterTotalL,
    slaveData.waterTotalMl / 1000.0f,
    slaveData.totalsAvailable,
    slaveData.lastGoodMs
  );
  cacheFloatValue(
    telemetrySnapshot.flowFertTotalL,
    slaveData.fertTotalMl / 1000.0f,
    slaveData.totalsAvailable,
    slaveData.lastGoodMs
  );
}

uint8_t telemetrySnapshotValidFieldCount() {
  uint8_t count = 0;

  count += cachedFloatValid(telemetrySnapshot.liquidPh) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.liquidEcUsCm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.liquidTemp) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.airTemp) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.airHumidity) ? 1 : 0;

  count += cachedFloatValid(telemetrySnapshot.soil1Moisture) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.soil1Temp) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil1EcUsCm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.soil1Ph) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil1N) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil1P) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil1K) ? 1 : 0;

  count += cachedFloatValid(telemetrySnapshot.soil2Moisture) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.soil2Temp) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil2EcUsCm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.soil2Ph) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil2N) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil2P) ? 1 : 0;
  count += cachedUIntValid(telemetrySnapshot.soil2K) ? 1 : 0;

  count += cachedFloatValid(telemetrySnapshot.tankWaterDistanceCm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.tankFertDistanceCm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.flowWaterLpm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.flowFertLpm) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.flowWaterTotalL) ? 1 : 0;
  count += cachedFloatValid(telemetrySnapshot.flowFertTotalL) ? 1 : 0;

  return count;
}

bool telemetrySnapshotHasAnyValidData() {
  return telemetrySnapshotValidFieldCount() > 0;
}

bool shouldPublishTelemetrySnapshot() {
  return
    (uint32_t)(millis() - spffLastTelemetrySentMs) >=
    SPFF_TELEMETRY_PUBLISH_INTERVAL_MS;
}

void serviceTelemetrySnapshot() {
  // Jangan publish sebelum initialization firmware/device status selesai.
  if (!spffStatusInitialized) {
    return;
  }

  // captureTelemetrySnapshot() aman dipanggil sering karena updatedMs selalu
  // memakai timestamp pembacaan sumber, bukan waktu service ini dipanggil.
  captureTelemetrySnapshot();

  if (!shouldPublishTelemetrySnapshot()) {
    return;
  }

  if (!telemetrySnapshotHasAnyValidData()) {
    return;
  }

  if (sendSpffTelemetry()) {
    spffLastTelemetrySentMs = millis();
  }
}

void sendTelemetryIfValid() {
  // Capture dulu seluruh last-valid per parameter memakai timestamp sumber asli.
  // Dengan begitu satu timeout sensor tidak menghapus nilai valid sebelumnya.
  captureTelemetrySnapshot();

  const uint8_t validSnapshotFields =
    telemetrySnapshotValidFieldCount();

  const bool snapshotComplete =
    validSnapshotFields ==
    SPFF_SUPPORTED_TELEMETRY_FIELD_COUNT;

  // sensorValid=true hanya jika snapshot 25 parameter lengkap dalam window 300s / 5 menit
  // DAN pembacaan SHT20 cycle sekarang sukses. Jadi cache membantu kelengkapan
  // payload tanpa menyembunyikan fault SHT20 yang sedang terjadi.
  const bool currentSensorValid =
    snapshotComplete &&
    shtTelemetryValid();

  updateSystemState(
    currentSensorValid
  );

  // Perubahan sensorValid/systemState dikirim segera, terpisah dari telemetry.
  serviceDeviceStatus();

  // Service publish terpisah dari sensor cycle. Ini membuat interval telemetry
  // mendekati 30 detik walau satu rangkaian polling Modbus memerlukan waktu lama.
  serviceTelemetrySnapshot();
}

bool sendSpffTelemetry() {
  if (!telemetrySnapshotHasAnyValidData()) {
    return false;
  }

  // recordedAt + sequence wajib valid menurut kontrak Edge Gateway.
  String recordedAt =
    spffUtcIso8601();

  uint32_t sequence =
    spffUtcEpoch();

  if (
    recordedAt.length() == 0 ||
    sequence == 0
  ) {
    return false;
  }

  String messageId =
    String("msg-") +
    SPFF_DEVICE_ID +
    "-" +
    String(sequence);

  String json;
  json.reserve(2100);

  json +=
    "{\"kind\":\"telemetry\"";

  json +=
    ",\"schemaVersion\":1";

  json +=
    ",\"siteId\":\"";
  json +=
    SPFF_SITE_ID;
  json +=
    "\"";

  json +=
    ",\"deviceId\":\"";
  json +=
    SPFF_DEVICE_ID;
  json +=
    "\"";

  json +=
    ",\"messageId\":\"";
  json +=
    messageId;
  json +=
    "\"";

  json +=
    ",\"sequence\":";
  json +=
    String(sequence);

  json +=
    ",\"recordedAt\":\"";
  json +=
    recordedAt;
  json +=
    "\"";

  json +=
    ",\"sensorValid\":";
  json +=
    spffSensorValid
    ? "true"
    : "false";

  json +=
    ",\"sensors\":{";

  bool first = true;

  // ================================================================
  // EXACT SENSOR KEYS dari @spff/contracts telemetrySensorKeys
  // ================================================================

  // Nutrisi cair - last-valid snapshot maksimal 300 detik / 5 menit.
  spffAppendFloat(json, "liquid_ph", telemetrySnapshot.liquidPh.value, cachedFloatValid(telemetrySnapshot.liquidPh), 2, first);
  spffAppendFloat(json, "liquid_ec_us_cm", telemetrySnapshot.liquidEcUsCm.value, cachedFloatValid(telemetrySnapshot.liquidEcUsCm), 0, first);
  spffAppendFloat(json, "liquid_temp", telemetrySnapshot.liquidTemp.value, cachedFloatValid(telemetrySnapshot.liquidTemp), 1, first);

  // Udara SHT20
  spffAppendFloat(json, "air_temp", telemetrySnapshot.airTemp.value, cachedFloatValid(telemetrySnapshot.airTemp), 1, first);
  spffAppendFloat(json, "air_humidity", telemetrySnapshot.airHumidity.value, cachedFloatValid(telemetrySnapshot.airHumidity), 1, first);

  // Soil 1
  spffAppendFloat(json, "soil_1_moisture", telemetrySnapshot.soil1Moisture.value, cachedFloatValid(telemetrySnapshot.soil1Moisture), 1, first);
  spffAppendFloat(json, "soil_1_temp", telemetrySnapshot.soil1Temp.value, cachedFloatValid(telemetrySnapshot.soil1Temp), 1, first);
  spffAppendUInt(json, "soil_1_ec_us_cm", telemetrySnapshot.soil1EcUsCm.value, cachedUIntValid(telemetrySnapshot.soil1EcUsCm), first);
  spffAppendFloat(json, "soil_1_ph", telemetrySnapshot.soil1Ph.value, cachedFloatValid(telemetrySnapshot.soil1Ph), 1, first);
  spffAppendUInt(json, "soil_1_n", telemetrySnapshot.soil1N.value, cachedUIntValid(telemetrySnapshot.soil1N), first);
  spffAppendUInt(json, "soil_1_p", telemetrySnapshot.soil1P.value, cachedUIntValid(telemetrySnapshot.soil1P), first);
  spffAppendUInt(json, "soil_1_k", telemetrySnapshot.soil1K.value, cachedUIntValid(telemetrySnapshot.soil1K), first);

  // Soil 2
  spffAppendFloat(json, "soil_2_moisture", telemetrySnapshot.soil2Moisture.value, cachedFloatValid(telemetrySnapshot.soil2Moisture), 1, first);
  spffAppendFloat(json, "soil_2_temp", telemetrySnapshot.soil2Temp.value, cachedFloatValid(telemetrySnapshot.soil2Temp), 1, first);
  spffAppendUInt(json, "soil_2_ec_us_cm", telemetrySnapshot.soil2EcUsCm.value, cachedUIntValid(telemetrySnapshot.soil2EcUsCm), first);
  spffAppendFloat(json, "soil_2_ph", telemetrySnapshot.soil2Ph.value, cachedFloatValid(telemetrySnapshot.soil2Ph), 1, first);
  spffAppendUInt(json, "soil_2_n", telemetrySnapshot.soil2N.value, cachedUIntValid(telemetrySnapshot.soil2N), first);
  spffAppendUInt(json, "soil_2_p", telemetrySnapshot.soil2P.value, cachedUIntValid(telemetrySnapshot.soil2P), first);
  spffAppendUInt(json, "soil_2_k", telemetrySnapshot.soil2K.value, cachedUIntValid(telemetrySnapshot.soil2K), first);

  // Slave sensor hub
  spffAppendFloat(json, "tank_water_distance_cm", telemetrySnapshot.tankWaterDistanceCm.value, cachedFloatValid(telemetrySnapshot.tankWaterDistanceCm), 1, first);
  spffAppendFloat(json, "tank_fert_distance_cm", telemetrySnapshot.tankFertDistanceCm.value, cachedFloatValid(telemetrySnapshot.tankFertDistanceCm), 1, first);
  spffAppendFloat(json, "flow_water_lpm", telemetrySnapshot.flowWaterLpm.value, cachedFloatValid(telemetrySnapshot.flowWaterLpm), 2, first);
  spffAppendFloat(json, "flow_fert_lpm", telemetrySnapshot.flowFertLpm.value, cachedFloatValid(telemetrySnapshot.flowFertLpm), 2, first);
  spffAppendFloat(json, "flow_water_total_l", telemetrySnapshot.flowWaterTotalL.value, cachedFloatValid(telemetrySnapshot.flowWaterTotalL), 3, first);
  spffAppendFloat(json, "flow_fert_total_l", telemetrySnapshot.flowFertTotalL.value, cachedFloatValid(telemetrySnapshot.flowFertTotalL), 3, first);

  // tank_*_level_pct dan battery_voltage belum punya sumber data resmi,
  // jadi sengaja TIDAK dikirim daripada mengirim nilai palsu/null.

  json +=
    "}}";

  // SATU JSON lengkap = SATU baris dengan terminator LF saja.
  return spffWriteJsonLine(json);
}

// =============================================================================
// SPFF ACTUATOR STATE + SERIAL COMMAND HANDLING
// =============================================================================
// USB CDC Serial adalah protocol channel. Jangan tulis debug text ke Serial.
// Parser di bawah menerima JSON Lines yang bisa terpecah menjadi beberapa
// chunk, beberapa frame sekaligus, CRLF/LF, serta membuang frame oversized.

static bool spffJsonWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

static void spffJsonSkipWhitespace(const String &json, size_t &pos) {
  while (pos < json.length() && spffJsonWhitespace(json[pos])) {
    pos++;
  }
}

static bool spffJsonHexDigit(char c) {
  return
    (c >= '0' && c <= '9') ||
    (c >= 'a' && c <= 'f') ||
    (c >= 'A' && c <= 'F');
}

static bool spffJsonParseStringToken(
  const String &json,
  size_t &pos,
  String *decoded
) {
  if (pos >= json.length() || json[pos] != '"') {
    return false;
  }

  pos++;

  if (decoded != nullptr) {
    *decoded = "";
  }

  while (pos < json.length()) {
    char c = json[pos++];

    if (c == '"') {
      return true;
    }

    if ((uint8_t)c < 0x20U) {
      return false;
    }

    if (c != '\\') {
      if (decoded != nullptr) {
        *decoded += c;
      }
      continue;
    }

    if (pos >= json.length()) {
      return false;
    }

    char escaped = json[pos++];

    switch (escaped) {
      case '"':
      case '\\':
      case '/':
        if (decoded != nullptr) {
          *decoded += escaped;
        }
        break;

      case 'b':
        if (decoded != nullptr) *decoded += '\b';
        break;
      case 'f':
        if (decoded != nullptr) *decoded += '\f';
        break;
      case 'n':
        if (decoded != nullptr) *decoded += '\n';
        break;
      case 'r':
        if (decoded != nullptr) *decoded += '\r';
        break;
      case 't':
        if (decoded != nullptr) *decoded += '\t';
        break;

      case 'u':
        // Command identifiers/keys SPFF adalah ASCII. Validasi escape Unicode
        // tanpa mencoba mengubahnya menjadi UTF-8 agar parser tetap kecil.
        for (uint8_t i = 0; i < 4; i++) {
          if (pos >= json.length() || !spffJsonHexDigit(json[pos])) {
            return false;
          }
          pos++;
        }
        if (decoded != nullptr) {
          *decoded += '?';
        }
        break;

      default:
        return false;
    }
  }

  return false;
}

static bool spffJsonSkipNumber(const String &json, size_t &pos) {
  const size_t length = json.length();

  if (pos < length && json[pos] == '-') {
    pos++;
  }

  if (pos >= length) {
    return false;
  }

  if (json[pos] == '0') {
    pos++;
  } else {
    if (json[pos] < '1' || json[pos] > '9') {
      return false;
    }

    while (pos < length && json[pos] >= '0' && json[pos] <= '9') {
      pos++;
    }
  }

  if (pos < length && json[pos] == '.') {
    pos++;
    size_t fractionalStart = pos;

    while (pos < length && json[pos] >= '0' && json[pos] <= '9') {
      pos++;
    }

    if (pos == fractionalStart) {
      return false;
    }
  }

  if (pos < length && (json[pos] == 'e' || json[pos] == 'E')) {
    pos++;

    if (pos < length && (json[pos] == '+' || json[pos] == '-')) {
      pos++;
    }

    size_t exponentStart = pos;

    while (pos < length && json[pos] >= '0' && json[pos] <= '9') {
      pos++;
    }

    if (pos == exponentStart) {
      return false;
    }
  }

  return true;
}

static bool spffJsonSkipValue(
  const String &json,
  size_t &pos,
  uint8_t depth
) {
  if (depth > SPFF_JSON_MAX_DEPTH) {
    return false;
  }

  spffJsonSkipWhitespace(json, pos);

  if (pos >= json.length()) {
    return false;
  }

  char c = json[pos];

  if (c == '"') {
    return spffJsonParseStringToken(json, pos, nullptr);
  }

  if (c == '{') {
    pos++;
    spffJsonSkipWhitespace(json, pos);

    if (pos < json.length() && json[pos] == '}') {
      pos++;
      return true;
    }

    while (pos < json.length()) {
      if (!spffJsonParseStringToken(json, pos, nullptr)) {
        return false;
      }

      spffJsonSkipWhitespace(json, pos);

      if (pos >= json.length() || json[pos] != ':') {
        return false;
      }

      pos++;

      if (!spffJsonSkipValue(json, pos, depth + 1U)) {
        return false;
      }

      spffJsonSkipWhitespace(json, pos);

      if (pos >= json.length()) {
        return false;
      }

      if (json[pos] == '}') {
        pos++;
        return true;
      }

      if (json[pos] != ',') {
        return false;
      }

      pos++;
      spffJsonSkipWhitespace(json, pos);
    }

    return false;
  }

  if (c == '[') {
    pos++;
    spffJsonSkipWhitespace(json, pos);

    if (pos < json.length() && json[pos] == ']') {
      pos++;
      return true;
    }

    while (pos < json.length()) {
      if (!spffJsonSkipValue(json, pos, depth + 1U)) {
        return false;
      }

      spffJsonSkipWhitespace(json, pos);

      if (pos >= json.length()) {
        return false;
      }

      if (json[pos] == ']') {
        pos++;
        return true;
      }

      if (json[pos] != ',') {
        return false;
      }

      pos++;
      spffJsonSkipWhitespace(json, pos);
    }

    return false;
  }

  if (json.startsWith("true", pos)) {
    pos += 4;
    return true;
  }

  if (json.startsWith("false", pos)) {
    pos += 5;
    return true;
  }

  if (json.startsWith("null", pos)) {
    pos += 4;
    return true;
  }

  if (c == '-' || (c >= '0' && c <= '9')) {
    return spffJsonSkipNumber(json, pos);
  }

  return false;
}

static bool spffJsonValid(const String &json) {
  size_t pos = 0;
  spffJsonSkipWhitespace(json, pos);

  if (pos >= json.length() || json[pos] != '{') {
    return false;
  }

  if (!spffJsonSkipValue(json, pos, 0)) {
    return false;
  }

  spffJsonSkipWhitespace(json, pos);
  return pos == json.length();
}

static bool spffJsonFindUniqueMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *wantedKey,
  bool &found,
  size_t &valueStart,
  size_t &valueEnd
) {
  found = false;

  if (
    objectStart >= objectEnd ||
    objectEnd > json.length() ||
    json[objectStart] != '{'
  ) {
    return false;
  }

  size_t pos = objectStart + 1U;
  spffJsonSkipWhitespace(json, pos);

  if (pos < objectEnd && json[pos] == '}') {
    return true;
  }

  while (pos < objectEnd) {
    String key;
    key.reserve(32);

    if (!spffJsonParseStringToken(json, pos, &key)) {
      return false;
    }

    spffJsonSkipWhitespace(json, pos);

    if (pos >= objectEnd || json[pos] != ':') {
      return false;
    }

    pos++;
    spffJsonSkipWhitespace(json, pos);

    const size_t memberValueStart = pos;

    if (!spffJsonSkipValue(json, pos, 1)) {
      return false;
    }

    const size_t memberValueEnd = pos;

    if (key == wantedKey) {
      if (found) {
        // Duplicate critical key -> reject ambiguous JSON.
        return false;
      }

      found = true;
      valueStart = memberValueStart;
      valueEnd = memberValueEnd;
    }

    spffJsonSkipWhitespace(json, pos);

    if (pos >= objectEnd) {
      return false;
    }

    if (json[pos] == '}') {
      return true;
    }

    if (json[pos] != ',') {
      return false;
    }

    pos++;
    spffJsonSkipWhitespace(json, pos);
  }

  return false;
}

static bool spffJsonGetStringMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  String &value
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        valueStart,
        valueEnd
      ) || !found) {
    return false;
  }

  size_t pos = valueStart;

  if (!spffJsonParseStringToken(json, pos, &value)) {
    return false;
  }

  return pos == valueEnd;
}

static bool spffJsonGetBoolMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  bool &value
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        valueStart,
        valueEnd
      ) || !found) {
    return false;
  }

  if (valueEnd - valueStart == 4U && json.startsWith("true", valueStart)) {
    value = true;
    return true;
  }

  if (valueEnd - valueStart == 5U && json.startsWith("false", valueStart)) {
    value = false;
    return true;
  }

  return false;
}

static bool spffJsonGetUintMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  uint32_t &value
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        valueStart,
        valueEnd
      ) || !found || valueStart >= valueEnd) {
    return false;
  }

  uint32_t result = 0;

  for (size_t i = valueStart; i < valueEnd; i++) {
    char c = json[i];

    if (c < '0' || c > '9') {
      return false;
    }

    uint32_t digit = (uint32_t)(c - '0');

    if (result > (UINT32_MAX - digit) / 10UL) {
      return false;
    }

    result = result * 10UL + digit;
  }

  value = result;
  return true;
}

static bool spffJsonGetObjectMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  size_t &nestedStart,
  size_t &nestedEnd
) {
  bool found = false;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        nestedStart,
        nestedEnd
      ) || !found) {
    return false;
  }

  return nestedStart < nestedEnd && json[nestedStart] == '{';
}

static bool spffJsonGetNullableFloatMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  float &value,
  bool &isNull
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json, objectStart, objectEnd, key,
        found, valueStart, valueEnd
      ) || !found || valueStart >= valueEnd) {
    return false;
  }

  if (
    valueEnd - valueStart == 4U &&
    json.startsWith("null", valueStart)
  ) {
    value = 0;
    isNull = true;
    return true;
  }

  size_t parsedEnd = valueStart;
  if (!spffJsonSkipNumber(json, parsedEnd) || parsedEnd != valueEnd) {
    return false;
  }

  value = json.substring(valueStart, valueEnd).toFloat();
  isNull = false;
  return isfinite(value);
}

static bool spffJsonGetNullableUintMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  uint32_t &value,
  bool &isNull
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json, objectStart, objectEnd, key,
        found, valueStart, valueEnd
      ) || !found || valueStart >= valueEnd) {
    return false;
  }

  if (
    valueEnd - valueStart == 4U &&
    json.startsWith("null", valueStart)
  ) {
    value = 0;
    isNull = true;
    return true;
  }

  isNull = false;
  return spffJsonGetUintMember(
    json, objectStart, objectEnd, key, value
  );
}

static bool spffJsonGetArrayMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  size_t &nestedStart,
  size_t &nestedEnd
) {
  bool found = false;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        nestedStart,
        nestedEnd
      ) || !found) {
    return false;
  }

  return nestedStart < nestedEnd && json[nestedStart] == '[';
}

static bool spffJsonGetNullableStringMember(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  const char *key,
  String &value,
  bool &isNull
) {
  bool found = false;
  size_t valueStart = 0;
  size_t valueEnd = 0;

  if (!spffJsonFindUniqueMember(
        json,
        objectStart,
        objectEnd,
        key,
        found,
        valueStart,
        valueEnd
      ) || !found) {
    return false;
  }

  if (
    valueEnd - valueStart == 4U &&
    json.startsWith("null", valueStart)
  ) {
    value = "";
    isNull = true;
    return true;
  }

  size_t pos = valueStart;
  isNull = false;

  if (!spffJsonParseStringToken(json, pos, &value)) {
    return false;
  }

  return pos == valueEnd;
}

static bool spffParseFixedDigits(
  const String &text,
  size_t start,
  size_t count,
  uint16_t &value
) {
  if (start + count > text.length()) {
    return false;
  }

  uint16_t result = 0;

  for (size_t i = 0; i < count; i++) {
    char c = text[start + i];

    if (c < '0' || c > '9') {
      return false;
    }

    result = (uint16_t)(result * 10U + (uint16_t)(c - '0'));
  }

  value = result;
  return true;
}

static bool spffParseUtcIso8601Epoch(
  const String &text,
  uint32_t &epoch
) {
  // Terima YYYY-MM-DDTHH:MM:SSZ dan versi dengan fractional seconds.
  if (text.length() < 20U) {
    return false;
  }

  if (
    text[4] != '-' ||
    text[7] != '-' ||
    text[10] != 'T' ||
    text[13] != ':' ||
    text[16] != ':'
  ) {
    return false;
  }

  uint16_t year = 0;
  uint16_t month16 = 0;
  uint16_t day16 = 0;
  uint16_t hour16 = 0;
  uint16_t minute16 = 0;
  uint16_t second16 = 0;

  if (
    !spffParseFixedDigits(text, 0, 4, year) ||
    !spffParseFixedDigits(text, 5, 2, month16) ||
    !spffParseFixedDigits(text, 8, 2, day16) ||
    !spffParseFixedDigits(text, 11, 2, hour16) ||
    !spffParseFixedDigits(text, 14, 2, minute16) ||
    !spffParseFixedDigits(text, 17, 2, second16)
  ) {
    return false;
  }

  if (
    year < 1970U || year > 2105U ||
    month16 < 1U || month16 > 12U ||
    hour16 > 23U || minute16 > 59U || second16 > 59U
  ) {
    return false;
  }

  uint8_t month = (uint8_t)month16;
  uint8_t day = (uint8_t)day16;

  if (day < 1U || day > spffDaysInMonth(year, month)) {
    return false;
  }

  size_t pos = 19U;

  if (pos < text.length() && text[pos] == '.') {
    pos++;
    size_t fractionStart = pos;

    while (pos < text.length() && text[pos] >= '0' && text[pos] <= '9') {
      pos++;
    }

    if (pos == fractionStart) {
      return false;
    }
  }

  if (pos + 1U != text.length() || text[pos] != 'Z') {
    return false;
  }

  uint32_t days = 0;

  for (uint16_t y = 1970U; y < year; y++) {
    days += spffLeapYear(y) ? 366UL : 365UL;
  }

  for (uint8_t m = 1U; m < month; m++) {
    days += spffDaysInMonth(year, m);
  }

  days += (uint32_t)(day - 1U);

  epoch =
    days * 86400UL +
    (uint32_t)hour16 * 3600UL +
    (uint32_t)minute16 * 60UL +
    (uint32_t)second16;

  return true;
}

static void spffCopyFixed(
  char *destination,
  size_t destinationSize,
  const String &source
) {
  if (destinationSize == 0U) {
    return;
  }

  size_t count = source.length();

  if (count >= destinationSize) {
    count = destinationSize - 1U;
  }

  for (size_t i = 0; i < count; i++) {
    destination[i] = source[i];
  }

  destination[count] = '\0';
}

static void spffCopyFixed(
  char *destination,
  size_t destinationSize,
  const char *source
) {
  if (destinationSize == 0U) {
    return;
  }

  size_t index = 0;

  if (source != nullptr) {
    while (source[index] != '\0' && index + 1U < destinationSize) {
      destination[index] = source[index];
      index++;
    }
  }

  destination[index] = '\0';
}

static void spffAppendEscapedString(
  String &json,
  const String &text
) {
  for (size_t i = 0; i < text.length(); i++) {
    char c = text[i];

    if (c == '"' || c == '\\') {
      json += '\\';
    }

    if ((uint8_t)c >= 0x20U) {
      json += c;
    }
  }
}

static SpffActuatorStateTracker *spffActuatorTrackerForTarget(
  const String &targetId
) {
  if (targetId == "pump_water") {
    return &spffWaterStateTracker;
  }

  if (targetId == "pump_fert") {
    return &spffFertStateTracker;
  }

  return nullptr;
}

bool sendSpffActuatorStateEvent(
  const char *targetId,
  bool stateKnown,
  bool actualActive,
  const String &commandId,
  const char *reason
) {
  updateRTC();

  String recordedAt = spffUtcIso8601();
  uint32_t sequence = spffUtcEpoch();

  if (recordedAt.length() == 0 || sequence == 0) {
    return false;
  }

  spffActuatorStateCounter++;

  String json;
  json.reserve(850);

  json += "{\"kind\":\"actuator_state\"";
  json += ",\"schemaVersion\":1";
  json += ",\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\"";
  json += ",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\"";
  json += ",\"messageId\":\"state-";
  json += SPFF_DEVICE_ID;
  json += "-";
  json += targetId;
  json += "-";
  json += String(sequence);
  json += "-";
  json += String(spffActuatorStateCounter);
  json += "\"";

  if (commandId.length() > 0) {
    json += ",\"commandId\":\"";
    spffAppendEscapedString(json, commandId);
    json += "\"";
  }

  json += ",\"recordedAt\":\"";
  json += recordedAt;
  json += "\"";
  json += ",\"targetId\":\"";
  json += targetId;
  json += "\"";

  if (stateKnown) {
    json += ",\"state\":\"";
    json += actualActive ? "active" : "inactive";
    json += "\"";
    json += ",\"isActive\":";
    json += actualActive ? "true" : "false";
  } else {
    json += ",\"state\":\"fault\"";
    json += ",\"isActive\":null";
  }

  if (reason != nullptr && reason[0] != '\0') {
    json += ",\"reason\":\"";
    json += reason;
    json += "\"";
  } else if (!stateKnown) {
    json += ",\"reason\":\"relay_fault\"";
  }

  json += "}";
  return spffWriteJsonLine(json);
}

static void spffRememberActuatorState(
  SpffActuatorStateTracker &tracker,
  bool stateKnown,
  bool actualActive
) {
  tracker.initialized = true;
  tracker.stateKnown = stateKnown;
  tracker.isActive = actualActive;
}

static void spffServiceOneActuatorState(
  const char *targetId,
  uint8_t relayChannel,
  SpffActuatorStateTracker &tracker
) {
  bool actualActive = false;
  bool stateKnown = relayOutputReadback(relayChannel, actualActive);

  bool changed =
    !tracker.initialized ||
    tracker.stateKnown != stateKnown ||
    (stateKnown && tracker.isActive != actualActive);

  if (!changed) {
    return;
  }

  const char *reason =
    (!stateKnown && tracker.initialized)
    ? "relay_fault"
    : "";

  if (sendSpffActuatorStateEvent(
        targetId,
        stateKnown,
        actualActive,
        String(),
        reason
      )) {
    spffRememberActuatorState(tracker, stateKnown, actualActive);
  }
}

void serviceSpffActuatorStateChanges(bool forcePoll) {
  uint32_t now = millis();

  if (
    !forcePoll &&
    (uint32_t)(now - spffLastActuatorStatePollMs) <
      SPFF_ACTUATOR_STATE_POLL_INTERVAL_MS
  ) {
    return;
  }

  spffLastActuatorStatePollMs = now;

  spffServiceOneActuatorState(
    "pump_water",
    PUMP_WATER_RELAY,
    spffWaterStateTracker
  );

  spffServiceOneActuatorState(
    "pump_fert",
    PUMP_FERTILIZER_RELAY,
    spffFertStateTracker
  );
}

bool sendSpffActuatorAckAt(
  const String &commandId,
  const String &targetId,
  const char *acknowledgedAt,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason
) {
  if (acknowledgedAt == nullptr || acknowledgedAt[0] == '\0') {
    return false;
  }

  String json;
  json.reserve(850);

  json += "{\"kind\":\"command_ack\"";
  json += ",\"schemaVersion\":1";
  json += ",\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\"";
  json += ",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\"";
  json += ",\"commandId\":\"";
  spffAppendEscapedString(json, commandId);
  json += "\"";
  json += ",\"acknowledgedAt\":\"";
  json += acknowledgedAt;
  json += "\"";
  json += ",\"status\":\"";
  json += status;
  json += "\"";
  json += ",\"targetId\":\"";
  spffAppendEscapedString(json, targetId);
  json += "\"";

  if (actualStateKnown) {
    json += ",\"actualState\":{\"isActive\":";
    json += actualActive ? "true" : "false";
    json += "}";
  }

  if (reason != nullptr && reason[0] != '\0') {
    json += ",\"reason\":\"";
    json += reason;
    json += "\"";
  }

  json += "}";
  return spffWriteJsonLine(json);
}

bool sendSpffActuatorAck(
  const String &commandId,
  const String &targetId,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason,
  String *acknowledgedAtOut
) {
  updateRTC();
  String acknowledgedAt = spffUtcIso8601();

  // Jika RTC belum valid, issuedAt dari command yang sudah lolos autentikasi
  // MQTT/Edge dipakai agar command tidak menggantung tanpa ACK.
  if (acknowledgedAt.length() == 0) {
    uint32_t fallbackEpoch = 0;
    if (
      spffCurrentCommandIssuedAt.length() == 0U ||
      !spffParseUtcIso8601Epoch(
        spffCurrentCommandIssuedAt,
        fallbackEpoch
      )
    ) {
      return false;
    }
    acknowledgedAt = spffCurrentCommandIssuedAt;
  }

  bool sent = sendSpffActuatorAckAt(
    commandId,
    targetId,
    acknowledgedAt.c_str(),
    status,
    actualStateKnown,
    actualActive,
    reason
  );

  if (sent && acknowledgedAtOut != nullptr) {
    *acknowledgedAtOut = acknowledgedAt;
  }

  return sent;
}

static SpffCommandHistoryEntry *spffFindCommandHistory(
  const String &commandId
) {
  for (uint8_t i = 0; i < SPFF_COMMAND_HISTORY_SIZE; i++) {
    if (
      spffCommandHistory[i].used &&
      commandId == spffCommandHistory[i].commandId
    ) {
      return &spffCommandHistory[i];
    }
  }

  return nullptr;
}

static void spffStoreCommandHistory(
  const String &commandId,
  const String &targetId,
  const String &acknowledgedAt,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason
) {
  SpffCommandHistoryEntry &entry =
    spffCommandHistory[spffCommandHistoryCursor];

  entry.used = true;
  spffCopyFixed(entry.commandId, sizeof(entry.commandId), commandId);
  spffCopyFixed(entry.targetId, sizeof(entry.targetId), targetId);
  spffCopyFixed(entry.acknowledgedAt, sizeof(entry.acknowledgedAt), acknowledgedAt);
  spffCopyFixed(entry.status, sizeof(entry.status), status);
  entry.actualStateKnown = actualStateKnown;
  entry.actualActive = actualActive;
  spffCopyFixed(entry.reason, sizeof(entry.reason), reason);

  spffCommandHistoryCursor =
    (uint8_t)((spffCommandHistoryCursor + 1U) % SPFF_COMMAND_HISTORY_SIZE);
}

static bool spffSendFinalAckAndRemember(
  const String &commandId,
  const String &targetId,
  const char *status,
  bool actualStateKnown,
  bool actualActive,
  const char *reason
) {
  String acknowledgedAt;

  if (!sendSpffActuatorAck(
        commandId,
        targetId,
        status,
        actualStateKnown,
        actualActive,
        reason,
        &acknowledgedAt
      )) {
    return false;
  }

  spffStoreCommandHistory(
    commandId,
    targetId,
    acknowledgedAt,
    status,
    actualStateKnown,
    actualActive,
    reason
  );

  return true;
}

static void spffReplayFinalAck(const SpffCommandHistoryEntry &entry) {
  sendSpffActuatorAckAt(
    String(entry.commandId),
    String(entry.targetId),
    entry.acknowledgedAt,
    entry.status,
    entry.actualStateKnown,
    entry.actualActive,
    entry.reason
  );
}

static void spffPublishBackendStateChange(
  const String &targetId,
  bool previousStateKnown,
  bool previousActive,
  bool actualActive,
  const String &commandId
) {
  SpffActuatorStateTracker *tracker =
    spffActuatorTrackerForTarget(targetId);

  if (tracker == nullptr) {
    return;
  }

  const bool changed =
    !previousStateKnown ||
    previousActive != actualActive;

  if (changed) {
    if (sendSpffActuatorStateEvent(
          targetId.c_str(),
          true,
          actualActive,
          commandId,
          "backend_command"
        )) {
      spffRememberActuatorState(*tracker, true, actualActive);
    }
    return;
  }

  // Command berbeda tetapi desired state sudah sama: jangan buat event
  // backend_command baru. Jika tracker belum sempat melihat perubahan eksternal,
  // catat perubahan tersebut sekali sebagai state change biasa.
  if (
    !tracker->initialized ||
    !tracker->stateKnown ||
    tracker->isActive != actualActive
  ) {
    if (sendSpffActuatorStateEvent(
          targetId.c_str(),
          true,
          actualActive,
          String(),
          ""
        )) {
      spffRememberActuatorState(*tracker, true, actualActive);
    }
  }
}

static uint32_t spffFnv1aBytes(
  const uint8_t *bytes,
  size_t length
) {
  uint32_t hash = 2166136261UL;

  for (size_t i = 0; i < length; i++) {
    hash ^= bytes[i];
    hash *= 16777619UL;
  }

  return hash;
}

static uint32_t spffSyncedScheduleChecksum(
  const SpffSyncedScheduleStore &store
) {
  return spffFnv1aBytes(
    reinterpret_cast<const uint8_t *>(&store),
    offsetof(SpffSyncedScheduleStore, checksum)
  );
}

static uint32_t spffAutomaticControlChecksum(
  const SpffAutomaticControlStore &store
) {
  return spffFnv1aBytes(
    reinterpret_cast<const uint8_t *>(&store),
    offsetof(SpffAutomaticControlStore, checksum)
  );
}

static uint32_t spffAutomaticDailyChecksum(
  const SpffAutomaticDailyStore &store
) {
  return spffFnv1aBytes(
    reinterpret_cast<const uint8_t *>(&store),
    offsetof(SpffAutomaticDailyStore, checksum)
  );
}

static bool spffPersistAutomaticDailyState() {
  SpffAutomaticDailyStore store;
  memset(&store, 0, sizeof(store));
  store.magic = SPFF_AUTO_DAILY_STORE_MAGIC;
  store.dateKey = spffFertDailyDateKey;
  store.fertilizerStartTotalMl = spffFertDailyStartTotalMl;
  store.checksum = spffAutomaticDailyChecksum(store);
  return prefs.putBytes(
    SPFF_AUTO_DAILY_NVS_KEY,
    &store,
    sizeof(store)
  ) == sizeof(store);
}

void loadSpffAutomaticDailyState() {
  spffFertDailyDateKey = 0U;
  spffFertDailyStartTotalMl = 0UL;

  if (
    prefs.getBytesLength(SPFF_AUTO_DAILY_NVS_KEY) !=
    sizeof(SpffAutomaticDailyStore)
  ) {
    return;
  }

  SpffAutomaticDailyStore store;
  memset(&store, 0, sizeof(store));
  if (
    prefs.getBytes(
      SPFF_AUTO_DAILY_NVS_KEY,
      &store,
      sizeof(store)
    ) != sizeof(store) ||
    store.magic != SPFF_AUTO_DAILY_STORE_MAGIC ||
    store.dateKey == 0U ||
    store.checksum != spffAutomaticDailyChecksum(store)
  ) {
    return;
  }

  spffFertDailyDateKey = store.dateKey;
  spffFertDailyStartTotalMl = store.fertilizerStartTotalMl;
}

static void spffResetAutomaticControl(
  SpffAutomaticControlStore &store
) {
  memset(&store, 0, sizeof(store));
  store.magic = SPFF_AUTO_STORE_MAGIC;
  store.formatVersion = SPFF_AUTO_STORE_FORMAT;
  store.desiredMode = SPFF_MODE_MANUAL;
  store.water.sensor = 1U;
  store.water.triggerSampleCount = 3U;
  store.water.sensorStaleSeconds = 120UL;
  store.fertilizer.triggerSampleCount = 3U;
  store.fertilizer.sensorStaleSeconds = 120UL;
}

static bool spffPersistAutomaticControl(
  const SpffAutomaticControlStore &store
) {
  return prefs.putBytes(
    SPFF_AUTO_NVS_KEY,
    &store,
    sizeof(store)
  ) == sizeof(store);
}

void loadSpffAutomaticControl() {
  spffResetAutomaticControl(spffAutomaticControl);
  spffAutomaticControlLoaded = false;

  if (
    prefs.getBytesLength(SPFF_AUTO_NVS_KEY) !=
    sizeof(SpffAutomaticControlStore)
  ) {
    return;
  }

  SpffAutomaticControlStore stored;
  memset(&stored, 0, sizeof(stored));

  if (
    prefs.getBytes(
      SPFF_AUTO_NVS_KEY,
      &stored,
      sizeof(stored)
    ) != sizeof(stored) ||
    stored.magic != SPFF_AUTO_STORE_MAGIC ||
    stored.formatVersion != SPFF_AUTO_STORE_FORMAT ||
    stored.revision < 1UL ||
    stored.desiredMode > SPFF_MODE_AUTOMATIC ||
    stored.checksum != spffAutomaticControlChecksum(stored)
  ) {
    return;
  }

  spffAutomaticControl = stored;
  spffAutomaticControlLoaded = true;
}

static void spffResetSyncedScheduleStore(
  SpffSyncedScheduleStore &store
) {
  memset(&store, 0, sizeof(store));
  store.magic = SPFF_SCHEDULE_STORE_MAGIC;
  store.formatVersion = SPFF_SCHEDULE_STORE_FORMAT;
  store.authority = SPFF_SCHEDULE_AUTHORITY_SERVER;
}

static bool spffPersistSyncedScheduleStore(
  const SpffSyncedScheduleStore &store
) {
  return prefs.putBytes(
    SPFF_SCHEDULE_NVS_KEY,
    &store,
    sizeof(store)
  ) == sizeof(store);
}

void loadSpffSyncedSchedules() {
  spffResetSyncedScheduleStore(spffSyncedScheduleStore);
  spffSyncedScheduleLoaded = false;

  if (
    prefs.getBytesLength(SPFF_SCHEDULE_NVS_KEY) !=
    sizeof(SpffSyncedScheduleStore)
  ) {
    return;
  }

  SpffSyncedScheduleStore stored;
  memset(&stored, 0, sizeof(stored));

  if (
    prefs.getBytes(
      SPFF_SCHEDULE_NVS_KEY,
      &stored,
      sizeof(stored)
    ) != sizeof(stored)
  ) {
    return;
  }

  if (
    stored.magic != SPFF_SCHEDULE_STORE_MAGIC ||
    stored.formatVersion != SPFF_SCHEDULE_STORE_FORMAT ||
    stored.count > SPFF_SYNCED_SCHEDULE_MAX ||
    (
      stored.authority != SPFF_SCHEDULE_AUTHORITY_SERVER &&
      stored.authority != SPFF_SCHEDULE_AUTHORITY_DEVICE
    ) ||
    stored.revision < 1UL ||
    stored.checksum != spffSyncedScheduleChecksum(stored)
  ) {
    return;
  }

  spffSyncedScheduleStore = stored;
  spffSyncedScheduleLoaded = true;
}

static uint32_t spffScheduleIdHash(
  const String &scheduleId
) {
  return spffFnv1aBytes(
    reinterpret_cast<const uint8_t *>(scheduleId.c_str()),
    scheduleId.length()
  );
}

static bool spffParseScheduleTime(
  const String &text,
  uint32_t &secondOfDay
) {
  if (
    text.length() != 8U ||
    text[2] != ':' ||
    text[5] != ':'
  ) {
    return false;
  }

  uint16_t hour = 0;
  uint16_t minute = 0;
  uint16_t second = 0;

  if (
    !spffParseFixedDigits(text, 0, 2, hour) ||
    !spffParseFixedDigits(text, 3, 2, minute) ||
    !spffParseFixedDigits(text, 6, 2, second) ||
    hour > 23U ||
    minute > 59U ||
    second > 59U
  ) {
    return false;
  }

  secondOfDay =
    (uint32_t)hour * 3600UL +
    (uint32_t)minute * 60UL +
    second;

  return true;
}

static bool spffParseScheduleDate(
  const String &text,
  uint16_t &year,
  uint8_t &month,
  uint8_t &day
) {
  if (
    text.length() != 10U ||
    text[4] != '-' ||
    text[7] != '-'
  ) {
    return false;
  }

  uint16_t month16 = 0;
  uint16_t day16 = 0;

  if (
    !spffParseFixedDigits(text, 0, 4, year) ||
    !spffParseFixedDigits(text, 5, 2, month16) ||
    !spffParseFixedDigits(text, 8, 2, day16) ||
    year < 2000U ||
    year > 2099U ||
    month16 < 1U ||
    month16 > 12U
  ) {
    return false;
  }

  month = (uint8_t)month16;
  day = (uint8_t)day16;

  return day >= 1U && day <= spffDaysInMonth(year, month);
}

static bool spffParseOneSyncedSchedule(
  const String &json,
  size_t objectStart,
  size_t objectEnd,
  SpffSyncedSchedule &schedule,
  const char *&reason
) {
  String scheduleId;
  String targetId;
  String onTime;
  String offTime;
  String repeatRule;
  String runDate;
  String timezone;
  bool runDateIsNull = false;
  bool enabled = false;

  if (
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "scheduleId", scheduleId
    ) ||
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "targetId", targetId
    ) ||
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "onTime", onTime
    ) ||
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "offTime", offTime
    ) ||
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "repeatRule", repeatRule
    ) ||
    !spffJsonGetNullableStringMember(
      json,
      objectStart,
      objectEnd,
      "runDate",
      runDate,
      runDateIsNull
    ) ||
    !spffJsonGetStringMember(
      json, objectStart, objectEnd, "timezone", timezone
    ) ||
    !spffJsonGetBoolMember(
      json, objectStart, objectEnd, "enabled", enabled
    )
  ) {
    reason = "invalid_schedule";
    return false;
  }

  String scheduleIdCheck = scheduleId;
  scheduleIdCheck.trim();

  if (
    scheduleIdCheck.length() == 0U ||
    scheduleId.length() > 128U
  ) {
    reason = "invalid_schedule_id";
    return false;
  }

  if (targetId == "pump_water") {
    schedule.target = SPFF_SCHEDULE_TARGET_WATER;
  } else if (targetId == "pump_fert") {
    schedule.target = SPFF_SCHEDULE_TARGET_FERT;
  } else {
    reason = "unknown_target";
    return false;
  }

  if (
    !spffParseScheduleTime(onTime, schedule.onSecond) ||
    !spffParseScheduleTime(offTime, schedule.offSecond) ||
    schedule.offSecond <= schedule.onSecond
  ) {
    reason = "invalid_schedule_time";
    return false;
  }

  if (repeatRule == "daily") {
    schedule.repeatRule = SPFF_SCHEDULE_REPEAT_DAILY;
  } else if (repeatRule == "weekdays") {
    schedule.repeatRule = SPFF_SCHEDULE_REPEAT_WEEKDAYS;
  } else if (repeatRule == "weekends") {
    schedule.repeatRule = SPFF_SCHEDULE_REPEAT_WEEKENDS;
  } else if (repeatRule == "once") {
    schedule.repeatRule = SPFF_SCHEDULE_REPEAT_ONCE;
  } else {
    reason = "invalid_repeat_rule";
    return false;
  }

  if (schedule.repeatRule == SPFF_SCHEDULE_REPEAT_ONCE) {
    if (
      runDateIsNull ||
      !spffParseScheduleDate(
        runDate,
        schedule.runYear,
        schedule.runMonth,
        schedule.runDay
      )
    ) {
      reason = "invalid_run_date";
      return false;
    }
  } else if (!runDateIsNull) {
    reason = "invalid_run_date";
    return false;
  }

  // RTC dan seluruh evaluator firmware menggunakan waktu lokal UTC+7.
  if (
    timezone != "Asia/Jakarta" &&
    timezone != "Asia/Bangkok"
  ) {
    reason = "unsupported_timezone";
    return false;
  }

  schedule.scheduleIdHash = spffScheduleIdHash(scheduleId);
  schedule.enabled = enabled ? 1U : 0U;
  return true;
}

static bool spffParseSyncedScheduleArray(
  const String &json,
  size_t arrayStart,
  size_t arrayEnd,
  SpffSyncedScheduleStore &candidate,
  const char *&reason
) {
  if (
    arrayStart >= arrayEnd ||
    arrayEnd > json.length() ||
    json[arrayStart] != '['
  ) {
    reason = "invalid_schedule_list";
    return false;
  }

  size_t pos = arrayStart + 1U;
  spffJsonSkipWhitespace(json, pos);

  if (pos < arrayEnd && json[pos] == ']') {
    return pos + 1U == arrayEnd;
  }

  while (pos < arrayEnd) {
    if (candidate.count >= SPFF_SYNCED_SCHEDULE_MAX) {
      reason = "too_many_schedules";
      return false;
    }

    const size_t objectStart = pos;

    if (json[objectStart] != '{') {
      reason = "invalid_schedule";
      return false;
    }

    if (!spffJsonSkipValue(json, pos, 2U)) {
      reason = "invalid_schedule";
      return false;
    }

    const size_t objectEnd = pos;
    SpffSyncedSchedule parsed;
    memset(&parsed, 0, sizeof(parsed));

    if (!spffParseOneSyncedSchedule(
          json,
          objectStart,
          objectEnd,
          parsed,
          reason
        )) {
      return false;
    }

    for (uint8_t i = 0; i < candidate.count; i++) {
      if (
        candidate.schedules[i].scheduleIdHash ==
        parsed.scheduleIdHash
      ) {
        reason = "duplicate_schedule_id";
        return false;
      }
    }

    candidate.schedules[candidate.count] = parsed;
    candidate.count++;

    spffJsonSkipWhitespace(json, pos);

    if (pos >= arrayEnd) {
      reason = "invalid_schedule_list";
      return false;
    }

    if (json[pos] == ']') {
      return pos + 1U == arrayEnd;
    }

    if (json[pos] != ',') {
      reason = "invalid_schedule_list";
      return false;
    }

    pos++;
    spffJsonSkipWhitespace(json, pos);
  }

  reason = "invalid_schedule_list";
  return false;
}

static bool spffSendScheduleSyncAck(
  uint32_t revision,
  const String &generatedAt,
  const char *status,
  uint8_t storedScheduleCount,
  const char *reason
) {
  updateRTC();
  String acknowledgedAt = spffUtcIso8601();

  if (acknowledgedAt.length() == 0U) {
    uint32_t generatedEpoch = 0;

    if (!spffParseUtcIso8601Epoch(generatedAt, generatedEpoch)) {
      return false;
    }

    acknowledgedAt = generatedAt;
  }

  String json;
  json.reserve(650);
  json += "{\"kind\":\"schedule_sync_ack\"";
  json += ",\"schemaVersion\":1";
  json += ",\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\"";
  json += ",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\"";
  json += ",\"revision\":";
  json += String(revision);
  json += ",\"acknowledgedAt\":\"";
  json += acknowledgedAt;
  json += "\"";
  json += ",\"status\":\"";
  json += status;
  json += "\"";
  json += ",\"storedScheduleCount\":";
  json += String((uint32_t)storedScheduleCount);

  if (reason != nullptr && reason[0] != '\0') {
    json += ",\"reason\":\"";
    spffAppendEscapedString(json, String(reason));
    json += "\"";
  }

  json += "}";
  return spffWriteJsonLine(json);
}

void processSpffScheduleSyncLine(
  const String &line,
  size_t rootStart,
  size_t rootEnd
) {
  uint32_t schemaVersion = 0;
  uint32_t revision = 0;
  String siteId;
  String deviceId;
  String generatedAt;
  String executionAuthority;

  const bool identityOk =
    spffJsonGetUintMember(
      line, rootStart, rootEnd, "schemaVersion", schemaVersion
    ) &&
    schemaVersion == 1UL &&
    spffJsonGetStringMember(
      line, rootStart, rootEnd, "siteId", siteId
    ) &&
    siteId == SPFF_SITE_ID &&
    spffJsonGetStringMember(
      line, rootStart, rootEnd, "deviceId", deviceId
    ) &&
    deviceId == SPFF_DEVICE_ID;

  // Snapshot untuk device lain tidak boleh mengubah NVS atau menghasilkan ACK.
  if (!identityOk) {
    return;
  }

  if (
    !spffJsonGetUintMember(
      line, rootStart, rootEnd, "revision", revision
    ) ||
    revision < 1UL
  ) {
    return;
  }

  uint32_t generatedEpoch = 0;

  if (
    !spffJsonGetStringMember(
      line, rootStart, rootEnd, "generatedAt", generatedAt
    ) ||
    !spffParseUtcIso8601Epoch(generatedAt, generatedEpoch)
  ) {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleLoaded ? spffSyncedScheduleStore.count : 0U,
      "invalid_generated_at"
    );
    return;
  }

  if (!spffJsonGetStringMember(
        line,
        rootStart,
        rootEnd,
        "executionAuthority",
        executionAuthority
      )) {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleLoaded ? spffSyncedScheduleStore.count : 0U,
      "invalid_authority"
    );
    return;
  }

  SpffSyncedScheduleStore candidate;
  spffResetSyncedScheduleStore(candidate);
  candidate.revision = revision;

  if (executionAuthority == "server") {
    candidate.authority = SPFF_SCHEDULE_AUTHORITY_SERVER;
  } else if (executionAuthority == "device") {
    candidate.authority = SPFF_SCHEDULE_AUTHORITY_DEVICE;
  } else {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleLoaded ? spffSyncedScheduleStore.count : 0U,
      "invalid_authority"
    );
    return;
  }

  size_t schedulesStart = 0;
  size_t schedulesEnd = 0;
  const char *reason = "invalid_schedule_list";

  if (
    !spffJsonGetArrayMember(
      line,
      rootStart,
      rootEnd,
      "schedules",
      schedulesStart,
      schedulesEnd
    ) ||
    !spffParseSyncedScheduleArray(
      line,
      schedulesStart,
      schedulesEnd,
      candidate,
      reason
    )
  ) {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleLoaded ? spffSyncedScheduleStore.count : 0U,
      reason
    );
    return;
  }

  candidate.checksum = spffSyncedScheduleChecksum(candidate);

  if (
    spffSyncedScheduleLoaded &&
    revision < spffSyncedScheduleStore.revision
  ) {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleStore.count,
      "stale_revision"
    );
    return;
  }

  if (
    spffSyncedScheduleLoaded &&
    revision == spffSyncedScheduleStore.revision
  ) {
    // QoS/restart resend: revision yang sama sudah tersimpan; hindari write flash.
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "applied",
      spffSyncedScheduleStore.count,
      ""
    );
    return;
  }

  if (!spffPersistSyncedScheduleStore(candidate)) {
    spffSendScheduleSyncAck(
      revision,
      generatedAt,
      "rejected",
      spffSyncedScheduleLoaded ? spffSyncedScheduleStore.count : 0U,
      "nvs_write_failed"
    );
    return;
  }

  spffSyncedScheduleStore = candidate;
  spffSyncedScheduleLoaded = true;

  spffSendScheduleSyncAck(
    revision,
    generatedAt,
    "applied",
    candidate.count,
    ""
  );
}

static bool spffSendAutomaticControlAck(
  uint32_t revision,
  const String &generatedAt,
  const char *status,
  SpffOperatingMode appliedMode,
  const char *reason
) {
  updateRTC();
  String acknowledgedAt = spffUtcIso8601();

  if (acknowledgedAt.length() == 0U) {
    uint32_t generatedEpoch = 0;
    if (!spffParseUtcIso8601Epoch(generatedAt, generatedEpoch)) {
      return false;
    }
    acknowledgedAt = generatedAt;
  }

  String json;
  json.reserve(650);
  json += "{\"kind\":\"automatic_control_ack\"";
  json += ",\"schemaVersion\":1";
  json += ",\"siteId\":\"";
  json += SPFF_SITE_ID;
  json += "\"";
  json += ",\"deviceId\":\"";
  json += SPFF_DEVICE_ID;
  json += "\"";
  json += ",\"revision\":";
  json += String(revision);
  json += ",\"acknowledgedAt\":\"";
  json += acknowledgedAt;
  json += "\"";
  json += ",\"status\":\"";
  json += status;
  json += "\"";
  json += ",\"appliedMode\":\"";
  json += appliedMode == SPFF_MODE_AUTOMATIC ? "automatic" : "manual";
  json += "\"";

  if (reason != nullptr && reason[0] != '\0') {
    json += ",\"reason\":\"";
    spffAppendEscapedString(json, String(reason));
    json += "\"";
  }

  json += "}";
  return spffWriteJsonLine(json);
}

static void spffStopAutomaticOutputs(const char *reason) {
  const char *targets[2] = {"pump_water", "pump_fert"};
  const uint8_t channels[2] = {PUMP_WATER_RELAY, PUMP_FERTILIZER_RELAY};
  SpffActuatorStateTracker *trackers[2] = {
    &spffWaterStateTracker,
    &spffFertStateTracker
  };

  for (uint8_t i = 0; i < 2U; i++) {
    bool active = false;
    if (!relayOutputReadback(channels[i], active) || !active) {
      continue;
    }
    bool actual = true;
    if (setPumpOutput(channels[i], false, actual)) {
      if (sendSpffActuatorStateEvent(
            targets[i], true, actual, String(), reason
          )) {
        spffRememberActuatorState(*trackers[i], true, actual);
      }
    }
  }

  spffWaterAutoActive = false;
  spffWaterLowSampleCount = 0;
  spffFertState = SPFF_FERT_IDLE;
  spffFertCycleLatched = false;
  spffFertLowSampleCount = 0;
}

static bool spffParseWaterAutomaticConfig(
  const String &line,
  size_t start,
  size_t end,
  SpffWaterAutomaticConfig &target,
  const char *&reason
) {
  bool enabled = false;
  String sensorKey;
  float low = 0;
  float targetPercent = 0;
  float minTank = 0;
  float minFlow = 0;
  uint32_t maxRuntime = 0;
  uint32_t cooldown = 0;
  uint32_t triggerCount = 0;
  uint32_t staleSeconds = 0;
  bool lowNull = false;
  bool targetNull = false;
  bool maxRuntimeNull = false;
  bool cooldownNull = false;
  bool minTankNull = false;
  bool minFlowNull = false;

  if (
    !spffJsonGetBoolMember(line, start, end, "enabled", enabled) ||
    !spffJsonGetStringMember(line, start, end, "sensorKey", sensorKey) ||
    !spffJsonGetNullableFloatMember(line, start, end, "moistureLowPercent", low, lowNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "moistureTargetPercent", targetPercent, targetNull) ||
    !spffJsonGetNullableUintMember(line, start, end, "maxRuntimeSeconds", maxRuntime, maxRuntimeNull) ||
    !spffJsonGetNullableUintMember(line, start, end, "cooldownSeconds", cooldown, cooldownNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "minTankLevelPercent", minTank, minTankNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "minFlowLpm", minFlow, minFlowNull) ||
    !spffJsonGetUintMember(line, start, end, "triggerSampleCount", triggerCount) ||
    !spffJsonGetUintMember(line, start, end, "sensorStaleSeconds", staleSeconds)
  ) {
    reason = "invalid_water_config";
    return false;
  }

  if (!minTankNull) {
    reason = "tank_level_not_supported";
    return false;
  }

  if (
    (sensorKey != "soil_1_moisture" && sensorKey != "soil_2_moisture") ||
    triggerCount < 1UL || triggerCount > 20UL ||
    staleSeconds < 10UL || staleSeconds > 3600UL
  ) {
    reason = "invalid_water_config";
    return false;
  }

  if (
    enabled &&
    (
      lowNull || targetNull || maxRuntimeNull || cooldownNull || minFlowNull ||
      low < 0 || targetPercent > 100 || low >= targetPercent ||
      maxRuntime < 1UL || maxRuntime > 86400UL ||
      cooldown > 86400UL || minFlow < 0 || minFlow > 10000
    )
  ) {
    reason = "invalid_water_config";
    return false;
  }

  target.enabled = enabled ? 1U : 0U;
  target.sensor = sensorKey == "soil_2_moisture" ? 2U : 1U;
  target.moistureLowPercent = low;
  target.moistureTargetPercent = targetPercent;
  target.maxRuntimeSeconds = maxRuntime;
  target.cooldownSeconds = cooldown;
  target.minFlowLpm = minFlow;
  target.triggerSampleCount = (uint8_t)triggerCount;
  target.sensorStaleSeconds = staleSeconds;
  return true;
}

static bool spffParseFertilizerAutomaticConfig(
  const String &line,
  size_t start,
  size_t end,
  SpffFertilizerAutomaticConfig &target,
  const char *&reason
) {
  bool enabled = false;
  String sensorKey;
  float ecLow = 0;
  float ecTarget = 0;
  float ecHigh = 0;
  float maxDose = 0;
  float maxDaily = 0;
  float minTank = 0;
  float minFlow = 0;
  uint32_t pulse = 0;
  uint32_t mixing = 0;
  uint32_t cooldown = 0;
  uint32_t triggerCount = 0;
  uint32_t staleSeconds = 0;
  bool ecLowNull = false;
  bool ecTargetNull = false;
  bool ecHighNull = false;
  bool pulseNull = false;
  bool mixingNull = false;
  bool cooldownNull = false;
  bool maxDoseNull = false;
  bool maxDailyNull = false;
  bool minTankNull = false;
  bool minFlowNull = false;

  if (
    !spffJsonGetBoolMember(line, start, end, "enabled", enabled) ||
    !spffJsonGetStringMember(line, start, end, "sensorKey", sensorKey) ||
    !spffJsonGetNullableFloatMember(line, start, end, "ecLowUsCm", ecLow, ecLowNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "ecTargetUsCm", ecTarget, ecTargetNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "ecHighUsCm", ecHigh, ecHighNull) ||
    !spffJsonGetNullableUintMember(line, start, end, "dosePulseSeconds", pulse, pulseNull) ||
    !spffJsonGetNullableUintMember(line, start, end, "mixingDelaySeconds", mixing, mixingNull) ||
    !spffJsonGetNullableUintMember(line, start, end, "cooldownSeconds", cooldown, cooldownNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "maxDoseVolumeL", maxDose, maxDoseNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "maxDailyVolumeL", maxDaily, maxDailyNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "minTankLevelPercent", minTank, minTankNull) ||
    !spffJsonGetNullableFloatMember(line, start, end, "minFlowLpm", minFlow, minFlowNull) ||
    !spffJsonGetUintMember(line, start, end, "triggerSampleCount", triggerCount) ||
    !spffJsonGetUintMember(line, start, end, "sensorStaleSeconds", staleSeconds)
  ) {
    reason = "invalid_fertilizer_config";
    return false;
  }

  if (!minTankNull) {
    reason = "tank_level_not_supported";
    return false;
  }

  if (
    sensorKey != "liquid_ec_us_cm" ||
    triggerCount < 1UL || triggerCount > 20UL ||
    staleSeconds < 10UL || staleSeconds > 3600UL
  ) {
    reason = "invalid_fertilizer_config";
    return false;
  }

  if (
    enabled &&
    (
      ecLowNull || ecTargetNull || ecHighNull || pulseNull || mixingNull ||
      cooldownNull || maxDoseNull || maxDailyNull || minFlowNull ||
      ecLow < 0 || ecLow >= ecTarget || ecTarget >= ecHigh ||
      pulse < 1UL || pulse > 3600UL ||
      mixing < 1UL || mixing > 86400UL ||
      cooldown > 86400UL ||
      maxDose <= 0 || maxDose > maxDaily ||
      minFlow < 0 || minFlow > 10000
    )
  ) {
    reason = "invalid_fertilizer_config";
    return false;
  }

  target.enabled = enabled ? 1U : 0U;
  target.ecLowUsCm = ecLow;
  target.ecTargetUsCm = ecTarget;
  target.ecHighUsCm = ecHigh;
  target.dosePulseSeconds = pulse;
  target.mixingDelaySeconds = mixing;
  target.cooldownSeconds = cooldown;
  target.maxDoseVolumeL = maxDose;
  target.maxDailyVolumeL = maxDaily;
  target.minFlowLpm = minFlow;
  target.triggerSampleCount = (uint8_t)triggerCount;
  target.sensorStaleSeconds = staleSeconds;
  return true;
}

void processSpffAutomaticControlSyncLine(
  const String &line,
  size_t rootStart,
  size_t rootEnd
) {
  uint32_t schemaVersion = 0;
  uint32_t revision = 0;
  String siteId;
  String deviceId;
  String generatedAt;
  String desiredMode;
  size_t configStart = 0;
  size_t configEnd = 0;
  size_t waterStart = 0;
  size_t waterEnd = 0;
  size_t fertilizerStart = 0;
  size_t fertilizerEnd = 0;

  const bool identityOk =
    spffJsonGetUintMember(line, rootStart, rootEnd, "schemaVersion", schemaVersion) &&
    schemaVersion == 1UL &&
    spffJsonGetStringMember(line, rootStart, rootEnd, "siteId", siteId) &&
    siteId == SPFF_SITE_ID &&
    spffJsonGetStringMember(line, rootStart, rootEnd, "deviceId", deviceId) &&
    deviceId == SPFF_DEVICE_ID;

  if (!identityOk) {
    return;
  }

  if (
    !spffJsonGetUintMember(line, rootStart, rootEnd, "revision", revision) ||
    revision < 1UL ||
    !spffJsonGetStringMember(line, rootStart, rootEnd, "generatedAt", generatedAt)
  ) {
    return;
  }

  uint32_t generatedEpoch = 0;
  if (!spffParseUtcIso8601Epoch(generatedAt, generatedEpoch)) {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      spffAutomaticControlLoaded
        ? (SpffOperatingMode)spffAutomaticControl.desiredMode
        : SPFF_MODE_MANUAL,
      "invalid_generated_at"
    );
    return;
  }

  if (
    !spffJsonGetObjectMember(line, rootStart, rootEnd, "config", configStart, configEnd) ||
    !spffJsonGetStringMember(line, configStart, configEnd, "desiredMode", desiredMode) ||
    !spffJsonGetObjectMember(line, configStart, configEnd, "water", waterStart, waterEnd) ||
    !spffJsonGetObjectMember(line, configStart, configEnd, "fertilizer", fertilizerStart, fertilizerEnd)
  ) {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      spffAutomaticControlLoaded
        ? (SpffOperatingMode)spffAutomaticControl.desiredMode
        : SPFF_MODE_MANUAL,
      "invalid_config"
    );
    return;
  }

  SpffAutomaticControlStore candidate;
  spffResetAutomaticControl(candidate);
  candidate.revision = revision;

  if (desiredMode == "manual") {
    candidate.desiredMode = SPFF_MODE_MANUAL;
  } else if (desiredMode == "automatic") {
    candidate.desiredMode = SPFF_MODE_AUTOMATIC;
  } else {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      spffAutomaticControlLoaded
        ? (SpffOperatingMode)spffAutomaticControl.desiredMode
        : SPFF_MODE_MANUAL,
      "invalid_mode"
    );
    return;
  }

  const char *reason = "invalid_config";
  if (
    !spffParseWaterAutomaticConfig(
      line, waterStart, waterEnd, candidate.water, reason
    ) ||
    !spffParseFertilizerAutomaticConfig(
      line, fertilizerStart, fertilizerEnd, candidate.fertilizer, reason
    ) ||
    (
      candidate.desiredMode == SPFF_MODE_AUTOMATIC &&
      candidate.water.enabled == 0U &&
      candidate.fertilizer.enabled == 0U
    )
  ) {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      spffAutomaticControlLoaded
        ? (SpffOperatingMode)spffAutomaticControl.desiredMode
        : SPFF_MODE_MANUAL,
      reason
    );
    return;
  }

  candidate.checksum = spffAutomaticControlChecksum(candidate);

  if (
    spffAutomaticControlLoaded &&
    revision < spffAutomaticControl.revision
  ) {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      (SpffOperatingMode)spffAutomaticControl.desiredMode,
      "stale_revision"
    );
    return;
  }

  if (
    spffAutomaticControlLoaded &&
    revision == spffAutomaticControl.revision
  ) {
    const bool same =
      candidate.checksum == spffAutomaticControl.checksum;
    spffSendAutomaticControlAck(
      revision, generatedAt,
      same ? "applied" : "rejected",
      (SpffOperatingMode)spffAutomaticControl.desiredMode,
      same ? "" : "revision_conflict"
    );
    return;
  }

  if (!spffPersistAutomaticControl(candidate)) {
    spffSendAutomaticControlAck(
      revision, generatedAt, "rejected",
      spffAutomaticControlLoaded
        ? (SpffOperatingMode)spffAutomaticControl.desiredMode
        : SPFF_MODE_MANUAL,
      "nvs_write_failed"
    );
    return;
  }

  spffStopAutomaticOutputs("automatic_config_change");
  spffAutomaticControl = candidate;
  spffAutomaticControlLoaded = true;
  spffStatusDirty = true;

  spffSendAutomaticControlAck(
    revision, generatedAt, "applied",
    (SpffOperatingMode)candidate.desiredMode,
    ""
  );
}

static bool spffAutoElapsed(
  uint32_t startedMs,
  uint32_t durationSeconds
) {
  return
    startedMs == 0UL ||
    (uint32_t)(millis() - startedMs) >= durationSeconds * 1000UL;
}

static bool spffAutomaticPumpOutput(
  const char *targetId,
  uint8_t relayChannel,
  bool requestedActive,
  SpffActuatorStateTracker &tracker,
  const char *reason
) {
  bool previousActive = false;
  const bool previousKnown = relayOutputReadback(
    relayChannel,
    previousActive
  );

  if (previousKnown && previousActive == requestedActive) {
    return true;
  }

  bool actualActive = previousActive;
  if (!setPumpOutput(relayChannel, requestedActive, actualActive)) {
    return false;
  }

  if (sendSpffActuatorStateEvent(
        targetId,
        true,
        actualActive,
        String(),
        reason
      )) {
    spffRememberActuatorState(tracker, true, actualActive);
  }

  return actualActive == requestedActive;
}

static bool spffWaterAutomaticSample(
  float &moisturePercent,
  uint32_t &sampleMs
) {
  const SpffWaterAutomaticConfig &config =
    spffAutomaticControl.water;

  if (config.sensor == 2U) {
    if (!soil2.has[0] || soil2RegLastGoodMs[0] == 0UL) {
      return false;
    }
    moisturePercent = soil2.raw[0] / 10.0f;
    sampleMs = soil2RegLastGoodMs[0];
  } else {
    if (!soil1.has[0] || soil1RegLastGoodMs[0] == 0UL) {
      return false;
    }
    moisturePercent = soil1.raw[0] / 10.0f;
    sampleMs = soil1RegLastGoodMs[0];
  }

  return
    isfinite(moisturePercent) &&
    (uint32_t)(millis() - sampleMs) <=
      config.sensorStaleSeconds * 1000UL;
}

static bool spffFertilizerAutomaticSample(
  float &ecUsCm,
  uint32_t &sampleMs
) {
  if (
    !nutri.hasValue ||
    nutri.lastGoodMs == 0UL ||
    !isfinite(nutri.ec)
  ) {
    return false;
  }

  ecUsCm = nutri.ec;
  sampleMs = nutri.lastGoodMs;
  return
    (uint32_t)(millis() - sampleMs) <=
      spffAutomaticControl.fertilizer.sensorStaleSeconds * 1000UL;
}

static bool spffAutomaticSlaveFresh(uint32_t staleSeconds) {
  return
    slaveData.hasValue &&
    slaveData.lastGoodMs != 0UL &&
    (uint32_t)(millis() - slaveData.lastGoodMs) <=
      staleSeconds * 1000UL;
}

static void spffStopAutomaticWater(uint32_t nowMs) {
  if (spffAutomaticPumpOutput(
        "pump_water",
        PUMP_WATER_RELAY,
        false,
        spffWaterStateTracker,
        "automatic_water"
      )) {
    spffWaterAutoActive = false;
    spffWaterLowSampleCount = 0;
    spffWaterCooldownStartedMs = nowMs;
  }
}

static void spffServiceAutomaticWater(uint32_t nowMs) {
  const SpffWaterAutomaticConfig &config =
    spffAutomaticControl.water;

  if (!config.enabled) {
    if (spffWaterAutoActive) {
      spffStopAutomaticWater(nowMs);
    }
    return;
  }

  float moisture = NAN;
  uint32_t sampleMs = 0;
  const bool sampleValid =
    spffWaterAutomaticSample(moisture, sampleMs);

  if (spffWaterAutoActive) {
    const bool runtimeExceeded =
      (uint32_t)(nowMs - spffWaterStartedMs) >=
      config.maxRuntimeSeconds * 1000UL;
    const bool flowFault =
      config.minFlowLpm > 0.0f &&
      (uint32_t)(nowMs - spffWaterStartedMs) >= SPFF_AUTO_FLOW_GRACE_MS &&
      (
        !spffAutomaticSlaveFresh(config.sensorStaleSeconds) ||
        !isfinite(slaveData.waterFlowLpm) ||
        slaveData.waterFlowLpm < config.minFlowLpm
      );

    if (
      !sampleValid ||
      moisture >= config.moistureTargetPercent ||
      runtimeExceeded ||
      flowFault ||
      otaMaintenanceActive()
    ) {
      spffStopAutomaticWater(nowMs);
    }
    return;
  }

  if (!sampleValid) {
    spffWaterLowSampleCount = 0;
    return;
  }

  if (sampleMs != spffWaterLastSampleMs) {
    spffWaterLastSampleMs = sampleMs;
    if (moisture <= config.moistureLowPercent) {
      if (spffWaterLowSampleCount < 255U) {
        spffWaterLowSampleCount++;
      }
    } else {
      spffWaterLowSampleCount = 0;
    }
  }

  if (
    spffWaterLowSampleCount < config.triggerSampleCount ||
    !spffAutoElapsed(
      spffWaterCooldownStartedMs,
      config.cooldownSeconds
    )
  ) {
    return;
  }

  if (spffAutomaticPumpOutput(
        "pump_water",
        PUMP_WATER_RELAY,
        true,
        spffWaterStateTracker,
        "automatic_water"
      )) {
    spffWaterAutoActive = true;
    spffWaterStartedMs = nowMs;
    spffWaterLowSampleCount = 0;
  }
}

static uint16_t spffAutomaticDateKey() {
  if (!rtcReady || !rtcNow.valid) {
    return 0U;
  }
  return
    (uint16_t)rtcNow.year * 512U +
    (uint16_t)rtcNow.month * 32U +
    rtcNow.day;
}

static void spffFinishFertilizerCycle(uint32_t nowMs) {
  if (spffAutomaticPumpOutput(
        "pump_fert",
        PUMP_FERTILIZER_RELAY,
        false,
        spffFertStateTracker,
        "automatic_fertilizer"
      )) {
    spffFertState = SPFF_FERT_IDLE;
    spffFertCycleLatched = false;
    spffFertLowSampleCount = 0;
    spffFertCooldownStartedMs = nowMs;
  }
}

static bool spffStartFertilizerPulse(uint32_t nowMs) {
  if (!slaveData.totalsAvailable) {
    return false;
  }

  spffFertPulseStartTotalMl = slaveData.fertTotalMl;
  if (spffAutomaticPumpOutput(
        "pump_fert",
        PUMP_FERTILIZER_RELAY,
        true,
        spffFertStateTracker,
        "automatic_fertilizer"
      )) {
    spffFertState = SPFF_FERT_DOSING;
    spffFertStateStartedMs = nowMs;
    return true;
  }
  return false;
}

static void spffServiceAutomaticFertilizer(uint32_t nowMs) {
  const SpffFertilizerAutomaticConfig &config =
    spffAutomaticControl.fertilizer;

  if (!config.enabled) {
    if (spffFertState != SPFF_FERT_IDLE) {
      spffFinishFertilizerCycle(nowMs);
    }
    return;
  }

  float ec = NAN;
  uint32_t sampleMs = 0;
  const bool ecValid =
    spffFertilizerAutomaticSample(ec, sampleMs);
  const bool slaveFresh =
    spffAutomaticSlaveFresh(config.sensorStaleSeconds);

  const uint16_t dateKey = spffAutomaticDateKey();
  if (
    dateKey != 0U &&
    dateKey != spffFertDailyDateKey &&
    slaveData.totalsAvailable
  ) {
    spffFertDailyDateKey = dateKey;
    spffFertDailyStartTotalMl = slaveData.fertTotalMl;
    spffPersistAutomaticDailyState();
  }

  const bool totalCounterValid =
    slaveData.totalsAvailable &&
    slaveData.fertTotalMl >= spffFertDailyStartTotalMl;
  const float dailyVolumeL = totalCounterValid
    ? (slaveData.fertTotalMl - spffFertDailyStartTotalMl) / 1000.0f
    : 0.0f;

  if (spffFertState == SPFF_FERT_DOSING) {
    const bool pulseExpired =
      (uint32_t)(nowMs - spffFertStateStartedMs) >=
      config.dosePulseSeconds * 1000UL;
    const bool counterReset =
      !slaveData.totalsAvailable ||
      slaveData.fertTotalMl < spffFertPulseStartTotalMl ||
      slaveData.fertTotalMl < spffFertCycleStartTotalMl;
    const float cycleVolumeL = counterReset
      ? 0.0f
      : (slaveData.fertTotalMl - spffFertCycleStartTotalMl) / 1000.0f;
    const bool volumeLimit =
      counterReset ||
      cycleVolumeL >= config.maxDoseVolumeL ||
      dailyVolumeL >= config.maxDailyVolumeL;
    const bool flowFault =
      config.minFlowLpm > 0.0f &&
      (uint32_t)(nowMs - spffFertStateStartedMs) >= SPFF_AUTO_FLOW_GRACE_MS &&
      (
        !slaveFresh ||
        !isfinite(slaveData.fertFlowLpm) ||
        slaveData.fertFlowLpm < config.minFlowLpm
      );
    const bool targetReached =
      ecValid && ec >= config.ecTargetUsCm;
    const bool highInterlock =
      ecValid && ec >= config.ecHighUsCm;

    if (
      !ecValid ||
      pulseExpired ||
      volumeLimit ||
      flowFault ||
      targetReached ||
      highInterlock ||
      otaMaintenanceActive()
    ) {
      if (!spffAutomaticPumpOutput(
            "pump_fert",
            PUMP_FERTILIZER_RELAY,
            false,
            spffFertStateTracker,
            "automatic_fertilizer"
          )) {
        return;
      }

      if (
        !ecValid ||
        volumeLimit ||
        flowFault ||
        targetReached ||
        highInterlock ||
        otaMaintenanceActive()
      ) {
        spffFertState = SPFF_FERT_IDLE;
        spffFertCycleLatched = false;
        spffFertCooldownStartedMs = nowMs;
      } else {
        spffFertState = SPFF_FERT_MIXING;
        spffFertStateStartedMs = nowMs;
        spffFertLastSampleMs = sampleMs;
      }
    }
    return;
  }

  if (spffFertState == SPFF_FERT_MIXING) {
    if (
      (uint32_t)(nowMs - spffFertStateStartedMs) <
      config.mixingDelaySeconds * 1000UL
    ) {
      return;
    }

    if (!ecValid) {
      spffFinishFertilizerCycle(nowMs);
      return;
    }

    // Setelah mixing, keputusan berikutnya wajib memakai pembacaan EC baru.
    if (sampleMs == spffFertLastSampleMs) {
      return;
    }
    spffFertLastSampleMs = sampleMs;

    const float cycleVolumeL =
      slaveData.totalsAvailable &&
      slaveData.fertTotalMl >= spffFertCycleStartTotalMl
      ? (slaveData.fertTotalMl - spffFertCycleStartTotalMl) / 1000.0f
      : config.maxDoseVolumeL;

    if (
      ec >= config.ecTargetUsCm ||
      ec >= config.ecHighUsCm ||
      cycleVolumeL >= config.maxDoseVolumeL ||
      dailyVolumeL >= config.maxDailyVolumeL ||
      !slaveFresh ||
      dateKey == 0U ||
      !totalCounterValid
    ) {
      spffFinishFertilizerCycle(nowMs);
      return;
    }

    spffStartFertilizerPulse(nowMs);
    return;
  }

  if (
    !ecValid ||
    !slaveFresh ||
    !slaveData.totalsAvailable ||
    dateKey == 0U ||
    !totalCounterValid
  ) {
    spffFertLowSampleCount = 0;
    return;
  }

  if (sampleMs != spffFertLastSampleMs) {
    spffFertLastSampleMs = sampleMs;
    if (ec <= config.ecLowUsCm) {
      if (spffFertLowSampleCount < 255U) {
        spffFertLowSampleCount++;
      }
    } else {
      spffFertLowSampleCount = 0;
    }
  }

  if (
    ec >= config.ecHighUsCm ||
    dailyVolumeL >= config.maxDailyVolumeL ||
    spffFertLowSampleCount < config.triggerSampleCount ||
    !spffAutoElapsed(
      spffFertCooldownStartedMs,
      config.cooldownSeconds
    )
  ) {
    return;
  }

  spffFertCycleStartTotalMl = slaveData.fertTotalMl;
  spffFertCycleLatched = true;
  spffFertLowSampleCount = 0;
  if (!spffStartFertilizerPulse(nowMs)) {
    spffFertCycleLatched = false;
  }
}

void serviceSpffAutomaticControl() {
  const uint32_t nowMs = millis();
  if (
    (uint32_t)(nowMs - spffLastAutoEvaluationMs) <
    SPFF_AUTO_EVAL_INTERVAL_MS
  ) {
    return;
  }
  spffLastAutoEvaluationMs = nowMs;

  const bool automatic =
    spffAutomaticControlLoaded &&
    spffAutomaticControl.desiredMode == SPFF_MODE_AUTOMATIC;

  if (!automatic || !relayReady || otaMaintenanceActive()) {
    if (spffWaterAutoActive || spffFertState != SPFF_FERT_IDLE) {
      spffStopAutomaticOutputs(
        otaMaintenanceActive()
          ? "automatic_ota_interlock"
          : "automatic_mode_exit"
      );
    }
    return;
  }

  updateRTC();
  spffServiceAutomaticWater(nowMs);
  spffServiceAutomaticFertilizer(nowMs);
}

static bool spffSyncedScheduleMatchesToday(
  const SpffSyncedSchedule &schedule
) {
  if (schedule.repeatRule == SPFF_SCHEDULE_REPEAT_ONCE) {
    return
      schedule.runYear == (uint16_t)(2000U + rtcNow.year) &&
      schedule.runMonth == rtcNow.month &&
      schedule.runDay == rtcNow.day;
  }

  const uint8_t weekday = weekdayMondayZero(
    rtcNow.year,
    rtcNow.month,
    rtcNow.day
  );

  if (schedule.repeatRule == SPFF_SCHEDULE_REPEAT_DAILY) {
    return true;
  }

  if (schedule.repeatRule == SPFF_SCHEDULE_REPEAT_WEEKDAYS) {
    return weekday <= 4U;
  }

  if (schedule.repeatRule == SPFF_SCHEDULE_REPEAT_WEEKENDS) {
    return weekday >= 5U;
  }

  return false;
}

static void spffApplySyncedScheduleTarget(
  const char *targetId,
  uint8_t relayChannel,
  bool requestedActive,
  SpffActuatorStateTracker &tracker
) {
  bool previousActive = false;
  const bool previousKnown = relayOutputReadback(
    relayChannel,
    previousActive
  );

  if (previousKnown && previousActive == requestedActive) {
    return;
  }

  bool actualActive = previousActive;

  if (!setPumpOutput(
        relayChannel,
        requestedActive,
        actualActive
      )) {
    return;
  }

  if (sendSpffActuatorStateEvent(
        targetId,
        true,
        actualActive,
        String(),
        "device_schedule"
      )) {
    spffRememberActuatorState(tracker, true, actualActive);
  }
}

void serviceSpffSyncedScheduleOutput() {
  static uint32_t lastEvaluationMs = 0;
  const uint32_t nowMs = millis();

  if (
    (uint32_t)(nowMs - lastEvaluationMs) < 500UL ||
    !spffSyncedScheduleLoaded ||
    (
      spffAutomaticControlLoaded &&
      spffAutomaticControl.desiredMode == SPFF_MODE_AUTOMATIC
    ) ||
    spffSyncedScheduleStore.authority != SPFF_SCHEDULE_AUTHORITY_DEVICE ||
    !relayReady
  ) {
    return;
  }

  lastEvaluationMs = nowMs;
  updateRTC();

  if (!rtcReady || !rtcNow.valid) {
    return;
  }

  const uint32_t nowSecond =
    (uint32_t)rtcNow.hour * 3600UL +
    (uint32_t)rtcNow.minute * 60UL +
    rtcNow.second;

  bool waterActive = false;
  bool fertActive = false;

  for (uint8_t i = 0; i < spffSyncedScheduleStore.count; i++) {
    const SpffSyncedSchedule &schedule =
      spffSyncedScheduleStore.schedules[i];

    if (
      schedule.enabled == 0U ||
      !spffSyncedScheduleMatchesToday(schedule) ||
      nowSecond < schedule.onSecond ||
      nowSecond >= schedule.offSecond
    ) {
      continue;
    }

    if (schedule.target == SPFF_SCHEDULE_TARGET_WATER) {
      waterActive = true;
    } else if (schedule.target == SPFF_SCHEDULE_TARGET_FERT) {
      fertActive = true;
    }
  }

  // Safety: snapshot device tidak boleh menyalakan pompa selama OTA.
  if (otaMaintenanceActive()) {
    waterActive = false;
    fertActive = false;
  }

  spffApplySyncedScheduleTarget(
    "pump_water",
    PUMP_WATER_RELAY,
    waterActive,
    spffWaterStateTracker
  );

  spffApplySyncedScheduleTarget(
    "pump_fert",
    PUMP_FERTILIZER_RELAY,
    fertActive,
    spffFertStateTracker
  );
}

void processSpffCommandLine(const String &line) {
  if (line.length() < 2U || !spffJsonValid(line)) {
    return;
  }

  size_t rootStart = 0U;
  spffJsonSkipWhitespace(line, rootStart);
  const size_t rootEnd = line.length();

  String kind;

  if (!spffJsonGetStringMember(line, rootStart, rootEnd, "kind", kind)) {
    return;
  }

  if (kind == "schedule_sync") {
    processSpffScheduleSyncLine(line, rootStart, rootEnd);
    return;
  }

  if (kind == "automatic_control_sync") {
    processSpffAutomaticControlSyncLine(line, rootStart, rootEnd);
    return;
  }

  if (kind != "command") {
    // Serial channel juga membawa ACK/persisted message lain; abaikan sisanya.
    return;
  }

  spffCurrentCommandIssuedAt = "";

  String commandId;
  String targetId;
  String type;
  String siteId;
  String deviceId;
  String issuedAt;
  String expiresAt;
  String requestedBy;
  uint32_t schemaVersion = 0;

  bool hasCommandId =
    spffJsonGetStringMember(line, rootStart, rootEnd, "commandId", commandId);
  bool hasTargetId =
    spffJsonGetStringMember(line, rootStart, rootEnd, "targetId", targetId);

  if (!hasCommandId || !hasTargetId) {
    return;
  }

  String commandIdCheck = commandId;
  commandIdCheck.trim();

  if (
    commandIdCheck.length() == 0U ||
    commandId.length() > SPFF_COMMAND_ID_MAX ||
    targetId.length() > SPFF_COMMAND_TARGET_MAX
  ) {
    return;
  }

  bool identityOk =
    spffJsonGetUintMember(line, rootStart, rootEnd, "schemaVersion", schemaVersion) &&
    schemaVersion == 1UL &&
    spffJsonGetStringMember(line, rootStart, rootEnd, "siteId", siteId) &&
    siteId == SPFF_SITE_ID &&
    spffJsonGetStringMember(line, rootStart, rootEnd, "deviceId", deviceId) &&
    deviceId == SPFF_DEVICE_ID;

  // Pesan untuk site/device lain tidak boleh menghasilkan output atau ACK lokal.
  if (!identityOk) {
    return;
  }

  // Ambil issuedAt sedini mungkin sebagai timestamp fallback ACK bila RTC belum
  // valid. Pesan dengan identitas benar tetap mendapat rejected ACK jika field
  // command lainnya tidak lolos validasi.
  if (spffJsonGetStringMember(
        line,
        rootStart,
        rootEnd,
        "issuedAt",
        issuedAt
      )) {
    spffCurrentCommandIssuedAt = issuedAt;
  }

  // QoS 1 duplicate: replay ACK final persis tanpa menyentuh output relay.
  SpffCommandHistoryEntry *duplicate = spffFindCommandHistory(commandId);

  if (duplicate != nullptr) {
    spffReplayFinalAck(*duplicate);
    return;
  }

  if (
    !spffJsonGetStringMember(line, rootStart, rootEnd, "type", type) ||
    type != "set_pump"
  ) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  if (
    targetId != "pump_water" &&
    targetId != "pump_fert"
  ) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "unknown_target"
    );
    return;
  }

  if (
    !spffJsonGetStringMember(line, rootStart, rootEnd, "issuedAt", issuedAt) ||
    !spffJsonGetStringMember(line, rootStart, rootEnd, "requestedBy", requestedBy)
  ) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  spffCurrentCommandIssuedAt = issuedAt;

  String requestedByCheck = requestedBy;
  requestedByCheck.trim();

  if (requestedByCheck.length() == 0U) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  size_t paramsStart = 0;
  size_t paramsEnd = 0;
  bool requestedActive = false;

  if (
    !spffJsonGetObjectMember(
      line,
      rootStart,
      rootEnd,
      "params",
      paramsStart,
      paramsEnd
    ) ||
    !spffJsonGetBoolMember(
      line,
      paramsStart,
      paramsEnd,
      "isActive",
      requestedActive
    )
  ) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  if (!spffJsonGetStringMember(line, rootStart, rootEnd, "expiresAt", expiresAt)) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  uint32_t issuedEpoch = 0;
  uint32_t expiresEpoch = 0;

  if (
    !spffParseUtcIso8601Epoch(issuedAt, issuedEpoch) ||
    !spffParseUtcIso8601Epoch(expiresAt, expiresEpoch) ||
    issuedEpoch > expiresEpoch
  ) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "invalid_command"
    );
    return;
  }

  uint32_t nowEpoch = spffUtcEpoch();
  if (nowEpoch == 0UL) {
    // Edge sudah menolak command yang kedaluwarsa sebelum menulis ke Serial.
    // Gunakan issuedAt terverifikasi sebagai fallback supaya controller tetap
    // menghasilkan ACK dan actual state walau RTC lokal belum siap.
    nowEpoch = issuedEpoch;
  }

  if (nowEpoch >= expiresEpoch) {
    bool actualActive = false;
    uint8_t relayChannel =
      targetId == "pump_water"
      ? PUMP_WATER_RELAY
      : PUMP_FERTILIZER_RELAY;
    bool actualKnown = relayOutputReadback(relayChannel, actualActive);

    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      actualKnown,
      actualActive,
      "command_expired"
    );
    return;
  }

  uint8_t relayChannel =
    targetId == "pump_water"
    ? PUMP_WATER_RELAY
    : PUMP_FERTILIZER_RELAY;

  if (!relayReady) {
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      false,
      false,
      "relay_fault"
    );
    return;
  }

  if (
    requestedActive &&
    spffAutomaticControlLoaded &&
    spffAutomaticControl.desiredMode == SPFF_MODE_AUTOMATIC
  ) {
    bool actualActive = false;
    const bool actualKnown =
      relayOutputReadback(relayChannel, actualActive);
    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      actualKnown,
      actualActive,
      "automatic_mode"
    );
    return;
  }

  // OFF tetap boleh untuk membawa sistem ke kondisi aman saat maintenance.
  if (requestedActive && otaMaintenanceActive()) {
    bool actualActive = false;
    bool actualKnown = relayOutputReadback(relayChannel, actualActive);

    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      actualKnown,
      actualActive,
      "safety_interlock"
    );
    return;
  }

  bool previousActive = false;
  bool previousStateKnown = relayOutputReadback(relayChannel, previousActive);

  // ACK accepted dikirim setelah seluruh validasi contract/expiry/safety lolos.
  if (!sendSpffActuatorAck(
        commandId,
        targetId,
        "accepted",
        false,
        false,
        "",
        nullptr
      )) {
    // Jangan ubah output bila ACK protocol tidak dapat dibuat (mis. RTC invalid).
    return;
  }

  bool actualActive = previousActive;
  bool outputOk = false;

  if (previousStateKnown && previousActive == requestedActive) {
    // Desired state sudah tercapai. Tidak perlu menulis relay lagi.
    outputOk = true;
  } else {
    outputOk = setPumpOutput(
      relayChannel,
      requestedActive,
      actualActive
    );
  }

  if (!outputOk) {
    bool readbackOk = relayOutputReadback(relayChannel, actualActive);

    spffSendFinalAckAndRemember(
      commandId,
      targetId,
      "rejected",
      readbackOk,
      actualActive,
      "relay_fault"
    );
    return;
  }

  // Final ACK hanya sesudah output register dibaca kembali sesuai desired state.
  if (!spffSendFinalAckAndRemember(
        commandId,
        targetId,
        "completed",
        true,
        actualActive,
        ""
      )) {
    return;
  }

  // Datalog state hanya dibuat jika actual state benar-benar berubah.
  spffPublishBackendStateChange(
    targetId,
    previousStateKnown,
    previousActive,
    actualActive,
    commandId
  );

  if (!requestedActive) {
    const uint32_t stoppedAtMs = millis();
    if (targetId == "pump_water") {
      spffWaterAutoActive = false;
      spffWaterLowSampleCount = 0;
      spffWaterCooldownStartedMs = stoppedAtMs;
    } else {
      spffFertState = SPFF_FERT_IDLE;
      spffFertCycleLatched = false;
      spffFertLowSampleCount = 0;
      spffFertCooldownStartedMs = stoppedAtMs;
    }
  }
}

void serviceSpffGatewaySerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();

    if (c == '\n') {
      // Terima LF maupun CRLF. CR hanya dibuang bila tepat di akhir frame;
      // CR di tengah JSON tetap dipertahankan agar syntax validator menolaknya.
      if (
        !spffRxDroppingOversize &&
        spffRxLine.length() > 0U &&
        spffRxLine[spffRxLine.length() - 1U] == '\r'
      ) {
        spffRxLine = spffRxLine.substring(0U, spffRxLine.length() - 1U);
      }

      if (!spffRxDroppingOversize && spffRxLine.length() > 0U) {
        processSpffCommandLine(spffRxLine);
      }

      spffRxLine = "";
      spffRxDroppingOversize = false;
      continue;
    }

    if (spffRxDroppingOversize) {
      continue;
    }

    if (spffRxLine.length() >= SPFF_RX_LINE_MAX) {
      // Jangan mulai parse dari potongan sisa frame oversized. Drop sampai LF.
      spffRxLine = "";
      spffRxDroppingOversize = true;
      continue;
    }

    spffRxLine += c;
  }
}


// =============================================================================
// SETUP / LOOP
// =============================================================================
void appSetup() {
  // USB CDC Serial = SPFF JSON Lines ke Orange Pi.
  // Core 2.0.17 default hanya 256 byte. Besarkan sebelum begin() agar
  // command/schedule tidak kehilangan akhir frame dan terminator LF.
  Serial.setRxBufferSize(SPFF_SERIAL_RX_QUEUE_BYTES);
  Serial.begin(115200);

#if ARDUINO_USB_CDC_ON_BOOT
  // Debug text khusus hardware tidak boleh masuk ke Serial JSON Lines.
  // UART0 (GPIO43 TX / GPIO44 RX pada ESP32-S3 default) dipisahkan untuk log.
  Serial0.begin(115200);
#endif

  spffRxLine.reserve(SPFF_RX_INITIAL_RESERVE);

  delay(1200);


  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 100000);
  delay(100);

  prefs.begin("s2pfs", false);
  loadSoilNVS(1, soil1);
  loadSoilNVS(2, soil2);
  loadWeeklyTimerNVS();
  loadSpffSyncedSchedules();
  loadSpffAutomaticControl();

  initBuzzer();
  initButtons();
  initRelay();
  initLCD();
  initRTC();
  loadSpffAutomaticDailyState();

  // Sinkronkan relay penyiraman CH3 dengan timer segera setelah boot.
  // initRelay() sebelumnya memastikan semua relay OFF sebagai fail-safe.
  serviceIrrigationTimerOutput();

  RS485.begin(
    BAUD_9600,
    SERIAL_8N1,
    RS485_RX_PIN,
    RS485_TX_PIN,
    false
  );

  activeBaud = BAUD_9600;
  clearBus();

  initSHT20();

  renderUI();

  initWebOTA();


  // Initialization firmware selesai. Kirim status pertama tanpa menunggu
  // sensor cycle/telemetry. Bila RTC belum valid, status tetap pending dan
  // serviceDeviceStatus() akan retry tanpa membuat timestamp palsu.
  initializeSpffDeviceStatus();
  serviceDeviceStatus();

  // Initial actuator_state dikirim satu kali setelah boot. Setelah itu event
  // hanya diterbitkan jika actual output berubah atau readback menjadi fault.
  serviceSpffActuatorStateChanges(true);

  // Beri waktu 30 detik sejak initialization selesai untuk mengumpulkan
  // last-valid dari semua sensor sebelum snapshot telemetry pertama dipublish.
  spffLastTelemetrySentMs = millis();

  lastCycleStartMs = millis() - SENSOR_CYCLE_INTERVAL_MS;
}

void appLoop() {
  // Command dari Orange Pi harus tetap dilayani di sela polling sensor.
  serviceSpffGatewaySerial();
  serviceDeviceStatus();
  serviceSpffActuatorStateChanges(false);

  serviceBuzzer();
  serviceWebOTA();

  // OTA hanya dimulai saat kedua pompa OFF. Selama upload/restart pending,
  // polling sensor dan UI dipause agar proses flash stabil; heartbeat dan
  // command parser tetap dilayani di bagian atas loop.
  if (otaMaintenanceActive()) {
    return;
  }

  // Telemetry publish scheduler berjalan independen dari akhir sensor cycle.
  serviceTelemetrySnapshot();
  serviceSpffAutomaticControl();

  serviceButtons();
  serviceLCDRefresh();

  // Reaksi cepat untuk PAKSA AKTIF / PAKSA NONAKTIF dan menjaga CH3 selalu
  // mengikuti status timer. RTC diperbarui pada cycle sensor; mode manual tidak
  // perlu menunggu cycle berikutnya.
  serviceIrrigationTimerOutput();
  serviceDeviceStatus();
  serviceSpffActuatorStateChanges(false);

  uint32_t now = millis();

  if (
    (uint32_t)(now - lastCycleStartMs) <
    SENSOR_CYCLE_INTERVAL_MS
  ) {
    delay(1);
    return;
  }

  // Start-to-start scheduler: bila satu cycle sendiri sudah > interval,
  // cycle berikutnya boleh langsung dimulai tanpa dead-time tambahan 2 detik.
  lastCycleStartMs = now;
  updateRTC();
  serviceIrrigationTimerOutput();


  readNutri();
  serviceSpffGatewaySerial();
  serviceDeviceStatus();

  readSHT20();
  serviceSpffGatewaySerial();
  serviceDeviceStatus();

  readSlave();
  serviceSpffGatewaySerial();
  serviceDeviceStatus();

  readSoil(1, SOIL1_ID, soil1);
  serviceSpffGatewaySerial();
  serviceDeviceStatus();

  readSoil(2, SOIL2_ID, soil2);
  serviceSpffGatewaySerial();
  serviceDeviceStatus();

  setBusBaud(BAUD_9600);

  updateRTC();
  serviceIrrigationTimerOutput();
  serviceSpffAutomaticControl();
  renderUI();

  // Mode produksi: kontrak JSON Lines untuk Orange Pi Edge Gateway.
  sendTelemetryIfValid();

  // Tidak publish actuator_state pada setiap sensor cycle. Poll tracker hanya
  // mendeteksi perubahan actual state/fault sehingga datalog tidak spam.
  serviceSpffActuatorStateChanges(false);
}


// =============================================================================
// ARDUINO ENTRY POINTS
// =============================================================================
// Diletakkan PALING BAWAH agar Arduino Core 2.0.17 membuat auto-prototype
// setelah semua struct/enum custom sudah dikenal.
void setup() {
  appSetup();
}

void loop() {
  appLoop();
}
