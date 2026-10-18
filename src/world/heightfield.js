import { noise2 } from '../noise.js';
import { rngFor, range, sign } from './seed.js';
import { planSlides, placeSlides, makeCarve, courseXAtZ, slideNearest } from './slidecourse.js';

const TAU = Math.PI * 2;

// Per-world shape of the land: route meander, dune grain and the mountain's place, all within hand-tuned bounds.
const W = (() => {
  const r = rngFor('terrain');
  return {
    len: Math.round(2045 * range(r, 0.94, 1.07)),
    a1: 95 * range(r, 0.75, 1.2) * sign(r), f1: 0.0031 * range(r, 0.82, 1.18), p1: range(r, 0, TAU),
    a2: 42 * range(r, 0.7, 1.25), f2: 0.0087 * range(r, 0.82, 1.18), p2: range(r, 0, TAU),
    c1: 22 * range(r, 0.75, 1.25), cf1: 0.011 * range(r, 0.85, 1.15), cp1: range(r, 0, TAU),
    c2: 10 * range(r, 0.6, 1.3), cf2: 0.027 * range(r, 0.85, 1.15), cp2: range(r, 0, TAU),
    wind: Math.atan2(0.3, -0.95) + range(r, -0.22, 0.22),
    lam: 150 * range(r, 0.88, 1.15), dune: 11 * range(r, 0.85, 1.12), swell: 22 * range(r, 0.85, 1.1), lam2: 52 * range(r, 0.9, 1.15),
    mx: range(r, -120, 120), mdz: range(r, 585, 625), mH: 1020 * range(r, 0.95, 1.05),
    s1x: 430 * range(r, 0.85, 1.15), s1z: range(r, -60, 40), s1a: 0.2 * range(r, 0.8, 1.2),
    s2x: -380 * range(r, 0.85, 1.15), s2z: range(r, -20, 80), s2a: 0.16 * range(r, 0.8, 1.2),
    ridges: 8 + ((r() * 3) | 0), calm: 0,
  };
})();
export const WORLD_SHAPE = W;

// The long sand slides (slidecourse.js) are inserted into the route: each adds its z-extent of ground at one point
// of the progress scale, so everything placed by progress keeps its place and the slide is extra road.
const SL = planSlides();
/** The long slides of this world (course geometry, profile, pace; see slidecourse.js). */
export const SLIDES = SL.list;
for (const d of SLIDES) { d.zs = -(d.p * W.len + d.Ebefore); d.ze = d.zs - d.E; }
const GOLD = SLIDES.find((d) => d.kind === 'gold');

/** Metres per unit of progress outside the slides (the walkable pilgrimage without them). */
export const PATH_LEN = W.len;
/** Full z-length of the route including the inserted slides. */
export const ROUTE_LEN = W.len + SL.E;
/** The distant mountain every traveler is drawn to. */
export const MOUNTAIN = { x: W.mx, z: -(ROUTE_LEN + W.mdz), H: W.mH, R: 1100 };
/** Prevailing wind (unit vector in XZ); dunes' steep lee faces point down-wind. */
export const WIND = { x: Math.sin(W.wind), z: Math.cos(W.wind) };

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Progress 0..1 along the route; constant across a slide's inserted ground. */
export const progressAt = (z) => {
  let d = -z;
  for (const s of SLIDES) {
    const a = s.p * PATH_LEN;          // d already has the earlier slides taken out
    if (d < a) break;
    if (d < a + s.E) return s.p;
    d -= s.E;
  }
  return clamp(d / PATH_LEN, 0, 1);
};
/** z of progress p (a slide's insertion point maps to the slide's far end). */
export const zAtProgress = (p) => {
  let e = 0;
  for (const s of SLIDES) if (p >= s.p) e += s.E;
  return -(p * PATH_LEN + e);
};
/** The slide whose inserted ground contains z (or null). */
export function slideSpanAt(z) {
  for (const s of SLIDES) if (z <= s.zs && z >= s.ze) return s;
  return null;
}

function basePath(z) {
  const p = progressAt(z);
  const w = 1 - smooth(0.62, 1.0, p);
  // starts at x = 0, ends at the foot of the mountain's cleft
  return w * (W.a1 * (Math.sin(z * W.f1 + W.p1) - Math.sin(W.p1)) + W.a2 * (Math.sin(z * W.f2 + W.p2) - Math.sin(W.p2))) + MOUNTAIN.x * smooth(0.55, 1.0, p);
}
const canyonWiggle = (z) => W.c1 * Math.sin(z * W.cf1 + W.cp1) + W.c2 * Math.sin(z * W.cf2 + W.cp2);

/** Centre-line of the pilgrimage (it follows the canyon floor through the depths). */
export function pathX(z) {
  for (const s of SLIDES) if (s.ready && z <= s.zs && z >= s.ze) return courseXAtZ(s, z);
  return pathXOrig(z);
}
function pathXOrig(z) {
  const p = progressAt(z);
  const inCanyon = smooth(0.49, 0.53, p) * (1 - smooth(0.76, 0.82, p));
  return basePath(z) + canyonWiggle(z) * inCanyon;
}

// Asymmetric dune profile: gentle windward rise, steep lee fall.
const skew = (ph) => Math.sin(ph - 0.55 * Math.sin(ph));

function trenchEnv(z) {
  const p = progressAt(z);
  let a;
  // the canyon opens along the golden slide: barely a dip before it, full depth below it
  if (!GOLD) a = smooth(0.50, 0.545, p);
  else if (z > GOLD.zs) a = 0.15 * smooth(0.50, GOLD.p, p);
  else if (z > GOLD.ze) a = 0.15 + 0.85 * smooth(0.04, 0.85, (GOLD.zs - z) / GOLD.E);
  else a = 1;
  return a * (1 - smooth(0.70, 0.79, p));
}

/** Each slide drops the world beyond it (a lower basin the rest of the route sits in), ramping across its span. */
function slideStep(z) {
  let h = 0;
  for (const s of SLIDES) if (s.D > 0 && z < s.zs) h += s.D * (z <= s.ze ? 1 : smooth(0, 1, (s.zs - z) / s.E));
  return h;
}

/**
 * Progress for the colour script. The city keeps its golden hour right up to the golden slide, which then carries
 * the light down through dusk into the blue of the depths as you descend.
 */
export function paletteProgressAt(z) {
  const p = progressAt(z);
  if (!GOLD) return p;
  if (z > GOLD.zs) return p <= 0.45 ? p : 0.45 + (p - 0.45) * (0.015 / (GOLD.p - 0.45));
  if (z > GOLD.ze) return 0.465 + 0.1 * smooth(0, 1, (GOLD.zs - z) / GOLD.E);
  return p >= 0.58 ? p : 0.565 + (p - GOLD.p) * (0.015 / (0.58 - GOLD.p));
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
  const sh1 = Math.exp(-(((dx - W.s1x) ** 2) / (2 * 190 * 190) + ((dz - W.s1z) ** 2) / (2 * 300 * 300)));
  const sh2 = Math.exp(-(((dx - W.s2x) ** 2) / (2 * 170 * 170) + ((dz - W.s2z) ** 2) / (2 * 280 * 280)));
  cone += W.s1a * sh1 * Math.min(1, (1 - r) * 3) + W.s2a * sh2 * Math.min(1, (1 - r) * 3);
  if (q > 0) {
    const ang = Math.atan2(dz, dx);
    const rough = noise2(dx * 0.004 + 30, dz * 0.004 + 30) * 0.5 + noise2(dx * 0.011, dz * 0.011) * 0.25;
    const ridge = 0.5 + 0.5 * Math.sin(ang * W.ridges + rough * 7);
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
  ds *= 1 - W.calm * smooth(0.78, 0.84, p);                                   // per-world: keep the final climb walkable

  // mountain skirt calms the dunes
  const mdx = x - MOUNTAIN.x, mdz = z - MOUNTAIN.z;
  const mr = Math.hypot(mdx, mdz) / MOUNTAIN.R;
  ds *= 1 - 0.5 * smooth(1.15, 0.7, mr);

  const lam1 = W.lam + 45 * noise2(x * 0.0013 + 2, z * 0.0013 - 6);
  const m1 = noise2(v * 0.0045 + 3.1, u * 0.0012) * 70;
  let h = W.dune * ds * skew(((u + m1) / lam1) * TAU);
  // slow rolling swells
  h += W.swell * ds * noise2(x * 0.0016 + 40, z * 0.0016 + 12);
  h += 9 * noise2(x * 0.0045 - 12, z * 0.0045 + 77) * ds;

  if (!lod) {
    const m2 = noise2(v * 0.012 + 9, u * 0.004) * 30;
    const amp2 = 0.5 + 0.5 * noise2(x * 0.01 + 5, z * 0.01 - 3);
    h += 3.4 * ds * amp2 * skew(((u + m2) / W.lam2) * TAU);
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
  return h - slideStep(z);
}

/** Steepest sustained uphill grade along the path centre (`win` m windows) between two progress values. */
export function pathGrade(p0, p1, win = 20) {
  let worst = 0;
  const hw = win / 2;
  for (let z = zAtProgress(p0); z > zAtProgress(p1); z -= 2) {
    const a = rawHeight(pathX(z + hw), z + hw, false), b = rawHeight(pathX(z - hw), z - hw, false);
    worst = Math.max(worst, (b - a) / Math.hypot(win, pathX(z - hw) - pathX(z + hw)));
  }
  return worst;
}
// some worlds pile their dunes too high on the mountain's skirt: calm them until the climb can be walked
while (W.calm < 0.75 && pathGrade(0.8, 0.995) > 0.44) W.calm += 0.15;

// Flattened plazas for the ruined city (filled in by ruins layout).
export const PLAZAS = [];
export function addPlaza(x, z, r0, r1) {
  const h0 = rawHeight(x, z, false);
  const pl = { x, z, r0, r1, h: h0 };
  PLAZAS.push(pl);
  return pl;
}

// While the traveler is inside a building (src/interiors) its floor replaces the dunes for everything that asks
// for the ground (controller, scarf, camera, particles). null = the open world.
let groundOverride = null;
/** Replace the ground with `fn(x, z)` (an interior's floor), or restore the terrain with null. */
export function setGroundOverride(fn) { groundOverride = fn; }
/**
 * Local reshaping of the ground on top of everything else (challenge passages carve chasms, ravines, slopes).
 * Each mod: { x0, x1, z0, z1, fn(x, z, h, lod) -> h }. Registered at module load, before anything is built on the
 * ground, so every later terrainHeight() query (ruins, props, chunks) sees the same surface.
 */
export const TERRAIN_MODS = [];
export function addTerrainMod(m) { TERRAIN_MODS.push(m); return m; }
// the slides' courses and troughs (before any other mod, so passages and ruins build on the carved ground)
placeSlides(SL, { pathXOrig, rawHeight: (x, z) => rawHeight(x, z, false) });
for (const d of SLIDES) {
  const carve = makeCarve(d);
  addTerrainMod({ ...d.box, fn: (x, z, h) => carve(x, z, h) });
}
const _sq = {};
/** Nearest slide pass to (x, z) for gameplay ({slide, s, d, tx, tz, nx, nz, W, Fw, vT, ok}) or null. Shared object. */
export function slideAt(x, z, out = _sq) { return slideNearest(SLIDES, x, z, out); }
/** Clearance from the nearest slide trough edge (big when far): keeps built things off the courses. */
export function slideClearance(x, z) {
  const q = slideNearest(SLIDES, x, z, _sq2);
  if (!q) return 1e9;
  if (q.s < -10 || q.s > q.slide.Ls + 12) return Math.max(-q.s - 10, q.s - q.slide.Ls - 12, 0) + Math.abs(q.d);
  return Math.abs(q.d) - q.W - 4;
}
const _sq2 = {};
const _sq3 = {};
/** For the sand shader: [s, d, mask, gold] of the slide under (x, z): course coordinates and how much is slide floor/wall. */
export function slideFlow(x, z, out) {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
  const q = slideNearest(SLIDES, x, z, _sq3);
  if (!q) return out;
  const d = q.slide;
  const m = (1 - smooth(q.W - 1, q.W + 2, Math.abs(q.d))) * smooth(-2, 6, q.s) * (1 - smooth(d.Ls - 20, d.Ls + 10, q.s));
  out[0] = q.s; out[1] = q.d; out[2] = m; out[3] = d.gold;
  return out;
}

function applyMods(x, z, h, lod) {
  for (let i = 0; i < TERRAIN_MODS.length; i++) {
    const m = TERRAIN_MODS[i];
    if (x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1) h = m.fn(x, z, h, lod);
  }
  return h;
}

export function terrainHeight(x, z) {
  if (groundOverride) return groundOverride(x, z);
  let h = rawHeight(x, z, false);
  for (let i = 0; i < PLAZAS.length; i++) {
    const pl = PLAZAS[i];
    const dx = x - pl.x, dz = z - pl.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > pl.r1 * pl.r1) continue;
    const w = 1 - smooth(pl.r0, pl.r1, Math.sqrt(d2));
    h = lerp(h, pl.h, w);
  }
  return TERRAIN_MODS.length ? applyMods(x, z, h, false) : h;
}

export function terrainHeightFar(x, z) { const h = rawHeight(x, z, true); return TERRAIN_MODS.length ? applyMods(x, z, h, true) : h; }

const _g = { x: 0, z: 0 };
/** Terrain gradient dh/dx, dh/dz (shared object — copy if you keep it). */
export function terrainGradient(x, z, e = 0.6) {
  _g.x = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  _g.z = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return _g;
}
