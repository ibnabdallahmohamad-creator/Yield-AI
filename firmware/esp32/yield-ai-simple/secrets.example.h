// Copy this file to secrets.h (same folder) and fill it in. secrets.h is git-ignored.
#pragma once

// Farm Wi-Fi (2.4 GHz, WPA2 with a password)
#define WIFI_SSID     "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// Your Yield AI site: the deployed URL, or http://<laptop-ip>:3000 for `npm run dev` on the same
// Wi-Fi. Never localhost (that is the ESP32 itself). No trailing slash.
#define SERVER_URL    "https://your-site.vercel.app"

// Dashboard → Farms & devices → Connect ESP32. Single use, valid 30 minutes. Only needed the first
// time: the token it is exchanged for is kept in flash.
#define PAIRING_CODE  "XXXX-XXXX"
