# T4 Thermal Printer - Firmware

Firmware per stampante termica automatica basata su LilyGo T4 v1.3 + CSN-A2 TTL.

## Hardware

**LilyGo T4 v1.3:**
- MCU: ESP32 (Dual-core Xtensa LX6)
- Flash: 4MB
- PSRAM: 8MB
- Display: ILI9341 240x320 (2.4")
- MicroSD Reader integrato

**CSN-A2 TTL:**
- Stampante termica 58mm
- Connessione seriale TTL (GPIO33/35)

## Pinout

### Display ILI9341
- SCLK → GPIO18
- RST → GPIO05
- CS → GPIO27
- BL (Backlight) → GPIO04
- RS (DC) → GPIO32
- SDI (MOSI) → GPIO23
- SDO (MISO) → GPIO12

### MicroSD Card
- MISO → GPIO02
- SCK → GPIO14
- MOSI → GPIO15
- CS → GPIO13

### Pulsanti
- Sinistra (↓) → GPIO38
- Centro (Stampa) → GPIO37
- Destra (↑) → GPIO39

### Stampante CSN-A2
- RX stampante ← TX T4 (GPIO33)
- TX stampante → RX T4 (GPIO35)
- GND comune

### Alimentazione
- Stampante: 9V esterno
- T4: 5V da regolatore (derivato da 9V stampante)

## Setup PlatformIO

```bash
# Compila (le dipendenze vengono installate automaticamente)
pio run

# Upload su T4
pio run -t upload

# Monitor seriale
pio device monitor

# Compila + Upload + Monitor in un colpo
pio run -t upload && pio device monitor
```

**Librerie installate:**
- TFT_eSPI v2.5.43 (display ILI9341)
- ArduinoJson v7.2.0 (parsing CSV)
- Adafruit Thermal Printer Library v1.4.1 (stampante CSN-A2)

## WiFi Credentials

- SSID: `FASTWEB-RNHDU3`
- Password: `C9FLCJDDRY`

## Database CSV

Il dispositivo scarica automaticamente il CSV delle riparazioni da:
```
https://docs.google.com/spreadsheets/d/e/2PACX-1vTLukAJJ7pIFcbxUC8082z7jG1EP-lFgoJmNVae-0w0uZWABdJ8yWXxPViw8bqge1TOWXeUmFZyrp/pub?gid=0&single=true&output=csv
```

## File su MicroSD

- `/riparazioni.csv` - Database locale (sync con Google Sheets)
- `/print_history.txt` - Schede già stampate (una per riga, formato: "26/0021")

## Development Status

Vedi `.claude.md` nella root del progetto per roadmap completa.

### Fase Corrente: Step 1 - Setup Ambiente
- [x] Progetto PlatformIO creato
- [x] Librerie configurate
- [x] Pin mapping documentato
- [ ] Test compilazione e upload
- [ ] Verifica info hardware (Flash, PSRAM, heap)
