/*
 * Elettromeccanica Maranzan - T4 Thermal Printer
 * Hardware: LilyGo T4 v1.3 + CSN-A2 TTL
 *
 * v1.2 - OTA Updates da GitHub
 */

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <math.h>
#include <Update.h>

// Versione firmware corrente
#define FIRMWARE_VERSION "1.6.6"

// Modalità debug print (stampa seriale su carta)
bool debugPrintMode = false;

// OTA Update URL (GitHub raw)
const char* OTA_URL = "https://raw.githubusercontent.com/marcelloemme/elettromeccanica-maranzan/main/hardware/EM_Maranzan_printer.bin";

// WiFiClientSecure per HTTPS
#include <WiFiClientSecure.h>

// WiFi - rete di default (fallback se SD vuota)
const char* DEFAULT_WIFI_SSID = "FASTWEB-RNHDU3";
const char* DEFAULT_WIFI_PASS = "C9FLCJDDRY";

// WiFi networks storage (max 5)
#define MAX_WIFI_NETWORKS 5
struct WifiNetwork {
  char ssid[33];
  char pass[65];
};
WifiNetwork savedNetworks[MAX_WIFI_NETWORKS];
int numSavedNetworks = 0;
int currentNetworkIndex = 0;

// Captive portal
WebServer webServer(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;
bool configMode = false;

// CSV URL (Google Sheets published)
const char* CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTLu_kAJJ7pIFcbxUC8082z7jG1EP-lFgoJmNVae-0w0_uZWABdJ8yWXxPViw8bqge1TOWXeUmFZyrp/pub?gid=0&single=true&output=csv";

// API URL per polling timestamp
const char* API_URL = "https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec";

// Display
TFT_eSPI tft = TFT_eSPI();

// Pin backlight
#define TFT_BL 4

// SD Card pins
#define SD_CS   13
#define SD_MOSI 15
#define SD_MISO 2
#define SD_SCK  14

// Pulsanti (dopo rotazione -90°: IO39=su, IO38=giù, IO37=OK)
#define BTN_UP     39   // Su (era giù in portrait)
#define BTN_CENTER 37   // OK/Stampa
#define BTN_DOWN   38   // Giù (era su in portrait)

// Stampante termica
#define PRINTER_TX 33
#define PRINTER_RX 35
HardwareSerial printerSerial(2);

// SPI dedicato per SD
SPIClass sdSPI(HSPI);

// ===== STRUTTURA SCHEDA RIPARAZIONE =====
struct Attrezzo {
  char marca[32];
  char dotazione[32];
  char note[64];
};

struct Scheda {
  char numero[12];      // es: "26/0021"
  char data[12];        // es: "2025-01-08"
  char cliente[32];     // nome cliente (troncato)
  char telefono[16];
  char indirizzo[32];
  Attrezzo attrezzi[5]; // max 5 attrezzi per scheda
  int numAttrezzi;
  bool completato;
  bool ddt;             // DDT presente (colonna F)
};

// Array schede (ultime 50)
#define MAX_SCHEDE 50
Scheda schede[MAX_SCHEDE];
int numSchede = 0;

// UI state (landscape 320x240, pulsanti a destra)
int selectedIndex = 0;
int scrollOffset = 0;
#define VISIBLE_ROWS 10
#define ROW_HEIGHT 20
#define BUTTON_PANEL_WIDTH 50   // Larghezza pannello pulsanti a destra
#define HEADER_HEIGHT 30        // Altezza header in alto
#define SCROLLBAR_WIDTH 5       // Larghezza scrollbar a sinistra

// Long press timing
unsigned long btnUpPressed = 0;
unsigned long btnDownPressed = 0;
unsigned long lastPageSkip = 0;
#define LONG_PRESS_MS 1500

// Stati
bool sdOK = false;
bool wifiOK = false;
String csvData = "";

// Auto-print polling
unsigned long lastKnownTimestamp = 0;

// Polling dinamico basato su fascia oraria (per rispettare limiti API Google)
// Lavoro (7:30-19:15): 2.2s  |  Transizione (7:00-7:30, 19:15-19:45): 60s  |  Notte: 3600s
#define POLL_FAST     2200     // 2.2 secondi durante orario lavoro
#define POLL_TRANS    60000    // 1 minuto durante transizione
#define POLL_NIGHT    3600000  // 1 ora durante notte

// NTP time sync
bool ntpSynced = false;

// Task polling su core separato
TaskHandle_t pollTaskHandle = NULL;
volatile bool newSchedeReady = false;  // Flag per comunicare col loop principale
char lastFastPrintNumero[12] = "";    // Numero stampato via API (per verificare CSV)

// WiFi retry
unsigned long lastWifiRetry = 0;
#define WIFI_RETRY_INTERVAL 60000  // 60 secondi
volatile bool wifiError = false;  // Errore temporaneo (polling fallito)
volatile bool showWifiStatus = false;  // Flag per aggiornare UI

// Print history (schede già stampate)
#define MAX_HISTORY 200
char printHistory[MAX_HISTORY][12];  // Array di numeri scheda (es: "26/0021")
int historyCount = 0;

// Screen sleep
unsigned long lastButtonActivity = 0;
#define SCREEN_TIMEOUT 30000  // 30 secondi
bool screenOn = true;
bool printFromSleep = false;  // Flag: stampa partita con schermo spento

// Modalità inserimento manuale numero scheda
bool manualInputMode = false;
char manualNumero[8] = "26/0001";  // Formato AA/NNNN
int manualCursorPos = 0;  // Posizione cursore (0-6, salta pos 2 che è /)
#define MANUAL_LONG_PRESS_MS 2000
#define MANUAL_TIMEOUT_MS 20000  // 20 secondi timeout inattività
unsigned long lastManualActivity = 0;

// Forward declarations
void showMessage(const char* msg, uint16_t color);
void drawList();
void printEtichetta(Scheda& s, int attrezzoIdx, int totAttrezzi);
void drawHeader();
void drawButtons();
void tryPrintManualScheda();
bool performOTAUpdate();
void printStatusReport();
void executeRemoteCommand(const char* cmd);

// ===== DEBUG PRINT (Serial + Stampante) =====

// Flag per sopprimere log JSON durante parsing
bool suppressJsonLogs = false;

// Stampa su seriale + carta (se debugPrintMode attivo)
void debugPrint(const char* msg) {
  Serial.print(msg);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.print(msg);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrint(const String& msg) {
  debugPrint(msg.c_str());
}

void debugPrint(int val) {
  Serial.print(val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.print(val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrint(unsigned long val) {
  Serial.print(val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.print(val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrint(size_t val) {
  Serial.print((unsigned long)val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.print((unsigned long)val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrintln(const char* msg) {
  Serial.println(msg);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.println(msg);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrintln(const String& msg) {
  debugPrintln(msg.c_str());
}

void debugPrintln(int val) {
  Serial.println(val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.println(val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrintln(unsigned long val) {
  Serial.println(val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.println(val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrintln(size_t val) {
  Serial.println((unsigned long)val);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.println((unsigned long)val);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

void debugPrintln() {
  Serial.println();
  if (debugPrintMode) {
    printerSerial.println();
  }
}

// Per IPAddress
void debugPrintln(IPAddress ip) {
  Serial.println(ip);
  if (debugPrintMode) {
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);
    printerSerial.println(ip);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }
}

// ===== OTA UPDATE =====

// Esegue aggiornamento OTA da GitHub
bool performOTAUpdate() {
  debugPrintln("[OTA] Avvio aggiornamento firmware...");
  debugPrint("[OTA] URL: ");
  debugPrintln(OTA_URL);

  // Mostra su display (landscape 320x240)
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 30);
  tft.println("Aggiornamento firmware...");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 70);
  tft.println("Download in corso...");
  tft.setCursor(10, 85);
  tft.print("Versione attuale: ");
  tft.println(FIRMWARE_VERSION);

  // Progress bar (landscape: più larga)
  int barX = 10, barY = 120, barW = 300, barH = 20;
  tft.drawRect(barX, barY, barW, barH, TFT_WHITE);

  // Usa WiFiClientSecure per HTTPS (senza verifica certificato)
  WiFiClientSecure client;
  client.setInsecure();  // Ignora verifica certificato SSL

  HTTPClient http;
  http.begin(client, OTA_URL);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(30000);  // 30 secondi

  int httpCode = http.GET();
  int contentLength = http.getSize();

  debugPrint("[OTA] HTTP code: ");
  debugPrintln(httpCode);
  debugPrint("[OTA] Content length: ");
  debugPrintln(contentLength);

  if (httpCode != HTTP_CODE_OK) {
    debugPrintln("[OTA] Download fallito");
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.setCursor(10, 170);
    tft.println("Download fallito!");
    tft.setCursor(10, 185);
    tft.print("HTTP: ");
    tft.println(httpCode);
    http.end();
    delay(3000);
    return false;
  }

  if (contentLength <= 0) {
    debugPrintln("[OTA] File non trovato o vuoto");
    tft.setTextColor(TFT_ORANGE, TFT_BLACK);
    tft.setCursor(10, 170);
    tft.println("File non trovato");
    http.end();
    delay(3000);
    return false;
  }

  // Inizia update
  if (!Update.begin(contentLength)) {
    debugPrintln("[OTA] Spazio insufficiente");
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.setCursor(10, 170);
    tft.println("Spazio insufficiente!");
    http.end();
    delay(3000);
    return false;
  }

  Stream* stream = http.getStreamPtr();
  size_t written = 0;
  uint8_t buff[1024];
  int lastPercent = 0;

  tft.setCursor(10, 105);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.print("0%");

  while (http.connected() && written < (size_t)contentLength) {
    size_t available = stream->available();
    if (available) {
      size_t toRead = min(available, sizeof(buff));
      size_t bytesRead = stream->readBytes(buff, toRead);
      size_t bytesWritten = Update.write(buff, bytesRead);

      if (bytesWritten != bytesRead) {
        debugPrintln("[OTA] Errore scrittura");
        Update.abort();
        http.end();
        tft.setTextColor(TFT_RED, TFT_BLACK);
        tft.setCursor(20, 200);
        tft.println("Errore scrittura!");
        delay(3000);
        return false;
      }

      written += bytesWritten;

      // Aggiorna progress bar
      int percent = (written * 100) / contentLength;
      if (percent != lastPercent) {
        lastPercent = percent;
        int fillW = (barW - 4) * percent / 100;
        tft.fillRect(barX + 2, barY + 2, fillW, barH - 4, TFT_GREEN);

        // Percentuale
        tft.fillRect(10, 105, 50, 15, TFT_BLACK);
        tft.setCursor(10, 105);
        tft.setTextColor(TFT_YELLOW, TFT_BLACK);
        tft.print(percent);
        tft.print("%");
      }
    }
    delay(1);
  }

  http.end();

  if (Update.end()) {
    if (Update.isFinished()) {
      debugPrintln("[OTA] Aggiornamento completato!");

      tft.fillRect(10, 160, 300, 60, TFT_BLACK);
      tft.setTextColor(TFT_GREEN, TFT_BLACK);
      tft.setTextSize(2);
      tft.setCursor(10, 165);
      tft.println("Completato!");

      tft.setTextSize(1);
      tft.setCursor(10, 195);
      tft.println("Riavvio in 3 secondi...");

      delay(3000);
      ESP.restart();
      return true;  // Non raggiunto
    }
  }

  debugPrint("[OTA] Errore finale: ");
  debugPrintln(Update.getError());
  tft.setTextColor(TFT_RED, TFT_BLACK);
  tft.setCursor(10, 170);
  tft.println("Errore aggiornamento!");
  delay(3000);
  return false;
}

// ===== WIFI CONFIG MANAGEMENT =====

// Carica reti WiFi da SD
void loadWifiConfig() {
  numSavedNetworks = 0;

  if (!sdOK) {
    debugPrintln("[WIFI] SD non disponibile, uso default");
    return;
  }

  File f = SD.open("/wifi_config.txt", FILE_READ);
  if (!f) {
    debugPrintln("[WIFI] Config non trovata, uso default");
    return;
  }

  while (f.available() && numSavedNetworks < MAX_WIFI_NETWORKS) {
    String line = f.readStringUntil('\n');
    line.trim();

    int sepIdx = line.indexOf('|');
    if (sepIdx > 0) {
      String ssid = line.substring(0, sepIdx);
      String pass = line.substring(sepIdx + 1);

      strncpy(savedNetworks[numSavedNetworks].ssid, ssid.c_str(), 32);
      savedNetworks[numSavedNetworks].ssid[32] = '\0';
      strncpy(savedNetworks[numSavedNetworks].pass, pass.c_str(), 64);
      savedNetworks[numSavedNetworks].pass[64] = '\0';

      debugPrint("[WIFI] Caricata rete: ");
      debugPrintln(savedNetworks[numSavedNetworks].ssid);
      numSavedNetworks++;
    }
  }
  f.close();

  debugPrint("[WIFI] Caricate ");
  debugPrint(numSavedNetworks);
  debugPrintln(" reti");
}

// Salva reti WiFi su SD
void saveWifiConfig() {
  if (!sdOK) return;

  File f = SD.open("/wifi_config.txt", FILE_WRITE);
  if (!f) {
    debugPrintln("[WIFI] Errore scrittura config");
    return;
  }

  for (int i = 0; i < numSavedNetworks; i++) {
    f.print(savedNetworks[i].ssid);
    f.print("|");
    f.println(savedNetworks[i].pass);
  }
  f.close();

  debugPrintln("[WIFI] Config salvata");
}

// Aggiunge una rete (FIFO se pieno)
void addWifiNetwork(const char* ssid, const char* pass) {
  // Controlla se esiste già, in tal caso aggiorna e sposta in fondo
  for (int i = 0; i < numSavedNetworks; i++) {
    if (strcmp(savedNetworks[i].ssid, ssid) == 0) {
      // Aggiorna password
      strncpy(savedNetworks[i].pass, pass, 64);
      savedNetworks[i].pass[64] = '\0';

      // Sposta in fondo (più recente)
      WifiNetwork temp = savedNetworks[i];
      for (int j = i; j < numSavedNetworks - 1; j++) {
        savedNetworks[j] = savedNetworks[j + 1];
      }
      savedNetworks[numSavedNetworks - 1] = temp;

      saveWifiConfig();
      debugPrint("[WIFI] Aggiornata rete: ");
      debugPrintln(ssid);
      return;
    }
  }

  // Se pieno, rimuovi la più vecchia (prima)
  if (numSavedNetworks >= MAX_WIFI_NETWORKS) {
    for (int i = 0; i < MAX_WIFI_NETWORKS - 1; i++) {
      savedNetworks[i] = savedNetworks[i + 1];
    }
    numSavedNetworks = MAX_WIFI_NETWORKS - 1;
  }

  // Aggiungi in fondo
  strncpy(savedNetworks[numSavedNetworks].ssid, ssid, 32);
  savedNetworks[numSavedNetworks].ssid[32] = '\0';
  strncpy(savedNetworks[numSavedNetworks].pass, pass, 64);
  savedNetworks[numSavedNetworks].pass[64] = '\0';
  numSavedNetworks++;

  saveWifiConfig();
  debugPrint("[WIFI] Aggiunta rete: ");
  debugPrintln(ssid);
}

// Tenta connessione a una rete specifica
bool tryConnectToNetwork(int index) {
  if (index < 0 || index >= numSavedNetworks) return false;

  debugPrint("[WIFI] Provo: ");
  debugPrintln(savedNetworks[index].ssid);

  WiFi.disconnect();
  delay(100);
  WiFi.begin(savedNetworks[index].ssid, savedNetworks[index].pass);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    debugPrint(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    debugPrint("\n[WIFI] Connesso a ");
    debugPrint(savedNetworks[index].ssid);
    debugPrint(": ");
    debugPrintln(WiFi.localIP());
    currentNetworkIndex = index;
    return true;
  }

  debugPrintln("\n[WIFI] Fallito");
  return false;
}

// Tenta connessione a rotazione su tutte le reti salvate
bool tryConnectAllNetworks() {
  // Prima prova le reti salvate
  for (int i = 0; i < numSavedNetworks; i++) {
    if (tryConnectToNetwork(i)) return true;
  }

  // Fallback: prova la rete di default se non è già nelle salvate
  bool defaultInList = false;
  for (int i = 0; i < numSavedNetworks; i++) {
    if (strcmp(savedNetworks[i].ssid, DEFAULT_WIFI_SSID) == 0) {
      defaultInList = true;
      break;
    }
  }

  if (!defaultInList) {
    debugPrint("[WIFI] Provo default: ");
    debugPrintln(DEFAULT_WIFI_SSID);

    WiFi.disconnect();
    delay(100);
    WiFi.begin(DEFAULT_WIFI_SSID, DEFAULT_WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      debugPrint(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      debugPrint("\n[WIFI] Connesso a default: ");
      debugPrintln(WiFi.localIP());
      return true;
    }
  }

  return false;
}

// ===== CAPTIVE PORTAL =====

// HTML della pagina di configurazione
String getConfigPageHTML() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EM Maranzan - Config WiFi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e; color: #eee; padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 400px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 20px; font-size: 1.5em; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; font-size: 0.9em; }
    .network {
      background: #16213e; border-radius: 10px; padding: 15px;
      margin-bottom: 10px; cursor: pointer; transition: all 0.2s;
      display: flex; justify-content: space-between; align-items: center;
    }
    .network:hover, .network.selected { background: #0f3460; }
    .network.selected { border: 2px solid #00d9ff; }
    .ssid { font-weight: 600; }
    .signal { color: #888; font-size: 0.8em; }
    .form-group { margin-top: 20px; }
    label { display: block; margin-bottom: 8px; color: #888; }
    input[type="password"], input[type="text"] {
      width: 100%; padding: 15px; border-radius: 10px; border: none;
      background: #16213e; color: #fff; font-size: 16px;
    }
    input:focus { outline: 2px solid #00d9ff; }
    button {
      width: 100%; padding: 15px; border-radius: 10px; border: none;
      background: #00d9ff; color: #1a1a2e; font-size: 16px;
      font-weight: 600; margin-top: 20px; cursor: pointer;
    }
    button:hover { background: #00b8d4; }
    button:disabled { background: #444; cursor: not-allowed; }
    .scanning { text-align: center; padding: 40px; color: #888; }
    .success { background: #00c853; }
    .error { background: #ff5252; color: #fff; padding: 15px; border-radius: 10px; margin-top: 20px; }
    .refresh { background: transparent; border: 2px solid #00d9ff; color: #00d9ff; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>EM Maranzan</h1>
    <p class="subtitle">Configurazione WiFi</p>

    <div id="networks">
      <div class="scanning">Scansione reti...</div>
    </div>

    <div id="form" style="display:none;">
      <div class="form-group">
        <label>Rete selezionata</label>
        <input type="text" id="ssid" readonly>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" placeholder="Inserisci password">
      </div>
      <button onclick="saveConfig()">Salva e Connetti</button>
    </div>

    <button class="refresh" onclick="scanNetworks()">Aggiorna lista</button>

    <div id="message"></div>
  </div>

  <script>
    let selectedSSID = '';

    function scanNetworks() {
      document.getElementById('networks').innerHTML = '<div class="scanning">Scansione reti...</div>';
      fetch('/scan').then(r => r.json()).then(data => {
        let html = '';
        data.networks.forEach(n => {
          html += `<div class="network" onclick="selectNetwork('${n.ssid}', this)">
            <span class="ssid">${n.ssid}</span>
            <span class="signal">${n.rssi} dBm</span>
          </div>`;
        });
        if (data.networks.length === 0) {
          html = '<div class="scanning">Nessuna rete trovata</div>';
        }
        document.getElementById('networks').innerHTML = html;
      }).catch(e => {
        document.getElementById('networks').innerHTML = '<div class="error">Errore scansione</div>';
      });
    }

    function selectNetwork(ssid, el) {
      selectedSSID = ssid;
      document.querySelectorAll('.network').forEach(n => n.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('ssid').value = ssid;
      document.getElementById('form').style.display = 'block';
      document.getElementById('password').focus();
    }

    function saveConfig() {
      const pass = document.getElementById('password').value;
      const msg = document.getElementById('message');

      fetch('/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'ssid=' + encodeURIComponent(selectedSSID) + '&pass=' + encodeURIComponent(pass)
      }).then(r => r.json()).then(data => {
        if (data.success) {
          msg.innerHTML = '<div class="network success">Salvato! Riavvio in corso...</div>';
          setTimeout(() => window.close(), 3000);
        } else {
          msg.innerHTML = '<div class="error">' + data.error + '</div>';
        }
      }).catch(e => {
        msg.innerHTML = '<div class="error">Errore di connessione</div>';
      });
    }

    scanNetworks();
  </script>
</body>
</html>
)rawliteral";
  return html;
}

// Handler pagina principale
void handleRoot() {
  webServer.send(200, "text/html", getConfigPageHTML());
}

// Handler scansione reti
void handleScan() {
  debugPrintln("[AP] Scansione reti...");
  int n = WiFi.scanNetworks();

  String json = "{\"networks\":[";
  for (int i = 0; i < n; i++) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]}";

  webServer.send(200, "application/json", json);
  WiFi.scanDelete();
}

// Handler salvataggio config
void handleSave() {
  String ssid = webServer.arg("ssid");
  String pass = webServer.arg("pass");

  if (ssid.length() == 0) {
    webServer.send(200, "application/json", "{\"success\":false,\"error\":\"SSID mancante\"}");
    return;
  }

  debugPrint("[AP] Salvo rete: ");
  debugPrintln(ssid);

  addWifiNetwork(ssid.c_str(), pass.c_str());

  webServer.send(200, "application/json", "{\"success\":true}");

  // Riavvia dopo 2 secondi
  delay(2000);
  ESP.restart();
}

// Handler captive portal (redirect tutto a root)
void handleNotFound() {
  webServer.sendHeader("Location", "http://192.168.4.1/", true);
  webServer.send(302, "text/plain", "");
}

// Avvia modalità Access Point
void startConfigMode() {
  configMode = true;

  debugPrintln("\n[AP] Avvio modalità configurazione...");

  // Mostra su display (landscape 320x240)
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(80, 30);
  tft.println("Config WiFi");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(90, 70);
  tft.println("Connettiti a:");

  tft.setTextSize(2);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setCursor(65, 95);
  tft.println("EM Maranzan");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(85, 130);
  tft.println("(nessuna password)");

  tft.setCursor(50, 170);
  tft.println("Si aprira' una pagina");
  tft.setCursor(50, 190);
  tft.println("per configurare il WiFi");

  // Avvia AP
  WiFi.mode(WIFI_AP);
  WiFi.softAP("EM Maranzan", "");  // No password

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  debugPrint("[AP] IP: ");
  debugPrintln(WiFi.softAPIP());

  // Avvia DNS server per captive portal
  dnsServer.start(DNS_PORT, "*", apIP);

  // Configura web server
  webServer.on("/", handleRoot);
  webServer.on("/scan", handleScan);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.onNotFound(handleNotFound);
  webServer.begin();

  debugPrintln("[AP] Server avviato");

  // Loop modalità config
  while (configMode) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    delay(10);
  }
}

// ===== PARSING CSV =====
String getCSVField(const String& line, int fieldIndex) {
  int start = 0;
  int fieldCount = 0;
  bool inQuotes = false;

  for (int i = 0; i <= (int)line.length(); i++) {
    char c = (i < (int)line.length()) ? line[i] : ',';

    if (c == '"') {
      inQuotes = !inQuotes;
    } else if (c == ',' && !inQuotes) {
      if (fieldCount == fieldIndex) {
        String field = line.substring(start, i);
        // Rimuovi virgolette
        if (field.startsWith("\"") && field.endsWith("\"")) {
          field = field.substring(1, field.length() - 1);
        }
        field.trim();
        return field;
      }
      fieldCount++;
      start = i + 1;
    }
  }
  return "";
}

void parseAttrezziJSON(String json, Scheda& s) {
  s.numAttrezzi = 0;

  // Debug (soppresso durante parsing massivo CSV)
  if (!suppressJsonLogs) {
    debugPrint("[JSON] Input: ");
    debugPrintln(json.substring(0, min((int)json.length(), 80)));
  }

  if (json.length() < 3) {
    if (!suppressJsonLogs) debugPrintln("[JSON] Troppo corto");
    return;
  }

  // CSV escapa le virgolette come "" -> sostituisci con "
  json.replace("\"\"", "\"");

  // Rimuovi virgolette esterne se presenti (dal CSV)
  if (json.startsWith("\"") && json.endsWith("\"")) {
    json = json.substring(1, json.length() - 1);
  }

  if (!json.startsWith("[")) {
    // Non è un JSON array, tratta come testo semplice
    if (!suppressJsonLogs) debugPrintln("[JSON] Non e' un array, uso come testo");
    strncpy(s.attrezzi[0].marca, json.c_str(), sizeof(s.attrezzi[0].marca) - 1);
    s.attrezzi[0].dotazione[0] = '\0';
    s.attrezzi[0].note[0] = '\0';
    s.numAttrezzi = 1;
    return;
  }

  // Parse JSON array
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, json);

  if (error) {
    if (!suppressJsonLogs) {
      debugPrint("[JSON] Parse error: ");
      debugPrintln(error.c_str());
    }
    // Fallback: mostra raw
    strncpy(s.attrezzi[0].marca, json.c_str(), sizeof(s.attrezzi[0].marca) - 1);
    s.numAttrezzi = 1;
    return;
  }

  JsonArray arr = doc.as<JsonArray>();
  if (!suppressJsonLogs) {
    debugPrint("[JSON] Trovati ");
    debugPrint((int)arr.size());
    debugPrintln(" attrezzi");
  }

  for (JsonObject obj : arr) {
    if (s.numAttrezzi >= 5) break;

    Attrezzo& a = s.attrezzi[s.numAttrezzi];
    const char* marca = obj["marca"] | "";
    const char* dotazione = obj["dotazione"] | "";
    const char* note = obj["note"] | "";

    strncpy(a.marca, marca, sizeof(a.marca) - 1);
    strncpy(a.dotazione, dotazione, sizeof(a.dotazione) - 1);
    strncpy(a.note, note, sizeof(a.note) - 1);

    if (!suppressJsonLogs) {
      debugPrint("[JSON] Attrezzo ");
      debugPrint(s.numAttrezzi);
      debugPrint(": ");
      debugPrintln(a.marca);
    }

    s.numAttrezzi++;
  }
}

void parseCSV(const String& csv) {
  numSchede = 0;
  int lineStart = 0;
  bool firstLine = true;

  // Sopprimi log JSON durante parsing massivo
  suppressJsonLogs = true;

  // Prima conta le righe per prendere le ultime 50
  int totalLines = 0;
  for (int i = 0; i < (int)csv.length(); i++) {
    if (csv[i] == '\n') totalLines++;
  }
  int skipLines = (totalLines > MAX_SCHEDE) ? (totalLines - MAX_SCHEDE) : 0;
  int currentLine = 0;

  for (int i = 0; i <= (int)csv.length() && numSchede < MAX_SCHEDE; i++) {
    if (i == (int)csv.length() || csv[i] == '\n') {
      if (i > lineStart) {
        String line = csv.substring(lineStart, i);
        line.trim();

        // Salta header
        if (firstLine) {
          firstLine = false;
          lineStart = i + 1;
          continue;
        }

        currentLine++;

        // Salta le prime righe per prendere solo le ultime 50
        if (currentLine <= skipLines) {
          lineStart = i + 1;
          continue;
        }

        if (line.length() > 0) {
          Scheda& s = schede[numSchede];
          memset(&s, 0, sizeof(Scheda));

          // Campi CSV: Numero,Data consegna,Cliente,Indirizzo,Telefono,DDT,Attrezzi(JSON),Completato,Data completamento
          //            0      1             2       3         4        5   6              7          8
          strncpy(s.numero, getCSVField(line, 0).c_str(), sizeof(s.numero) - 1);
          strncpy(s.data, getCSVField(line, 1).c_str(), sizeof(s.data) - 1);
          strncpy(s.cliente, getCSVField(line, 2).c_str(), sizeof(s.cliente) - 1);
          strncpy(s.indirizzo, getCSVField(line, 3).c_str(), sizeof(s.indirizzo) - 1);
          strncpy(s.telefono, getCSVField(line, 4).c_str(), sizeof(s.telefono) - 1);

          // Campo 5 = DDT (boolean)
          String ddtField = getCSVField(line, 5);
          s.ddt = (ddtField.equalsIgnoreCase("true") || ddtField == "1");

          // Campo 6 = Attrezzi (JSON array)
          String attrezziJson = getCSVField(line, 6);
          parseAttrezziJSON(attrezziJson, s);

          // Campo 7 = Completato
          String comp = getCSVField(line, 7);
          s.completato = (comp.equalsIgnoreCase("true") || comp == "1");

          numSchede++;
        }
      }
      lineStart = i + 1;
    }
  }

  // Ordina per numero decrescente (anno + progressivo)
  // Bubble sort semplice (max 50 elementi)
  for (int i = 0; i < numSchede - 1; i++) {
    for (int j = 0; j < numSchede - i - 1; j++) {
      // Estrai anno e progressivo da "AA/NNNN"
      int annoA = 0, progA = 0, annoB = 0, progB = 0;
      sscanf(schede[j].numero, "%d/%d", &annoA, &progA);
      sscanf(schede[j + 1].numero, "%d/%d", &annoB, &progB);

      // Ordine decrescente: prima per anno, poi per progressivo
      bool shouldSwap = false;
      if (annoA < annoB) {
        shouldSwap = true;
      } else if (annoA == annoB && progA < progB) {
        shouldSwap = true;
      }

      if (shouldSwap) {
        Scheda temp = schede[j];
        schede[j] = schede[j + 1];
        schede[j + 1] = temp;
      }
    }
  }

  // Riattiva log JSON
  suppressJsonLogs = false;

  debugPrint("[CSV] Parsed ");
  debugPrint(numSchede);
  debugPrintln(" schede (ordinate per anno/prog decrescente)");
}

// Verifica se una scheda esiste nella lista corrente
bool isSchedaInList(const char* numero) {
  for (int i = 0; i < numSchede; i++) {
    if (strcmp(schede[i].numero, numero) == 0) {
      return true;
    }
  }
  return false;
}

// ===== PRINT HISTORY =====

// Carica history da SD
void loadPrintHistory() {
  historyCount = 0;
  if (!sdOK) return;

  File f = SD.open("/print_history.txt", FILE_READ);
  if (!f) {
    debugPrintln("[HISTORY] File non trovato, creo nuovo");
    return;
  }

  while (f.available() && historyCount < MAX_HISTORY) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() > 0 && line.length() < 12) {
      strncpy(printHistory[historyCount], line.c_str(), 11);
      printHistory[historyCount][11] = '\0';
      historyCount++;
    }
  }
  f.close();

  debugPrint("[HISTORY] Caricate ");
  debugPrint(historyCount);
  debugPrintln(" schede gia' stampate");
}

// Salva history su SD
void savePrintHistory() {
  if (!sdOK) return;

  File f = SD.open("/print_history.txt", FILE_WRITE);
  if (!f) {
    debugPrintln("[HISTORY] Errore scrittura");
    return;
  }

  for (int i = 0; i < historyCount; i++) {
    f.println(printHistory[i]);
  }
  f.close();

  debugPrint("[HISTORY] Salvate ");
  debugPrint(historyCount);
  debugPrintln(" schede");
}

// Verifica se scheda è già stampata
bool isAlreadyPrinted(const char* numero) {
  for (int i = 0; i < historyCount; i++) {
    if (strcmp(printHistory[i], numero) == 0) {
      return true;
    }
  }
  return false;
}

// Aggiunge scheda a history
void addToHistory(const char* numero) {
  if (historyCount >= MAX_HISTORY) {
    // Rimuovi la più vecchia (shift array)
    for (int i = 0; i < MAX_HISTORY - 1; i++) {
      strcpy(printHistory[i], printHistory[i + 1]);
    }
    historyCount = MAX_HISTORY - 1;
  }
  strncpy(printHistory[historyCount], numero, 11);
  printHistory[historyCount][11] = '\0';
  historyCount++;
}

// Segna tutte le schede correnti come stampate (all'avvio)
// SOVRASCRIVE la history con solo le schede attuali nel CSV
void markAllAsPrinted() {
  historyCount = 0;  // Reset history
  for (int i = 0; i < numSchede; i++) {
    addToHistory(schede[i].numero);
  }
  savePrintHistory();
  debugPrint("[HISTORY] Reset history con ");
  debugPrint(historyCount);
  debugPrintln(" schede dal CSV");
}

// ===== POLLING & AUTO-PRINT =====

// Polling ottimizzato: singola chiamata che verifica timestamp E ritorna scheda
// Ritorna: 0 = nessuna novità, 1 = stampata nuova scheda, -1 = errore
int pollAndPrint() {
  if (WiFi.status() != WL_CONNECTED) {
    debugPrintln("[POLL] WiFi non connesso");
    wifiError = true;
    showWifiStatus = true;
    return -1;
  }

  HTTPClient http;
  String url = String(API_URL) + "?action=pollPrinter&ts=" + String(lastKnownTimestamp);
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(8000);  // 8 secondi (ridotto per velocità)

  int httpCode = http.GET();

  if (httpCode != HTTP_CODE_OK) {
    debugPrint("[POLL] HTTP error: ");
    debugPrintln(httpCode);
    http.end();
    wifiError = true;
    showWifiStatus = true;
    return -1;
  }

  String response = http.getString();
  http.end();

  // Connessione OK
  if (wifiError) {
    wifiError = false;
    showWifiStatus = true;
    debugPrintln("[POLL] Connessione ripristinata");
  }

  // Parse JSON
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    debugPrint("[POLL] JSON error: ");
    debugPrintln(error.c_str());
    return -1;
  }

  // Verifica se ts è un comando remoto (stringa) invece di un timestamp (numero)
  JsonVariant tsVar = doc["ts"];
  if (tsVar.is<const char*>()) {
    const char* tsStr = tsVar.as<const char*>();
    if (tsStr && strlen(tsStr) > 0) {
      debugPrint("[POLL] Comando remoto: ");
      debugPrintln(tsStr);
      executeRemoteCommand(tsStr);
      return 0;  // Comando eseguito, non è una nuova scheda
    }
  }

  // ts è un numero (timestamp) o vuoto/0
  double tsDouble = tsVar.as<double>();

  // Se ts è 0 o vuoto, tratta come "nessun cambiamento" e mantieni lastKnownTimestamp
  if (tsDouble == 0) {
    return 0;
  }

  lastKnownTimestamp = (unsigned long)fmod(tsDouble, 1000000000.0);

  // Nessuna novità
  if (!doc["changed"].as<bool>()) {
    return 0;
  }

  debugPrintln("[POLL] Nuova scheda rilevata!");

  // Verifica che ci sia una riparazione
  if (doc["riparazione"].isNull()) {
    debugPrintln("[POLL] Riparazione null");
    return 0;
  }

  JsonObject obj = doc["riparazione"].as<JsonObject>();
  const char* numero = obj["Numero"] | "";

  // Controlla se già stampata
  if (isAlreadyPrinted(numero)) {
    debugPrint("[POLL] Scheda ");
    debugPrint(numero);
    debugPrintln(" gia' stampata");
    return 0;
  }

  debugPrint("[POLL] Nuova scheda: ");
  debugPrintln(numero);
  showMessage("Nuova scheda!", TFT_CYAN);

  // Costruisci scheda per stampa
  Scheda s;
  memset(&s, 0, sizeof(Scheda));

  strncpy(s.numero, numero, sizeof(s.numero) - 1);
  strncpy(s.data, obj["Data consegna"] | "", sizeof(s.data) - 1);
  strncpy(s.cliente, obj["Cliente"] | "", sizeof(s.cliente) - 1);
  strncpy(s.indirizzo, obj["Indirizzo"] | "", sizeof(s.indirizzo) - 1);
  strncpy(s.telefono, obj["Telefono"] | "", sizeof(s.telefono) - 1);
  s.ddt = obj["DDT"] | false;

  // Parse attrezzi
  JsonArray attrezzi = obj["Attrezzi"].as<JsonArray>();
  s.numAttrezzi = 0;
  for (JsonObject att : attrezzi) {
    if (s.numAttrezzi >= 5) break;
    Attrezzo& a = s.attrezzi[s.numAttrezzi];
    strncpy(a.marca, att["marca"] | "", sizeof(a.marca) - 1);
    strncpy(a.dotazione, att["dotazione"] | "", sizeof(a.dotazione) - 1);
    strncpy(a.note, att["note"] | "", sizeof(a.note) - 1);
    s.numAttrezzi++;
  }

  // Riaccendi schermo
  if (!screenOn) {
    screenOn = true;
    digitalWrite(TFT_BL, HIGH);
    delay(100);
  }

  // Stampa
  int numEtichette = max(1, s.numAttrezzi);
  debugPrint("[POLL] Stampo ");
  debugPrint(numEtichette);
  debugPrintln(" etichette");

  for (int i = 0; i < numEtichette; i++) {
    char msg[40];
    sprintf(msg, "Stampa %s (%d/%d)", s.numero, i + 1, numEtichette);
    showMessage(msg, TFT_CYAN);
    printEtichetta(s, i, numEtichette);

    if (i < numEtichette - 1) {
      for (int sec = 8; sec > 0; sec--) {
        char countdown[32];
        sprintf(countdown, "Prossima in %ds...", sec);
        showMessage(countdown, TFT_CYAN);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
      }
    }
  }

  // Salva in history
  addToHistory(s.numero);
  savePrintHistory();

  // Salva numero per sync CSV
  strncpy(lastFastPrintNumero, s.numero, sizeof(lastFastPrintNumero) - 1);

  showMessage("Stampato!", TFT_GREEN);
  debugPrintln("[POLL] Stampa completata");

  return 1;
}

// === FUNZIONI LEGACY (mantenute per compatibilità) ===

// Fetch timestamp da API - ritorna 0 se errore
unsigned long fetchLastUpdate() {
  if (WiFi.status() != WL_CONNECTED) return 0;

  HTTPClient http;
  String url = String(API_URL) + "?action=getLastUpdate";
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(8000);

  int httpCode = http.GET();
  unsigned long ts = 0;

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, response)) {
      double tsDouble = doc["ts"] | 0.0;
      ts = (unsigned long)fmod(tsDouble, 1000000000.0);
    }
  }

  http.end();
  return ts;
}

// Fetch rapido ultima scheda (legacy, non più usata nel polling)
bool fetchAndPrintLastScheda() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(API_URL) + "?action=getRiparazioni&limit=1";
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(8000);

  int httpCode = http.GET();

  if (httpCode != HTTP_CODE_OK) {
    debugPrint("[FAST] HTTP error: ");
    debugPrintln(httpCode);
    http.end();
    return false;
  }

  String response = http.getString();
  http.end();

  debugPrint("[FAST] Response: ");
  debugPrint(response.length());
  debugPrintln(" bytes");

  // Parse JSON
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    debugPrint("[FAST] JSON error: ");
    debugPrintln(error.c_str());
    return false;
  }

  JsonArray arr = doc["riparazioni"].as<JsonArray>();
  if (arr.size() == 0) {
    debugPrintln("[FAST] Nessuna scheda trovata");
    return false;
  }

  // Prendi la prima (ultima inserita)
  JsonObject obj = arr[0];
  const char* numero = obj["Numero"] | "";

  // Controlla se già stampata
  if (isAlreadyPrinted(numero)) {
    debugPrint("[FAST] Scheda ");
    debugPrint(numero);
    debugPrintln(" gia' stampata");
    return false;
  }

  debugPrint("[FAST] Nuova scheda: ");
  debugPrintln(numero);

  // Costruisci scheda temporanea per stampa
  Scheda s;
  memset(&s, 0, sizeof(Scheda));

  strncpy(s.numero, numero, sizeof(s.numero) - 1);

  const char* data = obj["Data consegna"] | "";
  strncpy(s.data, data, sizeof(s.data) - 1);

  const char* cliente = obj["Cliente"] | "";
  strncpy(s.cliente, cliente, sizeof(s.cliente) - 1);

  const char* indirizzo = obj["Indirizzo"] | "";
  strncpy(s.indirizzo, indirizzo, sizeof(s.indirizzo) - 1);

  const char* telefono = obj["Telefono"] | "";
  strncpy(s.telefono, telefono, sizeof(s.telefono) - 1);
  s.ddt = obj["DDT"] | false;

  // Parse attrezzi
  JsonArray attrezzi = obj["Attrezzi"].as<JsonArray>();
  s.numAttrezzi = 0;
  for (JsonObject att : attrezzi) {
    if (s.numAttrezzi >= 5) break;
    Attrezzo& a = s.attrezzi[s.numAttrezzi];
    const char* marca = att["marca"] | "";
    const char* dotazione = att["dotazione"] | "";
    const char* note = att["note"] | "";
    strncpy(a.marca, marca, sizeof(a.marca) - 1);
    strncpy(a.dotazione, dotazione, sizeof(a.dotazione) - 1);
    strncpy(a.note, note, sizeof(a.note) - 1);
    s.numAttrezzi++;
  }

  // Riaccendi schermo per mostrare stampa
  if (!screenOn) {
    printFromSleep = true;  // Segnala a printEtichetta di usare 31 caratteri
    screenOn = true;
    digitalWrite(TFT_BL, HIGH);
    delay(100);
  }

  // Stampa
  int numEtichette = max(1, s.numAttrezzi);
  debugPrint("[FAST] Stampo ");
  debugPrint(numEtichette);
  debugPrintln(" etichette");

  for (int i = 0; i < numEtichette; i++) {
    char msg[40];
    sprintf(msg, "Fast: %s (%d/%d)", s.numero, i + 1, numEtichette);
    showMessage(msg, TFT_CYAN);
    printEtichetta(s, i, numEtichette);

    if (i < numEtichette - 1) {
      for (int sec = 8; sec > 0; sec--) {
        char countdown[32];
        sprintf(countdown, "Prossima in %ds...", sec);
        showMessage(countdown, TFT_CYAN);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
      }
    }
  }

  // Aggiungi a history
  addToHistory(s.numero);
  savePrintHistory();

  // Salva numero per verifica CSV
  strncpy(lastFastPrintNumero, s.numero, sizeof(lastFastPrintNumero) - 1);
  lastFastPrintNumero[sizeof(lastFastPrintNumero) - 1] = '\0';

  showMessage("Stampa rapida OK!", TFT_GREEN);
  debugPrintln("[FAST] Stampa completata");

  return true;
}

// Download CSV e ritorna true se OK
bool downloadCSV() {
  if (WiFi.status() != WL_CONNECTED) return false;

  showMessage("Download CSV...", TFT_YELLOW);
  debugPrintln("[AUTO] Download CSV...");

  HTTPClient http;
  http.begin(CSV_URL);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    csvData = http.getString();
    debugPrint("[AUTO] CSV: ");
    debugPrint(csvData.length());
    debugPrintln(" bytes");

    // Salva su SD
    if (sdOK) {
      File f = SD.open("/riparazioni.csv", FILE_WRITE);
      if (f) {
        f.print(csvData);
        f.close();
      }
    }

    http.end();
    return true;
  }

  debugPrint("[AUTO] HTTP error: ");
  debugPrintln(httpCode);
  http.end();
  return false;
}

// Stampa automatica nuove schede
void autoPrintNewSchede() {
  int printed = 0;

  for (int i = 0; i < numSchede; i++) {
    if (!isAlreadyPrinted(schede[i].numero)) {
      debugPrint("[AUTO] Nuova scheda: ");
      debugPrintln(schede[i].numero);

      // Stampa
      Scheda& s = schede[i];
      int numEtichette = max(1, s.numAttrezzi);
      debugPrint("[AUTO] numAttrezzi=");
      debugPrint(s.numAttrezzi);
      debugPrint(" -> numEtichette=");
      debugPrintln(numEtichette);

      for (int j = 0; j < numEtichette; j++) {
        debugPrint("[AUTO] Stampo etichetta ");
        debugPrint(j + 1);
        debugPrint("/");
        debugPrintln(numEtichette);

        char msg[40];
        sprintf(msg, "Auto: %s (%d/%d)", s.numero, j + 1, numEtichette);
        showMessage(msg, TFT_CYAN);

        printEtichetta(s, j, numEtichette);
        debugPrintln("[AUTO] printEtichetta completato");

        // Pausa tra etichette multiple
        if (j < numEtichette - 1) {
          for (int sec = 8; sec > 0; sec--) {
            char countdown[32];
            sprintf(countdown, "Prossima in %ds...", sec);
            showMessage(countdown, TFT_CYAN);
            delay(1000);
          }
        }
      }

      // Aggiungi a history
      addToHistory(s.numero);
      printed++;
    }
  }

  if (printed > 0) {
    savePrintHistory();
    char msg[32];
    sprintf(msg, "Stampate %d nuove", printed);
    showMessage(msg, TFT_GREEN);
    debugPrint("[AUTO] Stampate ");
    debugPrint(printed);
    debugPrintln(" nuove schede");

    // Aggiorna UI
    drawList();
  } else {
    showMessage("", TFT_BLACK);
  }
}

// Check per nuove schede - solo controllo timestamp (non bloccante)
bool checkTimestampChanged() {
  unsigned long serverTs = fetchLastUpdate();

  if (serverTs > lastKnownTimestamp) {
    debugPrint("[POLL] Timestamp cambiato: ");
    debugPrint(lastKnownTimestamp);
    debugPrint(" -> ");
    debugPrintln(serverTs);
    lastKnownTimestamp = serverTs;
    return true;
  }
  return false;
}

// Tenta riconnessione WiFi (rotazione su tutte le reti)
bool tryReconnectWifi() {
  debugPrintln("[WIFI] Tentativo riconnessione...");

  // Prova la prossima rete nella lista
  int startIndex = currentNetworkIndex;
  int tried = 0;

  while (tried < numSavedNetworks) {
    currentNetworkIndex = (currentNetworkIndex + 1) % numSavedNetworks;
    tried++;

    debugPrint("[WIFI] Provo: ");
    debugPrintln(savedNetworks[currentNetworkIndex].ssid);

    WiFi.disconnect();
    vTaskDelay(500 / portTICK_PERIOD_MS);
    WiFi.begin(savedNetworks[currentNetworkIndex].ssid, savedNetworks[currentNetworkIndex].pass);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 15) {
      vTaskDelay(500 / portTICK_PERIOD_MS);
      debugPrint(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      debugPrint("\n[WIFI] Riconnesso a ");
      debugPrint(savedNetworks[currentNetworkIndex].ssid);
      debugPrint(": ");
      debugPrintln(WiFi.localIP());
      wifiOK = true;
      wifiError = false;
      showWifiStatus = true;
      return true;
    }
    debugPrintln(" fallito");
  }

  // Fallback: prova default se non nelle salvate
  bool defaultInList = false;
  for (int i = 0; i < numSavedNetworks; i++) {
    if (strcmp(savedNetworks[i].ssid, DEFAULT_WIFI_SSID) == 0) {
      defaultInList = true;
      break;
    }
  }

  if (!defaultInList && numSavedNetworks == 0) {
    debugPrint("[WIFI] Provo default: ");
    debugPrintln(DEFAULT_WIFI_SSID);

    WiFi.disconnect();
    vTaskDelay(500 / portTICK_PERIOD_MS);
    WiFi.begin(DEFAULT_WIFI_SSID, DEFAULT_WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 15) {
      vTaskDelay(500 / portTICK_PERIOD_MS);
      debugPrint(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      debugPrint("\n[WIFI] Riconnesso a default: ");
      debugPrintln(WiFi.localIP());
      wifiOK = true;
      wifiError = false;
      showWifiStatus = true;
      return true;
    }
  }

  debugPrintln("[WIFI] Riconnessione fallita su tutte le reti");
  return false;
}

// Calcola intervallo polling in base all'ora corrente (NTP)
// Lavoro (7:30-19:15): 2.2s  |  Transizione (7:00-7:30, 19:15-19:45): 60s  |  Notte: 3600s
int getPollInterval() {
  if (!ntpSynced) {
    // Se NTP non sincronizzato, usa intervallo conservativo
    return POLL_TRANS;
  }

  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    // Fallback se getLocalTime fallisce
    return POLL_TRANS;
  }

  int hour = timeinfo.tm_hour;
  int minute = timeinfo.tm_min;
  int totalMinutes = hour * 60 + minute;  // Minuti dall'inizio del giorno

  // Fasce orarie in minuti:
  // Lavoro: 7:30 (450) - 19:15 (1155)
  // Transizione mattina: 7:00 (420) - 7:30 (450)
  // Transizione sera: 19:15 (1155) - 19:45 (1185)
  // Notte: tutto il resto

  if (totalMinutes >= 450 && totalMinutes < 1155) {
    // Fascia lavoro: 7:30 - 19:15
    return POLL_FAST;
  } else if ((totalMinutes >= 420 && totalMinutes < 450) ||
             (totalMinutes >= 1155 && totalMinutes < 1185)) {
    // Fascia transizione: 7:00-7:30 o 19:15-19:45
    return POLL_TRANS;
  } else {
    // Notte
    return POLL_NIGHT;
  }
}

// ===== COMANDI REMOTI =====

// Stampa scontrino con report di stato
void printStatusReport() {
  debugPrintln("[CMD] Stampa STATUS report");

  // Riaccendi schermo se spento
  if (!screenOn) {
    screenOn = true;
    digitalWrite(TFT_BL, HIGH);
    delay(100);
  }

  showMessage("Stampa STATUS...", TFT_YELLOW);

  // Reset stampante
  printerSerial.write(0x1B); printerSerial.write('@');
  delay(100);

  // Titolo
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(1);  // bold ON
  printerSerial.println("=== STATUS REPORT ===");
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(0);  // bold OFF
  printerSerial.println();

  // Firmware
  printerSerial.print("Firmware: v");
  printerSerial.println(FIRMWARE_VERSION);

  // Uptime
  unsigned long uptime = millis() / 1000;
  int hours = uptime / 3600;
  int mins = (uptime % 3600) / 60;
  int secs = uptime % 60;
  printerSerial.print("Uptime: ");
  printerSerial.print(hours);
  printerSerial.print("h ");
  printerSerial.print(mins);
  printerSerial.print("m ");
  printerSerial.print(secs);
  printerSerial.println("s");

  // WiFi
  printerSerial.print("WiFi: ");
  if (wifiOK && WiFi.status() == WL_CONNECTED) {
    printerSerial.println("OK");
    printerSerial.print("  SSID: ");
    printerSerial.println(WiFi.SSID());
    printerSerial.print("  IP: ");
    printerSerial.println(WiFi.localIP());
    printerSerial.print("  RSSI: ");
    printerSerial.print(WiFi.RSSI());
    printerSerial.println(" dBm");
  } else {
    printerSerial.println("ERRORE");
  }

  // NTP
  printerSerial.print("NTP: ");
  if (ntpSynced) {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      char timeBuf[20];
      sprintf(timeBuf, "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      printerSerial.println(timeBuf);
    } else {
      printerSerial.println("Errore lettura");
    }
  } else {
    printerSerial.println("Non sincronizzato");
  }

  // Polling interval attuale
  printerSerial.print("Poll interval: ");
  int interval = getPollInterval();
  if (interval >= 60000) {
    printerSerial.print(interval / 60000);
    printerSerial.println(" min");
  } else {
    printerSerial.print(interval / 1000.0, 1);
    printerSerial.println(" sec");
  }

  // SD Card
  printerSerial.print("SD Card: ");
  printerSerial.println(sdOK ? "OK" : "ERRORE");

  // Schede in memoria
  printerSerial.print("Schede in RAM: ");
  printerSerial.println(numSchede);

  // History stampe
  printerSerial.print("Schede stampate: ");
  printerSerial.println(historyCount);

  // Last timestamp
  printerSerial.print("Last TS: ");
  printerSerial.println(lastKnownTimestamp);

  // Free heap
  printerSerial.print("Free heap: ");
  printerSerial.print(ESP.getFreeHeap() / 1024);
  printerSerial.println(" KB");

  printerSerial.println();
  printerSerial.println("=====================");

  // Avanza carta
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(40);

  showMessage("STATUS stampato", TFT_GREEN);
  delay(1500);
  drawList();
}

// Esegue un comando remoto ricevuto via M1
void executeRemoteCommand(const char* cmd) {
  debugPrint("[CMD] Esecuzione: ");
  debugPrintln(cmd);

  // Riaccendi schermo se spento
  if (!screenOn) {
    screenOn = true;
    digitalWrite(TFT_BL, HIGH);
    delay(100);
  }

  // REBOOT
  if (strcmp(cmd, "REBOOT") == 0) {
    showMessage("REBOOT remoto...", TFT_YELLOW);
    delay(1000);
    ESP.restart();
    return;
  }

  // OTA
  if (strcmp(cmd, "OTA") == 0) {
    showMessage("OTA remoto...", TFT_YELLOW);
    delay(500);
    if (performOTAUpdate()) {
      // Se OTA riesce, il dispositivo si riavvia automaticamente
    } else {
      showMessage("OTA fallito!", TFT_RED);
      delay(2000);
      drawList();
    }
    return;
  }

  // STATUS
  if (strcmp(cmd, "STATUS") == 0) {
    printStatusReport();
    return;
  }

  // PRINT:XX/XXXX - Forza stampa di una scheda specifica
  if (strncmp(cmd, "PRINT:", 6) == 0) {
    const char* numero = cmd + 6;  // Salta "PRINT:"
    debugPrint("[CMD] Forza stampa scheda: ");
    debugPrintln(numero);

    showMessage("Ricerca scheda...", TFT_YELLOW);

    // Cerca la scheda nella lista
    bool found = false;
    for (int i = 0; i < numSchede; i++) {
      if (strcmp(schede[i].numero, numero) == 0) {
        found = true;

        // Stampa tutte le etichette di questa scheda
        int numEtichette = max(1, schede[i].numAttrezzi);
        for (int j = 0; j < numEtichette; j++) {
          char msg[40];
          sprintf(msg, "Stampa %s (%d/%d)", numero, j + 1, numEtichette);
          showMessage(msg, TFT_CYAN);
          printEtichetta(schede[i], j, numEtichette);

          if (j < numEtichette - 1) {
            delay(3000);  // Pausa tra etichette
          }
        }

        showMessage("Stampa forzata OK", TFT_GREEN);
        delay(1500);
        break;
      }
    }

    if (!found) {
      char msg[40];
      sprintf(msg, "%s non trovata", numero);
      showMessage(msg, TFT_RED);
      debugPrint("[CMD] Scheda non trovata: ");
      debugPrintln(numero);
      delay(2000);
    }

    drawList();
    return;
  }

  // Comando non riconosciuto
  debugPrint("[CMD] Comando sconosciuto: ");
  debugPrintln(cmd);
  showMessage("Cmd sconosciuto", TFT_RED);
  delay(1500);
  drawList();
}

// Task di polling su core 0 (loop principale gira su core 1)
void pollTask(void* parameter) {
  debugPrintln("[TASK] Poll task avviato su core 0");

  unsigned long lastWifiCheck = 0;

  for (;;) {
    unsigned long now = millis();

    // Se WiFi disconnesso, prova a riconnettersi ogni 60s
    if (WiFi.status() != WL_CONNECTED) {
      wifiOK = false;
      wifiError = true;
      showWifiStatus = true;

      if (now - lastWifiCheck >= WIFI_RETRY_INTERVAL) {
        lastWifiCheck = now;
        tryReconnectWifi();
      }
    }

    // Polling ottimizzato: singola chiamata che verifica E stampa
    if (wifiOK && !newSchedeReady) {
      int result = pollAndPrint();

      if (result == 1) {
        // Stampata nuova scheda, aggiorna CSV in background
        debugPrintln("[TASK] Aggiorno CSV in background...");

        for (int retry = 0; retry < 10; retry++) {
          vTaskDelay(10000 / portTICK_PERIOD_MS);

          debugPrint("[TASK] CSV tentativo ");
          debugPrint(retry + 1);
          debugPrintln("/10");

          if (downloadCSV()) {
            parseCSV(csvData);

            // Verifica che CSV contenga la scheda stampata
            if (lastFastPrintNumero[0] != '\0') {
              if (!isSchedaInList(lastFastPrintNumero)) {
                debugPrint("[TASK] CSV non contiene ancora ");
                debugPrintln(lastFastPrintNumero);
                continue;
              }
              debugPrint("[TASK] CSV sincronizzato con ");
              debugPrintln(lastFastPrintNumero);
            }

            // Verifica altre schede non stampate
            int newCount = 0;
            for (int i = 0; i < numSchede; i++) {
              if (!isAlreadyPrinted(schede[i].numero)) {
                newCount++;
              }
            }

            if (newCount > 0) {
              debugPrint("[TASK] Trovate altre ");
              debugPrint(newCount);
              debugPrintln(" schede da stampare");
              newSchedeReady = true;
            } else {
              debugPrint("[TASK] Lista sincronizzata (");
              debugPrint(numSchede);
              debugPrintln(" schede)");
              newSchedeReady = true;
            }

            lastFastPrintNumero[0] = '\0';
            break;
          }
        }

        lastFastPrintNumero[0] = '\0';
      }
    }
    // Polling dinamico basato su fascia oraria
    // In modalità debug stampa su carta: polling più lento per risparmiare carta
    int pollDelay = debugPrintMode ? 5000 : getPollInterval();
    vTaskDelay(pollDelay / portTICK_PERIOD_MS);
  }
}

// ===== UI DISPLAY =====
void drawButtons() {
  // Pannello pulsanti a destra (landscape 320x240)
  int panelX = 320 - BUTTON_PANEL_WIDTH;
  int btnHeight = 80;  // Altezza di ogni pulsante (240 / 3)

  // Sfondo pannello (bordo grigio)
  tft.fillRect(panelX, 0, BUTTON_PANEL_WIDTH, 240, TFT_DARKGREY);

  // Pulsante SU (in alto) - sfondo nero, triangolo bianco
  tft.fillRect(panelX + 1, 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  int centerX = panelX + BUTTON_PANEL_WIDTH / 2;
  int centerY1 = btnHeight / 2;
  tft.fillTriangle(
    centerX - 15, centerY1 + 10,   // punta basso sx
    centerX, centerY1 - 12,        // punta alto centro
    centerX + 15, centerY1 + 10,   // punta basso dx
    TFT_WHITE
  );

  // Pulsante OK (centro) - sfondo nero, testo bianco
  tft.fillRect(panelX + 1, btnHeight + 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(panelX + 10, btnHeight + btnHeight / 2 - 8);
  tft.print("OK");

  // Pulsante GIU (in basso) - sfondo nero, triangolo bianco
  tft.fillRect(panelX + 1, btnHeight * 2 + 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  int centerY3 = btnHeight * 2 + btnHeight / 2;
  tft.fillTriangle(
    centerX - 15, centerY3 - 10,  // punta alto sx
    centerX, centerY3 + 12,       // punta basso centro
    centerX + 15, centerY3 - 10,  // punta alto dx
    TFT_WHITE
  );
}

void drawList() {
  // Area lista (landscape: sotto header, a sinistra dei pulsanti)
  // Scrollbar a sinistra, poi lista, poi pulsanti a destra
  int listTop = HEADER_HEIGHT;
  int listX = SCROLLBAR_WIDTH + 2;  // Dopo scrollbar + gap
  int listWidth = 320 - BUTTON_PANEL_WIDTH - listX;
  int listHeight = 240 - HEADER_HEIGHT;

  // Pulisci area scrollbar + lista
  tft.fillRect(0, listTop, 320 - BUTTON_PANEL_WIDTH, listHeight, TFT_BLACK);

  // Usa font built-in numero 2 (piccolo, proporzionale)
  tft.setTextFont(2);
  tft.setTextSize(1);

  for (int i = 0; i < VISIBLE_ROWS && (scrollOffset + i) < numSchede; i++) {
    int idx = scrollOffset + i;
    Scheda& s = schede[idx];

    // Altezza alternata 20/21px (media 20.5px)
    int y = listTop + 4 + (i * 41) / 2;  // 41/2 = 20.5 in media
    int rowH = (i % 2 == 0) ? 20 : 21;

    // Riga selezionata = sfondo bianco, testo nero
    if (idx == selectedIndex) {
      tft.fillRect(listX, y - 2, listWidth - 2, rowH, TFT_WHITE);
      tft.setTextColor(TFT_BLACK, TFT_WHITE);
    } else {
      tft.setTextColor(s.completato ? TFT_DARKGREY : TFT_WHITE, TFT_BLACK);
    }

    // Numero + Cliente
    tft.setCursor(listX + 2, y);
    tft.print(s.numero);
    tft.print(" ");

    String cliente = String(s.cliente);
    // Troncamento: "COSTRUZIONI TAGLIAMENTO SRL" -> "COSTRUZIONI TAGLIAMENTO S."
    // 26 caratteri max per cliente (dopo numero 7 char + spazio)
    if (cliente.length() > 26) {
      cliente = cliente.substring(0, 25) + ".";
    }
    tft.print(cliente);

    // Indicatore stato completato
    if (s.completato) {
      tft.setTextColor(TFT_GREEN, idx == selectedIndex ? TFT_WHITE : TFT_BLACK);
      tft.setCursor(listX + listWidth - 16, y);
      tft.print("V");
    }
  }

  // Torna al font di default
  tft.setTextFont(1);

  // Scrollbar a sinistra (margine libero)
  if (numSchede > VISIBLE_ROWS) {
    int barHeight = (listHeight * VISIBLE_ROWS) / numSchede;
    if (barHeight < 10) barHeight = 10;
    int scrollRange = listHeight - barHeight;
    int barY = listTop + (scrollOffset * scrollRange) / max(1, numSchede - VISIBLE_ROWS);
    tft.fillRect(0, listTop, SCROLLBAR_WIDTH, listHeight, TFT_DARKGREY);
    tft.fillRect(0, barY, SCROLLBAR_WIDTH, barHeight, TFT_WHITE);
  } else {
    tft.fillRect(0, listTop, SCROLLBAR_WIDTH, listHeight, TFT_DARKGREY);
  }
}

void drawHeader() {
  // Header in alto (landscape: larghezza fino ai pulsanti)
  int headerWidth = 320 - BUTTON_PANEL_WIDTH;
  tft.fillRect(0, 0, headerWidth, HEADER_HEIGHT, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  // Centro orizzontale nell'area header
  tft.setCursor((headerWidth - 132) / 2, (HEADER_HEIGHT - 16) / 2);
  tft.print("EM Maranzan");

  // Linea separatore
  tft.drawFastHLine(0, HEADER_HEIGHT - 1, headerWidth, TFT_DARKGREY);
}

void showMessage(const char* msg, uint16_t color) {
  // Se messaggio vuoto, ridisegna la lista per ripristinare l'area
  if (msg[0] == '\0') {
    drawList();
    return;
  }
  // Mostra messaggio temporaneo in basso (dopo scrollbar, prima dei pulsanti)
  int msgX = SCROLLBAR_WIDTH + 2;  // Dopo scrollbar + gap
  int msgY = 240 - 20;
  int msgWidth = 320 - BUTTON_PANEL_WIDTH - msgX;
  tft.fillRect(msgX, msgY, msgWidth, 20, TFT_BLACK);
  tft.setTextColor(color, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(msgX + 3, msgY + 6);
  tft.print(msg);
}

// ===== MODALITA' INSERIMENTO MANUALE =====

// Inizializza numero manuale con la scheda più recente
void initManualNumero() {
  if (numSchede > 0) {
    strncpy(manualNumero, schede[0].numero, 7);
    manualNumero[7] = '\0';
  } else {
    strcpy(manualNumero, "26/0001");
  }
  manualCursorPos = 0;
}

// Mappa posizione cursore logica (0-5) a posizione stringa (0-6, salta /)
int cursorToStringPos(int cursorPos) {
  if (cursorPos < 2) return cursorPos;  // 0,1 -> 0,1
  return cursorPos + 1;  // 2,3,4,5 -> 3,4,5,6
}

// Disegna UI modalità inserimento manuale
void drawManualInput() {
  // Pulisci area centrale (landscape: a sinistra dei pulsanti)
  int areaWidth = 320 - BUTTON_PANEL_WIDTH;
  int areaTop = HEADER_HEIGHT;
  int areaHeight = 240 - areaTop;
  tft.fillRect(0, areaTop, areaWidth, areaHeight, TFT_BLACK);

  // Numero grande centrato
  tft.setTextSize(4);  // Font grande

  // Calcola larghezza totale: 7 caratteri × 24px = 168px
  int charWidth = 24;
  int totalWidth = 7 * charWidth;
  int startX = (areaWidth - totalWidth) / 2;
  int numY = areaTop + (areaHeight / 2) - 40;

  // Disegna ogni carattere
  for (int i = 0; i < 7; i++) {
    int x = startX + i * charWidth;
    int logicalPos = (i < 2) ? i : (i > 2 ? i - 1 : -1);  // -1 per /
    bool isSelected = (logicalPos == manualCursorPos);

    if (isSelected) {
      // Sfondo bianco, testo nero (come riga selezionata nella lista)
      tft.fillRect(x - 2, numY - 4, charWidth, 36, TFT_WHITE);
      tft.setTextColor(TFT_BLACK, TFT_WHITE);
    } else {
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
    }

    tft.setCursor(x, numY);
    tft.print(manualNumero[i]);
  }

  // Istruzioni
  tft.setTextSize(1);
  tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
  int instrY = numY + 55;
  int instrX = (areaWidth - 150) / 2;
  tft.setCursor(instrX, instrY);
  tft.print("Frecce: cambia cifra");
  tft.setCursor(instrX, instrY + 15);
  tft.print("OK: prossima / stampa");
  tft.setCursor(instrX, instrY + 30);
  tft.print("OK 2s: annulla");
}

// Cambia cifra corrente (su/giù)
void changeManualDigit(int delta) {
  int strPos = cursorToStringPos(manualCursorPos);
  char c = manualNumero[strPos];

  if (c >= '0' && c <= '9') {
    int digit = c - '0';
    digit = (digit + delta + 10) % 10;  // Wrap 0-9
    manualNumero[strPos] = '0' + digit;
  }

  drawManualInput();
}

// Avanza cursore o stampa
void advanceManualCursor() {
  manualCursorPos++;

  if (manualCursorPos >= 6) {
    // Ultima posizione raggiunta, cerca e stampa
    tryPrintManualScheda();
  } else {
    drawManualInput();
  }
}

// Cerca scheda nel CSV su SD e stampa
void tryPrintManualScheda() {
  showMessage("Ricerca scheda...", TFT_YELLOW);
  debugPrint("[MANUAL] Cerco scheda: ");
  debugPrintln(manualNumero);

  if (!sdOK) {
    debugPrintln("[MANUAL] SD non disponibile");
    showMessage("SD non disponibile!", TFT_RED);
    delay(2000);
    manualCursorPos = 0;  // Torna alla prima cifra
    drawManualInput();
    return;
  }

  File f = SD.open("/riparazioni.csv", FILE_READ);
  if (!f) {
    debugPrintln("[MANUAL] File CSV non trovato");
    showMessage("File CSV non trovato!", TFT_RED);
    delay(2000);
    manualCursorPos = 0;  // Torna alla prima cifra
    drawManualInput();
    return;
  }

  debugPrint("[MANUAL] File aperto, dimensione: ");
  debugPrintln(f.size());

  bool found = false;
  Scheda s;
  memset(&s, 0, sizeof(Scheda));

  // Salta header
  if (f.available()) {
    f.readStringUntil('\n');
  }

  int lineCount = 0;

  // Cerca la riga con il numero corrispondente
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    lineCount++;

    if (line.length() == 0) continue;

    // Estrai il numero (primo campo)
    String numero = getCSVField(line, 0);

    if (numero.equals(manualNumero)) {
      // Trovata! Parsa la riga
      debugPrint("[MANUAL] Scheda trovata alla riga ");
      debugPrintln(lineCount);

      strncpy(s.numero, numero.c_str(), sizeof(s.numero) - 1);
      strncpy(s.data, getCSVField(line, 1).c_str(), sizeof(s.data) - 1);
      strncpy(s.cliente, getCSVField(line, 2).c_str(), sizeof(s.cliente) - 1);
      strncpy(s.indirizzo, getCSVField(line, 3).c_str(), sizeof(s.indirizzo) - 1);
      strncpy(s.telefono, getCSVField(line, 4).c_str(), sizeof(s.telefono) - 1);

      // Parse attrezzi (campo 6)
      String attrezziJson = getCSVField(line, 6);
      parseAttrezziJSON(attrezziJson, s);

      found = true;
      break;
    }
  }

  f.close();
  debugPrint("[MANUAL] Righe lette: ");
  debugPrint(lineCount);
  debugPrint(", trovata: ");
  debugPrintln(found ? "SI" : "NO");

  if (found) {
    // Stampa
    int numEtichette = max(1, s.numAttrezzi);
    for (int i = 0; i < numEtichette; i++) {
      char msg[32];
      sprintf(msg, "Stampa %s (%d/%d)", s.numero, i + 1, numEtichette);
      showMessage(msg, TFT_CYAN);
      printEtichetta(s, i, numEtichette);

      if (i < numEtichette - 1) {
        for (int sec = 8; sec > 0; sec--) {
          char countdown[32];
          sprintf(countdown, "Prossima in %ds...", sec);
          showMessage(countdown, TFT_CYAN);
          delay(1000);
        }
      }
    }

    showMessage("Stampa completata!", TFT_GREEN);
    delay(1500);

    // Esci dalla modalità manuale
    manualInputMode = false;
    tft.fillScreen(TFT_BLACK);
    drawHeader();
    drawList();
    drawButtons();

  } else {
    debugPrintln("[MANUAL] Scheda non trovata");
    showMessage("Scheda non trovata!", TFT_RED);
    delay(2000);
    manualCursorPos = 0;  // Torna alla prima cifra
    drawManualInput();
  }
}

// Entra in modalità inserimento manuale
void enterManualInputMode() {
  manualInputMode = true;
  initManualNumero();
  lastManualActivity = millis();  // Inizializza timer inattività

  debugPrintln("[MANUAL] Modalità inserimento manuale attivata");

  tft.fillScreen(TFT_BLACK);
  drawHeader();
  drawManualInput();
  drawButtons();
}

// Esci dalla modalità inserimento manuale
void exitManualInputMode() {
  manualInputMode = false;

  debugPrintln("[MANUAL] Modalità inserimento manuale disattivata");

  tft.fillScreen(TFT_BLACK);
  drawHeader();
  drawList();
  drawButtons();
}

// ===== FORMATTA DATA gg.mm.aa =====
String formatDate(const char* isoDate) {
  // Input: "2025-01-21" -> Output: "21.01.25"
  String d = String(isoDate);
  if (d.length() >= 10) {
    return d.substring(8, 10) + "." + d.substring(5, 7) + "." + d.substring(2, 4);
  }
  return d;
}

// ===== STAMPA SINGOLA ETICHETTA =====
void printEtichetta(Scheda& s, int attrezzoIdx, int totAttrezzi) {
  // Reset completo stampante e svuota buffer
  printerSerial.flush();
  while (printerSerial.available()) printerSerial.read();  // Svuota buffer RX

  printerSerial.write(0x1B); printerSerial.write('@');  // ESC @ = reset
  delay(100);  // Attesa più lunga per reset completo

  // Assicura stato pulito: disattiva tutto esplicitamente
  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(0);  // reverse OFF
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(0);  // bold OFF
  printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);  // font normale
  printerSerial.flush();
  delay(50);

  // === NUMERO SCHEDA (bold, reverse, riga nera) ===
  // Usa sempre 31 caratteri per evitare wrap da byte spurio occasionale
  const int rowWidth = 31;

  String numStr = String(s.numero);
  if (totAttrezzi > 1) {
    numStr += " (" + String(attrezzoIdx + 1) + "/" + String(totAttrezzi) + ")";
  }

  // Centra il testo nella riga di 31 caratteri
  int padding = (rowWidth - numStr.length()) / 2;
  if (padding < 0) padding = 0;

  char rigaNera[32];
  memset(rigaNera, ' ', rowWidth);
  rigaNera[rowWidth] = '\0';
  // Copia il numero al centro
  for (int i = 0; i < (int)numStr.length() && (padding + i) < rowWidth; i++) {
    rigaNera[padding + i] = numStr[i];
  }

  // Attiva bold, flush, delay, poi reverse
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(1);  // bold ON
  printerSerial.flush();
  delay(30);

  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(1);  // reverse ON
  printerSerial.flush();
  delay(30);

  // Stampa carattere per carattere
  for (int i = 0; i < rowWidth; i++) {
    printerSerial.write(rigaNera[i]);
  }
  printerSerial.flush();
  delay(20);

  // Disattiva reverse, poi bold, poi newline
  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(0);  // reverse OFF
  printerSerial.flush();
  delay(20);

  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(0);  // bold OFF
  printerSerial.flush();
  delay(20);

  // Newline in stato completamente pulito
  printerSerial.println();

  // Spazio 1mm (ESC J 7)
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(7);

  // === Cliente (normale, max 32 char) + eventuale " - DDT" ===
  String clienteStr = String(s.cliente);
  if (s.ddt) {
    // Se DDT presente, aggiungi " - DDT" (6 caratteri)
    // Max 32 char totali: cliente max 32-6=26, poi " - DDT"
    if (clienteStr.length() > 26) {
      clienteStr = clienteStr.substring(0, 25) + ".";
    }
    clienteStr += " - DDT";
  } else {
    // Senza DDT: max 32 char
    if (clienteStr.length() > 32) {
      clienteStr = clienteStr.substring(0, 31) + ".";
    }
  }
  printerSerial.println(clienteStr);

  // === Data - Telefono - Indirizzo (condensato) ===
  printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);  // font condensato

  bool hasTel = strlen(s.telefono) > 0;
  bool hasInd = strlen(s.indirizzo) > 0;

  printerSerial.print(formatDate(s.data));
  if (hasTel) {
    printerSerial.print(" - ");
    printerSerial.print(s.telefono);
  }
  if (hasInd) {
    printerSerial.print(" - ");
    printerSerial.print(s.indirizzo);
  }
  printerSerial.println();

  printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);  // font normale

  // Spazio 1mm
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(7);

  // === Attrezzo - Dotazione (max 32 caratteri) ===
  if (attrezzoIdx < s.numAttrezzi) {
    Attrezzo& a = s.attrezzi[attrezzoIdx];

    if (strlen(a.marca) > 0) {
      String attrezzoLine = String(a.marca);
      bool hasDotazione = strlen(a.dotazione) > 0;

      if (hasDotazione) {
        // "marca - dotazione" deve stare in 32 char
        // Se troppo lungo, tronca la marca e aggiungi "."
        String separator = " - ";
        String dotazione = String(a.dotazione);
        int totalLen = attrezzoLine.length() + separator.length() + dotazione.length();

        if (totalLen > 32) {
          // Calcola spazio disponibile per la marca
          // marca + " - " + dotazione <= 32
          // marca <= 32 - 3 - dotazione.length() - 1 (per il punto)
          int maxMarcaLen = 32 - separator.length() - dotazione.length() - 1;
          if (maxMarcaLen < 1) maxMarcaLen = 1;
          attrezzoLine = attrezzoLine.substring(0, maxMarcaLen) + ".";
        }
        attrezzoLine += separator + dotazione;
      } else {
        // Solo marca, tronca a 32 se necessario
        if (attrezzoLine.length() > 32) {
          attrezzoLine = attrezzoLine.substring(0, 31) + ".";
        }
      }

      printerSerial.println(attrezzoLine);
    }

    // Note (condensato)
    if (strlen(a.note) > 0) {
      printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1);  // font condensato
      printerSerial.println(a.note);
      printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);  // font normale
    }
  }

  // Feed carta per staccare etichetta (solo line feed, no spazio extra)
  printerSerial.write(0x0A);
  printerSerial.write(0x0A);
  printerSerial.write(0x0A);
}

// ===== STAMPA SCHEDA (multi-etichetta) =====
void printScheda(int index) {
  if (index < 0 || index >= numSchede) return;

  Scheda& s = schede[index];
  int numEtichette = max(1, s.numAttrezzi);

  debugPrint("[PRINT] Stampa scheda ");
  debugPrint(s.numero);
  debugPrint(" - ");
  debugPrint(numEtichette);
  debugPrintln(" etichette");

  for (int i = 0; i < numEtichette; i++) {
    char msg[32];
    if (numEtichette > 1) {
      sprintf(msg, "Stampa %d/%d...", i + 1, numEtichette);
    } else {
      strcpy(msg, "Stampa...");
    }
    showMessage(msg, TFT_YELLOW);

    printEtichetta(s, i, numEtichette);

    // Pausa tra etichette multiple
    if (i < numEtichette - 1) {
      for (int sec = 8; sec > 0; sec--) {
        char countdown[32];
        sprintf(countdown, "Prossima in %ds...", sec);
        showMessage(countdown, TFT_CYAN);
        delay(1000);
      }
    }
  }

  debugPrintln("[PRINT] Completato");
  showMessage("Stampa OK!", TFT_GREEN);
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(1000);

  debugPrintln("\n\n=================================");
  debugPrint("T4 Thermal Printer - v");
  debugPrintln(FIRMWARE_VERSION);
  debugPrintln("Auto-print + WiFi + OTA");
  debugPrintln("=================================\n");

  // Pulsanti
  pinMode(BTN_UP, INPUT_PULLUP);
  pinMode(BTN_CENTER, INPUT_PULLUP);
  pinMode(BTN_DOWN, INPUT_PULLUP);

  // Display (landscape: rotazione -90°)
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.init();
  tft.setRotation(1);  // Landscape con pulsanti a destra (ruotato 180° rispetto a rot 3)
  tft.fillScreen(TFT_BLACK);

  // Messaggio avvio con versione (landscape 320x240)
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 100);
  tft.print("Avvio v");
  tft.print(FIRMWARE_VERSION);
  tft.println("...");

  // === Menu pulsanti avvio (OTA / WIFI / SER) per 2 secondi ===
  // Pulsanti a destra in verticale (landscape)
  int panelX = 320 - BUTTON_PANEL_WIDTH;
  int btnHeight = 80;

  // Sfondo pannello
  tft.fillRect(panelX, 0, BUTTON_PANEL_WIDTH, 240, TFT_DARKGREY);

  // Pulsante OTA (in alto = BTN_UP)
  tft.fillRect(panelX + 1, 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(panelX + 8, btnHeight / 2 - 8);
  tft.print("OTA");

  // Pulsante WIFI (centro = BTN_CENTER)
  tft.fillRect(panelX + 1, btnHeight + 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  tft.setCursor(panelX + 2, btnHeight + btnHeight / 2 - 8);
  tft.print("WIFI");

  // Pulsante SER (in basso = BTN_DOWN)
  tft.fillRect(panelX + 1, btnHeight * 2 + 1, BUTTON_PANEL_WIDTH - 2, btnHeight - 2, TFT_BLACK);
  tft.setCursor(panelX + 8, btnHeight * 2 + btnHeight / 2 - 8);
  tft.print("SER");

  // Attendi 2 secondi controllando i pulsanti
  int bootMenuSelection = -1;  // -1 = nessuna selezione
  unsigned long bootMenuStart = millis();
  while (millis() - bootMenuStart < 2000) {
    if (digitalRead(BTN_UP) == LOW) {
      bootMenuSelection = 0;  // OTA (in alto)
      break;
    }
    if (digitalRead(BTN_CENTER) == LOW) {
      bootMenuSelection = 1;  // WIFI (centro)
      break;
    }
    if (digitalRead(BTN_DOWN) == LOW) {
      bootMenuSelection = 2;  // SER (in basso)
      break;
    }
    delay(50);
  }

  // Pulisci area pulsanti
  tft.fillRect(panelX, 0, BUTTON_PANEL_WIDTH, 240, TFT_BLACK);

  // Stampante
  debugPrintln("[INIT] Stampante...");
  printerSerial.begin(19200, SERIAL_8N1, PRINTER_RX, PRINTER_TX);
  delay(100);

  // Imposta densità stampa più alta per carta adesiva più spessa
  // ESC 7 n1 n2 n3: n1=max heating dots (default 7), n2=heating time (default 80), n3=heating interval (default 2)
  // Valori più alti = stampa più scura
  printerSerial.write(0x1B);  // ESC
  printerSerial.write(0x37);  // '7'
  printerSerial.write(11);    // n1: heating dots (max 11, default 7)
  printerSerial.write(120);   // n2: heating time (max 255, default 80) - più alto = più scuro
  printerSerial.write(40);    // n3: heating interval (default 2) - più alto = più lento ma migliore qualità
  printerSerial.flush();
  debugPrintln("[INIT] Stampante densita' aumentata");

  // SD
  debugPrintln("[INIT] SD card...");
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS, sdSPI)) {
    sdOK = true;
    debugPrintln("[OK] SD card");
  } else {
    debugPrintln("[FAIL] SD card");
  }

  // Carica reti WiFi salvate
  loadWifiConfig();

  // Gestisci selezione menu avvio
  if (bootMenuSelection == 1) {
    // WIFI selezionato -> modalità configurazione WiFi
    debugPrintln("[INIT] WIFI selezionato - modalità config WiFi");
    startConfigMode();
    // Non ritorna mai da qui (riavvia dopo config)
  }

  if (bootMenuSelection == 2) {
    // SER selezionato -> modalità debug print
    debugPrintMode = true;
    debugPrintln("[INIT] SER selezionato - DEBUG PRINT MODE ATTIVO");
    // Stampa intestazione debug su carta
    printerSerial.write(0x1B); printerSerial.write('@'); // Reset stampante
    delay(50);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1); // Font condensato
    printerSerial.println("=== DEBUG MODE v" FIRMWARE_VERSION " ===");
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }

  if (bootMenuSelection == 0) {
    // OTA selezionato -> modalità OTA Update
    debugPrintln("[INIT] OTA selezionato - modalità OTA Update");

    // Prima connetti WiFi
    tft.setCursor(10, 130);
    tft.setTextSize(1);
    tft.print("WiFi per OTA...");

    if (tryConnectAllNetworks()) {
      wifiOK = true;
      performOTAUpdate();
      // Se fallisce, continua avvio normale
    } else {
      debugPrintln("[OTA] WiFi non disponibile");
      tft.fillScreen(TFT_BLACK);
      tft.setTextColor(TFT_RED, TFT_BLACK);
      tft.setTextSize(2);
      tft.setCursor(10, 80);
      tft.println("WiFi non disponibile!");
      tft.setTextSize(1);
      tft.setCursor(10, 130);
      tft.println("OTA annullato.");
      tft.setCursor(10, 150);
      tft.println("Avvio normale in 3s...");
      delay(3000);
    }
  }

  // WiFi - tenta connessione a rotazione
  debugPrintln("[INIT] WiFi...");
  tft.setCursor(10, 130);
  tft.setTextSize(1);
  tft.print("WiFi...");

  if (tryConnectAllNetworks()) {
    wifiOK = true;

    // Sincronizza NTP per polling basato su fascia oraria
    debugPrintln("[NTP] Sincronizzazione...");
    configTime(3600, 3600, "pool.ntp.org", "time.google.com");  // GMT+1, DST+1 (Italia)

    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 5000)) {  // Timeout 5 secondi
      ntpSynced = true;
      debugPrint("[NTP] OK: ");
      debugPrint(timeinfo.tm_hour);
      debugPrint(":");
      debugPrintln(timeinfo.tm_min);
    } else {
      debugPrintln("[NTP] Fallito, uso polling conservativo");
    }
  } else {
    debugPrintln("[FAIL] Nessuna rete disponibile");
  }

  // Download CSV
  if (wifiOK) {
    tft.setCursor(10, 150);
    tft.print("Download CSV...");
    debugPrintln("[INIT] Download CSV...");

    HTTPClient http;
    http.begin(CSV_URL);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
      csvData = http.getString();
      debugPrint("[OK] CSV: ");
      debugPrint(csvData.length());
      debugPrintln(" bytes");

      // Salva su SD
      if (sdOK) {
        File f = SD.open("/riparazioni.csv", FILE_WRITE);
        if (f) {
          f.print(csvData);
          f.close();
        }
      }

      // Parse
      parseCSV(csvData);

    } else {
      debugPrint("[FAIL] HTTP: ");
      debugPrintln(httpCode);

      // Prova da SD
      if (sdOK) {
        File f = SD.open("/riparazioni.csv", FILE_READ);
        if (f) {
          csvData = f.readString();
          f.close();
          parseCSV(csvData);
          debugPrintln("[OK] CSV da SD");
        }
      }
    }
    http.end();
  } else if (sdOK) {
    // Offline: carica da SD
    File f = SD.open("/riparazioni.csv", FILE_READ);
    if (f) {
      csvData = f.readString();
      f.close();
      parseCSV(csvData);
      debugPrintln("[OK] CSV da SD (offline)");
    }
  }

  // Carica print history
  loadPrintHistory();

  // Segna tutte le schede correnti come già stampate
  // (all'avvio non vogliamo ristampare tutto)
  markAllAsPrinted();

  // Leggi timestamp iniziale per polling (se WiFi OK)
  if (wifiOK) {
    lastKnownTimestamp = fetchLastUpdate();
    debugPrint("[POLL] Timestamp iniziale: ");
    debugPrintln(lastKnownTimestamp);
  }

  // Avvia SEMPRE task di polling su core 0 (gestisce anche retry WiFi)
  xTaskCreatePinnedToCore(
    pollTask,           // Funzione
    "PollTask",         // Nome
    8192,               // Stack size
    NULL,               // Parametri
    1,                  // Priorità
    &pollTaskHandle,    // Handle
    0                   // Core 0
  );

  // Disegna UI
  tft.fillScreen(TFT_BLACK);
  drawHeader();
  drawList();
  drawButtons();

  // Inizializza timer screen sleep
  lastButtonActivity = millis();

  debugPrintln("\n[READY] Auto-print attivo (dual-core)");
}

// ===== LOOP =====
void loop() {
  static bool lastUp = HIGH;
  static bool lastCenter = HIGH;
  static bool lastDown = HIGH;
  static unsigned long btnCenterPressed = 0;
  static bool centerLongPressHandled = false;

  bool currUp = digitalRead(BTN_UP);
  bool currCenter = digitalRead(BTN_CENTER);
  bool currDown = digitalRead(BTN_DOWN);

  bool needRedraw = false;
  unsigned long now = millis();

  // === Gestione screen sleep ===
  bool anyButtonPressed = (currUp == LOW || currCenter == LOW || currDown == LOW);

  if (anyButtonPressed) {
    lastButtonActivity = now;

    // Risveglia schermo se spento
    if (!screenOn) {
      printFromSleep = true;  // Prima stampa dopo sleep userà 31 caratteri
      screenOn = true;
      digitalWrite(TFT_BL, HIGH);
      debugPrintln("[SCREEN] Riattivato");
      // Aspetta che tutti i pulsanti vengano rilasciati prima di continuare
      while (digitalRead(BTN_UP) == LOW || digitalRead(BTN_CENTER) == LOW || digitalRead(BTN_DOWN) == LOW) {
        delay(10);
      }
      // Reset stati pulsanti per evitare azioni indesiderate
      lastUp = HIGH;
      lastCenter = HIGH;
      lastDown = HIGH;
      delay(100);  // Delay più lungo per stabilizzazione
      return;
    }
  }

  // Spegni schermo dopo timeout
  if (screenOn && (now - lastButtonActivity >= SCREEN_TIMEOUT)) {
    screenOn = false;
    digitalWrite(TFT_BL, LOW);
    debugPrintln("[SCREEN] Sleep");
  }

  // === Mostra stato WiFi/connessione ===
  if (showWifiStatus && !manualInputMode) {
    showWifiStatus = false;
    if (!wifiOK) {
      showMessage("WiFi disconnesso", TFT_RED);
    } else if (wifiError) {
      showMessage("Errore connessione", TFT_ORANGE);
    } else {
      showMessage("Connesso", TFT_GREEN);
      delay(1500);
      showMessage("", TFT_BLACK);
    }
  }

  // === Nuove schede pronte dal task di polling ===
  if (newSchedeReady && !manualInputMode) {
    newSchedeReady = false;
    debugPrintln("[LOOP] Processo nuove schede...");

    // Riaccendi schermo per mostrare stampa
    if (!screenOn) {
      printFromSleep = true;  // Segnala a printEtichetta di usare 31 caratteri
      screenOn = true;
      digitalWrite(TFT_BL, HIGH);
      delay(100);
      lastButtonActivity = now;
    }

    showMessage("Nuove schede!", TFT_CYAN);
    autoPrintNewSchede();
    drawList();
  }

  // ============================================
  // MODALITA' INSERIMENTO MANUALE
  // ============================================
  if (manualInputMode) {
    // === Timeout inattività 20s ===
    if (now - lastManualActivity >= MANUAL_TIMEOUT_MS) {
      debugPrintln("[MANUAL] Timeout inattività");
      exitManualInputMode();
      lastUp = currUp;
      lastCenter = currCenter;
      lastDown = currDown;
      return;
    }

    // === Long press CENTER per uscire ===
    if (currCenter == LOW) {
      if (lastCenter == HIGH) {
        btnCenterPressed = now;
        centerLongPressHandled = false;
        lastManualActivity = now;  // Reset timer
      } else if (!centerLongPressHandled && (now - btnCenterPressed >= MANUAL_LONG_PRESS_MS)) {
        // Long press: esci dalla modalità
        centerLongPressHandled = true;
        exitManualInputMode();
      }
    }

    // === Short press CENTER: avanza cursore ===
    if (currCenter == HIGH && lastCenter == LOW && !centerLongPressHandled) {
      lastManualActivity = now;  // Reset timer
      advanceManualCursor();
    }

    // === SU (UP button): incrementa cifra ===
    if (currUp == LOW && lastUp == HIGH) {
      lastManualActivity = now;  // Reset timer
      changeManualDigit(1);
    }

    // === GIU (DOWN button): decrementa cifra ===
    if (currDown == LOW && lastDown == HIGH) {
      lastManualActivity = now;  // Reset timer
      changeManualDigit(-1);
    }

    lastUp = currUp;
    lastCenter = currCenter;
    lastDown = currDown;
    delay(30);
    return;
  }

  // ============================================
  // MODALITA' LISTA NORMALE
  // ============================================

  // === Long press CENTER per entrare in modalità manuale ===
  if (currCenter == LOW) {
    if (lastCenter == HIGH) {
      btnCenterPressed = now;
      centerLongPressHandled = false;
    } else if (!centerLongPressHandled && (now - btnCenterPressed >= MANUAL_LONG_PRESS_MS)) {
      // Long press: entra in modalità inserimento manuale
      centerLongPressHandled = true;
      enterManualInputMode();
      lastUp = currUp;
      lastCenter = currCenter;
      lastDown = currDown;
      return;
    }
  }

  // === SU (UP button) ===
  if (currUp == LOW) {
    if (lastUp == HIGH) {
      // Appena premuto: muovi di 1
      if (selectedIndex > 0) {
        selectedIndex--;
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        }
        needRedraw = true;
      }
      btnUpPressed = now;
      lastPageSkip = now;
    } else if (now - btnUpPressed >= LONG_PRESS_MS && now - lastPageSkip >= LONG_PRESS_MS) {
      // Long press: muovi di 10
      int newIdx = selectedIndex - 10;
      if (newIdx < 0) newIdx = 0;
      if (newIdx != selectedIndex) {
        selectedIndex = newIdx;
        scrollOffset = max(0, selectedIndex - VISIBLE_ROWS / 2);
        needRedraw = true;
      }
      lastPageSkip = now;
    }
  }

  // === GIU (DOWN button) ===
  if (currDown == LOW) {
    if (lastDown == HIGH) {
      // Appena premuto: muovi di 1
      if (selectedIndex < numSchede - 1) {
        selectedIndex++;
        if (selectedIndex >= scrollOffset + VISIBLE_ROWS) {
          scrollOffset = selectedIndex - VISIBLE_ROWS + 1;
        }
        needRedraw = true;
      }
      btnDownPressed = now;
      lastPageSkip = now;
    } else if (now - btnDownPressed >= LONG_PRESS_MS && now - lastPageSkip >= LONG_PRESS_MS) {
      // Long press: muovi di 10
      int newIdx = selectedIndex + 10;
      if (newIdx >= numSchede) newIdx = numSchede - 1;
      if (newIdx != selectedIndex) {
        selectedIndex = newIdx;
        if (selectedIndex >= scrollOffset + VISIBLE_ROWS) {
          scrollOffset = selectedIndex - VISIBLE_ROWS + 1;
        }
        needRedraw = true;
      }
      lastPageSkip = now;
    }
  }

  // === STAMPA (CENTER button short press) ===
  if (currCenter == HIGH && lastCenter == LOW && !centerLongPressHandled) {
    printScheda(selectedIndex);

    // Aggiungi a history se non già presente
    if (!isAlreadyPrinted(schede[selectedIndex].numero)) {
      addToHistory(schede[selectedIndex].numero);
      savePrintHistory();
    }

    delay(1000);
    showMessage("", TFT_BLACK);
  }

  if (needRedraw) {
    drawList();
  }

  lastUp = currUp;
  lastCenter = currCenter;
  lastDown = currDown;

  delay(30);
}
