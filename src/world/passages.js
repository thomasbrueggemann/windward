import * as THREE from 'three';
import { rngFor, range, sign } from './seed.js';
import { PLAN, CORRIDOR, onPath, addSite, occupy, isFree } from './layout.js';
import { terrainHeight, terrainGradient, pathX, zAtProgress, progressAt, PATH_LEN, addTerrainMod, trenchAmount, smooth, clamp, WIND } from './heightfield.js';
import { ClothBanner } from './cloth.js';
import { Guardian, GUARDIAN_TUNING } from './creatures.js';

/**
 * Challenge passages: one readable, fair test per chapter, escalating along the route. Journey has no death, so
 * failing only ever costs ground: you fall into a chasm and walk out along its floor, get pushed back by the wind,
 * slide down the ice, lose your scarf's charge to a guardian. There is always a way through or a retry close by.
 *
 *   desert  the sand-surf gauntlet: a long dune face broken by chasms; jump (or glide) them at speed, or keep to the
 *           slower cairn path round their ends
 *   city    guardians hunt the last streets in a pack, lamps sweeping (sneak between stone canopies); then the broken
 *           bridge: a ravine and a wall too high to glide over. Sing to wake the cloth, fill the scarf, fly across
 *   depths  the dark flood (only the pools of light are firm ground), the guardian trench (dash from rock to rock),
 *           rivers of sand that sweep you sideways
 *   ascent  the wind gauntlet: gusts in a rhythm you can hear coming, shelter in the lee of standing stones; ice that
 *           slides you back; cold that drains the scarf unless you huddle with the others
 *
 * Everything is seeded per world (rngFor('passages')) and placed with the layout helpers. The ground shapes are
 * registered as terrain mods at import time, before anything is built on the ground.
 */

// ------------------------------------------------------------------ difficulty
export const DIFFICULTIES = {
  gentle: {
    label: 'Gentle', note: 'the wind lifts you over gaps, chasm walls can be climbed, fewer guardians wake', cliff: 0, lift: 1, lockRecharge: false,
    guard: { alert: 0.5, chase: 0.8, cos: 0.95, tear: 0, near: 8 }, extraGuardians: false,
    flood: { speed: 0.72, pull: 0.5 }, stream: 0.4, gustScale: 0.6,
    gust: { warn: 2.8, blow: 2.2, calm: 5.5, strength: 0.6 }, slip: 0.3, frost: 0.25,
  },
  journey: {
    label: 'Journey', note: 'as the journey was meant to be walked', cliff: 1, lift: 0, lockRecharge: true,
    guard: { alert: 1, chase: 1, cos: 0.93, tear: 2, near: 13 }, extraGuardians: true,
    flood: { speed: 0.45, pull: 1.6 }, stream: 1, gustScale: 1,
    gust: { warn: 2.1, blow: 3.0, calm: 4.2, strength: 2.0 }, slip: 1, frost: 1,
  },
  trial: {
    label: 'Trial', note: 'sharper guardians, fiercer wind, a colder mountain', cliff: 1, lift: 0, lockRecharge: true,
    guard: { alert: 1.5, chase: 1.15, cos: 0.91, tear: 3, near: 16 }, extraGuardians: true,
    flood: { speed: 0.38, pull: 2.1 }, stream: 1.35, gustScale: 1.2,
    gust: { warn: 1.7, blow: 3.3, calm: 3.6, strength: 2.3 }, slip: 1, frost: 1.7,
  },
};

// ------------------------------------------------------------------ path frames
/** A straight local frame along the chord of the path from p0 to p1: u along the way, v across (right). */
function frameAt(p0, p1) {
  const za = zAtProgress(p0), zb = zAtProgress(p1), ax = pathX(za), bx = pathX(zb);
  const L = Math.hypot(bx - ax, zb - za), fx = (bx - ax) / L, fz = (zb - za) / L;
  return { ox: ax, oz: za, fx, fz, rx: -fz, rz: fx, L };
}
const toU = (F, x, z) => (x - F.ox) * F.fx + (z - F.oz) * F.fz;
const toV = (F, x, z) => (x - F.ox) * F.rx + (z - F.oz) * F.rz;
const fromUV = (F, u, v) => [F.ox + F.fx * u + F.rx * v, F.oz + F.fz * u + F.rz * v];
function bbox(F, u0, u1, V) {
  const pts = [fromUV(F, u0, -V), fromUV(F, u0, V), fromUV(F, u1, -V), fromUV(F, u1, V)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
}
/** Unit direction of travel along the path at progress p. */
function pathDir(p) {
  const z = zAtProgress(p), dx = pathX(z - 2) - pathX(z + 2), dz = -4, l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}
const m2p = (m) => m / PATH_LEN;
const GUST_DIR = { x: -WIND.x, z: -WIND.z };   // the mountain wind pours down from the summit

// ------------------------------------------------------------------ the plan (import time: shapes the ground)
export const PASSAGE_PLAN = (() => {
  const R = rngFor('passages');
  const out = {};

  // ---------------------------------------------------------- desert: the sand-surf gauntlet
  {
    const sh = PLAN.shrines[0];
    // the profile: steep faces to build speed, each chasm cut into a flatter shelf (so a jump carries you over one
    // chasm, not three), widening as you go down
    const STEEP = 0.55, SHELF = 0.22;
    const widths = [8.5, 10, 11.5].map((w) => w + range(R, -0.5, 0.5));
    const chasms = [];
    let u = 14 + range(R, -2, 2);
    const shelves = [];
    for (const w of widths) {
      const s0 = u, c = s0 + 5 + w / 2, s1 = c + w / 2 + 9;
      chasms.push({ c, w, depth: 9 });
      shelves.push([s0, s1]);
      u = s1 + 22 + range(R, -2, 3);
    }
    const want = shelves[2][1] + 6;
    let pTop = Math.min(PLAN.banners[1].p + 0.004 + range(R, 0, 0.006), sh.p - m2p(want + 40 + 36));
    pTop = Math.max(pTop, 0.15);
    const F = frameAt(pTop, pTop + m2p(want));
    const L = want;
    const grade = (x) => {
      if (x < 0 || x > L) return 0;
      let m = 0;
      for (const [s0, s1] of shelves) m = Math.max(m, smooth(s0 - 3, s0 + 1, x) * (1 - smooth(s1 - 1, s1 + 3, x)));
      return STEEP + (SHELF - STEEP) * m;
    };
    const H = new Float32Array(Math.ceil(L) + 2);
    for (let i = 1; i < H.length; i++) H[i] = H[i - 1] - grade(i - 0.5);
    const drop = -H[H.length - 1];
    const hT0 = terrainHeight(F.ox, F.oz), hB0 = terrainHeight(...fromUV(F, L, 0));
    const hT = (hT0 + hB0) / 2 + drop / 2;
    // ease in and out of the dune over a long way, but stop short of the shrine's platform
    const zEnd = fromUV(F, L, 0)[1], zSh = zAtProgress(sh.p);
    const aft = clamp(zEnd - zSh - 32, 40, 110);
    const sd = sign(R), E = range(R, 18, 23);
    const prof = (x) => { if (x <= 0) return 0; if (x >= H.length - 1) return H[H.length - 1]; const i = Math.floor(x), f = x - i; return H[i] + (H[i + 1] - H[i]) * f; };
    const surface = (u2, v) => hT + prof(u2) + 1.2 * Math.sin(v * 0.09 + u2 * 0.05);
    const lateral = (v) => smooth(E + 3, E - 11, v * sd) * (1 - smooth(78, 95, -v * sd));
    const carve = (u, v) => {
      let d = 0;
      for (const c of chasms) {
        const du = Math.abs(u - c.c), half = c.w / 2;
        if (du > half + 1.5) continue;
        d = Math.max(d, c.depth * (1 - smooth(half - 1.6, half + 1.4, du)) * lateral(v));
      }
      return d;
    };
    const box = bbox(F, -125, L + aft + 5, 100);
    addTerrainMod({
      ...box,
      fn(x, z, h, lod) {
        const u = toU(F, x, z), v = toV(F, x, z), av = Math.abs(v);
        const w = smooth(-120, -4, u) * (1 - smooth(L + 4, L + aft, u)) * (1 - smooth(42, 88, av));
        if (w > 0) h += (surface(u, v) - h) * w;
        if (lod) {
          // the coarse far mesh must stay below the chasm floors: sink it wide around them
          for (const c of chasms) h -= (c.depth + 3) * (1 - smooth(c.w / 2 + 6, c.w / 2 + 26, Math.abs(u - c.c))) * lateral(v);
          return h;
        }
        return h - carve(u, v);
      },
    });
    for (const c of chasms) for (let v = -90; v <= 90; v += 12) {
      if (lateral(v) < 0.3) continue;
      occupy(...fromUV(F, c.c, v), c.w / 2 + 2);
    }
    const [sx, sz] = fromUV(F, L / 2, 0);
    out.gauntlet = { F, L, hT, drop, sd, E, chasms, carve, lateral, surface, site: addSite('passage', sx, sz, { type: 'gauntlet', r: L / 2, progress: progressAt(sz) }) };
  }

  // ---------------------------------------------------------- city: the broken bridge (where the city falls into the depths)
  {
    const sh = PLAN.shrines[1];
    const zS = zAtProgress(sh.p);
    const zN = zS - range(R, 24, 30);
    const pN = progressAt(zN);
    const F = frameAt(pN, pN + m2p(40));
    const G = range(R, 17, 20.5);          // near lip → wall face
    const Rh = range(R, 17.5, 19);         // wall top above the near lip: more than a full short scarf can climb
    const D = 8, Wl = range(R, 85, 95), TW = 2.4, TL = 4;   // the wall spans the whole ravine: the way round is very long
    const hLip = terrainHeight(F.ox, F.oz);
    const floorH = hLip - D;
    const latEnd = Wl + 6;
    const box = bbox(F, -14, G + 22, latEnd + 2);
    const prof = (u, v) => {
      const av = Math.abs(v);
      const lat = 1 - smooth(latEnd - 10, latEnd, av);
      if (lat <= 0) return 0;
      let k = smooth(-1, 7, u) * (1 - smooth(G + 1.5, G + 3, u));
      // the stub of the old bridge stays standing
      k *= 1 - (1 - smooth(TW, TW + 1.2, av)) * (1 - smooth(TL - 0.6, TL + 0.6, u));
      return k * lat;
    };
    addTerrainMod({
      ...box,
      fn(x, z, h, lod) {
        const u = toU(F, x, z), v = toV(F, x, z);
        if (lod) {
          const lat = 1 - smooth(latEnd - 10, latEnd + 8, Math.abs(v));
          const k = smooth(-12, 0, u) * (1 - smooth(G + 3, G + 20, u)) * lat;
          return h + (Math.min(h, floorH - 5) - h) * k;
        }
        const k = prof(u, v);
        return k > 0 ? h + (Math.min(h, floorH) - h) * k : h;
      },
    });
    for (let v = -latEnd + 6; v <= latEnd - 6; v += 12) occupy(...fromUV(F, G / 2, v), G / 2 + 3);
    const [sx, sz] = fromUV(F, G / 2, 0);
    out.bridge = { F, G, Rh, D, Wl, TW, TL, hLip, floorH, latEnd, prof, pN, site: addSite('passage', sx, sz, { type: 'bridge', r: G, progress: pN }) };
  }

  // ---------------------------------------------------------- depths: the dark flood, the guardian trench, rivers of sand
  {
    const p0 = 0.553 + range(R, 0, 0.006), len = 80;
    const F = frameAt(p0, p0 + m2p(len));
    const pools = [];
    let side = sign(R);
    for (let u = 2; u < F.L - 2; u += range(R, 10.5, 12)) {
      const p = p0 + m2p(u);
      const [x, z] = onPath(p, side * range(R, 2, 5.5));
      pools.push({ x, z, r: range(R, 5.2, 5.8) });
      side = -side;
    }
    const [fx0, fz0] = fromUV(F, F.L / 2, 0);
    out.flood = { F, p0, p1: p0 + m2p(F.L), pools, u0: F.ox * F.fx + F.oz * F.fz, site: addSite('passage', fx0, fz0, { type: 'flood', r: F.L / 2, progress: progressAt(fz0) }) };

    const t0 = out.flood.p1 + 0.004, t1 = 0.69;
    const rocks = [];
    let s2 = sign(R);
    for (let p = t0 + m2p(6); p < t1; p += m2p(range(R, 15, 19))) { rocks.push({ p, side: s2 * range(R, 6, 7.5) }); s2 = -s2; }
    out.trench = { p0: t0, p1: t1, rocks, extraP: range(R, 0.63, 0.645) };
    const [tx, tz] = onPath((t0 + t1) / 2);
    out.trench.site = addSite('passage', tx, tz, { type: 'trench', r: (t1 - t0) * PATH_LEN / 2, progress: (t0 + t1) / 2 });

    const streams = [];
    let s3 = sign(R);
    for (let i = 0; i < 3; i++) {
      const p = 0.702 + i * 0.0115 + range(R, -0.002, 0.002);
      const [x, z] = onPath(p);
      const [fx, fz] = pathDir(p);
      // flows across the canyon, a little back down the way
      let dx = -fz * s3 - fx * 0.25, dz = fx * s3 - fz * 0.25;
      const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      streams.push({ p, x, z, dx, dz, hl: 32, hw: range(R, 2.6, 3.0) });
      s3 = -s3;
    }
    out.streams = { streams, p0: streams[0].p - 0.01, p1: streams[2].p + 0.01 };
    const [qx, qz] = onPath(streams[1].p);
    out.streams.site = addSite('passage', qx, qz, { type: 'streams', r: 30, progress: streams[1].p });
  }

  // ---------------------------------------------------------- ascent: the wind gauntlet, ice, cold
  {
    const p0 = PLAN.shrines[2].p + 0.014, len = 105;
    const p1 = p0 + m2p(len);
    const stones = [];
    let side = sign(R);
    for (let u = 8; u < len + 3; u += range(R, 12, 14)) { stones.push({ p: p0 + m2p(u), side: side * range(R, 5.6, 6.4) }); side = -side; }
    const [wx, wz] = onPath((p0 + p1) / 2);
    out.wind = { p0, p1, stones, site: addSite('passage', wx, wz, { type: 'wind', r: len / 2, progress: (p0 + p1) / 2 }) };

    const ice = [];
    let s2 = sign(R);
    const pi0 = p1 + 0.008;
    for (let i = 0; i < 3; i++) {
      const p = pi0 + i * 0.013 + range(R, -0.002, 0.002);
      const hc = range(R, 10, 12), ha = range(R, 6.5, 8);
      const [fx, fz] = pathDir(p);
      const [x, z] = onPath(p, s2 * hc * 0.55);
      ice.push({ p, x, z, ha, hc, rx: -fz, rz: fx, lane: -s2 * (hc * 0.45 + 4.5) });
      s2 = -s2;
    }
    const [ix, iz] = onPath(ice[1].p);
    out.ice = { ice, p0: pi0 - 0.01, p1: ice[2].p + 0.01, site: addSite('passage', ix, iz, { type: 'ice', r: 30, progress: ice[1].p }) };
    out.cold = { p0, p1: 0.93 };
  }
  return out;
})();

// ------------------------------------------------------------------ light shafts (as in props.js) for the flood's pools
const shaftVert = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const shaftFrag = /* glsl */`
precision highp float;
uniform float uIntensity, uTime; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float side = pow(abs(dot(normalize(vN), V)), 1.4);
  float d = length(cameraPosition - vW);
  float near = smoothstep(3., 20., d);
  float a = (0.18 + 0.82 * vUv.y) * side * near * uIntensity * (0.8 + 0.2 * sin(uTime * 0.6 + vW.x * 0.2 + vW.z * 0.1));
  a *= smoothstep(0., 0.08, vUv.y);
  gl_FragColor = vec4(uColor * a, a);
}`;

// ------------------------------------------------------------------ runtime
export class Passages {
  /** deps: { ruins, props, fx } */
  constructor(scene, { ruins, props, fx }) {
    this.scene = scene; this.ruins = ruins; this.props = props; this.fx = fx;
    this.plan = PASSAGE_PLAN;
    this.diffName = 'journey'; this.diff = DIFFICULTIES.journey;
    this.hints = [];          // [key, html, ms] for main's hint queue
    this.events = [];         // {type: 'gust-warn' | 'gust'}
    this.guardians = [];      // extra guardians (main adds them to its list)
    this.extraGuardians = [];
    this.pack = { city: [], depths: [] };
    this.cairns = [];
    this.leeMarks = [];
    this.gustState = { phase: 'calm', t: 1.5, k: 0, active: false };
    this.pitT = new WeakMap();
    this._r = rngFor('passages-build');
    this._sandCol = new THREE.Color();
    this.cliff = (x, z) => this._cliff(x, z);
    this._buildGauntlet();
    this._buildBridge();
    this._buildCity();
    this._buildDepths();
    this._buildAscent();
  }

  // ---------------------------------------------------------------- building
  _stack(x, z, h = 1.6) {
    const r = this.ruins, y = terrainHeight(x, z);
    let yy = y - 0.15;
    for (let i = 0; i < 3; i++) {
      const s = 0.75 - i * 0.18;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), r.stone);
      m.scale.set(1.2, 0.55, 1.0);
      r._place(m, x + (this._r() - 0.5) * 0.15, yy + s * 0.5, z + (this._r() - 0.5) * 0.15, this._r() * 6);
      yy += s * 0.62;
    }
    // a strip of red cloth tied to the top: the cairns mark the safe way
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.4), new THREE.MeshStandardMaterial({ color: 0x9a2410, emissive: 0x5a0e04, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    flag.position.set(x, yy + 0.4, z); flag.rotation.set(0.25, this._r() * 6, 0.5);
    r.group.add(flag);
    this.cairns.push({ flag, ph: this._r() * 6, y: yy + 0.4 });
  }

  _buildGauntlet() {
    const g = this.plan.gauntlet, F = g.F;
    // cairns along the safe way round the chasm ends
    for (const c of g.chasms) {
      for (const du of [-c.w / 2 - 5, c.w / 2 + 4]) {
        const [x, z] = fromUV(F, c.c + du, g.sd * (g.E + 6));
        this._stack(x, z);
      }
    }
    this._stack(...fromUV(F, -8, g.sd * 9));
    this._stack(...fromUV(F, -2, g.sd * (g.E + 2)));
  }

  _buildBridge() {
    const b = this.plan.bridge, F = b.F, r = this.ruins, scene = this.scene;
    const rotY = Math.atan2(-F.rz, F.rx);          // mesh local x runs across the way
    const top = b.hLip + b.Rh;
    // the wall: as low as the ground behind it falls
    let low = b.floorH;
    for (let v = -b.Wl; v <= b.Wl; v += 6) for (const u of [b.G, b.G + 4]) low = Math.min(low, terrainHeight(...fromUV(F, u, v)));
    const wallH = top - low + 3;
    const [wx, wz] = fromUV(F, b.G + 1.3, 0);
    const wall = r._box(b.Wl * 2, wallH, 2.6, r.stoneDark); wall.geometry.translate(0, wallH / 2, 0);
    r._place(wall, wx, low - 3, wz, rotY);
    // crenellations, a little ragged
    for (let v = -b.Wl + 2; v <= b.Wl - 2; v += 4) {
      if (this._r() < 0.18) continue;
      const hh = 1.2 + this._r() * 0.8;
      const c = r._box(2.1, hh, 2.8, r.stoneDark); c.geometry.translate(0, hh / 2, 0);
      const [x, z] = fromUV(F, b.G + 1.3, v);
      r._place(c, x, top, z, rotY);
    }
    // towers at either end
    for (const sv of [-1, 1]) {
      const [x, z] = fromUV(F, b.G + 1.3, sv * (b.Wl + 2.5));
      const gy = Math.min(terrainHeight(x, z), low);
      const th = top + 7 - gy;
      const t = r._box(6, th, 6); t.geometry.translate(0, th / 2, 0);
      r._place(t, x, gy - 1, z, rotY);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4.5, 4), r.gold); roof.geometry.translate(0, 2.25, 0);
      r._place(roof, x, top + 6, z, rotY + Math.PI / 4);
      r._solid({ kind: 'box', x, z, hx: 3.2, hz: 3.2, rot: -rotY, top: top + 7 });
    }
    // the collider is a thin slab on the near face: clear its top and you are over
    const [cx, cz] = fromUV(F, b.G + 0.5, 0);
    r._solid({ kind: 'box', x: cx, z: cz, hx: b.Wl, hz: 0.55, rot: -rotY, top });
    // the far end of the broken bridge juts out of the wall top; the near stub is a stone deck on the tongue of ground
    {
      const deck = r._box(4.6, 1.1, 5.5); deck.geometry.translate(0, -0.55, 0);
      const [x, z] = fromUV(F, b.G - 2.4, 0);
      r._place(deck, x, top + 0.2, z, rotY);
      for (let i = 0; i < 3; i++) {
        const [dx, dz] = fromUV(F, 0.6 + i * 1.3 - 0.2, 0);
        const s = r._box(4.6, 0.9, 1.3); s.geometry.translate(0, -0.45, 0);
        r._place(s, dx, terrainHeight(dx, dz) + 0.08, dz, rotY + (this._r() - 0.5) * 0.06);
      }
      const ab = r._box(5.6, b.D + 1.5, 2.2, r.stoneDark); ab.geometry.translate(0, -(b.D + 1.5) / 2, 0);
      const [ax, az] = fromUV(F, b.TL + 0.4, 0);
      r._place(ab, ax, terrainHeight(ax, az) - 0.3, az, rotY);
      // fallen deck and broken piers down in the ravine
      for (let i = 0; i < 4; i++) {
        const [x2, z2] = fromUV(F, b.TL + 3 + this._r() * (b.G - b.TL - 5), (this._r() - 0.5) * 8);
        const s = r._box(4 + this._r() * 2, 1, 2 + this._r() * 2); s.rotation.set((this._r() - .5) * 0.6, this._r() * 3, (this._r() - .5) * 0.5);
        s.position.set(x2, terrainHeight(x2, z2) + 0.3, z2); r.group.add(s);
      }
      for (const f of [0.5, 0.78]) {
        const [px, pz] = fromUV(F, b.TL + (b.G - b.TL) * f, 0);
        const ph = b.D * (0.3 + 0.5 * f) + 2;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, ph, 10), r.stone); p.geometry.translate(0, ph / 2, 0);
        r._place(p, px, terrainHeight(px, pz) - 0.5, pz);
      }
    }
    // the cloth: a dormant banner at the bridgehead, two low pieces you can reach from the ground, three over the gap
    const props = this.props;
    const bi = props.banners.length;
    const [bx, bz] = fromUV(F, -11, 0);
    r._postPair(bx, bz, 0, new THREE.Vector3(F.rx, 0, F.rz), 17, 15);
    const pp = r.posts[r.posts.length - 1];
    const banner = new ClothBanner(scene, pp.a, pp.b, 4.4);
    banner.index = bi; banner.awakened = false; banner.pieces = [];
    const add = (x, y, z) => { banner.pieces.push(props.pieces.length); props.addPiece(x, y, z, bi); };
    for (let k = 0; k < 4; k++) { const ox = (k - 1.5) * 4; add(banner.center.x + banner.dir.x * ox, banner.center.y + 3 + (k % 2) * 2, banner.center.z + banner.dir.z * ox); }
    for (const [u, v, dy] of [[-5, 3.4, 2.2], [-5, -3.4, 2.6], [-1.5, 0, 2.4]]) { const [x, z] = fromUV(F, u, v); add(x, terrainHeight(x, z) + dy, z); }
    this.gapCloth = [];
    for (const [u, dy] of [[7, 5], [10.5, 9], [14, 13], [b.G - 1.4, b.Rh + 0.5]]) { const [x, z] = fromUV(F, u, 0); add(x, b.hLip + dy, z); this.gapCloth.push(new THREE.Vector3(x, b.hLip + dy, z)); }
    props.banners.push(banner);
    props.updateMatrices();
    this.bridgeBanner = banner;
    this.bridgeTop = top;
  }

  _canopy(x, z, rot) {
    const r = this.ruins, y0 = terrainHeight(x, z), H = 4.3;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const s of [-2.6, 2.6]) {
      const px = x + sn * s, pz = z + cs * s;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, H + 1, 10), r.stone); c.geometry.translate(0, (H + 1) / 2, 0);
      r._place(c, px, terrainHeight(px, pz) - 1, pz, 0, y0);
      r._solid({ kind: 'circle', x: px, z: pz, r: 0.8, top: y0 + H });
    }
    const roof = r._box(4.6, 0.8, 7.4); roof.geometry.translate(0, 0.4, 0);
    r._place(roof, x, y0 + H, z, rot, y0);
    const lip = r._box(5.2, 0.35, 8.0, r.gold); lip.geometry.translate(0, 0.17, 0);
    r._place(lip, x, y0 + H + 0.8, z, rot);
    r.shelters.push({ x, z, r: 3.3, y: y0 + H });
    addSite('shelter', x, z, { y: y0, r: 3.3 });
  }

  _buildCity() {
    const pl = PLAN.plazas, b = this.plan.bridge;
    // stone canopies along the last streets, alternating sides, wherever the ruins leave room
    let side = sign(this._r);
    for (let p = pl[1].p + 0.022; p < b.pN - 0.002; p += m2p(range(this._r, 22, 28))) {
      let placed = false;
      for (const dp of [0, 0.003, -0.003, 0.006]) {
        for (const s of [side, -side]) {
          const [fx, fz] = pathDir(p + dp);
          const [x, z] = onPath(p + dp, s * 5.2);
          if (!isFree(x, z, 3.2, { corridor: false, pad: 0.5 })) continue;
          this._canopy(x, z, Math.atan2(fx, fz));
          placed = true; break;
        }
        if (placed) break;
      }
      side = -side;
    }
    // guardian routes: a pack hunting the streets between the plazas and over the bridgehead
    const zig = (p0, p1, n, amp) => {
      const pts = [];
      for (let i = 0; i < n; i++) { const p = p0 + (p1 - p0) * i / (n - 1); const [x, z] = onPath(p, (i % 2 ? 1 : -1) * amp); pts.push({ x, z }); }
      return pts;
    };
    const mk = (p0, p1, pack, h, n = 5) => {
      const route = zig(p0, p1, n, 13);
      const [ax, az] = onPath((p0 + p1) / 2);
      const g = new Guardian(this.scene, ax, az, 40, { route, sweep: 0.7, pack, height: h });
      this.guardians.push(g); this.extraGuardians.push(g);
      return g;
    };
    mk(pl[1].p + 0.026, pl[2].p - 0.018, this.pack.city, 12);
    mk(pl[2].p + 0.022, b.pN - 0.004, this.pack.city, 12.5, 4);
    this.cityRange = [pl[1].p - 0.03, b.pN + 0.01];
  }

  _buildDepths() {
    const r = this.ruins, props = this.props, fl = this.plan.flood;
    // inside the flood only its own pools of light: the canyon's other shafts there go dark
    for (let i = props.shafts.length - 1; i >= 0; i--) {
      const sh = props.shafts[i], u = toU(fl.F, sh.x, sh.z);
      if (u > -sh.r && u < fl.F.L + sh.r) { sh.mesh.visible = false; props.shafts.splice(i, 1); props.shaftMats.splice(props.shaftMats.indexOf(sh.mesh.material), 1); }
    }
    // shafts of light whose pools are the only firm ground in the flood
    const sunC = new THREE.Vector3(-0.2, 0.9, -0.28).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunC);
    for (const pool of fl.pools) {
      const floor = terrainHeight(pool.x, pool.z);
      const geo = new THREE.CylinderGeometry(2.5 + this._r() * 1.5, pool.r, 80, 16, 1, true); geo.translate(0, 40, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(2.2, 1.7, 0.9) } },
        vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(pool.x, floor - 1, pool.z); mesh.quaternion.copy(q);
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      this.scene.add(mesh);
      props.shafts.push({ mesh, x: pool.x, z: pool.z, r: pool.r });
      props.shaftMats.push(m);
    }
    // cover rocks along the guardian trench: a boulder with a slab leaning over toward the path
    for (const rk of this.plan.trench.rocks) {
      const [fx, fz] = pathDir(rk.p);
      let [x, z] = onPath(rk.p, rk.side);
      if (!isFree(x, z, 1.7, { pad: 0.4 })) { [x, z] = onPath(rk.p + m2p(4), rk.side); if (!isFree(x, z, 1.7, { pad: 0.4 })) continue; }
      const y = terrainHeight(x, z), s = Math.sign(rk.side);
      const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), r.rock);
      boulder.scale.set(1.1, 1.05, 1.2);
      r._place(boulder, x, y + 0.9, z, this._r() * 6);
      // toward the path: -s * right
      const ix = -fz * -s, iz = fx * -s;
      const slab = r._box(4.2, 0.55, 4.8, r.rock);
      slab.position.set(x + ix * 1.8, y + 3.0, z + iz * 1.8);
      slab.rotation.set(0, Math.atan2(fx, fz), 0); slab.rotateZ(0.22 * s);
      r.group.add(slab);
      r._solid({ kind: 'circle', x, z, r: 1.7, top: y + 3.2 });
      const sx = x + ix * 2.3, sz = z + iz * 2.3;
      r.shelters.push({ x: sx, z: sz, r: 2.7, y: y + 2.8 });
      addSite('shelter', sx, sz, { y, r: 2.7 });
    }
    // the trench guardians patrol up and down the canyon; a third one joins them unless the journey is gentle
    const tr = this.plan.trench;
    const zig = (p0, p1, n, amp) => Array.from({ length: n }, (_, i) => { const [x, z] = onPath(p0 + (p1 - p0) * i / (n - 1), (i % 2 ? 1 : -1) * amp); return { x, z }; });
    const [gx, gz] = onPath(tr.extraP);
    const g = new Guardian(this.scene, gx, gz, 40, { route: zig(tr.extraP - 0.018, tr.extraP + 0.018, 4, 9), sweep: 0.8, pack: this.pack.depths, height: 11 });
    this.guardians.push(g); this.extraGuardians.push(g);
  }

  _buildAscent() {
    const r = this.ruins, w = this.plan.wind;
    this.stones = [];
    for (const st of w.stones) {
      let ok = null;
      for (const dp of [0, 3, -3, 6, -6]) {
        const [x, z] = onPath(st.p + m2p(dp), st.side);
        if (isFree(x, z, 1.6, { pad: 0.6 })) { ok = [x, z]; break; }
      }
      if (!ok) continue;
      const [x, z] = ok, y = terrainHeight(x, z), h = 4.6 + this._r() * 1.2;
      const m = r._box(2.8, h, 1.2); m.geometry.translate(0, h / 2, 0);
      // broad face across the wind
      r._place(m, x, y - 0.6, z, Math.atan2(-GUST_DIR.x, -GUST_DIR.z), y);
      r._solid({ kind: 'circle', x, z, r: 1.55, top: y + h - 0.8 });
      const lee = { x: x + GUST_DIR.x * 3.2, z: z + GUST_DIR.z * 3.2 };
      this.stones.push({ x, z, lee, p: progressAt(z) });
      addSite('shelter', lee.x, lee.z, { y, r: 2.4, wind: true });
    }
  }

  /** The guardians from the plan: the plaza's joins the street pack, the trench's two patrol up and down the canyon. */
  adopt(list) {
    const [g0, ...rest] = list;
    if (g0) { g0.pack = this.pack.city; this.pack.city.push(g0); g0.sweep = 0.6; }
    for (const g of rest) {
      // keep clear of the flood: one test at a time
      const p = Math.max(progressAt(g.anchor.z), this.plan.flood.p1 + 0.026);
      g.route = Array.from({ length: 5 }, (_, i) => { const [x, z] = onPath(p - 0.02 + 0.04 * i / 4, (i % 2 ? 1 : -1) * 10); return { x, z }; });
      [g.anchor.x, g.anchor.z] = onPath(p);
      g.pack = this.pack.depths; this.pack.depths.push(g); g.sweep = 0.75; g.patrolH = 11;
    }
  }

  // ---------------------------------------------------------------- difficulty
  setDifficulty(name) {
    const d = DIFFICULTIES[name] || DIFFICULTIES.journey;
    this.diffName = DIFFICULTIES[name] ? name : 'journey'; this.diff = d;
    Object.assign(GUARDIAN_TUNING, d.guard);
    for (const g of this.extraGuardians) g.setAsleep(!d.extraGuardians);
  }

  // ---------------------------------------------------------------- queries
  _cliff(x, z) {
    if (this.diff.cliff <= 0) return 0;
    const g = this.plan.gauntlet, F = g.F;
    const u = toU(F, x, z);
    if (u < -2 || u > g.L + 2) return 0;
    const v = toV(F, x, z);
    for (const c of g.chasms) if (Math.abs(u - c.c) < c.w / 2 + 1.5) return this.diff.cliff * smooth(0.55, 0.9, g.lateral(v));
    return 0;
  }

  /** How far below the surrounding ground a point lies in a chasm or the ravine (0 when not in one). */
  pitDepth(x, z) {
    const g = this.plan.gauntlet;
    const u = toU(g.F, x, z);
    if (u > -2 && u < g.L + 2) return g.carve(u, toV(g.F, x, z));
    const b = this.plan.bridge;
    const ub = toU(b.F, x, z);
    if (ub > -1 && ub < b.G + 1.5) return b.D * b.prof(ub, toV(b.F, x, z));
    return 0;
  }

  _inFlood(x, z) {
    const fl = this.plan.flood, F = fl.F;
    const u = toU(F, x, z);
    if (u < 2 || u > F.L - 2) return false;
    if (trenchAmount(x, z) < 0.55) return false;
    const gr = terrainGradient(x, z);
    if (Math.hypot(gr.x, gr.z) > 0.55) return false;          // the walls stay dry
    for (const sh of this.props.shafts) {
      if (Math.abs(sh.z - z) > 20) continue;
      if (Math.hypot(sh.x - x, sh.z - z) < sh.r * 0.9 * 0.82) return false;
    }
    return true;
  }

  _iceAt(x, z) {
    for (const e of this.plan.ice.ice) {
      const dx = x - e.x, dz = z - e.z;
      const a = (dx * e.rx + dz * e.rz) / e.hc, b = (dx * -e.rz + dz * e.rx) / e.ha;
      if (a * a + b * b < 0.9 * 0.9) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------- the rhythmic wind (main's updateGusts asks)
  /** Inside the wind gauntlet: { k: 0..1 envelope, s: strength multiplier, phase }; otherwise null. */
  gust(dt, prog, playing) {
    const w = this.plan.wind, G = this.gustState, d = this.diff.gust;
    const inside = prog > w.p0 - 0.006 && prog < w.p1 + 0.001;
    if (!inside || !playing) { G.active = false; G.k = Math.max(0, G.k - dt * 2); return null; }
    if (!G.active) { G.active = true; G.phase = 'calm'; G.t = 2.5; }
    G.t -= dt;
    if (G.t <= 0) {
      if (G.phase === 'calm') { G.phase = 'warn'; G.t = d.warn; this.events.push({ type: 'gust-warn' }); }
      else if (G.phase === 'warn') { G.phase = 'blow'; G.t = d.blow; this.events.push({ type: 'gust' }); }
      else { G.phase = 'calm'; G.t = d.calm; }
    }
    let k = 0;
    if (G.phase === 'blow') { const e = d.blow - G.t; k = smooth(0, 0.35, e) * smooth(0, 0.6, G.t); }
    G.k = k;
    return { k, s: d.strength, phase: G.phase };
  }
  /** Scale for the ordinary mountain gusts beyond the gauntlet. */
  gustScale() { return this.diff.gustScale; }

  // ---------------------------------------------------------------- per frame
  /**
   * ctx: { player, group, camera, time, prog, sandU, guardians, playing }
   * Call after the gusts were applied (adds to player.push for the next step).
   */
  update(dt, ctx) {
    const { player, group, prog, sandU, time } = ctx;
    const p = player.pos, d = this.diff, fx = this.fx;
    player.speedMul = 1; player.slip = 0; player.rechargeMul = 1;

    // ---- desert gauntlet
    const g = this.plan.gauntlet;
    const gu = toU(g.F, p.x, p.z), gv = toV(g.F, p.x, p.z);
    if (gu > -120 && gu < g.L + 60) {
      if (gu > -45 && gu < 0 && Math.abs(gv) < 50) this._hint('p-surf', `The dune falls away into chasms. Surf down and <b>jump</b> at each edge &mdash; or take the slower way round, past the cairns on the <b>${g.sd > 0 ? 'right' : 'left'}</b>.`, 9000);
      const pit = g.carve(gu, gv);
      if (pit > 2.5 && player.grounded) {
        this._hint('p-surf-fall', 'Fallen in. Follow the sand along the floor of the chasm and climb out at its end.', 7000);
        // the sand on the floor streams toward the way out
        player.push.x += g.F.rx * g.sd * 2.6; player.push.z += g.F.rz * g.sd * 2.6;
      }
      // gentle: the chasms breathe out, lifting anyone who leaps them
      if (d.lift > 0 && !player.grounded) {
        for (const c of g.chasms) if (Math.abs(gu - c.c) < c.w / 2 + 2 && g.lateral(gv) > 0.3) { player.vel.y = Math.min(player.vel.y + 9 * d.lift * dt, 4); break; }
      }
      this._sandfalls(dt, g, gu, gv);
    }

    // ---- city streets and the broken bridge
    const b = this.plan.bridge;
    const bu = toU(b.F, p.x, p.z), bv = toV(b.F, p.x, p.z);
    if (prog > this.cityRange[0] && prog < this.cityRange[1]) this._hint('p-guard', 'Guardians hunt these streets together. Where their lamps light the sand they can see you &mdash; slip between the stone canopies while they look away.', 9000);
    if (bu > -60 && bu < b.G + 10 && Math.abs(bv) < b.latEnd + 10) {
      if (bu < -18) this._hint('p-bridge', d.lockRecharge
        ? 'A broken bridge, a wall too high to glide over. These old stones will not fill your scarf: <b>sing</b> to wake the cloth, fill your scarf, then leap and <b>hold space</b> to fly.'
        : 'A broken bridge. <b>Sing</b> to wake the cloth and fill your scarf, then leap and <b>hold space</b> to fly &mdash; the ravine\'s breath will help you up.', 10000);
      if (d.lockRecharge && bu > -45 && bu < b.G + 3 && Math.abs(bv) < b.Wl + 30) player.rechargeMul = 0;
      if (bu > 1 && bu < b.G && p.y < b.hLip - 3 && player.grounded) this._hint('p-bridge-fall', 'Climb back up to the bridge and fill your scarf at the cloth.', 7000);
      if (d.lift > 0 && !player.grounded && bu > 3 && bu < b.G + 1 && Math.abs(bv) < 9) {
        player.vel.y = Math.min(player.vel.y + 16 * d.lift * dt, 7);
        if (Math.random() < 0.5) fx.sparkles.emit(p.x + (Math.random() - .5) * 4, p.y - 2, p.z + (Math.random() - .5) * 4, 0, 4, 0, 1.2, 0.12, 3, 2.3, 1.2, 0.8, 0.5, 0, 0);
      }
    }

    // ---- depths
    const fl = this.plan.flood;
    let flood = false;
    if (prog > fl.p0 - 0.02 && prog < fl.p1 + 0.01) {
      flood = this._inFlood(p.x, p.z);
      if (prog > fl.p0 - 0.012) this._hint('p-flood', 'Dark sand floods the depths and drags at your feet. Keep to the pools of light &mdash; <b>jump</b> from one to the next.', 9000);
      if (flood && player.grounded) {
        player.speedMul = d.flood.speed;
        // the drag never quite outruns a wading traveler: straying costs time, it never traps you
        const pull = Math.min(d.flood.pull, 0.45 * 6 * d.flood.speed);
        player.push.x -= fl.F.fx * pull; player.push.z -= fl.F.fz * pull;
        if (Math.random() < dt * 30) fx.dust.emit(p.x + (Math.random() - .5), p.y + 0.1, p.z + (Math.random() - .5), -fl.F.fx * 1.5, 0.3, -fl.F.fz * 1.5, 1.0, 0.5, 0.08, 0.09, 0.18, 0.5, 1.5, 0.2, 1);
      }
    }
    const tr = this.plan.trench;
    if (prog > tr.p0 - 0.008 && prog < tr.p1) this._hint('p-trench', 'Guardians patrol the trench. Wait in the shadow of the leaning rocks, and run when the light has passed.', 8000);
    const sm = this.plan.streams;
    if (prog > sm.p0 - 0.02 && prog < sm.p1 + 0.01) {
      if (prog > sm.p0 - 0.008) this._hint('p-stream', 'Rivers of sand cross the canyon. They will sweep you away &mdash; <b>jump</b> or glide across.', 8000);
      for (const s of sm.streams) {
        const dx = p.x - s.x, dz = p.z - s.z;
        const a = dx * s.dx + dz * s.dz, c = dx * -s.dz + dz * s.dx;
        if (player.grounded && Math.abs(a) < s.hl && Math.abs(c) < s.hw) {
          const k = 8 * d.stream * (1 - smooth(s.hl - 6, s.hl, Math.abs(a)));
          player.push.x += s.dx * k; player.push.z += s.dz * k;
        }
        // streaming sand, near the traveler only
        if (Math.abs((p.z - s.z)) < 70 && Math.random() < dt * 40) {
          const a0 = (Math.random() - 0.5) * 2 * s.hl, c0 = (Math.random() - 0.5) * 2 * s.hw;
          const x = s.x + s.dx * a0 - s.dz * c0, z = s.z + s.dz * a0 + s.dx * c0;
          fx.sparkles.emit(x, terrainHeight(x, z) + 0.15, z, s.dx * 6 * d.stream, 0.1, s.dz * 6 * d.stream, 1.2, 0.1, 1.6, 1.0, 0.45, 0.6, 0.2, 0, 0);
        }
      }
    }

    // ---- ascent: wind stones, ice, frost
    const w = this.plan.wind;
    if (this.gustState.active && this.gustState.phase !== 'calm') {
      // the telegraph: snow streamers racing down the slope, thickening as the gust gathers
      const G = this.gustState, k = G.phase === 'warn' ? 1 - G.t / d.gust.warn : 1;
      const n = Math.floor(dt * (40 + 160 * k) + Math.random());
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 22;
        const x = p.x + Math.cos(a) * r - GUST_DIR.x * 10, z = p.z + Math.sin(a) * r - GUST_DIR.z * 10;
        const sp = 12 + 10 * k;
        fx.dust.emit(x, terrainHeight(x, z) + 0.3 + Math.random() * 2.2, z, GUST_DIR.x * sp, 0.2, GUST_DIR.z * sp, 1.1, 0.35 + Math.random() * 0.3, 1, 1, 1, 0.35 + 0.3 * k, 0.1, 0, 1.5);
      }
    }
    if (prog > w.p0 - 0.01 && prog < w.p1 + 0.01) this._hint('p-wind', 'The wind gathers before it strikes. When you hear it rise, get into the glowing lee of a standing stone and wait for it to pass.', 9000);
    const ic = this.plan.ice;
    if (prog > ic.p0 - 0.012 && prog < ic.p1 + 0.01) {
      this._hint('p-ice', 'Ice ahead. It gives no grip &mdash; walk around it, or fly across.', 7000);
      if (player.grounded && this._iceAt(p.x, p.z)) player.slip = d.slip;
    }
    const cold = this.plan.cold;
    if (prog > cold.p0 && prog < cold.p1 && !player.frozen) {
      const near = group ? group.near : 0;
      const drain = 0.05 * d.frost * player.cold / (1 + 2.5 * near);
      player.charge = Math.max(0, player.charge - drain * dt);
      if (player.charge < 0.05 && near === 0 && player.cold > 0.4) player.speedMul *= 0.85;
      if (player.cold > 0.35) this._hint(near ? 'p-cold-together' : 'p-cold', near ? 'The cold steals the light from your scarves &mdash; but close together you keep each other warm.' : 'The cold steals the light from your scarf. Find the others and <b>stay close</b>: together you keep warm.', 8000);
    }

    // ---- companions who fell into a pit (or were left behind the bridge wall) find their way round
    if (group) for (const c of group.travellers) {
      const cp = c.pos;
      const stuck = this.pitDepth(cp.x, cp.z) > 2.5 || (bu > b.G + 2 && toU(b.F, cp.x, cp.z) < b.G - 1 && Math.abs(toV(b.F, cp.x, cp.z)) < b.latEnd && c.dist > 18);
      const t = stuck ? (this.pitT.get(c) || 0) + dt : 0;
      this.pitT.set(c, t);
      if (t > 3.5 && c.catchUp(player, ctx.camera, time)) this.pitT.set(c, 0);
    }

    this._shade(dt, ctx, prog, sandU);
    this._cairns(time);
  }

  _hint(key, html, ms) { this.hints.push([key, html, ms]); }

  _sandfalls(dt, g, gu, gv) {
    if (gu < -90 || gu > g.L + 30) return;
    const F = g.F, col = this._sandCol.setRGB(0.95, 0.72, 0.45);
    for (const c of g.chasms) {
      const n = Math.floor(dt * 45 + Math.random());
      for (let i = 0; i < n; i++) {
        const v = gv + (Math.random() - 0.5) * 70;
        if (g.lateral(v) < 0.6) continue;
        const lip = c.c - c.w / 2 - 0.2;
        const [x, z] = fromUV(F, lip, v);
        const y = terrainHeight(x, z);
        this.fx.dust.emit(x, y + 0.1, z, F.fx * (1 + Math.random()), 0.2, F.fz * (1 + Math.random()), 1.3, 0.55 + Math.random() * 0.4, col.r, col.g, col.b, 0.55, 0.6, 9, 1.2);
      }
      // dust rising from the chasm floor
      if (Math.random() < dt * 8) {
        const v = gv + (Math.random() - 0.5) * 40;
        if (g.lateral(v) > 0.6) {
          const [x, z] = fromUV(F, c.c, v);
          this.fx.dust.emit(x, terrainHeight(x, z) + 0.5, z, (Math.random() - .5), 1.2, (Math.random() - .5), 2.5, 1.8, col.r, col.g, col.b, 0.25, 0.8, -0.2, 2);
        }
      }
    }
  }

  _cairns(time) {
    for (const c of this.cairns) c.flag.rotation.z = 0.5 + Math.sin(time * 3.1 + c.ph) * 0.25;
  }

  /** Feed the sand shader: beam spots, shelter glows, ice, flood, sand rivers. */
  _shade(dt, ctx, prog, U) {
    if (!U || !U.uMarks) return;
    const p = ctx.player.pos;
    let n = 0;
    const marks = U.uMarks.value, cols = U.uMarkCol.value;
    for (const gd of ctx.guardians) {
      if (n >= 6) break;
      const s = gd.spot;
      if (s.w <= 0 || Math.hypot(s.x - p.x, s.y - p.z) > 140) continue;
      marks[n].copy(s);
      cols[n].setRGB(0.55 + 0.45 * s.w, 0.42 - 0.25 * s.w, 0.18 - 0.1 * s.w);
      n++;
    }
    // the lee of the wind stones glows, brightest while the wind gathers
    if (this.stones.length && prog > this.plan.wind.p0 - 0.02 && prog < this.plan.wind.p1 + 0.02) {
      const G = this.gustState;
      const k = G.phase === 'warn' ? 0.8 + 0.35 * Math.sin(ctx.time * 9) : G.phase === 'blow' ? 0.7 : 0.3;
      const list = this.stones.map((s) => [Math.hypot(s.lee.x - p.x, s.lee.z - p.z), s]).sort((a, b) => a[0] - b[0]);
      for (const [dd, s] of list) {
        if (n >= 8 || dd > 60) break;
        marks[n].set(s.lee.x, s.lee.z, 2.9, -k);
        cols[n].setRGB(0.9, 0.62, 0.3);
        n++;
      }
    }
    U.uMarkN.value = n;
    const ic = this.plan.ice;
    if (prog > ic.p0 - 0.04 && prog < ic.p1 + 0.03) {
      ic.ice.forEach((e, i) => { U.uIce.value[i].set(e.x, e.z, e.hc, e.ha); U.uIceRot.value[i] = Math.atan2(e.rz, e.rx); });
      U.uIceN.value = ic.ice.length;
    } else U.uIceN.value = 0;
    const fl = this.plan.flood;
    if (prog > fl.p0 - 0.05 && prog < fl.p1 + 0.03) {
      U.uFlood.value.set(fl.F.fx, fl.F.fz, fl.u0, fl.u0 + fl.F.L);
      U.uFloodK.value = 1;
    } else U.uFloodK.value = 0;
    const sm = this.plan.streams;
    if (prog > sm.p0 - 0.04 && prog < sm.p1 + 0.03) {
      sm.streams.forEach((s, i) => { U.uStream.value[i].set(s.x, s.z, s.hl, s.hw); U.uStreamDir.value[i].set(s.dx, s.dz); });
      U.uStreamN.value = sm.streams.length;
    } else U.uStreamN.value = 0;
  }

  // ---------------------------------------------------------------- ?auto: how the autopilot gets through
  /**
   * Returns overrides for the autopilot: { tx, tz, amt, jump, jumpPressed, sing } (any subset) or null.
   * A: persistent autopilot state (main's autoS).
   */
  auto(player, A, dt) {
    const p = player.pos, out = {};
    const prog = progressAt(p.z);
    A.pHold = Math.max(0, (A.pHold || 0) - dt);

    // desert: jump each chasm edge; climb out at the end if fallen in
    const g = this.plan.gauntlet;
    const gu = toU(g.F, p.x, p.z), gv = toV(g.F, p.x, p.z);
    if (gu > -10 && gu < g.L + 5) {
      out.amt = 1;
      if (g.carve(gu, gv) > 2 && player.grounded) {
        const c = g.chasms.reduce((a, b) => (Math.abs(b.c - gu) < Math.abs(a.c - gu) ? b : a));
        [out.tx, out.tz] = fromUV(g.F, c.c, g.sd * (g.E + 4));
        return out;
      }
      for (const c of g.chasms) {
        const dl = (c.c - c.w / 2 - 1.4) - gu;          // to the visible edge
        if (dl > -0.5 && dl < 0.8 + player.speed * 0.05 && player.grounded) { out.jumpPressed = true; A.pHold = 0.45; }
        if (gu > c.c - c.w / 2 - 1 && gu < c.c + c.w / 2 + 1 && !player.grounded) A.pHold = Math.max(A.pHold, 0.2);
      }
      [out.tx, out.tz] = fromUV(g.F, gu + 25, 0);
      if (A.pHold > 0) out.jump = true;
      return out;
    }

    // the broken bridge: wake the cloth, fill the scarf, leap from the stub, fly over the wall
    const b = this.plan.bridge;
    const bu = toU(b.F, p.x, p.z), bv = toV(b.F, p.x, p.z);
    if (bu > -35 && bu < b.G + 2.5 && Math.abs(bv) < b.latEnd) {
      out.amt = 1;
      if (bu > 0.5 && p.y < b.hLip - 2.5 && player.grounded) { [out.tx, out.tz] = fromUV(b.F, -8, 0); return out; }   // fell in: back up
      const ready = player.charge > 0.97;
      if (!ready && player.grounded && bu < 2) {
        // stand among the low cloth (singing wakes it)
        [out.tx, out.tz] = fromUV(b.F, -4, 0);
        if (Math.hypot(out.tx - p.x, out.tz - p.z) < 1.2) out.amt = 0;
        if (!this.bridgeBanner.awakened) out.sing = true;
        return out;
      }
      [out.tx, out.tz] = fromUV(b.F, b.G + 12, 0);
      if (player.grounded && bu > b.TL - 1.6 && bu < b.TL + 1) { out.jumpPressed = true; A.pHold = 4; }
      if (!player.grounded && p.y < this.bridgeTop + 2.5 && bu < b.G + 1.5) out.jump = true;
      return out;
    }

    // depths: pool to pool through the flood
    const fl = this.plan.flood;
    if (prog > fl.p0 - 0.004 && prog < fl.p1) {
      out.amt = 1;
      const pools = fl.pools;
      let next = null;
      for (const q of pools) if (q.z < p.z - 3) { next = q; break; }
      if (next) {
        out.tx = next.x; out.tz = next.z;
        // hop from the edge of the light into the next pool
        const dx = next.x - p.x, dz = next.z - p.z, dl = Math.hypot(dx, dz) || 1;
        if (player.grounded && !this._inFlood(p.x, p.z) && this._inFlood(p.x + dx / dl * 1.6, p.z + dz / dl * 1.6)) out.jumpPressed = true;
        else if (player.grounded && this._inFlood(p.x, p.z) && dl < next.r + 3) out.jumpPressed = true;
      }
      return out;
    }
    // sand rivers: hop them
    const sm = this.plan.streams;
    if (prog > sm.p0 - 0.006 && prog < sm.p1 + 0.004) {
      for (const s of sm.streams) {
        const c = Math.abs((p.x - s.x) * -s.dz + (p.z - s.z) * s.dx);
        if (prog < s.p && c < s.hw + 0.9 && player.grounded) { out.jumpPressed = true; A.pHold = 0.5; }
      }
      if (A.pHold > 0) out.jump = true;
      out.amt = 1;
      return out;
    }

    // the wind gauntlet: shelter while it gathers and blows, run between
    const w = this.plan.wind, G = this.gustState;
    if (prog > w.p0 - 0.004 && prog < w.p1 + 0.004 && G.active && this.stones.length) {
      out.amt = 1;
      const d = this.diff.gust;
      const left = G.phase === 'warn' ? G.t : G.phase === 'calm' ? G.t + d.warn : 0;   // seconds until it blows
      {
        // the furthest stone ahead that can still be reached in time, else the nearest one
        let best = null, bestZ = 1e9, near = null, nd = 1e9;
        const [ex, ez] = onPath(w.p1 + 0.0025);
        const est = 6 * (1 - 0.35 * player.cold) * Math.max(0.5, player.speedMul) * 0.85;
        for (const s of [...this.stones, { lee: { x: ex, z: ez } }]) {
          const dd = Math.hypot(s.lee.x - p.x, s.lee.z - p.z);
          if (dd < nd) { nd = dd; near = s; }
          if (G.phase !== 'blow' && dd / est < left - 0.4 && s.lee.z < bestZ && s.lee.z < p.z + 4) { bestZ = s.lee.z; best = s; }
        }
        const s = best || near;
        if (s && Math.hypot(s.lee.x - p.x, s.lee.z - p.z) < 30) {
          out.tx = s.lee.x; out.tz = s.lee.z;
          if (Math.hypot(s.lee.x - p.x, s.lee.z - p.z) < 0.8) out.amt = 0;
        }
      }
      return out;
    }
    // ice: take the lane round each patch
    const ic = this.plan.ice;
    if (prog > ic.p0 - 0.006 && prog < ic.p1 + 0.004) {
      for (const e of ic.ice) {
        const ahead = p.z - e.z;
        if (ahead < -e.ha - 3 || ahead > e.ha + 16) continue;
        // to the lane at the near end of the patch, then along it past the far end
        const inLane = Math.abs((p.x - pathX(p.z)) - e.lane) < 2.5;
        const [x, z] = ahead > e.ha - 1 && !inLane ? onPath(e.p - m2p(e.ha + 1), e.lane) : onPath(e.p + m2p(e.ha + 5), e.lane);
        out.tx = x; out.tz = z; out.amt = 1;
        break;
      }
      return out;
    }
    return null;
  }
}
