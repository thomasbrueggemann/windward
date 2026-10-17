// The seeded plan of the pilgrimage: where each chapter's set pieces go (in progress along the path), plus a
// registry of the sites actually built, so later features (interiors, passages) can build on the same layout.
import { rngFor, range, sign, shuffle } from './seed.js';
import { pathX, zAtProgress, progressAt } from './heightfield.js';

/** Chapter spans in progress (the colour script and chapter titles key off the same numbers). */
export const CHAPTER_SPANS = [
  { id: 'desert', p0: 0.0, p1: 0.30 },
  { id: 'city', p0: 0.30, p1: 0.515 },
  { id: 'depths', p0: 0.515, p1: 0.745 },
  { id: 'ascent', p0: 0.745, p1: 0.93 },
  { id: 'summit', p0: 0.93, p1: 1.0 },
];
export function chapterAt(p) {
  for (const c of CHAPTER_SPANS) if (p < c.p1) return c.id;
  return 'summit';
}

/** Half-width of the walkable corridor along the path centre that nothing solid may block. */
export const CORRIDOR = 3.5;

export const PLAN = (() => {
  const r = rngFor('plan');
  const j = (p, d) => p + range(r, -d, d);
  // the ruined city: the middle plaza always has a roofed hall to hide from its guardian
  const ends = shuffle(r, ['gate', 'colonnade', 'temple']);
  const mid = r() < 0.5 ? 'colonnade' : 'temple';
  const rest = ends.filter((k) => k !== mid);
  const plazas = [
    { p: j(0.340, 0.006), kind: rest[0] }, { p: j(0.402, 0.006), kind: mid }, { p: j(0.462, 0.006), kind: rest[1] },
  ].map((d) => ({ ...d, mirror: sign(r), seed: (r() * 1e9) >>> 0 }));
  const shrines = [
    { p: j(0.289, 0.005), side: sign(r) * range(r, 8, 12) },
    { p: j(0.489, 0.004), side: sign(r) * range(r, 8, 11) },
    { p: j(0.783, 0.004), side: sign(r) * range(r, 5, 8) },
  ];
  const guardians = [plazas[1].p, j(0.60, 0.012), j(0.675, 0.012)];
  // symbols: a fixed count per chapter, stratified with jitter; lateral reach shrinks inside the canyon
  const glyphs = [];
  for (const [p0, p1, n, lat, up] of [[0.018, 0.285, 5, 30, 2.5], [0.335, 0.485, 4, 26, 4], [0.53, 0.70, 4, 12, 5], [0.795, 0.93, 3, 15, 1.5]]) {
    for (let i = 0; i < n; i++) {
      const p = p0 + (p1 - p0) * (i + range(r, 0.15, 0.85)) / n;
      glyphs.push({ p, side: sign(r) * range(r, 4, lat), up: r() < 0.45 ? range(r, 0.5, up) : 0 });
    }
  }
  glyphs[0].p = Math.min(glyphs[0].p, 0.03); glyphs[0].side = sign(r) * range(r, 6, 11);   // one in sight of the start
  // dormant banners: the first teaches singing
  const banners = [{ p: j(0.068, 0.012), span: range(r, 20, 26) }, { p: j(0.188, 0.02), span: range(r, 18, 24) }, { p: j(0.83, 0.012), span: range(r, 19, 24) }];
  // flocks of cloth creatures
  const flyers = [];
  for (let p = 0.09 + range(r, 0, 0.03); p < 0.92; p += range(r, 0.055, 0.095)) flyers.push({ p, side: range(r, -18, 18), n: 2 + ((r() * 3) | 0) });
  const gateway = { z: -range(r, 46, 60), dx: sign(r) * range(r, 10, 24), rot: range(r, -0.2, 0.2) };   // off to one side: the summit stays in view
  return { plazas, shrines, guardians, glyphs, banners, flyers, gateway };
})();

/** Where a plan entry lands in the world: [x, z] at progress p, `side` units off the path centre. */
export function onPath(p, side = 0) { const z = zAtProgress(p); return [pathX(z) + side, z]; }

// ------------------------------------------------------------ built sites
/** Every set piece placed in the world, grouped by chapter: {kind, x, y, z, r, ...extra}. */
export const SITES = Object.fromEntries(CHAPTER_SPANS.map((c) => [c.id, []]));
export const ALL_SITES = [];
export function addSite(kind, x, z, extra = {}) {
  const s = { kind, x, z, y: 0, r: 2, chapter: chapterAt(progressAt(z)), ...extra };
  SITES[s.chapter].push(s); ALL_SITES.push(s);
  return s;
}
export const sitesOf = (kind, chapter = null) => ALL_SITES.filter((s) => s.kind === kind && (!chapter || s.chapter === chapter));

/** Solid ground footprints (discs) of everything built: ruins register theirs as they go up. */
export const FOOTPRINTS = [];
export const occupy = (x, z, r) => { FOOTPRINTS.push({ x, z, r }); };
/** Is a disc of radius `r` clear of every solid footprint (and, optionally, the path corridor)? */
export function isFree(x, z, r, { corridor = true, pad = 2 } = {}) {
  if (corridor && Math.abs(x - pathX(z)) < r + CORRIDOR) return false;
  for (const f of FOOTPRINTS) if (Math.hypot(f.x - x, f.z - z) < f.r + r + pad) return false;
  return true;
}
/** Find a free spot near progress p (tries both sides, widening out); returns [x, z] or null. */
export function findFreeSpot(p, r, rng = Math.random, { minSide = 0, maxSide = 80, tries = 40 } = {}) {
  for (let i = 0; i < tries; i++) {
    const side = sign(rng) * range(rng, minSide + r + CORRIDOR, Math.max(minSide + r + CORRIDOR + 1, maxSide * (0.4 + 0.6 * i / tries)));
    const [x, z] = onPath(p + range(rng, -0.004, 0.004), side);
    if (isFree(x, z, r)) return [x, z];
  }
  return null;
}
