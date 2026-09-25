# ESP32 Wi-Fi test

A small sketch that checks the ESP32's Wi-Fi on its own, before you flash the
[probe firmware](../yield-ai-probe). It runs five steps and prints PASS / WARN / FAIL for each, with
the likely fix when one fails:

| Step | Checks | Typical failure |
| --- | --- | --- |
| 1. Radio | Scans nearby networks and looks for yours | Not listed: name typo, too far, or a 5 GHz-only router (most ESP32s are 2.4 GHz only) |
| 2. Join | Connects; prints IP, gateway, channel and signal | `reason 15/202/204`: wrong password · `reason 201`: network not found |
| 3. DNS | Looks up the dashboard's host name | No internet on this Wi-Fi, or a typo in the address |
| 4. Clock | Sets the time over NTP | Only a WARN: the probe then sends each reading's age instead of a timestamp |
| 5. Server | `GET <server>/api/health` → `200 {"ok":true,...}` | Server not running, `localhost` used, laptop firewall, or a guest network that isolates devices |

It then keeps watching: every 10 s it prints the signal strength and repeats step 5, and reconnects
when the link drops. Carry the board to where the probe will sit: better than −70 dBm is good,
below −80 dBm expect dropped readings.

## Run it

1. Set `WIFI_SSID`, `WIFI_PASS` and `SERVER_URL` at the top of `wifi-test.ino`. For a laptop running
   `npm run dev`, `SERVER_URL` is its address on the same Wi-Fi (e.g. `http://192.168.1.20:3000`,
   shown in *Farms & devices → Connect ESP32*), never `localhost`.
2. Upload it (Arduino IDE: *ESP32 Dev Module*, or):

   ```bash
   arduino-cli compile --fqbn esp32:esp32:esp32 firmware/esp32/wifi-test
   arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/esp32/wifi-test   # or COM5
   arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
   ```

3. Read the summary:

   ```
   === Summary ===
     [PASS] Radio
     [PASS] Join
     [PASS] DNS
     [PASS] Clock
     [PASS] Server
   Wi-Fi works end to end. Next: flash yield-ai-probe and pair it from the dashboard.
   ```

To check the server end from your computer first: `curl http://192.168.1.20:3000/api/health`
should answer `{"ok":true,...}`.

## Then test the probe firmware end to end

Flash [`yield-ai-probe`](../yield-ai-probe) with test values, so no sensor is needed:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/esp32/yield-ai-probe \
  --build-property "compiler.cpp.extra_flags=-DSIMULATE_SENSORS=1"
```

| Test | Do | Expect |
| --- | --- | --- |
| Setup page | Power it on, join `YieldAI-Setup-XXXX` from a phone | The setup page lists your Wi-Fi networks |
| Pairing | Enter Wi-Fi, server and a pairing code from *Connect ESP32* | Serial: `[wifi] connected…`, `[pair] 200 {…"token":"yd_…"}`; the dialog shows *Receiving readings* |
| Readings | Leave it running | `[send] 1 readings → 201 {"ok":true,"stored":1,…}` every interval |
| Interval | Change the device's interval in *Farms & devices* | `[send] interval changed to N s` on the next reading |
| Server down | Stop `npm run dev` for a minute, then start it again | `[send] … → -1 connection refused` while it's down, then one batch `[send] N readings → 201` |
| Wi-Fi down | Switch the router off for a minute, then on again | `[wifi] offline, N reading(s) waiting`, then one batch `[send] N readings → 201` |
| Wrong password | Hold BOOT 5 s, set it up again with a bad password | The setup network comes back saying it couldn't join the Wi-Fi |
| Removed device | *Farms & devices* → the device's menu → *Remove device* | `[send] token refused: pair again`, back to setup mode |
