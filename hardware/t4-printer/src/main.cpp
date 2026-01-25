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
#define FIRMWARE_VERSION "1.4.0"

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

// Pulsanti
#define BTN_LEFT   38   // Su (nella UI lista)
#define BTN_CENTER 37   // Stampa
#define BTN_RIGHT  39   // Giu

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
};

// Array schede (ultime 50)
#define MAX_SCHEDE 50
Scheda schede[MAX_SCHEDE];
int numSchede = 0;

// UI state
int selectedIndex = 0;
int scrollOffset = 0;
#define VISIBLE_ROWS 10
#define ROW_HEIGHT 20
#define BUTTON_HEIGHT 40

// Long press timing
unsigned long btnLeftPressed = 0;
unsigned long btnRightPressed = 0;
unsigned long lastPageSkip = 0;
#define LONG_PRESS_MS 1500

// Stati
bool sdOK = false;
bool wifiOK = false;
String csvData = "";

// Auto-print polling
unsigned long lastKnownTimestamp = 0;
#define POLL_INTERVAL 5000  // 5 secondi

// Task polling su core separato
TaskHandle_t pollTaskHandle = NULL;
volatile bool newSchedeReady = false;  // Flag per comunicare col loop principale

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

  // Mostra su display
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(20, 40);
  tft.println("Aggiornamento");
  tft.setCursor(20, 65);
  tft.println("firmware...");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(20, 100);
  tft.println("Download in corso...");
  tft.setCursor(20, 115);
  tft.print("Versione attuale: ");
  tft.println(FIRMWARE_VERSION);

  // Progress bar
  int barX = 20, barY = 150, barW = 200, barH = 20;
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
    tft.setCursor(20, 200);
    tft.println("Download fallito!");
    tft.setCursor(20, 215);
    tft.print("HTTP: ");
    tft.println(httpCode);
    http.end();
    delay(3000);
    return false;
  }

  if (contentLength <= 0) {
    debugPrintln("[OTA] File non trovato o vuoto");
    tft.setTextColor(TFT_ORANGE, TFT_BLACK);
    tft.setCursor(20, 200);
    tft.println("File non trovato");
    http.end();
    delay(3000);
    return false;
  }

  // Inizia update
  if (!Update.begin(contentLength)) {
    debugPrintln("[OTA] Spazio insufficiente");
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.setCursor(20, 200);
    tft.println("Spazio insufficiente!");
    http.end();
    delay(3000);
    return false;
  }

  Stream* stream = http.getStreamPtr();
  size_t written = 0;
  uint8_t buff[1024];
  int lastPercent = 0;

  tft.setCursor(20, 130);
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
        tft.fillRect(20, 130, 50, 15, TFT_BLACK);
        tft.setCursor(20, 130);
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

      tft.fillRect(20, 200, 220, 40, TFT_BLACK);
      tft.setTextColor(TFT_GREEN, TFT_BLACK);
      tft.setTextSize(2);
      tft.setCursor(20, 200);
      tft.println("Completato!");

      tft.setTextSize(1);
      tft.setCursor(20, 230);
      tft.println("Riavvio in 3 secondi...");

      delay(3000);
      ESP.restart();
      return true;  // Non raggiunto
    }
  }

  debugPrint("[OTA] Errore finale: ");
  debugPrintln(Update.getError());
  tft.setTextColor(TFT_RED, TFT_BLACK);
  tft.setCursor(20, 200);
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

  // Mostra su display
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(20, 60);
  tft.println("Config WiFi");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(20, 100);
  tft.println("Connettiti a:");

  tft.setTextSize(2);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setCursor(20, 120);
  tft.println("EM Maranzan");

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(20, 160);
  tft.println("(nessuna password)");

  tft.setCursor(20, 200);
  tft.println("Si aprira' una pagina");
  tft.setCursor(20, 215);
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
          // Campo 5 = DDT (boolean), skippiamo

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

  // Inverti l'ordine per avere le più recenti prima
  for (int i = 0; i < numSchede / 2; i++) {
    Scheda temp = schede[i];
    schede[i] = schede[numSchede - 1 - i];
    schede[numSchede - 1 - i] = temp;
  }

  // Riattiva log JSON
  suppressJsonLogs = false;

  debugPrint("[CSV] Parsed ");
  debugPrint(numSchede);
  debugPrintln(" schede (ultime, ordine decrescente)");
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

// Fetch timestamp da API - ritorna 0 se errore, setta wifiError
unsigned long fetchLastUpdate() {
  if (WiFi.status() != WL_CONNECTED) {
    debugPrintln("[POLL] WiFi non connesso");
    wifiError = true;
    showWifiStatus = true;
    return 0;
  }

  debugPrintln("[POLL] Fetching timestamp...");

  HTTPClient http;
  String url = String(API_URL) + "?action=getLastUpdate";
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(10000);  // 10 secondi

  int httpCode = http.GET();
  unsigned long ts = 0;

  debugPrint("[POLL] HTTP code: ");
  debugPrintln(httpCode);

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    debugPrint("[POLL] Response: ");
    debugPrintln(response);

    // Parse JSON: {"ts":1234567890}
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    if (!error) {
      // Il timestamp JS è troppo grande per unsigned long (32 bit su ESP32)
      // Usiamo solo parte del valore per confronto
      double tsDouble = doc["ts"] | 0.0;
      ts = (unsigned long)fmod(tsDouble, 1000000000.0);
      debugPrint("[POLL] Parsed ts: ");
      debugPrintln(ts);

      // Connessione OK, resetta errore
      if (wifiError) {
        wifiError = false;
        showWifiStatus = true;
        debugPrintln("[POLL] Connessione ripristinata");
      }
    } else {
      debugPrint("[POLL] JSON error: ");
      debugPrintln(error.c_str());
      wifiError = true;
      showWifiStatus = true;
    }
  } else {
    // Errore HTTP (timeout, connection refused, etc)
    debugPrint("[POLL] HTTP error: ");
    debugPrintln(httpCode);
    wifiError = true;
    showWifiStatus = true;
  }

  http.end();
  return ts;
}

// Fetch rapido ultima scheda via API (per stampa veloce)
// Ritorna true se trovata e stampata una nuova scheda
bool fetchAndPrintLastScheda() {
  if (WiFi.status() != WL_CONNECTED) return false;

  debugPrintln("[FAST] Fetch ultima scheda via API...");
  showMessage("Fetch rapido...", TFT_CYAN);

  HTTPClient http;
  String url = String(API_URL) + "?action=getRiparazioni&limit=1";
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(15000);  // 15 secondi

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

  const char* data = obj["Data Consegna"] | "";
  strncpy(s.data, data, sizeof(s.data) - 1);

  const char* cliente = obj["Cliente"] | "";
  strncpy(s.cliente, cliente, sizeof(s.cliente) - 1);

  const char* indirizzo = obj["Indirizzo"] | "";
  strncpy(s.indirizzo, indirizzo, sizeof(s.indirizzo) - 1);

  const char* telefono = obj["Telefono"] | "";
  strncpy(s.telefono, telefono, sizeof(s.telefono) - 1);

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
    screenOn = true;
    digitalWrite(TFT_BL, HIGH);
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

    // Polling normale se WiFi OK
    if (wifiOK && !newSchedeReady) {
      if (checkTimestampChanged()) {
        debugPrintln("[TASK] Nuova scheda rilevata!");

        // === STAMPA RAPIDA via API (immediata) ===
        // L'API risponde subito, il CSV pubblicato ha delay
        debugPrintln("[TASK] Tentativo stampa rapida via API...");
        bool stampataRapida = fetchAndPrintLastScheda();

        if (stampataRapida) {
          debugPrintln("[TASK] Stampa rapida completata!");
        } else {
          debugPrintln("[TASK] Stampa rapida fallita, attendo CSV...");
        }

        // === AGGIORNAMENTO CSV in background ===
        // Continua a provare finché il CSV non si aggiorna
        debugPrintln("[TASK] Aggiorno CSV in background...");
        vTaskDelay(3000 / portTICK_PERIOD_MS);  // Breve attesa iniziale

        for (int retry = 0; retry < 15; retry++) {
          if (downloadCSV()) {
            parseCSV(csvData);

            // Verifica se ci sono nuove schede non ancora stampate
            int newCount = 0;
            for (int i = 0; i < numSchede; i++) {
              if (!isAlreadyPrinted(schede[i].numero)) {
                newCount++;
              }
            }

            if (newCount > 0) {
              // Ci sono schede non stampate (stampa rapida fallita o multiple schede)
              debugPrint("[TASK] Trovate ");
              debugPrint(newCount);
              debugPrintln(" schede da stampare");
              newSchedeReady = true;
              break;
            } else {
              // CSV aggiornato, nessuna scheda nuova (già stampata via API)
              debugPrintln("[TASK] CSV aggiornato, lista sincronizzata");
              // Aggiorna display con nuova lista
              newSchedeReady = true;  // Trigger redraw lista
              break;
            }
          }

          debugPrint("[TASK] CSV retry ");
          debugPrint(retry + 1);
          debugPrintln("/15");
          vTaskDelay(3000 / portTICK_PERIOD_MS);
        }
      }
    }
    vTaskDelay(POLL_INTERVAL / portTICK_PERIOD_MS);
  }
}

// ===== UI DISPLAY =====
void drawButtons() {
  int btnY = 320 - BUTTON_HEIGHT;
  int btnWidth = 80;

  // Sfondo pulsanti (bordo grigio)
  tft.fillRect(0, btnY, 240, BUTTON_HEIGHT, TFT_DARKGREY);

  // Pulsante SU (sinistra) - sfondo nero, triangolo bianco
  tft.fillRect(1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_BLACK);
  int leftCenter = btnWidth / 2;
  tft.fillTriangle(
    leftCenter - 15, btnY + 28,   // punta basso sx
    leftCenter, btnY + 10,        // punta alto centro
    leftCenter + 15, btnY + 28,   // punta basso dx
    TFT_WHITE
  );

  // Pulsante OK (centro) - sfondo nero, testo bianco
  tft.fillRect(btnWidth + 1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(btnWidth + 28, btnY + 12);
  tft.print("OK");

  // Pulsante GIU (destra) - sfondo nero, triangolo bianco
  tft.fillRect(btnWidth * 2 + 1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_BLACK);
  int rightCenter = btnWidth * 2 + btnWidth / 2;
  tft.fillTriangle(
    rightCenter - 15, btnY + 10,  // punta alto sx
    rightCenter, btnY + 28,       // punta basso centro
    rightCenter + 15, btnY + 10,  // punta alto dx
    TFT_WHITE
  );
}

void drawList() {
  // Area lista (sotto header, sopra pulsanti)
  int listTop = BUTTON_HEIGHT;  // Inizia dopo header (40px)
  int listHeight = 320 - listTop - BUTTON_HEIGHT;
  tft.fillRect(0, listTop, 236, listHeight, TFT_BLACK);  // 236 per non coprire scrollbar

  // Usa font built-in numero 2 (piccolo, proporzionale) size 2
  tft.setTextFont(2);  // Font 2: 16px alto
  tft.setTextSize(1);

  // Offset verticale per creare spazio sopra la prima riga (come una riga vuota)
  int topPadding = ROW_HEIGHT;

  for (int i = 0; i < VISIBLE_ROWS && (scrollOffset + i) < numSchede; i++) {
    int idx = scrollOffset + i;
    Scheda& s = schede[idx];

    int y = listTop + topPadding + i * ROW_HEIGHT;

    // Riga selezionata = sfondo bianco, testo nero
    if (idx == selectedIndex) {
      tft.fillRect(0, y - 1, 234, ROW_HEIGHT, TFT_WHITE);
      tft.setTextColor(TFT_BLACK, TFT_WHITE);
    } else {
      tft.setTextColor(s.completato ? TFT_DARKGREY : TFT_WHITE, TFT_BLACK);
    }

    // Numero + Cliente
    tft.setCursor(2, y);
    tft.print(s.numero);
    tft.print(" ");

    String cliente = String(s.cliente);
    if (cliente.length() > 22) {
      cliente = cliente.substring(0, 21) + ".";
    }
    tft.print(cliente);

    // Indicatore stato completato
    if (s.completato) {
      tft.setTextColor(TFT_GREEN, idx == selectedIndex ? TFT_WHITE : TFT_BLACK);
      tft.setCursor(224, y);
      tft.print("V");
    }
  }

  // Torna al font di default
  tft.setTextFont(1);

  // Scrollbar (occupa tutta l'altezza della lista, a destra)
  if (numSchede > VISIBLE_ROWS) {
    int barHeight = (listHeight * VISIBLE_ROWS) / numSchede;
    if (barHeight < 10) barHeight = 10;
    int scrollRange = listHeight - barHeight;
    int barY = listTop + (scrollOffset * scrollRange) / max(1, numSchede - VISIBLE_ROWS);
    tft.fillRect(236, listTop, 4, listHeight, TFT_DARKGREY);
    tft.fillRect(236, barY, 4, barHeight, TFT_WHITE);
  }
}

void drawHeader() {
  // Header stessa altezza dei pulsanti (BUTTON_HEIGHT = 40)
  tft.fillRect(0, 0, 240, BUTTON_HEIGHT, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  // "EM Maranzan" = 11 caratteri × 12px = 132px
  // Centro orizzontale: (240 - 132) / 2 = 54
  // Centro verticale: (40 - 16) / 2 = 12
  tft.setCursor(54, 12);
  tft.print("EM Maranzan");

  // Linea separatore
  tft.drawFastHLine(0, BUTTON_HEIGHT - 1, 240, TFT_DARKGREY);
}

void showMessage(const char* msg, uint16_t color) {
  // Mostra messaggio temporaneo sopra i pulsanti (non copre scrollbar a destra)
  int msgY = 320 - BUTTON_HEIGHT - 20;
  tft.fillRect(0, msgY, 232, 18, TFT_BLACK);  // 232 invece di 240 per non coprire scrollbar
  tft.setTextColor(color, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(5, msgY + 4);
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
  // Pulisci area centrale (sotto header, sopra pulsanti)
  int areaTop = BUTTON_HEIGHT;  // Usa stessa altezza header
  int areaHeight = 320 - areaTop - BUTTON_HEIGHT;
  tft.fillRect(0, areaTop, 240, areaHeight, TFT_BLACK);

  // Numero grande centrato
  tft.setTextSize(4);  // Font grande

  // Calcola larghezza totale: 7 caratteri × 24px = 168px
  int charWidth = 24;
  int totalWidth = 7 * charWidth;
  int startX = (240 - totalWidth) / 2;
  int numY = areaTop + (areaHeight / 2) - 30;

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
  int instrY = numY + 50;
  tft.setCursor(45, instrY);
  tft.print("Frecce: cambia cifra");
  tft.setCursor(45, instrY + 15);
  tft.print("OK: prossima / stampa");
  tft.setCursor(45, instrY + 30);
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
  // Inizializza
  printerSerial.write(0x1B);
  printerSerial.write('@');
  delay(50);

  // === NUMERO SCHEDA (normale, bold, reverse, riga intera nera) ===
  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(1);  // reverse ON
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(1);  // bold

  // Costruisci stringa centrata con padding per riempire tutta la riga (32 caratteri)
  String numStr = String(s.numero);
  if (totAttrezzi > 1) {
    numStr += " (" + String(attrezzoIdx + 1) + "/" + String(totAttrezzi) + ")";
  }
  int padding = (32 - numStr.length()) / 2;
  for (int p = 0; p < padding; p++) printerSerial.print(" ");
  printerSerial.print(numStr);
  for (int p = 0; p < (32 - padding - numStr.length()); p++) printerSerial.print(" ");
  printerSerial.println();

  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(0);  // reverse OFF
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(0);  // bold off

  // Spazio 1mm (ESC J 7)
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(7);

  // === Cliente (normale) ===
  printerSerial.println(s.cliente);

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

  // === Attrezzo - Dotazione ===
  if (attrezzoIdx < s.numAttrezzi) {
    Attrezzo& a = s.attrezzi[attrezzoIdx];

    if (strlen(a.marca) > 0) {
      printerSerial.print(a.marca);
      if (strlen(a.dotazione) > 0) {
        printerSerial.print(" - ");
        printerSerial.print(a.dotazione);
      }
      printerSerial.println();
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
  pinMode(BTN_LEFT, INPUT_PULLUP);
  pinMode(BTN_CENTER, INPUT_PULLUP);
  pinMode(BTN_RIGHT, INPUT_PULLUP);

  // Display
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.init();
  tft.setRotation(0);
  tft.fillScreen(TFT_BLACK);

  // Messaggio avvio con versione
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 100);
  tft.print("Avvio v");
  tft.print(FIRMWARE_VERSION);
  tft.println("...");

  // Stampante
  debugPrintln("[INIT] Stampante...");
  printerSerial.begin(19200, SERIAL_8N1, PRINTER_RX, PRINTER_TX);

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

  // Controlla pulsanti all'avvio
  delay(100);  // Debounce

  // Pulsante CENTRALE premuto -> modalità configurazione WiFi
  if (digitalRead(BTN_CENTER) == LOW) {
    debugPrintln("[INIT] Pulsante centrale premuto - modalità config WiFi");
    startConfigMode();
    // Non ritorna mai da qui (riavvia dopo config)
  }

  // Pulsante GIU (RIGHT) premuto -> modalità debug print
  if (digitalRead(BTN_RIGHT) == LOW) {
    debugPrintMode = true;
    debugPrintln("[INIT] Pulsante GIU premuto - DEBUG PRINT MODE ATTIVO");
    // Stampa intestazione debug su carta
    printerSerial.write(0x1B); printerSerial.write('@'); // Reset stampante
    delay(50);
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(1); // Font condensato
    printerSerial.println("=== DEBUG MODE v" FIRMWARE_VERSION " ===");
    printerSerial.write(0x1B); printerSerial.write('M'); printerSerial.write(0);
  }

  // Pulsante SU (LEFT) premuto -> OTA Update
  if (digitalRead(BTN_LEFT) == LOW) {
    debugPrintln("[INIT] Pulsante SU premuto - modalità OTA Update");

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
      tft.setCursor(20, 100);
      tft.println("WiFi non");
      tft.setCursor(20, 125);
      tft.println("disponibile!");
      tft.setTextSize(1);
      tft.setCursor(20, 170);
      tft.println("OTA annullato.");
      tft.setCursor(20, 190);
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
  } else {
    debugPrintln("[FAIL] Nessuna rete disponibile");
  }

  // Download CSV
  if (wifiOK) {
    tft.setCursor(10, 145);
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
  static bool lastLeft = HIGH;
  static bool lastCenter = HIGH;
  static bool lastRight = HIGH;
  static unsigned long btnCenterPressed = 0;
  static bool centerLongPressHandled = false;

  bool currLeft = digitalRead(BTN_LEFT);
  bool currCenter = digitalRead(BTN_CENTER);
  bool currRight = digitalRead(BTN_RIGHT);

  bool needRedraw = false;
  unsigned long now = millis();

  // === Gestione screen sleep ===
  bool anyButtonPressed = (currLeft == LOW || currCenter == LOW || currRight == LOW);

  if (anyButtonPressed) {
    lastButtonActivity = now;

    // Risveglia schermo se spento
    if (!screenOn) {
      screenOn = true;
      digitalWrite(TFT_BL, HIGH);
      debugPrintln("[SCREEN] Riattivato");
      // Aspetta che tutti i pulsanti vengano rilasciati prima di continuare
      while (digitalRead(BTN_LEFT) == LOW || digitalRead(BTN_CENTER) == LOW || digitalRead(BTN_RIGHT) == LOW) {
        delay(10);
      }
      // Reset stati pulsanti per evitare azioni indesiderate
      lastLeft = HIGH;
      lastCenter = HIGH;
      lastRight = HIGH;
      delay(50);  // Debounce extra
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
      screenOn = true;
      digitalWrite(TFT_BL, HIGH);
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
      lastLeft = currLeft;
      lastCenter = currCenter;
      lastRight = currRight;
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

    // === SU (LEFT button): incrementa cifra ===
    if (currLeft == LOW && lastLeft == HIGH) {
      lastManualActivity = now;  // Reset timer
      changeManualDigit(1);
    }

    // === GIU (RIGHT button): decrementa cifra ===
    if (currRight == LOW && lastRight == HIGH) {
      lastManualActivity = now;  // Reset timer
      changeManualDigit(-1);
    }

    lastLeft = currLeft;
    lastCenter = currCenter;
    lastRight = currRight;
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
      lastLeft = currLeft;
      lastCenter = currCenter;
      lastRight = currRight;
      return;
    }
  }

  // === SU (LEFT button) ===
  if (currLeft == LOW) {
    if (lastLeft == HIGH) {
      // Appena premuto: muovi di 1
      if (selectedIndex > 0) {
        selectedIndex--;
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        }
        needRedraw = true;
      }
      btnLeftPressed = now;
      lastPageSkip = now;
    } else if (now - btnLeftPressed >= LONG_PRESS_MS && now - lastPageSkip >= LONG_PRESS_MS) {
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

  // === GIU (RIGHT button) ===
  if (currRight == LOW) {
    if (lastRight == HIGH) {
      // Appena premuto: muovi di 1
      if (selectedIndex < numSchede - 1) {
        selectedIndex++;
        if (selectedIndex >= scrollOffset + VISIBLE_ROWS) {
          scrollOffset = selectedIndex - VISIBLE_ROWS + 1;
        }
        needRedraw = true;
      }
      btnRightPressed = now;
      lastPageSkip = now;
    } else if (now - btnRightPressed >= LONG_PRESS_MS && now - lastPageSkip >= LONG_PRESS_MS) {
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

  lastLeft = currLeft;
  lastCenter = currCenter;
  lastRight = currRight;

  delay(30);
}
