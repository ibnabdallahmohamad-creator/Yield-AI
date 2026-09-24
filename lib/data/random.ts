/** Deterministic pseudo-random helpers so mock data and the Supabase seed are identical. */

/** FNV-1a 32-bit hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG → uniform [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...keys: Array<string | number>): () => number {
  return mulberry32(hashString(keys.join(":")));
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Stationary AR(1) series with lag-1 correlation `phi` and marginal standard deviation `sigma`. */
export function ar1Series(rng: () => number, length: number, phi: number, sigma: number): number[] {
  const out: number[] = [];
  let x = gaussian(rng) * sigma;
  const innovation = sigma * Math.sqrt(1 - phi * phi);
  for (let i = 0; i < length; i++) {
    out.push(x);
    x = phi * x + innovation * gaussian(rng);
  }
  return out;
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
