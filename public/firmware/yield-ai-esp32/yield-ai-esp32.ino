/*
 * Yield AI — ESP32 soil probe firmware
 * ====================================
 *
 * Reads a 7-in-1 RS485 soil probe (moisture, temperature, EC, pH, N, P, K) over Modbus RTU and
 * sends every reading to your Yield AI dashboard over Wi-Fi:
 *
 *   POST <server>/api/readings   Authorization: Bearer <device key>
 *   { "moisture": 12.4, "temperature": 28.1, "ec_us_cm": 1850, "ph": 8.1, "n": 31, "p": 19, "k": 132,
 *     "timestamp": 1790000000, "rssi": -61, "fw": "1.0.0" }
 *
 * The reply carries "interval_s" — the reading interval you pick in the dashboard (default 10 s) —
 * and the device follows it. Readings taken while Wi-Fi is down are kept (up to 30 minutes at
 * 10 s) and sent as a batch when the connection is back.
 *
 * First connection
 * ----------------
 *  1. In the dashboard: Farms & devices → Add ESP32. Download this sketch there to get the server
 *     address and the device key filled in (and, if you like, your Wi-Fi name and password).
 *  2. Arduino IDE: install "esp32 by Espressif Systems" (Boards Manager), pick "ESP32 Dev Module",
 *     and upload. No extra libraries are needed.
 *  3. If Wi-Fi details are missing or wrong, the ESP32 opens a setup hotspot named
 *     "YieldAI-Setup-XXXX". Join it from your phone; the setup page opens (or browse to
 *     http://192.168.4.1) — pick your Wi-Fi, enter its password, the server address and the key.
 *     Hold the BOOT button while powering up to open the setup page again later.
 *  4. The dashboard shows "Connected" as soon as the first reading arrives.
 *
 * Wiring (MAX485 / RS485-TTL module)
 * ----------------------------------
 *   Probe brown  → 12 V (5–24 V; check your probe)     Probe black → GND (shared with the ESP32)
 *   Probe yellow → RS485 A                              Probe blue  → RS485 B
 *   RS485 RO → GPIO 16 (RX2)    RS485 DI → GPIO 17 (TX2)    RS485 DE + RE → GPIO 4
 *   RS485 VCC → 3.3 V           RS485 GND → GND
 *   (Auto-direction modules without DE/RE: set RS485_DE_PIN to -1.)
 *
 * Status LED (GPIO 2): steady = setup hotspot open · one blink = reading sent ·
 *                      three fast blinks = send failed (reading kept for later).
 */

#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ---------------------------------------------------------------------------
// Settings — filled in by the dashboard's download (leave "" to use the setup hotspot).
// ---------------------------------------------------------------------------
#define YAI_WIFI_SSID ""
#define YAI_WIFI_PASSWORD ""
#define YAI_SERVER_URL ""
#define YAI_DEVICE_KEY ""

#define FIRMWARE_VERSION "1.0.0"

// Probe (Modbus RTU). Most 7-in-1 probes ship at address 1, 4800 baud, 8N1.
#define RS485_RX_PIN 16
#define RS485_TX_PIN 17
#define RS485_DE_PIN 4
#define PROBE_ADDRESS 1
#define PROBE_BAUD 4800

// Register map: first register and scale of each value. This is the common layout
// (registers 0x0000–0x0006). Check your probe's manual — some models use other registers or
// report pH ×100 (then set PH_SCALE to 0.01).
#define PROBE_FIRST_REGISTER 0x0000
#define REG_MOISTURE 0     // % × 10
#define REG_TEMPERATURE 1  // °C × 10, signed
#define REG_EC 2           // µS/cm
#define REG_PH 3           // pH × 10
#define REG_N 4            // mg/kg
#define REG_P 5            // mg/kg
#define REG_K 6            // mg/kg
#define MOISTURE_SCALE 0.1f
#define TEMPERATURE_SCALE 0.1f
#define PH_SCALE 0.1f

#define LED_PIN 2
#define BOOT_BUTTON_PIN 0

// Timings
#define DEFAULT_INTERVAL_S 10
#define MIN_INTERVAL_S 5
#define MAX_INTERVAL_S 3600
#define WIFI_CONNECT_TIMEOUT_MS 30000
#define PORTAL_TIMEOUT_MS (10UL * 60UL * 1000UL)
#define HTTP_TIMEOUT_MS 10000
#define MAX_BUFFERED 180
#define MAX_PER_REQUEST 60

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
struct Config {
  String ssid;
  String password;
  String server;
  String key;
};

struct Reading {
  uint32_t timestamp;  // Unix seconds, 0 when the clock was not set yet
  float moisture, temperature, ec, ph, n, p, k;
};

// Declared before any function: the Arduino IDE puts its generated prototypes there.
enum ProbeResult { PROBE_OK, PROBE_NO_ANSWER, PROBE_IMPLAUSIBLE };

Config config;
Preferences prefs;
WebServer portal(80);
DNSServer dns;
HardwareSerial probeSerial(2);

Reading buffered[MAX_BUFFERED];
int bufferedCount = 0;
uint32_t intervalS = DEFAULT_INTERVAL_S;
unsigned long lastCycle = 0;
bool portalMode = false;
unsigned long portalStarted = 0;
String lastError = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
void blink(int times, int onMs, int offMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(onMs);
    digitalWrite(LED_PIN, LOW);
    delay(offMs);
  }
}

String chipSuffix() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[5];
  snprintf(buf, sizeof(buf), "%04X", (uint16_t)(mac >> 32));
  return String(buf);
}

String trimSlash(String url) {
  url.trim();
  while (url.endsWith("/")) url.remove(url.length() - 1);
  return url;
}

void loadConfig() {
  prefs.begin("yieldai", true);
  config.ssid = prefs.getString("ssid", YAI_WIFI_SSID);
  config.password = prefs.getString("pass", YAI_WIFI_PASSWORD);
  config.server = trimSlash(prefs.getString("server", YAI_SERVER_URL));
  config.key = prefs.getString("key", YAI_DEVICE_KEY);
  prefs.end();
}

void saveConfig() {
  prefs.begin("yieldai", false);
  prefs.putString("ssid", config.ssid);
  prefs.putString("pass", config.password);
  prefs.putString("server", config.server);
  prefs.putString("key", config.key);
  prefs.end();
}

bool configComplete() {
  return config.ssid.length() > 0 && config.server.length() > 0 && config.key.length() > 0;
}

bool clockSet() {
  return time(nullptr) > 1700000000;
}

// ---------------------------------------------------------------------------
// Probe (Modbus RTU, function 0x03)
// ---------------------------------------------------------------------------
uint16_t modbusCrc(const uint8_t *data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

bool readRegisters(uint16_t first, uint16_t count, uint16_t *out) {
  uint8_t request[8] = {PROBE_ADDRESS, 0x03, (uint8_t)(first >> 8), (uint8_t)(first & 0xFF),
                        (uint8_t)(count >> 8), (uint8_t)(count & 0xFF), 0, 0};
  uint16_t crc = modbusCrc(request, 6);
  request[6] = crc & 0xFF;
  request[7] = crc >> 8;

  const size_t expected = 5 + 2 * count;
  uint8_t response[5 + 2 * 16];
  if (expected > sizeof(response)) return false;

  for (int attempt = 0; attempt < 3; attempt++) {
    while (probeSerial.available()) probeSerial.read();
    if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, HIGH);
    probeSerial.write(request, sizeof(request));
    probeSerial.flush();
    if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, LOW);

    size_t got = 0;
    unsigned long start = millis();
    while (got < expected && millis() - start < 600) {
      if (probeSerial.available()) response[got++] = probeSerial.read();
    }
    if (got == expected && response[0] == PROBE_ADDRESS && response[1] == 0x03 && response[2] == 2 * count) {
      uint16_t rxCrc = response[expected - 2] | (response[expected - 1] << 8);
      if (rxCrc == modbusCrc(response, expected - 2)) {
        for (uint16_t i = 0; i < count; i++) out[i] = (response[3 + 2 * i] << 8) | response[4 + 2 * i];
        return true;
      }
    }
    delay(150);
  }
  return false;
}

ProbeResult readProbe(Reading &r) {
  uint16_t regs[7];
  r.timestamp = clockSet() ? (uint32_t)time(nullptr) : 0;
  if (!readRegisters(PROBE_FIRST_REGISTER, 7, regs)) return PROBE_NO_ANSWER;
  r.moisture = regs[REG_MOISTURE] * MOISTURE_SCALE;
  r.temperature = (int16_t)regs[REG_TEMPERATURE] * TEMPERATURE_SCALE;
  r.ec = regs[REG_EC];
  r.ph = regs[REG_PH] * PH_SCALE;
  r.n = regs[REG_N];
  r.p = regs[REG_P];
  r.k = regs[REG_K];
  if (r.ph <= 0 || r.ph > 14 || r.moisture > 100) return PROBE_IMPLAUSIBLE;
  return PROBE_OK;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
void appendValue(String &json, const char *name, float value, int decimals) {
  if (isnan(value)) return;
  if (json.length() > 1) json += ",";
  json += "\"";
  json += name;
  json += "\":";
  json += String(value, decimals);
}

String readingJson(const Reading &r) {
  String json = "{";
  // Without a clock (no NTP yet) the timestamp is left out and the server uses its arrival time.
  if (r.timestamp > 0) json += "\"timestamp\":" + String((unsigned long)r.timestamp);
  appendValue(json, "moisture", r.moisture, 1);
  appendValue(json, "temperature", r.temperature, 1);
  appendValue(json, "ec_us_cm", r.ec, 0);
  appendValue(json, "ph", r.ph, 2);
  appendValue(json, "n", r.n, 0);
  appendValue(json, "p", r.p, 0);
  appendValue(json, "k", r.k, 0);
  json += "}";
  return json;
}

String deviceFields() {
  String json = "\"rssi\":";
  json += String((int)WiFi.RSSI());
  json += ",\"fw\":\"" FIRMWARE_VERSION "\",\"uptime_s\":";
  json += String((unsigned long)(millis() / 1000));
  if (lastError.length() > 0) {
    json += ",\"error\":\"";
    json += lastError;
    json += "\"";
  }
  return json;
}

// Pulls "interval_s": <number> out of the server's JSON reply.
void followInterval(const String &body) {
  int at = body.indexOf("\"interval_s\"");
  if (at < 0) return;
  at = body.indexOf(':', at);
  if (at < 0) return;
  long value = body.substring(at + 1).toInt();
  if (value >= MIN_INTERVAL_S && value <= MAX_INTERVAL_S && (uint32_t)value != intervalS) {
    intervalS = value;
    Serial.printf("[yield-ai] Reading interval is now %lu s\n", (unsigned long)intervalS);
  }
}

// Returns the HTTP status (or a negative HTTPClient error).
int post(const String &body) {
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  String url = config.server + "/api/readings";
  bool ok;
  if (url.startsWith("https://")) {
    // Encrypted, but the server certificate is not pinned. To pin it, replace setInsecure()
    // with secure.setCACert(<root CA of your host>).
    secure.setInsecure();
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return -1;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + config.key);
  int status = http.POST(body);
  String reply = status > 0 ? http.getString() : String("");
  http.end();

  if (status > 0) followInterval(reply);
  if (status == 401) Serial.println("[yield-ai] The server rejected the device key — copy it again from the dashboard.");
  else if (status >= 400) Serial.printf("[yield-ai] Server said %d: %s\n", status, reply.c_str());
  else if (status < 0) Serial.printf("[yield-ai] Request failed: %s\n", http.errorToString(status).c_str());
  return status;
}

void keep(const Reading &r) {
  if (bufferedCount == MAX_BUFFERED) {
    memmove(buffered, buffered + 1, sizeof(Reading) * (MAX_BUFFERED - 1));
    bufferedCount--;
  }
  buffered[bufferedCount++] = r;
}

// Sends buffered readings first (oldest first), then the new one. False keeps them for later.
bool sendAll() {
  while (bufferedCount > 0) {
    int n = bufferedCount < MAX_PER_REQUEST ? bufferedCount : MAX_PER_REQUEST;
    String body = "{\"readings\":[";
    for (int i = 0; i < n; i++) {
      if (i) body += ",";
      body += readingJson(buffered[i]);
    }
    body += "]," + deviceFields() + "}";
    int status = post(body);
    if (status < 200 || status >= 300) return false;
    memmove(buffered, buffered + n, sizeof(Reading) * (bufferedCount - n));
    bufferedCount -= n;
  }
  return true;
}

void cycle() {
  Reading r;
  ProbeResult result = readProbe(r);
  if (result == PROBE_OK) {
    lastError = "";
    Serial.printf("[yield-ai] moisture %.1f%%  temp %.1f C  EC %.0f uS/cm  pH %.2f  N %.0f  P %.0f  K %.0f\n", r.moisture,
                  r.temperature, r.ec, r.ph, r.n, r.p, r.k);
    keep(r);
  } else {
    lastError = result == PROBE_NO_ANSWER ? "probe not responding (check RS485 wiring and power)"
                                          : "probe returned implausible values (is it in the soil?)";
    Serial.printf("[yield-ai] %s - sending a heartbeat with the error.\n", lastError.c_str());
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[yield-ai] Wi-Fi down - reading kept, reconnecting...");
    WiFi.reconnect();
    blink(3, 60, 60);
    return;
  }

  bool ok = sendAll();
  if (ok && result != PROBE_OK) {
    int status = post("{" + deviceFields() + "}");
    ok = status >= 200 && status < 300;
  }
  if (ok) blink(1, 40, 0);
  else blink(3, 60, 60);
}

// ---------------------------------------------------------------------------
// Setup hotspot (captive portal)
// ---------------------------------------------------------------------------
String htmlEscape(const String &s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

void handlePortalPage() {
  int found = WiFi.scanNetworks();
  String options;
  for (int i = 0; i < found; i++) options += "<option value=\"" + htmlEscape(WiFi.SSID(i)) + "\">";
  String page =
      "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>Yield AI setup</title><style>"
      "body{font-family:system-ui,sans-serif;background:#f6f3ea;color:#1c2b22;margin:0;padding:24px}"
      "main{max-width:420px;margin:auto;background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px #0002}"
      "h1{font-size:20px;margin:0 0 4px;color:#1f5a3d}p{color:#556;font-size:14px}"
      "label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}"
      "input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px}"
      "button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#1f5a3d;color:#fff;font-size:16px}"
      "</style></head><body><main><h1>Yield AI probe setup</h1>"
      "<p>Device " + chipSuffix() + " · firmware " FIRMWARE_VERSION "</p>"
      "<form method=post action=/save>"
      "<label>Wi-Fi network</label><input name=ssid list=nets required value=\"" + htmlEscape(config.ssid) + "\">"
      "<datalist id=nets>" + options + "</datalist>"
      "<label>Wi-Fi password</label><input name=pass type=password placeholder=\"(unchanged if empty)\">"
      "<label>Dashboard address</label><input name=server type=url required placeholder=\"https://your-app.example.com\" value=\"" +
      htmlEscape(config.server) + "\">"
      "<label>Device key</label><input name=key autocomplete=off placeholder=\"" +
      String(config.key.length() ? "(saved — paste a new one to replace it)" : "yai_…") + "\">"
      "<button>Save and connect</button></form></main></body></html>";
  portal.send(200, "text/html", page);
}

void handlePortalSave() {
  if (portal.hasArg("ssid")) config.ssid = portal.arg("ssid");
  if (portal.arg("pass").length() > 0) config.password = portal.arg("pass");
  if (portal.hasArg("server")) config.server = trimSlash(portal.arg("server"));
  if (portal.arg("key").length() > 0) {
    String key = portal.arg("key");
    key.trim();
    config.key = key;
  }
  saveConfig();
  portal.send(200, "text/html",
              "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;padding:24px'>"
              "<h2>Saved</h2><p>The probe is restarting and will connect to your Wi-Fi. Watch the dashboard for the first "
              "reading.</p></body>");
  delay(1500);
  ESP.restart();
}

void startPortal() {
  portalMode = true;
  portalStarted = millis();
  String name = "YieldAI-Setup-" + chipSuffix();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(name.c_str());
  dns.start(53, "*", WiFi.softAPIP());
  portal.on("/", HTTP_GET, handlePortalPage);
  portal.on("/save", HTTP_POST, handlePortalSave);
  portal.onNotFound([]() {
    portal.sendHeader("Location", "http://192.168.4.1/", true);
    portal.send(302, "text/plain", "");
  });
  portal.begin();
  digitalWrite(LED_PIN, HIGH);
  Serial.printf("[yield-ai] Setup hotspot \"%s\" is open — join it and browse to http://192.168.4.1\n", name.c_str());
}

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------
bool connectWifi() {
  if (config.ssid.length() == 0) return false;
  Serial.printf("[yield-ai] Connecting to Wi-Fi \"%s\"…\n", config.ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(config.ssid.c_str(), config.password.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }
  digitalWrite(LED_PIN, LOW);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[yield-ai] Could not join Wi-Fi.");
    return false;
  }
  Serial.printf("[yield-ai] Wi-Fi connected, IP %s, signal %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  return true;
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[yield-ai] Yield AI probe firmware " FIRMWARE_VERSION);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  if (RS485_DE_PIN >= 0) {
    pinMode(RS485_DE_PIN, OUTPUT);
    digitalWrite(RS485_DE_PIN, LOW);
  }
  probeSerial.begin(PROBE_BAUD, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);

  loadConfig();
  bool forcePortal = digitalRead(BOOT_BUTTON_PIN) == LOW;
  if (forcePortal || !configComplete() || !connectWifi()) {
    startPortal();
    return;
  }
  Serial.printf("[yield-ai] Sending to %s every %lu s (the dashboard can change this).\n", config.server.c_str(),
                (unsigned long)intervalS);
  lastCycle = millis() - intervalS * 1000UL;  // first reading right away
}

void loop() {
  if (portalMode) {
    dns.processNextRequest();
    portal.handleClient();
    // Nobody configured the probe: try the saved Wi-Fi again (e.g. after a router outage).
    if (millis() - portalStarted > PORTAL_TIMEOUT_MS && configComplete()) ESP.restart();
    delay(2);
    return;
  }
  if (millis() - lastCycle >= intervalS * 1000UL) {
    lastCycle = millis();
    cycle();
  }
  delay(20);
}
