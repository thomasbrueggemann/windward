import { noise2 } from '../noise.js';

const TAU = Math.PI * 2;

/** Length of the walkable pilgrimage (world units along -Z). */
export const PATH_LEN = 2045;
/** The distant mountain every traveler is drawn to. */
export const MOUNTAIN = { x: 0, z: -2650, H: 1020, R: 1100 };
/** Prevailing wind (unit vector in XZ); dunes' steep lee faces point down-wind. */
export const WIND = (() => { const x = 0.3, z = -0.95, l = Math.hypot(x, z); return { x: x / l, z: z / l }; })();

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

export const progressAt = (z) => clamp(-z / PATH_LEN, 0, 1);
export const zAtProgress = (p) => -p * PATH_LEN;

function basePath(z) {
  const p = progressAt(z);
  const w = 1 - smooth(0.62, 1.0, p);
  return w * (95 * Math.sin(z * 0.0031) + 42 * (Math.sin(z * 0.0087 + 1.3) - Math.sin(1.3)));
}
const canyonWiggle = (z) => 22 * Math.sin(z * 0.011) + 10 * Math.sin(z * 0.027 + 2);

/** Centre-line of the pilgrimage (it follows the canyon floor through the depths). */
export function pathX(z) {
  const p = progressAt(z);
  const inCanyon = smooth(0.49, 0.53, p) * (1 - smooth(0.76, 0.82, p));
  return basePath(z) + canyonWiggle(z) * inCanyon;
}

// Asymmetric dune profile: gentle windward rise, steep lee fall.
const skew = (ph) => Math.sin(ph - 0.55 * Math.sin(ph));

function trenchEnv(z) {
  const p = progressAt(z);
  return smooth(0.50, 0.545, p) * (1 - smooth(0.70, 0.79, p));
}
function trenchCenter(z) { return basePath(z) + canyonWiggle(z); }
export { trenchCenter };

/** 0..1: how deep inside the canyon ("the depths") this point is. */
export function trenchAmount(x, z) {
  const env = trenchEnv(z);
  if (env <= 0) return 0;
  const d = Math.abs(x - trenchCenter(z));
  return env * (1 - smooth(36, 84, d));
}

function mountainHeight(x, z) {
  const dx = x - MOUNTAIN.x, dz = z - MOUNTAIN.z;
  // the massif is much wider than it is deep, so it fills the horizon
  const r = Math.hypot(dx * 0.62, dz) / MOUNTAIN.R;
  if (r >= 1) return 0;
  const skirt = 0.30 * Math.pow(1 - r, 1.2);
  const q = Math.max(0, 1 - r / 0.55);
  let cone = 0.62 * Math.pow(q, 1.5);
  // flanking shoulders
  const sh1 = Math.exp(-(((dx - 430) ** 2) / (2 * 190 * 190) + ((dz + 20) ** 2) / (2 * 300 * 300)));
  const sh2 = Math.exp(-(((dx + 380) ** 2) / (2 * 170 * 170) + ((dz - 40) ** 2) / (2 * 280 * 280)));
  cone += 0.2 * sh1 * Math.min(1, (1 - r) * 3) + 0.16 * sh2 * Math.min(1, (1 - r) * 3);
  if (q > 0) {
    const ang = Math.atan2(dz, dx);
    const rough = noise2(dx * 0.004 + 30, dz * 0.004 + 30) * 0.5 + noise2(dx * 0.011, dz * 0.011) * 0.25;
    const ridge = 0.5 + 0.5 * Math.sin(ang * 9 + rough * 7);
    cone *= (0.86 + 0.28 * ridge) * (1 + 0.22 * rough * Math.min(1, q * 3));
    // the glowing cleft splitting the summit in two
    const notch = 0.075 * Math.exp(-(dx * dx) / (2 * 22 * 22)) * smooth(0.5, 1, q);
    cone -= notch;
  }
  return MOUNTAIN.H * (skirt + cone);
}

/** Height of the very top of the cleft (for the glow). */
export function summitPoint() {
  return { x: MOUNTAIN.x, y: mountainHeight(MOUNTAIN.x, MOUNTAIN.z) + 6, z: MOUNTAIN.z };
}

function rawHeight(x, z, lod) {
  const p = progressAt(z);

  // large-scale domain warp keeps crest lines meandering
  const wx = x + 55 * noise2(x * 0.0031 + 11.3, z * 0.0031 + 4.7);
  const wz = z + 55 * noise2(x * 0.0031 - 5.1, z * 0.0031 + 9.2);
  const u = wx * WIND.x + wz * WIND.z;          // along wind
  const v = -wx * WIND.z + wz * WIND.x;         // along the crest line

  // dune amplitude schedule over the pilgrimage
  const env = trenchEnv(z);
  let ds = 1;
  ds *= 1 - 0.55 * smooth(0.27, 0.33, p) * (1 - smooth(0.50, 0.54, p)); // ruined city sits on calmer ground
  ds *= 1 - 0.4 * env;
  ds *= 1 - 0.55 * smooth(0.70, 0.735, p) * (1 - smooth(0.80, 0.85, p));   // a walkable ramp out of the depths
  ds *= 1 - 0.3 * smooth(0.74, 0.80, p);

  // mountain skirt calms the dunes
  const mdx = x - MOUNTAIN.x, mdz = z - MOUNTAIN.z;
  const mr = Math.hypot(mdx, mdz) / MOUNTAIN.R;
  ds *= 1 - 0.5 * smooth(1.15, 0.7, mr);

  const lam1 = 150 + 45 * noise2(x * 0.0013 + 2, z * 0.0013 - 6);
  const m1 = noise2(v * 0.0045 + 3.1, u * 0.0012) * 70;
  let h = 11 * ds * skew(((u + m1) / lam1) * TAU);
  // slow rolling swells
  h += 22 * ds * noise2(x * 0.0016 + 40, z * 0.0016 + 12);
  h += 9 * noise2(x * 0.0045 - 12, z * 0.0045 + 77) * ds;

  if (!lod) {
    const m2 = noise2(v * 0.012 + 9, u * 0.004) * 30;
    const amp2 = 0.5 + 0.5 * noise2(x * 0.01 + 5, z * 0.01 - 3);
    h += 3.4 * ds * amp2 * skew(((u + m2) / 52) * TAU);
    h += 0.8 * ds * noise2(x * 0.05, z * 0.05);
  }

  // the canyon ("the depths")
  const tr = trenchAmount(x, z);
  if (tr > 0) {
    h -= 58 * tr;
    // rough walls, but keep the floor (where the path runs) smooth enough to walk
    const wall = 4 * tr * (1 - tr) * smooth(14, 44, Math.abs(x - trenchCenter(z)));
    h += 9 * wall * noise2(x * 0.03 + 3, z * 0.03 - 8);
    if (!lod) h += 2.4 * wall * noise2(x * 0.09, z * 0.09);
  }

  h += mountainHeight(x, z);
  return h;
}

// Flattened plazas for the ruined city (filled in by ruins layout).
export const PLAZAS = [];
export function addPlaza(x, z, r0, r1) {
  const h0 = rawHeight(x, z, false);
  const pl = { x, z, r0, r1, h: h0 };
  PLAZAS.push(pl);
  return pl;
}

export function terrainHeight(x, z) {
  let h = rawHeight(x, z, false);
  for (let i = 0; i < PLAZAS.length; i++) {
    const pl = PLAZAS[i];
    const dx = x - pl.x, dz = z - pl.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > pl.r1 * pl.r1) continue;
    const w = 1 - smooth(pl.r0, pl.r1, Math.sqrt(d2));
    h = lerp(h, pl.h, w);
  }
  return h;
}

export function terrainHeightFar(x, z) { return rawHeight(x, z, true); }

const _g = { x: 0, z: 0 };
/** Terrain gradient dh/dx, dh/dz (shared object — copy if you keep it). */
export function terrainGradient(x, z, e = 0.6) {
  _g.x = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  _g.z = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return _g;
}
