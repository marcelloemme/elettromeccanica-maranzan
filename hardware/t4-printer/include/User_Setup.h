/*
 * TFT_eSPI User Setup per LilyGo T4 v1.3
 * Display: ILI9341 240x320 (2.4")
 *
 * IMPORTANTE: Questo file sovrascrive la configurazione di default
 * della libreria TFT_eSPI per il T4
 */

// ===== SELEZIONE DRIVER =====
#define ILI9341_DRIVER      // Display ILI9341 240x320

// ===== PIN DISPLAY T4 v1.3 =====
#define TFT_MISO  12   // SDO -> GPIO12
#define TFT_MOSI  23   // SDI -> GPIO23
#define TFT_SCLK  18   // SCLK -> GPIO18
#define TFT_CS    27   // CS -> GPIO27
#define TFT_DC    32   // RS (Data/Command) -> GPIO32
#define TFT_RST    5   // RST -> GPIO05
#define TFT_BL     4   // Backlight -> GPIO04

// ===== CONTROLLO BACKLIGHT =====
// Il backlight è controllato via GPIO04
// LOW = spento, HIGH = acceso
#define TFT_BACKLIGHT_ON HIGH

// ===== FREQUENZA SPI =====
// 40MHz è sicuro per ILI9341 su ESP32
#define SPI_FREQUENCY  40000000
#define SPI_READ_FREQUENCY  20000000
#define SPI_TOUCH_FREQUENCY  2500000

// ===== COLORI =====
#define TFT_BLACK       0x0000
#define TFT_WHITE       0xFFFF
#define TFT_GREY        0x7BEF

// ===== FONT =====
// Carichiamo i font smooth di default
#define LOAD_GLCD   // Font 1. Original Adafruit 8 pixel font needs ~1820 bytes in FLASH
#define LOAD_FONT2  // Font 2. Small 16 pixel high font, needs ~3534 bytes in FLASH
#define LOAD_FONT4  // Font 4. Medium 26 pixel high font, needs ~5848 bytes in FLASH
#define LOAD_FONT6  // Font 6. Large 48 pixel font, needs ~2666 bytes in FLASH
#define LOAD_FONT7  // Font 7. 7 segment 48 pixel font, needs ~2438 bytes in FLASH
#define LOAD_FONT8  // Font 8. Large 75 pixel font needs ~3256 bytes in FLASH

#define SMOOTH_FONT // Enable antialiased fonts

// ===== SUPPORTO SPI TRANSACTIONS =====
#define SUPPORT_TRANSACTIONS
