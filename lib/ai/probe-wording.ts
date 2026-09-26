/**
 * The training set calls the soil-moisture source "the field robot"; on this site it is the farm's
 * ESP32 probes. The model's input keeps the training wording (it must match what the model learned);
 * only the answer shown to people is reworded.
 */
const RULES: Array<[RegExp, string]> = [
  [/\bthe field robot's\b/gi, "the probes'"],
  [/\bthe robot's\b/gi, "the probes'"],
  [/\bfield robot probes?\b/gi, "ESP32 probes"],
  [/\bthe field robot\b/gi, "the probes"],
  [/\bthe robot\b/gi, "the probes"],
  [/\brobot survey\b/gi, "probe survey"],
  [/\brobot\b/gi, "probe"],
];

function reword(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, (match) => (match[0] === match[0].toUpperCase() ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement));
  }
  return out;
}

/** Every string in the answer, reworded; the shape and every number stay as they are. */
export function probeWording<T>(value: T): T {
  if (typeof value === "string") return reword(value) as T;
  if (Array.isArray(value)) return value.map((v) => probeWording(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, probeWording(v)])) as T;
  }
  return value;
}
