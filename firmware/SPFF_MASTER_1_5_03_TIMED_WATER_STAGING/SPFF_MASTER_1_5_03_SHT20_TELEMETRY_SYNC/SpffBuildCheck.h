#pragma once
#include <sdkconfig.h>
#include <esp_arduino_version.h>

#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "SPFF: select ESP32S3 Dev Module."
#endif
#if ESP_ARDUINO_VERSION_MAJOR != 2 || ESP_ARDUINO_VERSION_MINOR != 0 || ESP_ARDUINO_VERSION_PATCH != 17
#error "SPFF: install esp32 by Espressif Systems version 2.0.17 to match the working archive."
#endif
#if defined(CONFIG_ESPTOOLPY_OCT_FLASH) && CONFIG_ESPTOOLPY_OCT_FLASH
#error "SPFF: wrong Octal FLASH build. Select Flash Mode QIO 80MHz, not OPI. Keep PSRAM OPI."
#endif
#if !defined(CONFIG_ESPTOOLPY_FLASHMODE_QIO) || !CONFIG_ESPTOOLPY_FLASHMODE_QIO
#error "SPFF: Flash Mode must be QIO 80MHz to match the working qio_opi build."
#endif
#if !defined(BOARD_HAS_PSRAM) || !defined(CONFIG_SPIRAM_MODE_OCT) || !CONFIG_SPIRAM_MODE_OCT
#error "SPFF: select OPI PSRAM (not OPI Flash)."
#endif
#if !defined(ARDUINO_USB_MODE) || ARDUINO_USB_MODE != 1 || !defined(ARDUINO_USB_CDC_ON_BOOT) || ARDUINO_USB_CDC_ON_BOOT != 1
#error "SPFF: select USB Mode Hardware CDC and JTAG, USB CDC On Boot Enabled."
#endif
