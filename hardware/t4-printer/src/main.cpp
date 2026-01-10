/*
 * Elettromeccanica Maranzan - T4 Thermal Printer
 * Hardware: LilyGo T4 v1.3 + CSN-A2 TTL
 *
 * Test base per verificare compilazione e upload
 */

#include <Arduino.h>

void setup() {
  // Inizializza Serial per debug
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=================================");
  Serial.println("Elettromeccanica Maranzan");
  Serial.println("T4 Thermal Printer - Test Base");
  Serial.println("=================================\n");

  Serial.println("[OK] Serial inizializzato a 115200 baud");
  Serial.print("[INFO] ESP32 Chip: ");
  Serial.println(ESP.getChipModel());
  Serial.print("[INFO] Flash size: ");
  Serial.print(ESP.getFlashChipSize() / (1024 * 1024));
  Serial.println(" MB");
  Serial.print("[INFO] PSRAM size: ");
  Serial.print(ESP.getPsramSize() / (1024 * 1024));
  Serial.println(" MB");
  Serial.print("[INFO] Free heap: ");
  Serial.print(ESP.getFreeHeap() / 1024);
  Serial.println(" KB");

  Serial.println("\n[READY] Sistema pronto per test hardware");
}

void loop() {
  // Blink LED interno (se presente) per verificare che il loop giri
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 1000) {
    lastBlink = millis();
    Serial.print(".");
  }

  delay(10);
}
