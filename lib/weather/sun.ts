/**
 * Sunrise and sunset (the sunrise equation with refraction, NOAA-style; about a minute of error), for
 * night shading on forecast charts and the weather map's timeline.
 */

const RAD = Math.PI / 180;
const J2000 = 2451545;
const msToJulian = (ms: number) => ms / 86_400_000 + 2440587.5;
const julianToMs = (j: number) => (j - 2440587.5) * 86_400_000;

/** Sunrise and sunset (ms, UTC) of the solar day nearest `ms` at a location; null in polar day/night. */
export function sunTimes(ms: number, lat: number, lng: number): { rise: number; set: number } | null {
  const n = Math.round(msToJulian(ms) - J2000 - 0.0009 + lng / 360);
  const jStar = n + 0.0009 - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  return { rise: julianToMs(transit - w / 360), set: julianToMs(transit + w / 360) };
}

/** Night intervals [start, end] (ms) overlapping [from, to]. */
export function nightSpans(from: number, to: number, lat: number, lng: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const DAY = 86_400_000;
  let prevSet: number | null = null;
  for (let d = from - DAY; d <= to + DAY; d += DAY) {
    const s = sunTimes(d, lat, lng);
    if (!s) continue;
    if (prevSet != null && s.rise > prevSet) {
      const a = Math.max(from, prevSet);
      const b = Math.min(to, s.rise);
      if (b > a) spans.push([a, b]);
    }
    prevSet = s.set;
  }
  return spans;
}

export function isNight(ms: number, lat: number, lng: number): boolean {
  const s = sunTimes(ms, lat, lng);
  if (!s) return false;
  // The solar day nearest `ms` can start after it (just before midnight): compare with that day's times.
  return ms < s.rise || ms > s.set;
}
