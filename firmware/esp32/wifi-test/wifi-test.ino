/*
 * Yield AI — ESP32 Wi-Fi test (Arduino core 2.x or 3.x, no extra libraries).
 *
 * Checks, one step at a time, everything the probe firmware needs from the Wi-Fi, and prints
 * PASS / WARN / FAIL for each on the serial monitor (115200 baud):
 *   1. Radio   scan nearby networks; is WIFI_SSID among them?
 *   2. Join    connect to WIFI_SSID; IP, gateway, signal — or why it failed (e.g. wrong password)
 *   3. DNS     look up the dashboard's host name
 *   4. Clock   set the time over NTP (the probe timestamps its readings with it)
 *   5. Server  GET <SERVER_URL>/api/health, the same server the probe pairs with and sends to
 * Then it keeps watching: every 10 s it prints the signal and repeats step 5, reconnecting when the
 * link drops. Carry the board to where the probe will sit to see if the signal holds up there.
 *
 * Set WIFI_SSID, WIFI_PASS and SERVER_URL below, then upload and open the serial monitor.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
// The dashboard: your deployed site (https://your-site.vercel.app), or a laptop running
// `npm run dev` on the same Wi-Fi (http://192.168.1.20:3000). Not localhost: that's the ESP32 itself.
const char* SERVER_URL = "http://192.168.1.20:3000";

const uint32_t CONNECT_TIMEOUT_MS = 20000;
const uint32_t CHECK_EVERY_MS = 10000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

enum class Result { Pass, Warn, Fail, Skip };

volatile uint8_t lastDisconnectReason = 0;
uint32_t nextCheckAt = 0;
unsigned long checks = 0, failures = 0, drops = 0;
bool wasConnected = false;

const char* resultText(Result r) {
  switch (r) {
    case Result::Pass: return "PASS";
    case Result::Warn: return "WARN";
    case Result::Fail: return "FAIL";
    default: return "SKIP";
  }
}

const char* statusText(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED: return "connected";
    case WL_NO_SSID_AVAIL: return "network not found";
    case WL_CONNECT_FAILED: return "connection failed";
    case WL_CONNECTION_LOST: return "connection lost";
    case WL_DISCONNECTED: return "disconnected";
    case WL_IDLE_STATUS: return "idle";
    default: return "unknown";
  }
}

// ESP-IDF's wifi_err_reason_t, the ones worth explaining.
const char* reasonText(uint8_t reason) {
  switch (reason) {
    case 15:  // 4WAY_HANDSHAKE_TIMEOUT
    case 202: // AUTH_FAIL
    case 204: // HANDSHAKE_TIMEOUT
      return "wrong password";
    case 2: return "authentication timed out (weak signal or wrong password)";
    case 201: return "network not found (name typo, out of range, or a 5 GHz-only network)";
    case 203: return "the router refused the ESP32 (MAC filter, or too many devices?)";
    case 200: return "lost the router's beacon (signal too weak)";
    default: return "see wifi_err_reason_t in the ESP-IDF docs";
  }
}

const char* signalLabel(int rssi) {
  if (rssi >= -60) return "excellent";
  if (rssi >= -70) return "good";
  if (rssi >= -80) return "weak: expect dropped readings";
  return "too weak";
}

void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) lastDisconnectReason = info.wifi_sta_disconnected.reason;
}

String baseUrl() {
  String s = SERVER_URL;
  s.trim();
  while (s.endsWith("/")) s.remove(s.length() - 1);
  if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
  return s;
}

String serverHost() {
  String s = baseUrl();
  s = s.substring(s.indexOf("://") + 3);
  int end = s.length();
  for (const char* c = "/:?"; *c; c++) {
    int i = s.indexOf(*c);
    if (i >= 0 && i < end) end = i;
  }
  return s.substring(0, end);
}

// GET <server>/api/health; returns the HTTP status (negative on a connection error) and fills `reply`.
int getHealth(String& reply, unsigned long& ms) {
  String url = baseUrl() + "/api/health";
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https://")) {
    secure.setInsecure(); // like the probe: the certificate isn't checked
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return -1;
  http.setTimeout(15000);
  unsigned long started = millis();
  int status = http.GET();
  ms = millis() - started;
  reply = status > 0 ? http.getString() : http.errorToString(status);
  http.end();
  return status;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

Result stepScan() {
  Serial.println("\n[1/5] Radio: scanning for Wi-Fi networks...");
  int found = WiFi.scanNetworks();
  if (found <= 0) {
    Serial.println("  No networks at all. Check the antenna and the power supply (use a good USB cable/port).");
    return Result::Fail;
  }
  bool seen = false;
  for (int i = 0; i < found; i++) {
    bool match = WiFi.SSID(i) == WIFI_SSID;
    seen = seen || match;
    Serial.printf("  %s %-32s %4d dBm  ch %2d  %s\n", match ? "->" : "  ", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i),
                  WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
  }
  WiFi.scanDelete();
  if (seen) return Result::Pass;
  Serial.printf("  \"%s\" isn't in the list: check the name (case matters), move closer, and make sure the router\n"
                "  has 2.4 GHz turned on (most ESP32s can't see 5 GHz). Hidden networks don't show up here.\n",
                WIFI_SSID);
  return Result::Warn;
}

Result stepJoin() {
  Serial.printf("\n[2/5] Join: connecting to \"%s\"...\n", WIFI_SSID);
  lastDisconnectReason = 0;
  unsigned long started = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED && millis() - started < CONNECT_TIMEOUT_MS) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("  Not connected after %lu s: %s\n", (unsigned long)(CONNECT_TIMEOUT_MS / 1000), statusText(WiFi.status()));
    if (lastDisconnectReason) Serial.printf("  Reason %u: %s\n", lastDisconnectReason, reasonText(lastDisconnectReason));
    return Result::Fail;
  }
  int rssi = WiFi.RSSI();
  Serial.printf("  Connected in %lu ms\n", millis() - started);
  Serial.printf("  IP %s  gateway %s  DNS %s\n", WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str());
  Serial.printf("  MAC %s  channel %d  signal %d dBm (%s)\n", WiFi.macAddress().c_str(), WiFi.channel(), rssi, signalLabel(rssi));
  wasConnected = true;
  return rssi >= -80 ? Result::Pass : Result::Warn;
}

Result stepDns() {
  String host = serverHost();
  Serial.printf("\n[3/5] DNS: looking up %s...\n", host.c_str());
  IPAddress ip;
  if (ip.fromString(host)) {
    Serial.println("  It's an IP address: nothing to look up.");
    return Result::Pass;
  }
  if (WiFi.hostByName(host.c_str(), ip) == 1) {
    Serial.printf("  %s -> %s\n", host.c_str(), ip.toString().c_str());
    return Result::Pass;
  }
  Serial.println("  Lookup failed: check the address, and that this Wi-Fi reaches the internet.");
  return Result::Fail;
}

Result stepClock() {
  Serial.println("\n[4/5] Clock: asking NTP for the time...");
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  unsigned long started = millis();
  while (time(nullptr) < 1704067200 && millis() - started < 10000) delay(200); // before 2024 = not set yet
  time_t now = time(nullptr);
  if (now < 1704067200) {
    Serial.println("  No answer (UDP port 123 blocked?). The probe still works: it sends each reading's age instead.");
    return Result::Warn;
  }
  char text[32];
  struct tm utc;
  gmtime_r(&now, &utc);
  strftime(text, sizeof text, "%Y-%m-%d %H:%M:%S UTC", &utc);
  Serial.printf("  %s\n", text);
  return Result::Pass;
}

Result stepServer() {
  Serial.printf("\n[5/5] Server: GET %s/api/health...\n", baseUrl().c_str());
  String reply;
  unsigned long ms = 0;
  int status = getHealth(reply, ms);
  Serial.printf("  %d in %lu ms: %.160s\n", status, ms, reply.c_str());
  if (status == 200 && reply.indexOf("\"ok\":true") >= 0) return Result::Pass;
  if (status < 0) {
    Serial.println("  Couldn't connect. Is the server running? For `npm run dev`, use the laptop's Wi-Fi address,\n"
                   "  keep both on the same network, and allow port 3000 through the laptop's firewall. Guest\n"
                   "  networks often stop devices from reaching each other.");
  } else if (status >= 300 && status < 400) {
    Serial.println("  Redirected: the site probably wants https://. Change SERVER_URL.");
  } else {
    Serial.println("  Reached a web server, but not Yield AI's health check: check the address and port.");
  }
  return Result::Fail;
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nYield AI Wi-Fi test");
  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  const char* names[] = {"Radio", "Join", "DNS", "Clock", "Server"};
  Result results[5];
  results[0] = stepScan();
  results[1] = stepJoin();
  bool joined = results[1] != Result::Fail;
  results[2] = joined ? stepDns() : Result::Skip;
  results[3] = joined ? stepClock() : Result::Skip;
  results[4] = joined ? stepServer() : Result::Skip;

  Serial.println("\n=== Summary ===");
  for (int i = 0; i < 5; i++) Serial.printf("  [%s] %s\n", resultText(results[i]), names[i]);
  if (!joined) Serial.println("The ESP32 couldn't join the Wi-Fi: fix that first (see step 2).");
  else if (results[4] == Result::Fail) Serial.println("The Wi-Fi works, but the dashboard can't be reached (see step 5).");
  else Serial.println("Wi-Fi works end to end. Next: flash yield-ai-probe and pair it from the dashboard.");
  Serial.printf("\nWatching the link every %lu s (aim for better than -70 dBm where the probe will sit)...\n",
                (unsigned long)(CHECK_EVERY_MS / 1000));
  nextCheckAt = millis() + CHECK_EVERY_MS;
}

void loop() {
  if ((int32_t)(millis() - nextCheckAt) < 0) {
    delay(20);
    return;
  }
  nextCheckAt = millis() + CHECK_EVERY_MS;
  checks++;

  if (WiFi.status() != WL_CONNECTED) {
    if (wasConnected) drops++;
    wasConnected = false;
    Serial.printf("[watch] Wi-Fi down (%s), reconnecting...\n", statusText(WiFi.status()));
    lastDisconnectReason = 0;
    WiFi.reconnect();
    unsigned long started = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - started < 10000) delay(250);
    if (WiFi.status() != WL_CONNECTED) {
      failures++;
      if (lastDisconnectReason) Serial.printf("[watch] still down, reason %u: %s\n", lastDisconnectReason, reasonText(lastDisconnectReason));
      else Serial.println("[watch] still down");
      return;
    }
    Serial.printf("[watch] back after %lu ms\n", millis() - started);
  }
  wasConnected = true;

  String reply;
  unsigned long ms = 0;
  int status = getHealth(reply, ms);
  if (status != 200) failures++;
  int rssi = WiFi.RSSI();
  Serial.printf("[watch] signal %d dBm (%s)  server %d in %lu ms  failed %lu of %lu  drops %lu\n", rssi, signalLabel(rssi), status, ms,
                failures, checks, drops);
}
