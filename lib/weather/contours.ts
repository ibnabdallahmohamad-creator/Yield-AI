/**
 * Isolines (isotherms, isobars, humidity lines) by marching squares on a regular grid of samples,
 * with linear interpolation along cell edges. Returns loose segments per level, in the grid's own
 * coordinates; callers scale them to pixels. Saddle cells are resolved with the cell's mean.
 */

export interface ContourSet {
  level: number;
  /** x1, y1, x2, y2 per segment, in sample units (0 … w−1, 0 … h−1). */
  segments: number[];
}

/** Levels at multiples of `step` inside [min, max]. */
export function contourLevels(min: number, max: number, step: number, limit = 60): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || step <= 0) return [];
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max && out.length < limit; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function marchingSquares(values: Float32Array, w: number, h: number, levels: number[]): ContourSet[] {
  const sets: ContourSet[] = [];
  for (const level of levels) {
    const seg: number[] = [];
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const k = y * w + x;
        const a = values[k]; // top-left
        const b = values[k + 1]; // top-right
        const c = values[k + w + 1]; // bottom-right
        const d = values[k + w]; // bottom-left
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
        const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        // Edge crossings: top (a–b), right (b–c), bottom (d–c), left (a–d).
        const top = () => [x + frac(a, b, level), y];
        const right = () => [x + 1, y + frac(b, c, level)];
        const bottom = () => [x + frac(d, c, level), y + 1];
        const left = () => [x, y + frac(a, d, level)];
        const push = (p: number[], q: number[]) => seg.push(p[0], p[1], q[0], q[1]);
        switch (idx) {
          case 1:
          case 14:
            push(left(), bottom());
            break;
          case 2:
          case 13:
            push(bottom(), right());
            break;
          case 3:
          case 12:
            push(left(), right());
            break;
          case 4:
          case 11:
            push(top(), right());
            break;
          case 6:
          case 9:
            push(top(), bottom());
            break;
          case 7:
          case 8:
            push(left(), top());
            break;
          case 5:
          case 10: {
            const centre = (a + b + c + d) / 4 >= level;
            if ((idx === 5) === centre) {
              push(left(), top());
              push(bottom(), right());
            } else {
              push(left(), bottom());
              push(top(), right());
            }
            break;
          }
        }
      }
    }
    if (seg.length) sets.push({ level, segments: seg });
  }
  return sets;
}

function frac(v0: number, v1: number, level: number): number {
  const d = v1 - v0;
  return Math.abs(d) < 1e-12 ? 0.5 : Math.min(1, Math.max(0, (level - v0) / d));
}
