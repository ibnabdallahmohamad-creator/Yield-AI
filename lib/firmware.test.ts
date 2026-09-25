import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cString, fillFirmware } from "./firmware";

const template = readFileSync(new URL("../public/firmware/yield-ai-esp32/yield-ai-esp32.ino", import.meta.url), "utf8");

describe("ESP32 firmware generator", () => {
  it("escapes C string literals", () => {
    expect(cString('my "home" wifi')).toBe('"my \\"home\\" wifi"');
    expect(cString("back\\slash")).toBe('"back\\\\slash"');
    expect(cString("")).toBe('""');
  });

  it("fills the four settings of the real sketch", () => {
    const sketch = fillFirmware(template, {
      ssid: "Farm WiFi",
      password: 'p@ss"word',
      server: "https://yield.example.com/",
      key: "yai_abcdefghijklmnopqrstuvwxyz",
    });
    expect(sketch).toContain('#define YAI_WIFI_SSID "Farm WiFi"');
    expect(sketch).toContain('#define YAI_WIFI_PASSWORD "p@ss\\"word"');
    expect(sketch).toContain('#define YAI_SERVER_URL "https://yield.example.com"');
    expect(sketch).toContain('#define YAI_DEVICE_KEY "yai_abcdefghijklmnopqrstuvwxyz"');
    // Everything else is untouched.
    expect(sketch.split("\n").length).toBe(template.split("\n").length);
  });

  it("leaves Wi-Fi empty when not given, so the device opens its setup hotspot", () => {
    const sketch = fillFirmware(template, { ssid: "", password: "", server: "http://192.168.1.20:3000", key: "yai_x" });
    expect(sketch).toContain('#define YAI_WIFI_SSID ""');
    expect(sketch).toContain('#define YAI_SERVER_URL "http://192.168.1.20:3000"');
  });
});
