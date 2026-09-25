/*
 * Yield AI probe — ESP32 firmware (Arduino core 2.x or 3.x, no extra libraries).
 *
 * First start (or after holding BOOT for 5 s):
 *   The ESP32 opens a Wi-Fi network "YieldAI-Setup-XXXX". Join it from a phone; the setup page opens
 *   (or browse to http://192.168.4.1). Pick the farm's Wi-Fi, enter its password, the dashboard's
 *   address (e.g. https://your-site.vercel.app, or http://192.168.1.20:3000 for a laptop on the same
 *   Wi-Fi) and the pairing code from Farms & devices → Connect ESP32. Save.
 *
 * Then, on the farm's Wi-Fi:
 *   1. POST <server>/api/device/pair {code} → a device token (kept in flash; the code is single use).
 *   2. Every interval_s seconds (10 by default): read the sensors and POST <server>/api/readings with
 *      `Authorization: Bearer <token>`. The reply carries `interval_s`, so changing the interval in
 *      the dashboard reaches the device with its next reading — no reflashing.
 *   3. If the server can't be reached, readings are kept (up to BUFFER_SIZE) and sent later in one
 *      batch with their own timestamps (NTP time) or their age.
 *   4. If the server says the token is no longer valid (401), the device goes back to setup mode.
 *
 * Sensors: set the USE_* switches below. With none enabled (or SIMULATE_SENSORS 1) it sends
 * plausible test values so the whole path can be checked on a bare board.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#define FIRMWARE_VERSION "1.0.0"

// Test values instead of real sensors (a bare ESP32 on the bench).
#ifndef SIMULATE_SENSORS
#define SIMULATE_SENSORS 0
#endif
// Capacitive soil-moisture sensor on an analog pin (v1.2 style). Calibrate RAW_DRY / RAW_WET:
// read the raw value in dry air and in a glass of water.
#ifndef USE_ANALOG_MOISTURE
#define USE_ANALOG_MOISTURE 1
#endif
#define MOISTURE_PIN 34
#define MOISTURE_RAW_DRY 3300
#define MOISTURE_RAW_WET 1350
// Volumetric water content at RAW_WET for sandy soil (a wet sand holds ~35-40 %).
#define MOISTURE_VWC_WET 40.0

// RS485 "7-in-1" soil sensor (moisture, temperature, EC, pH, N, P, K) over Modbus RTU through a
// MAX485 / auto-direction module. The register map below is the common one (registers 0x0000-0x0006);
// some vendors use other addresses — check the sensor's sheet.
#ifndef USE_RS485_SOIL
#define USE_RS485_SOIL 0
#endif
#define RS485_RX 16
#define RS485_TX 17
#define RS485_DE_RE 4       // -1 for auto-direction modules
#define RS485_BAUD 4800
#define RS485_ADDRESS 0x01

// Hold this button (BOOT on most boards) for 5 s to forget the Wi-Fi and pairing.
#define RESET_PIN 0

// Readings kept while the server is unreachable (each ~40 bytes).
#define BUFFER_SIZE 360

// HTTPS: the certificate isn't checked (fine for a farm probe; set a root CA below to check it).
// const char* ROOT_CA = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n";
const char* ROOT_CA = nullptr;

const uint32_t DEFAULT_INTERVAL_S = 10;
const uint32_t MIN_INTERVAL_S = 5;
const uint32_t MAX_INTERVAL_S = 3600;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct Settings {
  String ssid, pass, server, code, token;
  uint32_t interval_s = DEFAULT_INTERVAL_S;
};

struct Reading {
  uint32_t epoch;    // 0 when the clock wasn't set
  uint32_t millisAt; // for age_s when epoch is 0
  float moisture, temperature, ec, ph, n, p, k, air_temp, air_humidity; // NAN = not measured
};

void startSetupMode(const String& message);

Preferences prefs;
Settings cfg;
WebServer web(80);
DNSServer dns;
bool setupMode = false;
Reading buffer[BUFFER_SIZE];
int bufHead = 0, bufCount = 0;
uint32_t nextReadingAt = 0;
uint32_t resetPressedAt = 0;
uint32_t setupStartedAt = 0;

uint32_t clampInterval(long v) {
  if (v < (long)MIN_INTERVAL_S) return MIN_INTERVAL_S;
  if (v > (long)MAX_INTERVAL_S) return MAX_INTERVAL_S;
  return (uint32_t)v;
}

void loadSettings() {
  prefs.begin("yieldai", true);
  cfg.ssid = prefs.getString("ssid", "");
  cfg.pass = prefs.getString("pass", "");
  cfg.server = prefs.getString("server", "");
  cfg.code = prefs.getString("code", "");
  cfg.token = prefs.getString("token", "");
  cfg.interval_s = prefs.getUInt("interval", DEFAULT_INTERVAL_S);
  prefs.end();
}

void saveSettings() {
  prefs.begin("yieldai", false);
  prefs.putString("ssid", cfg.ssid);
  prefs.putString("pass", cfg.pass);
  prefs.putString("server", cfg.server);
  prefs.putString("code", cfg.code);
  prefs.putString("token", cfg.token);
  prefs.putUInt("interval", cfg.interval_s);
  prefs.end();
}

String deviceSuffix() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char s[5];
  snprintf(s, sizeof s, "%02X%02X", mac[4], mac[5]);
  return String(s);
}

// ---------------------------------------------------------------------------
// Tiny JSON helpers (the replies are small and flat)
// ---------------------------------------------------------------------------

String jsonString(const String& body, const char* key) {
  String k = String("\"") + key + "\"";
  int i = body.indexOf(k);
  if (i < 0) return "";
  i = body.indexOf(':', i + k.length());
  if (i < 0) return "";
  i = body.indexOf('"', i);
  if (i < 0) return "";
  int j = body.indexOf('"', i + 1);
  return j < 0 ? "" : body.substring(i + 1, j);
}

long jsonNumber(const String& body, const char* key, long fallback) {
  String k = String("\"") + key + "\"";
  int i = body.indexOf(k);
  if (i < 0) return fallback;
  i = body.indexOf(':', i + k.length());
  if (i < 0) return fallback;
  while (i + 1 < (int)body.length() && (body[i + 1] == ' ')) i++;
  long v = body.substring(i + 1).toInt();
  return v > 0 ? v : fallback;
}

void addField(String& out, const char* key, float v, int decimals) {
  if (isnan(v)) return;
  out += ",\"";
  out += key;
  out += "\":";
  out += String(v, decimals);
}

String htmlEscape(const String& s) {
  String o;
  for (char c : s) {
    if (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else o += c;
  }
  return o;
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

#if USE_RS485_SOIL
HardwareSerial rs485(2);

uint16_t modbusCrc(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

// Read `count` holding registers from `start`. Returns false on timeout or a bad CRC.
bool modbusRead(uint16_t start, uint16_t count, uint16_t* out) {
  uint8_t req[8] = {RS485_ADDRESS, 0x03, (uint8_t)(start >> 8), (uint8_t)start, (uint8_t)(count >> 8), (uint8_t)count, 0, 0};
  uint16_t crc = modbusCrc(req, 6);
  req[6] = crc & 0xFF;
  req[7] = crc >> 8;
  while (rs485.available()) rs485.read();
  if (RS485_DE_RE >= 0) digitalWrite(RS485_DE_RE, HIGH);
  rs485.write(req, 8);
  rs485.flush();
  if (RS485_DE_RE >= 0) digitalWrite(RS485_DE_RE, LOW);
  const size_t want = 5 + 2 * count;
  uint8_t resp[5 + 2 * 16];
  size_t got = 0;
  uint32_t until = millis() + 1000;
  while (got < want && millis() < until) {
    if (rs485.available()) resp[got++] = rs485.read();
  }
  if (got < want || resp[0] != RS485_ADDRESS || resp[1] != 0x03) return false;
  uint16_t check = modbusCrc(resp, want - 2);
  if ((check & 0xFF) != resp[want - 2] || (check >> 8) != resp[want - 1]) return false;
  for (uint16_t i = 0; i < count; i++) out[i] = (resp[3 + 2 * i] << 8) | resp[4 + 2 * i];
  return true;
}
#endif

void readSensors(Reading& r) {
  r.moisture = r.temperature = r.ec = r.ph = r.n = r.p = r.k = r.air_temp = r.air_humidity = NAN;

#if SIMULATE_SENSORS
  float t = millis() / 60000.0;
  r.moisture = 22.0 + 4.0 * sin(t / 30.0) + random(-10, 10) / 20.0;
  r.temperature = 26.0 + 2.0 * sin(t / 45.0);
  r.ec = 1.8 + 0.2 * sin(t / 60.0);
  r.ph = 7.5 + random(-5, 5) / 100.0;
  r.n = 40 + random(-2, 3);
  r.p = 20 + random(-2, 3);
  r.k = 180 + random(-5, 6);
  r.air_temp = 33.0 + 3.0 * sin(t / 50.0);
  r.air_humidity = 40.0 - 8.0 * sin(t / 50.0);
  return;
#endif

#if USE_ANALOG_MOISTURE
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MOISTURE_PIN);
    delay(2);
  }
  float raw = sum / 16.0;
  float frac = (MOISTURE_RAW_DRY - raw) / (float)(MOISTURE_RAW_DRY - MOISTURE_RAW_WET);
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  r.moisture = frac * MOISTURE_VWC_WET;
#endif

#if USE_RS485_SOIL
  uint16_t reg[7];
  if (modbusRead(0x0000, 7, reg)) {
    r.moisture = reg[0] / 10.0;             // %
    r.temperature = (int16_t)reg[1] / 10.0; // °C (signed)
    r.ec = reg[2] / 1000.0;                 // µS/cm → dS/m
    r.ph = reg[3] / 10.0;
    r.n = reg[4];                           // mg/kg
    r.p = reg[5];
    r.k = reg[6];
  } else {
    Serial.println("[sensor] RS485 soil sensor didn't answer");
  }
#endif
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

String baseUrl() {
  String s = cfg.server;
  s.trim();
  while (s.endsWith("/")) s.remove(s.length() - 1);
  if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
  return s;
}

// POST JSON; returns the HTTP status (negative on a connection error) and fills `reply`.
int postJson(const String& url, const String& body, const String& bearer, String& reply) {
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https://")) {
    if (ROOT_CA) secure.setCACert(ROOT_CA);
    else secure.setInsecure();
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return -1;
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  if (bearer.length()) http.addHeader("Authorization", "Bearer " + bearer);
  int status = http.POST(body);
  reply = status > 0 ? http.getString() : http.errorToString(status);
  http.end();
  return status;
}

bool pair() {
  String body = String("{\"code\":\"") + cfg.code + "\",\"firmware\":\"" FIRMWARE_VERSION "\",\"mac\":\"" + WiFi.macAddress() +
                "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" + WiFi.RSSI() + "}";
  String reply;
  int status = postJson(baseUrl() + "/api/device/pair", body, "", reply);
  Serial.printf("[pair] %d %s\n", status, reply.c_str());
  if (status == 200) {
    String token = jsonString(reply, "token");
    if (token.length() == 0) return false;
    cfg.token = token;
    cfg.code = "";
    cfg.interval_s = clampInterval(jsonNumber(reply, "interval_s", DEFAULT_INTERVAL_S));
    saveSettings();
    return true;
  }
  if (status == 404 || status == 400) {
    // The code is wrong or expired: back to setup with the other fields kept.
    cfg.code = "";
    saveSettings();
    startSetupMode("That pairing code isn't valid or has expired. Make a new one in the dashboard.");
  }
  return false;
}

void bufferReading(const Reading& r) {
  buffer[(bufHead + bufCount) % BUFFER_SIZE] = r;
  if (bufCount < BUFFER_SIZE) bufCount++;
  else bufHead = (bufHead + 1) % BUFFER_SIZE; // full: drop the oldest
}

String readingJson(const Reading& r) {
  String o = "{";
  if (r.epoch) o += "\"timestamp\":" + String(r.epoch);
  else o += "\"age_s\":" + String((millis() - r.millisAt) / 1000);
  addField(o, "moisture", r.moisture, 1);
  addField(o, "temperature", r.temperature, 1);
  addField(o, "ec", r.ec, 3);
  addField(o, "ph", r.ph, 2);
  addField(o, "n", r.n, 0);
  addField(o, "p", r.p, 0);
  addField(o, "k", r.k, 0);
  addField(o, "air_temp", r.air_temp, 1);
  addField(o, "air_humidity", r.air_humidity, 0);
  return o + "}";
}

// Send everything buffered (up to 60 per request). Returns true when the buffer was emptied.
bool flushBuffer() {
  while (bufCount > 0) {
    int n = min(bufCount, 60);
    String body = String("{\"firmware\":\"" FIRMWARE_VERSION "\",\"rssi\":") + String(WiFi.RSSI()) + ",\"ip\":\"" + WiFi.localIP().toString() + "\",\"readings\":[";
    for (int i = 0; i < n; i++) {
      if (i) body += ",";
      body += readingJson(buffer[(bufHead + i) % BUFFER_SIZE]);
    }
    body += "]}";
    String reply;
    int status = postJson(baseUrl() + "/api/readings", body, cfg.token, reply);
    Serial.printf("[send] %d readings → %d %s\n", n, status, reply.c_str());
    if (status == 201 || status == 422) {
      // Stored (or rejected as invalid, which retrying won't fix): drop them.
      bufHead = (bufHead + n) % BUFFER_SIZE;
      bufCount -= n;
      uint32_t next = clampInterval(jsonNumber(reply, "interval_s", cfg.interval_s));
      if (next != cfg.interval_s) {
        Serial.printf("[send] interval changed to %u s\n", next);
        cfg.interval_s = next;
        saveSettings();
      }
    } else if (status == 401) {
      Serial.println("[send] token refused: pair again");
      cfg.token = "";
      saveSettings();
      startSetupMode("The dashboard no longer accepts this device. Enter a new pairing code.");
      return false;
    } else {
      return false; // network trouble or 429/5xx: keep them for the next round
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Setup portal
// ---------------------------------------------------------------------------

String setupMessage;

void handleRoot() {
  int found = WiFi.scanNetworks();
  String options;
  for (int i = 0; i < found; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0 || options.indexOf(">" + htmlEscape(s) + "<") >= 0) continue;
    options += "<option value=\"" + htmlEscape(s) + "\"" + (s == cfg.ssid ? " selected" : "") + ">" + htmlEscape(s) + "</option>";
  }
  String page = F("<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'><title>Yield AI probe</title>"
                  "<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:1.5rem auto;padding:0 1rem;color:#1f2a1f}"
                  "label{display:block;margin-top:1rem;font-weight:600}input,select{width:100%;padding:.6rem;font-size:1rem;margin-top:.3rem;box-sizing:border-box}"
                  "button{margin-top:1.5rem;width:100%;padding:.8rem;font-size:1rem;background:#1f5f3f;color:#fff;border:0;border-radius:.5rem}"
                  ".note{background:#fdecc8;padding:.6rem;border-radius:.4rem}.muted{color:#666;font-size:.9rem}</style></head><body>"
                  "<h1>Yield AI probe</h1>");
  if (setupMessage.length()) page += "<p class=note>" + htmlEscape(setupMessage) + "</p>";
  page += "<form method=post action=/save>";
  page += "<label>Wi-Fi network<select name=ssid_pick onchange=\"document.getElementById('ssid').value=this.value\"><option value=''>Choose…</option>" + options + "</select></label>";
  page += "<input id=ssid name=ssid placeholder='or type the network name' value=\"" + htmlEscape(cfg.ssid) + "\">";
  page += "<label>Wi-Fi password<input name=pass type=password value=\"" + htmlEscape(cfg.pass) + "\"></label>";
  page += "<label>Dashboard address<input name=server placeholder='https://your-site.example' value=\"" + htmlEscape(cfg.server) + "\"></label>";
  page += "<label>Pairing code<input name=code placeholder='ABCD-EFGH' autocapitalize=characters value=\"" + htmlEscape(cfg.code) + "\"></label>";
  page += "<p class=muted>From the dashboard: Farms &amp; devices → Connect ESP32. Valid for 30 minutes.</p>";
  page += String("<button>Save and connect</button></form><p class=muted>Device ") + deviceSuffix() + " · firmware " FIRMWARE_VERSION "</p></body></html>";
  web.send(200, "text/html", page);
}

void handleSave() {
  cfg.ssid = web.arg("ssid");
  if (cfg.ssid.length() == 0) cfg.ssid = web.arg("ssid_pick");
  cfg.pass = web.arg("pass");
  cfg.server = web.arg("server");
  String code = web.arg("code");
  code.trim();
  code.toUpperCase();
  if (code.length()) {
    cfg.code = code;
    cfg.token = ""; // a new code means pairing again
  }
  saveSettings();
  web.send(200, "text/html",
           "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><body style='font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem'>"
           "<h1>Saved</h1><p>The probe restarts, joins your Wi-Fi and pairs. Watch the dashboard: it shows <b>Receiving readings</b> within a minute.</p>"
           "<p>If it doesn't, this setup network comes back and tells you why.</p></body>");
  delay(1500);
  ESP.restart();
}

void startSetupMode(const String& message) {
  setupMessage = message;
  setupMode = true;
  setupStartedAt = millis();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  String ap = "YieldAI-Setup-" + deviceSuffix();
  WiFi.softAP(ap.c_str());
  dns.start(53, "*", WiFi.softAPIP());
  web.on("/", HTTP_GET, handleRoot);
  web.on("/save", HTTP_POST, handleSave);
  web.onNotFound([]() {
    web.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
    web.send(302, "text/plain", "");
  });
  web.begin();
  Serial.printf("[setup] join Wi-Fi \"%s\" and open http://%s\n", ap.c_str(), WiFi.softAPIP().toString().c_str());
}

// ---------------------------------------------------------------------------
// Wi-Fi and time
// ---------------------------------------------------------------------------

bool connectWifi(uint32_t timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
  uint32_t until = millis() + timeoutMs;
  while (WiFi.status() != WL_CONNECTED && millis() < until) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, ip %s, rssi %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }
  return false;
}

uint32_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1704067200 ? (uint32_t)t : 0; // before 2024 = not synced yet
}

void checkResetButton() {
  if (digitalRead(RESET_PIN) == LOW) {
    if (!resetPressedAt) resetPressedAt = millis();
    else if (millis() - resetPressedAt > 5000) {
      Serial.println("[reset] forgetting Wi-Fi and pairing");
      prefs.begin("yieldai", false);
      prefs.clear();
      prefs.end();
      ESP.restart();
    }
  } else {
    resetPressedAt = 0;
  }
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(RESET_PIN, INPUT_PULLUP);
#if USE_RS485_SOIL
  if (RS485_DE_RE >= 0) {
    pinMode(RS485_DE_RE, OUTPUT);
    digitalWrite(RS485_DE_RE, LOW);
  }
  rs485.begin(RS485_BAUD, SERIAL_8N1, RS485_RX, RS485_TX);
#endif
  loadSettings();
  Serial.printf("\nYield AI probe %s, device %s\n", FIRMWARE_VERSION, deviceSuffix().c_str());

  if (cfg.ssid.length() == 0 || cfg.server.length() == 0 || (cfg.token.length() == 0 && cfg.code.length() == 0)) {
    startSetupMode("");
    return;
  }
  if (!connectWifi(30000)) {
    startSetupMode("Couldn't join the Wi-Fi \"" + cfg.ssid + "\". Check the name and password.");
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  if (cfg.token.length() == 0 && !pair()) {
    if (!setupMode) startSetupMode("Couldn't reach the dashboard at " + cfg.server + ". Check the address (the phone's browser should open it).");
    return;
  }
  nextReadingAt = millis();
}

void loop() {
  checkResetButton();
  if (setupMode) {
    dns.processNextRequest();
    web.handleClient();
    // Set up before but failed (Wi-Fi or server down)? Retry every 10 minutes while nobody is on the setup page.
    if (cfg.ssid.length() && (cfg.token.length() || cfg.code.length()) && millis() - setupStartedAt > 600000UL && WiFi.softAPgetStationNum() == 0) {
      ESP.restart();
    }
    return;
  }
  if ((int32_t)(millis() - nextReadingAt) < 0) {
    delay(20);
    return;
  }
  nextReadingAt = millis() + cfg.interval_s * 1000UL;

  Reading r;
  readSensors(r);
  r.epoch = nowEpoch();
  r.millisAt = millis();
  bufferReading(r);

  if (!connectWifi(10000)) {
    Serial.printf("[wifi] offline, %d reading(s) waiting\n", bufCount);
    return;
  }
  flushBuffer();
}
