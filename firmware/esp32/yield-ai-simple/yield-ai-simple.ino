/*
 * Yield AI — simple ESP32 soil-moisture probe.
 *
 * The minimal version of ../yield-ai-probe: Wi-Fi and server are set in secrets.h instead of a
 * setup portal, and it only reads a capacitive soil-moisture sensor.
 *
 *   1. First boot: POST <server>/api/device/pair {code} → a device token, kept in flash.
 *   2. Every interval_s seconds: read the sensor, POST <server>/api/readings {moisture} with
 *      `Authorization: Bearer <token>`. The reply carries interval_s, so the dashboard sets the rate.
 *
 * Wiring (capacitive sensor v1.2): VCC → 3V3, GND → GND, AOUT → GPIO 34.
 * Serial monitor at 115200 baud. Hold BOOT for 3 s to forget the token and pair again.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include "secrets.h"  // copy secrets.example.h → secrets.h and fill it in

#define FIRMWARE_VERSION "simple-1.0.0"

// Moisture sensor on an ADC1 pin (ADC2 pins don't work while Wi-Fi is on).
#define MOISTURE_PIN 34
// Calibrate: watch the "raw" value on the serial monitor with the sensor in dry air (RAW_DRY) and
// in a glass of water (RAW_WET).
#define MOISTURE_RAW_DRY 3300
#define MOISTURE_RAW_WET 1350
// Volumetric water content (%) reported at RAW_WET. Wet sandy soil holds ~35-40 %.
#define MOISTURE_VWC_WET 40.0

#define RESET_PIN 0  // BOOT button
#define DEFAULT_INTERVAL_S 10

Preferences prefs;
String token;
uint32_t intervalS = DEFAULT_INTERVAL_S;
uint32_t lastSend = 0;

// ---------------------------------------------------------------------------
// Helpers

// Pulls "key":"value" or "key":123 out of a small JSON reply (no JSON library needed).
String jsonValue(const String& body, const char* key) {
  String needle = String("\"") + key + "\":";
  int i = body.indexOf(needle);
  if (i < 0) return "";
  i += needle.length();
  while (i < (int)body.length() && body[i] == ' ') i++;
  if (i < (int)body.length() && body[i] == '"') {
    int end = body.indexOf('"', i + 1);
    return end < 0 ? "" : body.substring(i + 1, end);
  }
  int end = i;
  while (end < (int)body.length() && (isdigit(body[end]) || body[end] == '-' || body[end] == '.')) end++;
  return body.substring(i, end);
}

uint32_t clampInterval(long s) {
  if (s < 5) return 5;
  if (s > 3600) return 3600;
  return (uint32_t)s;
}

// POST JSON; returns the HTTP status (negative on a connection error) and fills `reply`.
int postJson(const String& path, const String& body, String& reply) {
  String url = String(SERVER_URL) + path;
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https://")) {
    secure.setInsecure();  // the certificate isn't checked; fine for a class project / demo
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return -1;
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  if (token.length()) http.addHeader("Authorization", "Bearer " + token);
  int status = http.POST(body);
  reply = status > 0 ? http.getString() : http.errorToString(status);
  http.end();
  return status;
}

// ---------------------------------------------------------------------------
// Wi-Fi, pairing, sensor

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\n[wifi] failed, will retry");
  }
}

bool pair() {
  String body = String("{\"code\":\"") + PAIRING_CODE + "\",\"firmware\":\"" + FIRMWARE_VERSION +
                "\",\"mac\":\"" + WiFi.macAddress() + "\",\"ip\":\"" + WiFi.localIP().toString() +
                "\",\"rssi\":" + WiFi.RSSI() + "}";
  String reply;
  Serial.printf("[pair] code %s → %s/api/device/pair\n", PAIRING_CODE, SERVER_URL);
  int status = postJson("/api/device/pair", body, reply);
  if (status != 200) {
    Serial.printf("[pair] failed (%d): %s\n", status, reply.c_str());
    if (status == 404) Serial.println("[pair] make a new code in the dashboard, put it in secrets.h and re-upload");
    return false;
  }
  String t = jsonValue(reply, "token");
  if (!t.length()) {
    Serial.println("[pair] no token in the reply");
    return false;
  }
  token = t;
  intervalS = clampInterval(jsonValue(reply, "interval_s").toInt());
  prefs.putString("token", token);
  Serial.printf("[pair] paired as %s, sending every %u s\n", jsonValue(reply, "sensor_id").c_str(), intervalS);
  return true;
}

float readMoisture() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MOISTURE_PIN);
    delay(2);
  }
  float raw = sum / 16.0;
  float frac = (MOISTURE_RAW_DRY - raw) / (float)(MOISTURE_RAW_DRY - MOISTURE_RAW_WET);
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  float moisture = frac * MOISTURE_VWC_WET;
  Serial.printf("[sensor] raw %.0f → moisture %.1f %%\n", raw, moisture);
  return moisture;
}

void sendReading() {
  float moisture = readMoisture();
  String body = String("{\"moisture\":") + String(moisture, 1) + ",\"firmware\":\"" + FIRMWARE_VERSION +
                "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" + WiFi.RSSI() + "}";
  String reply;
  int status = postJson("/api/readings", body, reply);
  if (status == 201 || status == 200) {
    intervalS = clampInterval(jsonValue(reply, "interval_s").toInt());
    Serial.printf("[send] ok, next in %u s\n", intervalS);
  } else if (status == 401) {
    Serial.println("[send] token rejected (device removed?), pairing again");
    token = "";
    prefs.remove("token");
  } else {
    Serial.printf("[send] failed (%d): %s\n", status, reply.c_str());
  }
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nYield AI simple probe " FIRMWARE_VERSION);
  pinMode(RESET_PIN, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(MOISTURE_PIN, ADC_11db);  // full 0-3.3 V range

  prefs.begin("yieldai", false);
  token = prefs.getString("token", "");
  connectWifi();
}

void loop() {
  // Hold BOOT for 3 s: forget the token (to pair with a new code).
  if (digitalRead(RESET_PIN) == LOW) {
    uint32_t start = millis();
    while (digitalRead(RESET_PIN) == LOW && millis() - start < 3000) delay(10);
    if (millis() - start >= 3000) {
      prefs.remove("token");
      Serial.println("[reset] token cleared, restarting");
      delay(200);
      ESP.restart();
    }
  }

  connectWifi();
  if (WiFi.status() != WL_CONNECTED) {
    delay(5000);
    return;
  }

  if (!token.length()) {
    if (!pair()) {
      delay(15000);  // the pair endpoint allows 10 tries a minute
      return;
    }
    lastSend = 0;
  }

  if (lastSend == 0 || millis() - lastSend >= intervalS * 1000UL) {
    lastSend = millis();
    if (lastSend == 0) lastSend = 1;
    sendReading();
  }
  delay(50);
}
