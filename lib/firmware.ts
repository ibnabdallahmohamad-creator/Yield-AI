/**
 * Fills the ESP32 sketch (public/firmware/yield-ai-esp32/yield-ai-esp32.ino) with a device's
 * settings. Runs in the browser, so the Wi-Fi password typed there never reaches the server.
 */

export const FIRMWARE_PATH = "/firmware/yield-ai-esp32/yield-ai-esp32.ino";
export const FIRMWARE_FILENAME = "yield-ai-esp32.ino";

export interface FirmwareSettings {
  ssid: string;
  password: string;
  server: string;
  key: string;
}

/** A C string literal: quotes, backslashes and control characters escaped. */
export function cString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}""`;
    else out += ch;
  }
  return `${out}"`;
}

const DEFINES: Record<keyof FirmwareSettings, string> = {
  ssid: "YAI_WIFI_SSID",
  password: "YAI_WIFI_PASSWORD",
  server: "YAI_SERVER_URL",
  key: "YAI_DEVICE_KEY",
};

export function fillFirmware(template: string, settings: FirmwareSettings): string {
  let out = template;
  for (const [field, name] of Object.entries(DEFINES) as Array<[keyof FirmwareSettings, string]>) {
    const value = field === "server" ? settings.server.trim().replace(/\/+$/, "") : settings[field];
    const pattern = new RegExp(`^#define ${name} .*$`, "m");
    if (!pattern.test(out)) throw new Error(`The firmware template has no ${name} setting.`);
    out = out.replace(pattern, () => `#define ${name} ${cString(value)}`);
  }
  return out;
}
