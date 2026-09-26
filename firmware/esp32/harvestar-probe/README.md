# Harvestar AI probe — ESP32 firmware

Sends soil readings from an ESP32 to your Harvestar AI dashboard over Wi-Fi. It pairs with a short code
from the dashboard (no keys to type), sends a reading every 10 s by default, follows the interval you
set in the dashboard, and keeps readings while the Wi-Fi is down.

Works with any ESP32 dev board (ESP32-WROOM / DevKit v1), Arduino core 2.x or 3.x. No extra
libraries.

## Flash it

**Arduino IDE:** install the *esp32* boards package (Espressif), open `harvestar-probe.ino`, pick
*ESP32 Dev Module*, then Upload.

**arduino-cli:**

```bash
arduino-cli core install esp32:esp32
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/esp32/harvestar-probe
arduino-cli upload  --fqbn esp32:esp32:esp32 -p COM5 firmware/esp32/harvestar-probe   # or /dev/ttyUSB0
```

On Windows, if the compile fails with `bits/c++config.h: No such file or directory`, the build path is
too long: build from a short folder (e.g. `subst W: <folder>`), or pass `--build-path C:\b`.

## Connect it

1. In the dashboard: **Farms & devices → Connect ESP32**. Pick the farm and the interval; you get a
   pairing code like `K8A3-BNSQ` (valid 30 minutes) and the server address.
2. Power the ESP32. It opens a Wi-Fi network **`Harvestar-Setup-XXXX`**. Join it with a phone; the setup
   page opens by itself (or browse to `http://192.168.4.1`).
3. Pick the farm's Wi-Fi, type its password, the server address and the pairing code. **Save and
   connect.**
4. The probe restarts, joins the Wi-Fi, pairs and starts sending. The dashboard shows
   *Receiving readings* within a minute.

Server address: your deployed site (`https://your-site.vercel.app`), or, for a laptop running
`npm run dev`, its address on the same Wi-Fi (`http://192.168.1.20:3000`, shown in the connect
dialog). `localhost` doesn't work: it means the ESP32 itself.

If something goes wrong (wrong password, expired code, server unreachable) the setup network comes back
and its page says why. Hold **BOOT** for 5 s to forget the Wi-Fi and the pairing and start over.

## Sensors

Set the switches at the top of the sketch, or pass them as build flags with arduino-cli, e.g.
`--build-property "compiler.cpp.extra_flags=-DUSE_RS485_SOIL=1 -DUSE_ANALOG_MOISTURE=0"`:

| Switch | Default | Sensor |
| --- | --- | --- |
| `USE_ANALOG_MOISTURE` | `1` | Capacitive soil-moisture sensor (v1.2) on GPIO 34. Calibrate `MOISTURE_RAW_DRY` (in air) and `MOISTURE_RAW_WET` (in water). |
| `USE_RS485_SOIL` | `0` | RS485 "7-in-1" soil sensor (moisture, temperature, EC, pH, N, P, K), Modbus RTU at 4800 baud through a MAX485 module: RX 16, TX 17, DE/RE 4 (`-1` for auto-direction modules). Registers 0x0000–0x0006; check your sensor's sheet. |
| `SIMULATE_SENSORS` | `0` | Plausible test values, to check the whole path with a bare board. |

With no sensor enabled, it sends test values.

## What it does

| When | Request |
| --- | --- |
| After setup | `POST <server>/api/device/pair` `{ code, firmware, mac, ip, rssi }` → a device token, kept in flash (the code is single use) |
| Every `interval_s` | `POST <server>/api/readings` with `Authorization: Bearer <token>`: the new reading, plus any buffered ones, in one batch |

- **Interval.** Each reply carries `interval_s`, so a change in the dashboard reaches the probe with
  its next reading, no reflashing (clamped to 5 s – 1 hour).
- **Time.** The clock is set over NTP; readings carry Unix timestamps, or their age (`age_s`) if NTP
  hasn't answered yet.
- **Offline.** If the server can't be reached, up to 360 readings are kept in memory (an hour at 10 s)
  and sent in batches of 60 when it's back. Readings the server rejects (422) are dropped.
- **Token revoked** (401: the device was removed, or a new token was made): back to setup mode.
- **HTTPS.** The server's certificate isn't checked by default; set `ROOT_CA` in the sketch to check it.

Serial monitor at 115200 baud shows `[pair]`, `[send]` and `[sensor]` lines.

## Without hardware

`npm run device:sim -- --code K8A3-BNSQ` (from the project root) is a simulated probe speaking the same
protocol. See the main [README](../../../README.md#esp32-devices) for the full protocol.
