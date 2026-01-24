/*
 * Elettromeccanica Maranzan - T4 Thermal Printer
 * Hardware: LilyGo T4 v1.3 + CSN-A2 TTL
 *
 * v0.9 - Auto-print nuove schede + print history
 */

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// WiFi credentials
const char* WIFI_SSID = "FASTWEB-RNHDU3";
const char* WIFI_PASS = "C9FLCJDDRY";

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
unsigned long lastPollTime = 0;
unsigned long lastKnownTimestamp = 0;
#define POLL_INTERVAL 5000  // 5 secondi

// Print history (schede già stampate)
#define MAX_HISTORY 200
char printHistory[MAX_HISTORY][12];  // Array di numeri scheda (es: "26/0021")
int historyCount = 0;

// Forward declarations
void showMessage(const char* msg, uint16_t color);
void drawList();
void printEtichetta(Scheda& s, int attrezzoIdx, int totAttrezzi);

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

  // Debug
  Serial.print("[JSON] Input: ");
  Serial.println(json.substring(0, min((int)json.length(), 80)));

  if (json.length() < 3) {
    Serial.println("[JSON] Troppo corto");
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
    Serial.println("[JSON] Non e' un array, uso come testo");
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
    Serial.print("[JSON] Parse error: ");
    Serial.println(error.c_str());
    // Fallback: mostra raw
    strncpy(s.attrezzi[0].marca, json.c_str(), sizeof(s.attrezzi[0].marca) - 1);
    s.numAttrezzi = 1;
    return;
  }

  JsonArray arr = doc.as<JsonArray>();
  Serial.print("[JSON] Trovati ");
  Serial.print(arr.size());
  Serial.println(" attrezzi");

  for (JsonObject obj : arr) {
    if (s.numAttrezzi >= 5) break;

    Attrezzo& a = s.attrezzi[s.numAttrezzi];
    const char* marca = obj["marca"] | "";
    const char* dotazione = obj["dotazione"] | "";
    const char* note = obj["note"] | "";

    strncpy(a.marca, marca, sizeof(a.marca) - 1);
    strncpy(a.dotazione, dotazione, sizeof(a.dotazione) - 1);
    strncpy(a.note, note, sizeof(a.note) - 1);

    Serial.print("[JSON] Attrezzo ");
    Serial.print(s.numAttrezzi);
    Serial.print(": ");
    Serial.println(a.marca);

    s.numAttrezzi++;
  }
}

void parseCSV(const String& csv) {
  numSchede = 0;
  int lineStart = 0;
  bool firstLine = true;

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

  Serial.print("[CSV] Parsed ");
  Serial.print(numSchede);
  Serial.println(" schede (ultime, ordine decrescente)");
}

// ===== PRINT HISTORY =====

// Carica history da SD
void loadPrintHistory() {
  historyCount = 0;
  if (!sdOK) return;

  File f = SD.open("/print_history.txt", FILE_READ);
  if (!f) {
    Serial.println("[HISTORY] File non trovato, creo nuovo");
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

  Serial.print("[HISTORY] Caricate ");
  Serial.print(historyCount);
  Serial.println(" schede gia' stampate");
}

// Salva history su SD
void savePrintHistory() {
  if (!sdOK) return;

  File f = SD.open("/print_history.txt", FILE_WRITE);
  if (!f) {
    Serial.println("[HISTORY] Errore scrittura");
    return;
  }

  for (int i = 0; i < historyCount; i++) {
    f.println(printHistory[i]);
  }
  f.close();

  Serial.print("[HISTORY] Salvate ");
  Serial.print(historyCount);
  Serial.println(" schede");
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
void markAllAsPrinted() {
  for (int i = 0; i < numSchede; i++) {
    if (!isAlreadyPrinted(schede[i].numero)) {
      addToHistory(schede[i].numero);
    }
  }
  savePrintHistory();
  Serial.println("[HISTORY] Tutte le schede correnti segnate come stampate");
}

// ===== POLLING & AUTO-PRINT =====

// Fetch timestamp da API
unsigned long fetchLastUpdate() {
  if (WiFi.status() != WL_CONNECTED) return 0;

  HTTPClient http;
  String url = String(API_URL) + "?action=getLastUpdate";
  http.begin(url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(5000);

  int httpCode = http.GET();
  unsigned long ts = 0;

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    // Parse JSON: {"ts":1234567890}
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    if (!error) {
      ts = doc["ts"] | 0UL;
    }
  }

  http.end();
  return ts;
}

// Download CSV e ritorna true se OK
bool downloadCSV() {
  if (WiFi.status() != WL_CONNECTED) return false;

  showMessage("Download CSV...", TFT_YELLOW);
  Serial.println("[AUTO] Download CSV...");

  HTTPClient http;
  http.begin(CSV_URL);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    csvData = http.getString();
    Serial.print("[AUTO] CSV: ");
    Serial.print(csvData.length());
    Serial.println(" bytes");

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

  Serial.print("[AUTO] HTTP error: ");
  Serial.println(httpCode);
  http.end();
  return false;
}

// Stampa automatica nuove schede
void autoPrintNewSchede() {
  int printed = 0;

  for (int i = 0; i < numSchede; i++) {
    if (!isAlreadyPrinted(schede[i].numero)) {
      Serial.print("[AUTO] Nuova scheda: ");
      Serial.println(schede[i].numero);

      // Stampa
      Scheda& s = schede[i];
      int numEtichette = max(1, s.numAttrezzi);

      for (int j = 0; j < numEtichette; j++) {
        char msg[40];
        sprintf(msg, "Auto: %s (%d/%d)", s.numero, j + 1, numEtichette);
        showMessage(msg, TFT_CYAN);

        printEtichetta(s, j, numEtichette);

        // Pausa tra etichette multiple
        if (j < numEtichette - 1) {
          for (int sec = 10; sec > 0; sec--) {
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
    Serial.print("[AUTO] Stampate ");
    Serial.print(printed);
    Serial.println(" nuove schede");

    // Aggiorna UI
    drawList();
  } else {
    showMessage("", TFT_BLACK);
  }
}

// Check per nuove schede (chiamato ogni 5s)
void checkForNewSchede() {
  unsigned long serverTs = fetchLastUpdate();

  if (serverTs > lastKnownTimestamp) {
    Serial.print("[POLL] Timestamp cambiato: ");
    Serial.print(lastKnownTimestamp);
    Serial.print(" -> ");
    Serial.println(serverTs);

    lastKnownTimestamp = serverTs;

    // Scarica nuovo CSV
    if (downloadCSV()) {
      parseCSV(csvData);
      autoPrintNewSchede();
      drawList();
    }
  }
}

// ===== UI DISPLAY =====
void drawButtons() {
  int btnY = 320 - BUTTON_HEIGHT;
  int btnWidth = 80;

  // Sfondo pulsanti
  tft.fillRect(0, btnY, 240, BUTTON_HEIGHT, TFT_DARKGREY);

  // Pulsante SU (sinistra) - triangolo su centrato
  tft.fillRect(1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_NAVY);
  int leftCenter = btnWidth / 2;
  tft.fillTriangle(
    leftCenter - 15, btnY + 28,   // punta basso sx
    leftCenter, btnY + 10,        // punta alto centro
    leftCenter + 15, btnY + 28,   // punta basso dx
    TFT_WHITE
  );

  // Pulsante OK (centro)
  tft.fillRect(btnWidth + 1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_DARKGREEN);
  tft.setTextColor(TFT_WHITE, TFT_DARKGREEN);
  tft.setTextSize(2);
  tft.setCursor(btnWidth + 22, btnY + 12);
  tft.print("OK");

  // Pulsante GIU (destra) - triangolo giù centrato
  tft.fillRect(btnWidth * 2 + 1, btnY + 1, btnWidth - 2, BUTTON_HEIGHT - 2, TFT_NAVY);
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
  int listTop = 32;
  int listHeight = 320 - listTop - BUTTON_HEIGHT;
  tft.fillRect(0, listTop, 240, listHeight, TFT_BLACK);

  // Usa font built-in numero 2 (piccolo, proporzionale) size 2
  // Font 1 size 1 = 6x8, Font 1 size 2 = 12x16
  // Font 2 size 1 = 16px alto, una via di mezzo
  tft.setTextFont(2);  // Font 2: 16px alto
  tft.setTextSize(1);

  for (int i = 0; i < VISIBLE_ROWS && (scrollOffset + i) < numSchede; i++) {
    int idx = scrollOffset + i;
    Scheda& s = schede[idx];

    int y = listTop + 2 + i * ROW_HEIGHT;

    // Riga selezionata = sfondo blu
    if (idx == selectedIndex) {
      tft.fillRect(0, y - 1, 234, ROW_HEIGHT, TFT_NAVY);
      tft.setTextColor(TFT_WHITE, TFT_NAVY);
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
      tft.setTextColor(TFT_GREEN, idx == selectedIndex ? TFT_NAVY : TFT_BLACK);
      tft.setCursor(224, y);
      tft.print("V");
    }
  }

  // Torna al font di default
  tft.setTextFont(1);

  // Scrollbar
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
  tft.fillRect(0, 0, 240, 30, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(35, 8);  // Centrato
  tft.print("EM Maranzan");

  // Linea separatore
  tft.drawFastHLine(0, 30, 240, TFT_DARKGREY);
}

void showMessage(const char* msg, uint16_t color) {
  // Mostra messaggio temporaneo sopra i pulsanti
  int msgY = 320 - BUTTON_HEIGHT - 20;
  tft.fillRect(0, msgY, 240, 18, TFT_BLACK);
  tft.setTextColor(color, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(5, msgY + 4);
  tft.print(msg);
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

  // === NUMERO SCHEDA (grande, bianco su nero) ===
  printerSerial.write(0x1B); printerSerial.write('a'); printerSerial.write(1);  // center
  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(1);  // reverse
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(1);  // bold
  printerSerial.write(0x1D); printerSerial.write('!'); printerSerial.write(0x11); // large

  printerSerial.print(" ");
  printerSerial.print(s.numero);
  if (totAttrezzi > 1) {
    printerSerial.print(" (");
    printerSerial.print(attrezzoIdx + 1);
    printerSerial.print("/");
    printerSerial.print(totAttrezzi);
    printerSerial.print(")");
  }
  printerSerial.println(" ");

  printerSerial.write(0x1D); printerSerial.write('B'); printerSerial.write(0);  // reverse off
  printerSerial.write(0x1D); printerSerial.write('!'); printerSerial.write(0x00); // normal
  printerSerial.write(0x1B); printerSerial.write('E'); printerSerial.write(0);    // bold off
  printerSerial.write(0x1B); printerSerial.write('a'); printerSerial.write(0);  // left

  // Spazio 3mm (ESC J 21 = 21/180 pollici ≈ 3mm)
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(14);

  // === Cliente - Data ===
  printerSerial.print(s.cliente);
  printerSerial.print(" - ");
  printerSerial.println(formatDate(s.data));

  // === Telefono - Indirizzo (se presenti) ===
  bool hasTel = strlen(s.telefono) > 0;
  bool hasInd = strlen(s.indirizzo) > 0;

  if (hasTel && hasInd) {
    printerSerial.print(s.telefono);
    printerSerial.print(" - ");
    printerSerial.println(s.indirizzo);
  } else if (hasTel) {
    printerSerial.println(s.telefono);
  } else if (hasInd) {
    printerSerial.println(s.indirizzo);
  }

  // Spazio 3mm
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(14);

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

    // Note
    if (strlen(a.note) > 0) {
      printerSerial.println(a.note);
    }
  }

  // Spazio 3mm prima del feed finale
  printerSerial.write(0x1B); printerSerial.write('J'); printerSerial.write(14);

  // Feed carta per staccare etichetta
  printerSerial.write(0x0A);
  printerSerial.write(0x0A);
  printerSerial.write(0x0A);
}

// ===== STAMPA SCHEDA (multi-etichetta) =====
void printScheda(int index) {
  if (index < 0 || index >= numSchede) return;

  Scheda& s = schede[index];
  int numEtichette = max(1, s.numAttrezzi);

  Serial.print("[PRINT] Stampa scheda ");
  Serial.print(s.numero);
  Serial.print(" - ");
  Serial.print(numEtichette);
  Serial.println(" etichette");

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
      for (int sec = 10; sec > 0; sec--) {
        char countdown[32];
        sprintf(countdown, "Prossima in %ds...", sec);
        showMessage(countdown, TFT_CYAN);
        delay(1000);
      }
    }
  }

  Serial.println("[PRINT] Completato");
  showMessage("Stampa OK!", TFT_GREEN);
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=================================");
  Serial.println("T4 Thermal Printer - v0.9");
  Serial.println("Auto-print + History");
  Serial.println("=================================\n");

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

  // Messaggio avvio
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 100);
  tft.println("Avvio...");

  // Stampante
  Serial.println("[INIT] Stampante...");
  printerSerial.begin(19200, SERIAL_8N1, PRINTER_RX, PRINTER_TX);

  // SD
  Serial.println("[INIT] SD card...");
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS, sdSPI)) {
    sdOK = true;
    Serial.println("[OK] SD card");
  } else {
    Serial.println("[FAIL] SD card");
  }

  // WiFi
  Serial.println("[INIT] WiFi...");
  tft.setCursor(10, 130);
  tft.setTextSize(1);
  tft.print("WiFi...");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    Serial.print("\n[OK] WiFi: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[FAIL] WiFi");
  }

  // Download CSV
  if (wifiOK) {
    tft.setCursor(10, 145);
    tft.print("Download CSV...");
    Serial.println("[INIT] Download CSV...");

    HTTPClient http;
    http.begin(CSV_URL);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
      csvData = http.getString();
      Serial.print("[OK] CSV: ");
      Serial.print(csvData.length());
      Serial.println(" bytes");

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
      Serial.print("[FAIL] HTTP: ");
      Serial.println(httpCode);

      // Prova da SD
      if (sdOK) {
        File f = SD.open("/riparazioni.csv", FILE_READ);
        if (f) {
          csvData = f.readString();
          f.close();
          parseCSV(csvData);
          Serial.println("[OK] CSV da SD");
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
      Serial.println("[OK] CSV da SD (offline)");
    }
  }

  // Carica print history
  loadPrintHistory();

  // Segna tutte le schede correnti come già stampate
  // (all'avvio non vogliamo ristampare tutto)
  markAllAsPrinted();

  // Leggi timestamp iniziale per polling
  if (wifiOK) {
    lastKnownTimestamp = fetchLastUpdate();
    Serial.print("[POLL] Timestamp iniziale: ");
    Serial.println(lastKnownTimestamp);
  }

  // Disegna UI
  tft.fillScreen(TFT_BLACK);
  drawHeader();
  drawList();
  drawButtons();

  Serial.println("\n[READY] Auto-print attivo");
}

// ===== LOOP =====
void loop() {
  static bool lastLeft = HIGH;
  static bool lastCenter = HIGH;
  static bool lastRight = HIGH;

  bool currLeft = digitalRead(BTN_LEFT);
  bool currCenter = digitalRead(BTN_CENTER);
  bool currRight = digitalRead(BTN_RIGHT);

  bool needRedraw = false;
  unsigned long now = millis();

  // === POLLING per nuove schede (ogni 5 secondi) ===
  if (wifiOK && (now - lastPollTime >= POLL_INTERVAL)) {
    lastPollTime = now;
    checkForNewSchede();
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

  // === STAMPA (CENTER button) ===
  if (currCenter == LOW && lastCenter == HIGH) {
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
