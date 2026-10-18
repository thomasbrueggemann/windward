// The world seed: every journey gets its own dunes, route, ruins and visions.
// Resolution order: `?seed=123` → the seed of a saved journey (so Continue rebuilds the same world) → random.
// Everything built at load time draws from independent streams via rngFor(tag), so adding draws to one
// subsystem never reshuffles another.
const SAVE_KEY = 'windward-progress';

function resolveSeed() {
  if (typeof location === 'undefined') return 1;
  const q = new URLSearchParams(location.search);
  const forced = parseInt(q.get('seed'), 10);
  if (Number.isFinite(forced)) return forced >>> 0;
  if (!q.has('p') && !q.has('auto')) {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && Number.isFinite(s.seed)) return s.seed >>> 0;
    } catch (e) { /* storage unavailable */ }
  }
  return 1 + Math.floor(Math.random() * 99998);
}

export const SEED = resolveSeed();

/** mulberry32: small, fast, good-enough PRNG in [0, 1). */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a of the world seed and a tag. */
export function hashSeed(tag, seed = SEED) {
  let h = 0x811c9dc5 ^ seed;
  const s = String(tag);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
}

/** An independent, reproducible random stream for one subsystem (e.g. rngFor('ruins')). */
export const rngFor = (tag, seed = SEED) => mulberry32(hashSeed(tag, seed));

// small helpers on top of a stream
export const range = (r, a, b) => a + (b - a) * r();
export const sign = (r) => (r() < 0.5 ? -1 : 1);
export const pick = (r, arr) => arr[(r() * arr.length) | 0];
export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
