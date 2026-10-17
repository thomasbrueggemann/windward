import { rngFor } from './world/seed.js';

// Small, fast 2D gradient noise (deterministic per world seed).
const P = new Uint8Array(512);
(function seed() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const rnd = rngFor('noise');
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();

const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1]);

/** Gradient noise in roughly [-1, 1]. */
export function noise2(x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const X = fx & 255, Y = fy & 255;
  x -= fx; y -= fy;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const a = P[P[X] + Y] & 7, b = P[P[X + 1] + Y] & 7;
  const c = P[P[X] + Y + 1] & 7, d = P[P[X + 1] + Y + 1] & 7;
  const n00 = GX[a] * x + GY[a] * y;
  const n10 = GX[b] * (x - 1) + GY[b] * y;
  const n01 = GX[c] * x + GY[c] * (y - 1);
  const n11 = GX[d] * (x - 1) + GY[d] * (y - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
}

export function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f);
    n += a; a *= gain; f *= lac;
  }
  return s / n;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
