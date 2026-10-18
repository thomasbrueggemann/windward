// Long sand slides: the geometry of each course, shared by the heightfield (ground and route), the controller and the
// visuals. No imports from heightfield.js (it imports this): the route-dependent half is filled in by placeSlides()
// with the heightfield's functions injected.
//
// A course is a sine-generated meander (like a river: heading theta(s) = A sin(pi s / l) per half-bend), always
// running down the route (|theta| < 90 deg, so z is monotone and pathX(z) can follow it). It is *inserted* into the
// route: the slide's z-extent is extra ground at one point of the progress scale, so nothing else along the way moves.
import { rngFor, range, sign } from './seed.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Widest bank (outside the halfpipe) the carve may blend over. */
export const SKIRT_MAX = 36;
const FINE = 1.5, COARSE_K = 4, CELL = 10;

/**
 * Phase 1, at import before the route exists: per world the slides' insertion points, lengths and shapes.
 * Returns { list, E } where E is the total inserted z-length.
 */
export function planSlides() {
  const r = rngFor('slides');
  const defs = [
    // the great dune: from the desert down into the sunken city
    { id: 0, kind: 'dune', name: 'The Great Dune', p: 0.3025 + range(r, 0, 0.0015), Ls: range(r, 630, 665), A: [1.34, 1.46], l: [104, 124],
      W: 12.5, Fw: 4.8, Hw: 5.0, v0: 17, v1: 22.5, nk: 3, drop: range(r, 52, 62), taper: 0.15, gold: 0 },
    // the golden descent: from the broken bridge, through the last arches, down into the depths
    { id: 1, kind: 'gold', name: 'The Golden Descent', p: 0.535 - range(r, 0.0005, 0.0028), Ls: range(r, 725, 785), A: [1.32, 1.46], l: [104, 126],
      W: 12, Fw: 4.6, Hw: 5.6, v0: 18, v1: 24.5, nk: 3, drop: range(r, 54, 64), taper: 0.35, gold: 1 },
  ];
  let E = 0;
  for (const d of defs) {
    for (let tries = 0; tries < 8; tries++) {
      shapeCourse(d, r, 1 - tries * 0.04);
      if (d.sep >= 2 * d.W + 18) break;
    }
    d.E = d.Lz; d.Ebefore = E; E += d.E;
    d.D = 0; d.ready = false;
  }
  return { list: defs, E };
}

function shapeCourse(d, r, ampMul) {
  const lead = 44, tail = 60, Ls = d.Ls;
  const bends = [];
  let s = lead, sg = sign(r);
  while (s < Ls - tail - 70) { const l = range(r, d.l[0], d.l[1]); bends.push({ s0: s, l, A: range(r, d.A[0], d.A[1]) * sg * ampMul }); s += l; sg = -sg; }
  const k = (Ls - tail - lead) / (s - lead);
  for (const b of bends) { b.s0 = lead + (b.s0 - lead) * k; b.l *= k; }
  // the last bends calm down so the course runs out straight (into the canyon floor for the golden one)
  bends.forEach((b, i) => { b.A *= 1 - d.taper * smooth(0.5, 1, i / Math.max(1, bends.length - 1)); });
  d.bends = bends;
  const theta = (s2) => {
    for (const b of bends) if (s2 >= b.s0 && s2 < b.s0 + b.l) return b.A * Math.sin(Math.PI * (s2 - b.s0) / b.l);
    return 0;
  };
  const ds = 0.5, n = Math.ceil(Ls / ds) + 1;
  const xl = new Float32Array(n), zl = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const th = theta((i - 0.5) * ds);
    xl[i] = xl[i - 1] + Math.sin(th) * ds; zl[i] = zl[i - 1] + Math.cos(th) * ds;
  }
  d.shape = { xl, zl, n, ds };
  d.Lz = zl[n - 1];
  // the closest approach between different passes of the course (troughs must not merge)
  let sep = 1e9;
  for (let i = 0; i < n; i += 8) for (let j = i + 220; j < n; j += 8) sep = Math.min(sep, Math.hypot(xl[i] - xl[j], zl[i] - zl[j]));
  d.sep = sep;
  // kickers on the middle of the traverses (straight there); rollers on others
  const mids = bends.map((b) => b.s0 + b.l / 2).filter((m) => m > 90 && m < Ls - 110);
  d.kicks = []; d.rolls = [];
  const order = mids.map((m, i) => i);
  for (let i = 0; i < order.length; i++) {
    const m = mids[order[i]];
    if (d.kicks.length < d.nk && i % 2 === (d.id % 2)) d.kicks.push(m / Ls);
    else if (d.rolls.length < 2) d.rolls.push([(m - 28) / Ls, (m + 28) / Ls]);
  }
}

/**
 * Phase 2, once the route functions exist: absolute polylines, floor profile, banking, speed and a lookup grid.
 * deps: { pathXOrig(z), rawHeight(x, z) } — rawHeight must already include the steps of earlier slides (d.D).
 */
export function placeSlides(SL, { pathXOrig, rawHeight }) {
  for (const d of SL.list) placeOne(d, pathXOrig, rawHeight);
}

function placeOne(d, pathXOrig, rawHeight) {
  const { xl, zl, n } = d.shape, Lz = d.Lz, xEnd = xl[n - 1];
  // absolute curve: the meander rides on the route's own meander through the inserted ground, ends land on the route
  const ax = new Float64Array(n), az = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const z = d.zs - zl[i];
    az[i] = z; ax[i] = pathXOrig(z) + xl[i] - xEnd * zl[i] / Lz;
  }
  az[n - 1] = d.ze;
  // resample by arc length
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(ax[i] - ax[i - 1], az[i] - az[i - 1]);
  const Ls = cum[n - 1];
  const nf = Math.ceil(Ls / FINE) + 1;
  const fx = new Float32Array(nf), fz = new Float32Array(nf), fs = new Float32Array(nf);
  let j = 0;
  for (let k = 0; k < nf; k++) {
    const s = Math.min(Ls, k * FINE);
    while (j < n - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    fx[k] = ax[j] + (ax[j + 1] - ax[j]) * t; fz[k] = az[j] + (az[j + 1] - az[j]) * t; fs[k] = s;
  }
  const ftx = new Float32Array(nf), ftz = new Float32Array(nf);
  for (let k = 0; k < nf; k++) {
    const a = Math.max(0, k - 1), b = Math.min(nf - 1, k + 1);
    const tx = fx[b] - fx[a], tz = fz[b] - fz[a], l = Math.hypot(tx, tz) || 1;
    ftx[k] = tx / l; ftz[k] = tz / l;
  }
  Object.assign(d, { Ls, nf, fx, fz, fs, ftx, ftz });
  // pathX lookup by z (z is monotone along the course)
  const dzs = 0.5, nzx = Math.ceil((d.zs - d.ze) / dzs) + 1, zx = new Float32Array(nzx);
  let q = 0;
  for (let k = 0; k < nzx; k++) {
    const z = d.zs - k * dzs;
    while (q < nf - 2 && fz[q + 1] > z) q++;
    const t = clamp((fz[q] - z) / Math.max(1e-6, fz[q] - fz[q + 1]), 0, 1);
    zx[k] = fx[q] + (fx[q + 1] - fx[q]) * t;
  }
  d.zx = zx; d.dzs = dzs;

  // ---- floor profile (1 m table): a steep inviting lip, long gentle descent, kicker ramps and landings, a runout
  const nT = Math.ceil(Ls) + 2;
  const avg = (x, z) => { let h = 0; for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) h += rawHeight(x + ox, z + oz); return h / 5; };
  const hs = avg(fx[0], fz[0]);
  const heNat = avg(fx[nf - 1], fz[nf - 1]);
  d.D = Math.max(0, d.drop - (hs - heNat));          // the world beyond steps down by this much
  const he = heNat - d.D;
  const kicks = d.kicks.map((u) => u * Ls), rolls = d.rolls.map(([a, b]) => [a * Ls, b * Ls]);
  const g = new Float32Array(nT);
  for (let k = 0; k < nT; k++) {
    const s = k;
    let w = 1 + 0.25 * Math.sin(s / 37 + d.id * 2);
    w += 3.4 * (1 - smooth(6, 36, s));                                           // the lip: the sand visibly falls away
    for (const sk of kicks) {
      if (s > sk - 22 && s < sk) w = 0.3;
      if (s >= sk && s < sk + 24) w = 2.4;
    }
    w *= 1 - 0.88 * smooth(Ls - 70, Ls - 5, s);                                 // runout
    g[k] = Math.max(0.05, w);
  }
  const G = new Float32Array(nT);
  for (let k = 1; k < nT; k++) G[k] = G[k - 1] + (g[k - 1] + g[k]) * 0.5;
  const Gend = G[Math.min(nT - 1, Math.round(Ls))];
  const F = new Float32Array(nT);
  for (let k = 0; k < nT; k++) {
    const s = k;
    let h = hs - (hs - he) * Math.min(1, G[k] / Gend);
    // kickers: a ramp that steepens into its lip (so it throws you up), then a quick drop onto a steep landing
    for (const sk of kicks) { const t = clamp((s - (sk - 16)) / 16, 0, 1); h += 2.2 * t * t * (1 - smooth(sk, sk + 2.6, s)); }
    for (const [a, b] of rolls) if (s > a && s < b) h += 1.0 * Math.sin(2 * Math.PI * (s - a) / 20) * smooth(a, a + 6, s) * (1 - smooth(b - 6, b, s));
    F[k] = h;
  }
  // banking: raise the outside of each turn; curvature toward the right-hand normal n = (-tz, tx)
  const bank = new Float32Array(nT), bankRaw = new Float32Array(nT);
  for (let k = 0; k < nT; k++) {
    const i = Math.min(nf - 2, Math.max(1, Math.round(k / FINE)));
    const dtx = (ftx[i + 1] - ftx[i - 1]) / (2 * FINE), dtz = (ftz[i + 1] - ftz[i - 1]) / (2 * FINE);
    const kn = dtx * -ftz[i] + dtz * ftx[i];
    bankRaw[k] = clamp(kn * 7, -0.3, 0.3);
  }
  for (let k = 0; k < nT; k++) { let a = 0, c = 0; for (let o = -6; o <= 6; o++) { const m = k + o; if (m >= 0 && m < nT) { a += bankRaw[m]; c++; } } bank[k] = (a / c) * smooth(10, 40, k) * (1 - smooth(Ls - 50, Ls, k)); }
  // cross-section and pace along the course
  const Wt = new Float32Array(nT), Ft = new Float32Array(nT), Ht = new Float32Array(nT), vT = new Float32Array(nT);
  for (let k = 0; k < nT; k++) {
    const s = k, f0 = 1 - smooth(0, 36, s), f1 = smooth(Ls - 55, Ls, s);
    Wt[k] = d.W + 9 * f0 + 9 * f1; Ft[k] = d.Fw + 5 * f0 + 7 * f1;
    Ht[k] = d.Hw * smooth(-4, 26, s) * (1 - 0.8 * smooth(Ls - 50, Ls + 4, s));
    let v = d.v0 + (d.v1 - d.v0) * smooth(20, Ls - 90, s);
    for (const sk of kicks) if (s > sk && s < sk + 60) v += 2 * (1 - (s - sk) / 60);
    v = v + (10 - v) * smooth(Ls - 70, Ls - 4, s);
    vT[k] = v;
  }
  Object.assign(d, { F, bank, Wt, Ft, Ht, vT, nT, hs, he, kicksS: kicks, rollsS: rolls });

  // ---- lookup grid over the coarse polyline
  const nc = Math.floor((nf - 1) / COARSE_K) + 1;
  const cx = new Float32Array(nc), cz = new Float32Array(nc);
  for (let i = 0; i < nc; i++) { cx[i] = fx[Math.min(nf - 1, i * COARSE_K)]; cz[i] = fz[Math.min(nf - 1, i * COARSE_K)]; }
  const R = d.W + 18 + SKIRT_MAX + 2;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < nc; i++) { x0 = Math.min(x0, cx[i]); x1 = Math.max(x1, cx[i]); z0 = Math.min(z0, cz[i]); z1 = Math.max(z1, cz[i]); }
  x0 -= R; x1 += R; z0 -= R; z1 += R;
  const gw = Math.ceil((x1 - x0) / CELL), gh = Math.ceil((z1 - z0) / CELL);
  const cells = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < nc - 1; i++) {
    const ax0 = Math.min(cx[i], cx[i + 1]) - R, ax1 = Math.max(cx[i], cx[i + 1]) + R, az0 = Math.min(cz[i], cz[i + 1]) - R, az1 = Math.max(cz[i], cz[i + 1]) + R;
    for (let gz = Math.max(0, Math.floor((az0 - z0) / CELL)); gz <= Math.min(gh - 1, Math.floor((az1 - z0) / CELL)); gz++)
      for (let gx = Math.max(0, Math.floor((ax0 - x0) / CELL)); gx <= Math.min(gw - 1, Math.floor((ax1 - x0) / CELL)); gx++) cells[gz * gw + gx].push(i);
  }
  d.grid = { x0, z0, gw, gh, cells: cells.map((c) => Int32Array.from(c)), nc, cx, cz };
  d.box = { x0, x1, z0, z1 };
  d.ready = true;
}

// ------------------------------------------------------------------ queries
/** Linear table lookup at arc length s (clamped). */
export function tab(arr, s) {
  const n = arr.length - 1;
  if (s <= 0) return arr[0];
  if (s >= n) return arr[n];
  const i = s | 0, f = s - i;
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

/** x of the course at z (z inside the slide's span). */
export function courseXAtZ(d, z) {
  const t = (d.zs - z) / d.dzs, i = Math.max(0, Math.min(d.zx.length - 2, Math.floor(t))), f = clamp(t - i, 0, 1);
  return d.zx[i] + (d.zx[i + 1] - d.zx[i]) * f;
}

// refine the nearest point on the fine polyline around coarse segment j; writes into o, returns squared distance
function refine(d, x, z, j, o) {
  const nf = d.nf, fx = d.fx, fz = d.fz;
  const a = Math.max(0, j * COARSE_K - 3), b = Math.min(nf - 2, (j + 1) * COARSE_K + 3);
  let best = 1e18;
  for (let k = a; k <= b; k++) {
    const sx = fx[k + 1] - fx[k], sz = fz[k + 1] - fz[k], L2 = sx * sx + sz * sz || 1e-9;
    let t = ((x - fx[k]) * sx + (z - fz[k]) * sz) / L2;
    if (k > 0 || t > 0) t = Math.max(0, t);
    if (k < nf - 2 || t < 1) t = Math.min(1, t);
    const qx = fx[k] + sx * t, qz = fz[k] + sz * t, dx = x - qx, dz = z - qz;
    const L = Math.sqrt(L2), tx = sx / L, tz = sz / L;
    // beyond the ends, distance is measured across the course only (so the trough fades by s, not by d)
    const dd = (k === 0 && t < 0) || (k === nf - 2 && t > 1) ? (dx * -tz + dz * tx) ** 2 : dx * dx + dz * dz;
    if (dd < best) {
      best = dd;
      o.s = d.fs[k] + t * L; o.d = dx * -tz + dz * tx; o.tx = tx; o.tz = tz;
    }
  }
  return best;
}

const _cand = [];
const _o = { s: 0, d: 0, tx: 0, tz: 0 };
/**
 * Every pass of the course within reach of (x, z): calls fn(s, d, tx, tz) once per pass (nearest point of each).
 * Returns the number of passes.
 */
export function eachPass(d, x, z, fn) {
  const G = d.grid;
  const gx = Math.floor((x - G.x0) / CELL), gz = Math.floor((z - G.z0) / CELL);
  if (gx < 0 || gz < 0 || gx >= G.gw || gz >= G.gh) return 0;
  const list = G.cells[gz * G.gw + gx];
  if (!list.length) return 0;
  let n = 0, i = 0;
  while (i < list.length) {
    // a pass: a run of consecutive coarse segments
    let j = i, bestJ = list[i], bestD = 1e18;
    while (j < list.length && (j === i || list[j] - list[j - 1] <= 2)) {
      const c = list[j], ax = G.cx[c], az = G.cz[c], sx = G.cx[c + 1] - ax, sz = G.cz[c + 1] - az, L2 = sx * sx + sz * sz || 1e-9;
      const t = clamp(((x - ax) * sx + (z - az) * sz) / L2, 0, 1), dx = x - ax - sx * t, dz = z - az - sz * t;
      const dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; bestJ = c; }
      j++;
    }
    refine(d, x, z, bestJ, _o);
    fn(_o.s, _o.d, _o.tx, _o.tz);
    n++; i = j;
  }
  return n;
}

/** The terrain mod for one slide: halfpipe trough, banks blending into the land around, faded beyond its ends. */
export function makeCarve(d) {
  let acc = 0, wsum = 0, hh = 0;
  const pass = (s, dd) => {
    const sc = clamp(s, 0, d.Ls);
    const ad = Math.abs(dd), W = tab(d.Wt, sc), Fw = tab(d.Ft, sc), H = tab(d.Ht, sc);
    const floor = tab(d.F, sc) - tab(d.bank, sc) * dd;
    let target, w;
    if (ad <= W) {
      const q = clamp((ad - Fw) / (W - Fw), 0, 1);
      target = floor + H * Math.pow(q, 1.7); w = 1;
    } else {
      target = floor + H;
      const skirt = clamp(6 + 0.9 * Math.abs(hh - target), 6, SKIRT_MAX);
      w = 1 - smooth(W, W + skirt, ad);
    }
    if (s < 0) w *= 1 - smooth(0, 16, -s);
    if (s > d.Ls) w *= 1 - smooth(0, 30, s - d.Ls);
    acc += w * (target - hh); wsum += w;
  };
  return (x, z, h) => {
    acc = 0; wsum = 0; hh = h;
    eachPass(d, x, z, pass);
    if (wsum <= 0) return h;
    return h + (wsum > 1 ? acc / wsum : acc);
  };
}

/**
 * Gameplay query: the nearest pass of any slide. Returns null when far; else writes into out:
 * { slide, s, d, tx, tz, nx, nz, W, Fw, vT, ok } (ok = inside the trough laterally and between its ends).
 */
export function slideNearest(list, x, z, out) {
  let best = 1e9, found = null;
  for (const d of list) {
    if (!d.ready || x < d.box.x0 || x > d.box.x1 || z < d.box.z0 || z > d.box.z1) continue;
    eachPass(d, x, z, (s, dd, tx, tz) => {
      const ad = Math.abs(dd) + (s < 0 ? -s : s > d.Ls ? s - d.Ls : 0);
      if (ad < best) { best = ad; found = d; out.s = s; out.d = dd; out.tx = tx; out.tz = tz; }
    });
  }
  if (!found) return null;
  const sc = clamp(out.s, 0, found.Ls);
  out.slide = found; out.nx = -out.tz; out.nz = out.tx;
  out.W = tab(found.Wt, sc); out.Fw = tab(found.Ft, sc); out.vT = tab(found.vT, sc);
  out.ok = Math.abs(out.d) < out.W + 2.5 && out.s > -6 && out.s < found.Ls + 4;
  return out;
}

/** A point on the course at arc length s, `lat` metres to the right: writes {x, z, tx, tz, y} into out. */
export function coursePoint(d, s, lat, out) {
  const t = clamp(s, 0, d.Ls) / FINE, i = Math.min(d.nf - 2, Math.floor(t)), f = clamp(t - i, 0, 1);
  const tx = d.ftx[i] + (d.ftx[i + 1] - d.ftx[i]) * f, tz = d.ftz[i] + (d.ftz[i + 1] - d.ftz[i]) * f, l = Math.hypot(tx, tz) || 1;
  out.tx = tx / l; out.tz = tz / l;
  out.x = d.fx[i] + (d.fx[i + 1] - d.fx[i]) * f - out.tz * lat;
  out.z = d.fz[i] + (d.fz[i + 1] - d.fz[i]) * f + out.tx * lat;
  return out;
}
