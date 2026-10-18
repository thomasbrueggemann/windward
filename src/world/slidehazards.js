import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rngFor, range } from './seed.js';
import { terrainHeight, clamp, smooth } from './heightfield.js';
import { coursePoint, tab } from './slidecourse.js';
import { weather, finish } from './stone.js';

/**
 * What lies in the way on the long sand slides: boulders half sunk in the floor and low walls (steer round them or
 * jump them), and sandworms that rise out of the sand ahead of the rider. A worm shakes the ground and throws up
 * dust about a second before it erupts, right where you are heading, then rears up facing you, sways, and sinks
 * back. Rocks and worms knock a rider off their line: speed lost, a short stun, a hop. Companions are hit too.
 */

const ROCK_HIT = 0.5;            // body radius (m) added to a rock's
// Dune-sized and unhurried: a long swelling rumble, a slow rise, a long look around, a slow sinking away
const WORM_RUMBLE = 2.4, WORM_ERUPT = 2.0, WORM_UP = 4.5, WORM_RETREAT = 3.2, WORM_SCALE = 2.6, WORM_DRIFT = 0.9;
// rings: radial segments, body rings, mouth rings (rim, then a funnel down to the throat)
const M = 28, NB = 40;
const MOUTH = [[0.12, 1.05], [0.12, 0.93], [-0.26, 0.85], [-0.48, 0.7], [-0.66, 0.55], [-0.8, 0.4], [-0.89, 0.25], [-0.94, 0.12], [-0.95, 0.02]];   // [depth, radius] in units of the head radius
const NR = NB + MOUTH.length;
const SKIN = [0.46, 0.34, 0.21], PLATE = [0.68, 0.53, 0.35], RIM = [0.6, 0.46, 0.3], THROAT = [0.2, 0.09, 0.05];
const TOOTH = [0.9, 0.76, 0.52];
const _c = {}, _tg = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _L = new THREE.Vector3(), _a = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * The inside of the mouth: hundreds of long thin teeth lying in rings over the funnel, every one pointing in toward
 * the dark throat, so the whole maw reads as a burst of needles. One shared geometry in head units (z = out of the
 * mouth, radius 1 = the rim); each worm places it on its head.
 */
let _teeth = null;
function teethMesh() {
  if (_teeth) return _teeth;
  const r = rngFor('worm-teeth'), pos = [];
  const depth = (f) => -0.95 * (1 - f * f);
  for (let f = 0.93; f > 0.17; f -= 0.052) {
    const n = Math.round(f * 74);
    for (let k = 0; k < n; k++) {
      const an = (k + r() * 0.8) / n * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
      const fb = f + (r() - 0.5) * 0.02, zb = depth(fb) + 0.02, rb = fb;
      const L = (0.2 + 0.2 * r()) * (0.5 + 0.7 * fb), tilt = 0.2 + 0.2 * r();
      // direction: inward along the radius, slightly out of the mouth, with a little scatter
      let dx = -ca + (r() - 0.5) * 0.2, dy = -sa + (r() - 0.5) * 0.2, dz = tilt;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const bx = ca * rb, by = sa * rb, w = 0.016 + 0.01 * r();
      // a thin three-sided spike: base triangle perpendicular to the direction, apex at the tip
      const px = -sa, py = ca;                               // a vector perpendicular to the radial direction in the mouth plane
      const q1 = [px * w, py * w, 0], q2 = [-px * w * 0.5 + ca * w * 0.9, -py * w * 0.5 + sa * w * 0.9, w * 0.5], q3 = [-px * w * 0.5 - ca * w * 0.9, -py * w * 0.5 - sa * w * 0.9, -w * 0.5];
      const A = [bx + q1[0], by + q1[1], zb + q1[2]], B = [bx + q2[0], by + q2[1], zb + q2[2]], C = [bx + q3[0], by + q3[1], zb + q3[2]], T = [bx + dx * L, by + dy * L, zb + dz * L];
      pos.push(...A, ...B, ...T, ...B, ...C, ...T, ...C, ...A, ...T);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...TOOTH), roughness: 0.75, emissive: 0x4a2c12, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  return (_teeth = { g, m });
}

class Worm {
  constructor(scene, mat, d, s) {
    this.d = d; this.s = s; this.state = 'idle'; this.t = 0; this.ext = 0; this.ph = Math.random() * 6;
    this.lat = 0; this.x = 0; this.y = 0; this.z = 0; this.tx = 0; this.tz = 1; this.nx = 1; this.nz = 0;
    const nv = NR * M;
    this.pos = new Float32Array(nv * 3); this.nrm = new Float32Array(nv * 3); this.col = new Float32Array(nv * 3);
    this.jit = new Float32Array(nv);                      // fixed roughness of the skin
    const idx = [];
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, e = (i + 1) * M + (j + 1) % M;
      idx.push(a, c, b, b, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
    const T = teethMesh();
    this.teeth = new THREE.Mesh(T.g, T.m); this.teeth.frustumCulled = false; this.teeth.visible = false;
    scene.add(this.teeth);
    this.pts = new Float32Array(NB * 3); this.rad = new Float32Array(NB);
    // colours and roughness never change: armoured plates ringing the body, pale rim, dark throat
    const col = this.col, put = (i, j, c, k = 1) => { const o = (i * M + j) * 3; col[o] = c[0] * k; col[o + 1] = c[1] * k; col[o + 2] = c[2] * k; };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < NR; i++) for (let j = 0; j < M; j++) this.jit[i * M + j] = 0.955 + Math.random() * 0.09;
    for (let i = 0; i < NB; i++) for (let j = 0; j < M; j++) put(i, j, mix(SKIN, PLATE, clamp(0.5 + 0.55 * Math.sin(i * 1.7) + (Math.random() - 0.5) * 0.5, 0, 1)), 0.88 + Math.random() * 0.24);
    for (let q = 0; q < MOUTH.length; q++) for (let j = 0; j < M; j++) {
      const i = NB + q;
      if (q < 2) put(i, j, RIM, 0.9 + Math.random() * 0.2);
      else put(i, j, mix([0.45, 0.28, 0.15], THROAT, (q - 2) / (MOUTH.length - 3)));
    }
  }

  /** The worm will come up at (s, lat) on the course. */
  start(lat) {
    const P = coursePoint(this.d, this.s, lat, _c);
    this.lat = lat; this.x = P.x; this.z = P.z; this.tx = P.tx; this.tz = P.tz; this.nx = -P.tz; this.nz = P.tx;
    this.y = terrainHeight(P.x, P.z);
    this.dir = lat > 0 ? -1 : 1; this.reach = tab(this.d.Ft, this.s) + 2;
    this.state = 'rumble'; this.t = 0; this.ext = 0; this.mesh.visible = true; this.lastHit = new WeakMap();
    this.pose(0);
  }

  /** The worm ploughs slowly sideways through the sand while it is up. */
  drift(dt) {
    this.lat += this.dir * WORM_DRIFT * dt;
    if (Math.abs(this.lat) > this.reach) { this.lat = Math.sign(this.lat) * this.reach; this.dir = -this.dir; }
    const P = coursePoint(this.d, this.s, this.lat, _c);
    this.x = P.x; this.z = P.z; this.y = terrainHeight(P.x, P.z);
  }

  get active() { return this.state === 'erupt' || this.state === 'up' || this.state === 'retreat'; }

  /** Shape the spine for the current extension and write the rings. */
  pose(time) {
    const e = this.ext;
    // a huge, low body: the tail stays under the sand behind it, the back humps out of it and the blunt head skims along
    // just above the surface, its round maw facing the rider
    const sway = Math.sin(time * 0.45 + this.ph) * 1.2 * e;
    const p1a = 5, p1y = -4 + 5.5 * e, p2a = 1.5 * e, p2y = -1.5 + 2.3 * e, ha = -3.5 * e + Math.sin(time * 0.7 + this.ph) * 0.4 * e, hy = -1.5 + 2.3 * e;
    const S = WORM_SCALE;
    const at = (u, out) => {
      const w = 1 - u, b0 = w * w * w, b1 = 3 * w * w * u, b2 = 3 * w * u * u, b3 = u * u * u;
      const a = (b0 * 8 + b1 * p1a + b2 * p2a + b3 * ha) * S;
      const y = (b0 * -4 + b1 * p1y + b2 * p2y + b3 * hy + 0.3 * e * Math.sin(u * 11 - time * 1.0) * smooth(0.1, 0.5, u)) * S, l = sway * u * u * S;
      return out.set(this.x + this.tx * a + this.nx * l, this.y + y, this.z + this.tz * a + this.nz * l);
    };
    const P = this.pts, R = this.rad, pos = this.pos, nrm = this.nrm, jit = this.jit;
    for (let i = 0; i < NB; i++) {
      const u = i / (NB - 1) * 0.97;
      at(u, _a); P[i * 3] = _a.x; P[i * 3 + 1] = _a.y; P[i * 3 + 2] = _a.z;
      // a thick body that swells slightly toward a blunt head; plates ring it
      R[i] = (1.05 - 0.15 * smooth(0.1, 0.6, u) + 0.2 * smooth(0.8, 1, u)) * S * (1 + 0.07 * Math.sin(i * 1.7 - time * 0.5));
    }
    _L.set(this.nx, 0, this.nz);
    // ring i of M points around (cx, cy, cz), perpendicular to t, radius r (each point roughened by its fixed jitter)
    const frame = (tgx, tgy, tgz) => {
      _tg.set(tgx, tgy, tgz).normalize();
      _e1.copy(_L).addScaledVector(_tg, -_L.dot(_tg)).normalize();
      _e2.crossVectors(_tg, _e1);
    };
    const ring = (i, cx, cy, cz, r, rough = 1, push = 0) => {
      for (let j = 0; j < M; j++) {
        const an = j / M * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
        const dx = _e1.x * ca + _e2.x * sa, dy = _e1.y * ca + _e2.y * sa, dz = _e1.z * ca + _e2.z * sa;
        const rr = r * (1 + (jit[i * M + j] - 1) * rough), o = (i * M + j) * 3;
        pos[o] = cx + dx * rr + _tg.x * push; pos[o + 1] = cy + dy * rr + _tg.y * push; pos[o + 2] = cz + dz * rr + _tg.z * push;
        nrm[o] = dx; nrm[o + 1] = dy; nrm[o + 2] = dz;
      }
    };
    for (let i = 0; i < NB; i++) {
      const a = Math.max(0, i - 1), b = Math.min(NB - 1, i + 1);
      frame(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
      ring(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], R[i]);
    }
    // the maw: a thick rolled rim, then a funnel down to the dark throat (depth is back along the body)
    const k = NB - 1;
    frame(P[k * 3] - P[(k - 1) * 3], P[k * 3 + 1] - P[(k - 1) * 3 + 1], P[k * 3 + 2] - P[(k - 1) * 3 + 2]);
    const cx = P[k * 3], cy = P[k * 3 + 1], cz = P[k * 3 + 2], Rh = R[k];
    MOUTH.forEach(([depth, f], q) => ring(NB + q, cx + _tg.x * depth * Rh, cy + _tg.y * depth * Rh, cz + _tg.z * depth * Rh, f * Rh, q < 2 ? 1.6 : 0.3));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
    // the teeth ride on the head: x, y across the mouth, z out of it
    _m.makeBasis(_e1, _e2, _tg);
    this.teeth.position.set(cx, cy, cz); this.teeth.quaternion.setFromRotationMatrix(_m); this.teeth.scale.setScalar(Rh);
    this.teeth.visible = this.mesh.visible;
  }

  setVisible(v) { this.mesh.visible = v; this.teeth.visible = v; }

  /** Returns the horizontal push direction {nx, nz} if a body with its chest at (x, y, z) is inside the worm, else null. */
  hit(x, y, z) {
    const P = this.pts, R = this.rad;
    for (let i = 6; i < NB; i++) {
      const py = P[i * 3 + 1];
      if (py < this.y - 0.3) continue;
      const r = R[i] + 0.5, dx = x - P[i * 3], dy = y - py, dz = z - P[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < r * r) {
        const l = Math.hypot(dx, dz);
        return l > 0.05 ? { nx: dx / l, nz: dz / l } : { nx: this.nx, nz: this.nz };
      }
    }
    return null;
  }
}

export class SlideHazards {
  /** deps: { ruins, fx, slides (the course definitions) } */
  constructor(scene, { ruins, fx, slides }) {
    this.scene = scene; this.fx = fx;
    this.events = []; this.hints = []; this.shake = 0;
    this.rocks = []; this.worms = [];
    this._hitT = new WeakMap();
    const r = rngFor('slide-hazards');
    const wormMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: 0x4a2c14, emissiveIntensity: 0.5, side: THREE.DoubleSide });
    for (const d of slides) {
      const nearKick = (s, pad = 16) => d.kicksS.some((k) => s > k - pad && s < k + pad + 12);
      // boulders: singly or in pairs with a gap between them, never on a kicker
      const geos = [];
      for (let s = 95 + r() * 25; s < d.Ls - 70; s += 26 + r() * 28) {
        if (nearKick(s)) continue;
        const reach = tab(d.Ft, s) + 1.5;
        let lat = (r() * 2 - 1) * reach;
        const n = r() < 0.3 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          if (k) { lat += (lat > 0 ? -1 : 1) * (5 + r() * 2); if (Math.abs(lat) > reach + 1) break; }
          const ds = k ? (r() - 0.5) * 6 : 0;
          this._addRock(d, s + ds, lat, range(r, 0.9, 1.9), r, geos);
        }
      }
      const mat = d.kind === 'gold' ? ruins.stone : ruins.stoneDark;
      if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos, false), mat); this.scene.add(m); }
      // sandworms: a few per course, far enough apart to breathe
      for (let s = 170 + r() * 40; s < d.Ls - 110; s += range(r, 120, 170)) {
        if (nearKick(s, 24)) continue;
        this.worms.push(new Worm(scene, wormMat, d, s));
      }
    }
  }

  _addRock(d, s, lat, rad, r, geos) {
    const P = coursePoint(d, s, lat, _c), gy = terrainHeight(P.x, P.z);
    const h = rad * 1.05;
    this.rocks.push({ d, s, lat, x: P.x, z: P.z, r: rad * 0.9, h, gy });
    const mk = (rr, x, z, sd) => {
      let g = finish(new THREE.IcosahedronGeometry(1, 2));
      weather(g, 0.55, 1.3, sd); g.computeVertexNormals();
      g.scale(rr * (0.9 + r() * 0.3), rr * 0.8, rr * (0.9 + r() * 0.3));
      g.rotateY(r() * 6.28);
      g.translate(x, terrainHeight(x, z) - rr * 0.22, z);
      geos.push(g);
    };
    mk(rad, P.x, P.z, r() * 40);
    for (let i = 0; i < 3; i++) { const a = r() * 6.28, dd = rad * (1.1 + r() * 0.8); mk(rad * (0.18 + r() * 0.18), P.x + Math.cos(a) * dd, P.z + Math.sin(a) * dd, r() * 40); }
  }

  /** Knock a rider off their line. */
  _knock(b, nx, nz, { slow, stun, hop, shove, charge = 0 }) {
    const v = b.vel;
    v.x = v.x * slow + nx * shove; v.z = v.z * slow + nz * shove;
    v.y = Math.max(v.y, hop);
    b.stunned = Math.max(b.stunned, stun);
    b.grounded = false; b.airT = 0.14; b.squashV -= 3; b.glideLatch = false;
    if (charge) b.charge = Math.max(0, b.charge - charge);
  }

  /**
   * ctx: { player, bodies, q (player's course query or null), time, sand (THREE.Color) }
   * Call after the controllers updated (same place as the slides' feed).
   */
  update(dt, ctx) {
    const { player, bodies, q, time, sand } = ctx, fx = this.fx;
    this.shake = 0;
    const riding = !!q && player.slide > 0.3;

    // ---- sandworms
    for (const w of this.worms) {
      if (w.state === 'idle') {
        if (riding && q.slide === w.d) {
          const ahead = w.s - q.s, trig = clamp(player.speed * 3.4 + 6, 55, 100);
          if (ahead > 4 && ahead < trig) {
            const reach = tab(w.d.Ft, w.s) + 2;
            w.start(clamp(q.d + (Math.random() - 0.5) * 2.4, -reach, reach));
            this.events.push({ type: 'worm-rumble' });
            this.hints.push(['worm', 'The sand trembles &mdash; something is coming up under it. <b>Steer clear.</b>', 7000]);
          }
        }
        continue;
      }
      if (w.state === 'spent') {
        if (!q || q.slide !== w.d || q.s < w.s - 100) w.state = 'idle';
        continue;
      }
      w.t += dt;
      const near = Math.hypot(w.x - player.pos.x, w.z - player.pos.z);
      if (w.state === 'rumble') {
        const k = w.t / WORM_RUMBLE;
        w.ext = 0.08 * smooth(0, 1, k);
        // the ground heaves: a widening ring of sand thrown up around the spot
        const n = Math.floor(dt * (80 + 160 * k) + Math.random());
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.28, rr = Math.random() * (2 + 5 * k);
          fx.dust.emit(w.x + Math.cos(a) * rr, w.y + 0.1, w.z + Math.sin(a) * rr, Math.cos(a) * (1 + 2 * k), 1.5 + Math.random() * (2 + 3 * k), Math.sin(a) * (1 + 2 * k),
            1.3 + Math.random() * 0.9, 0.8 + Math.random() * 0.8, sand.r, sand.g * 0.95, sand.b * 0.85, 0.5, 0.8, 1.5, 1.2);
        }
        this.shake = Math.max(this.shake, 0.17 * k * k * (1 - smooth(15, 90, near)));
        if (w.t >= WORM_RUMBLE) {
          w.state = 'erupt'; w.t = 0;
          this.events.push({ type: 'worm-erupt', near });
          for (let i = 0; i < 120; i++) {
            const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 5;
            fx.dust.emit(w.x + Math.cos(a) * 1.5, w.y + 0.2, w.z + Math.sin(a) * 1.5, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp,
              2 + Math.random() * 1.5, 1.2 + Math.random() * 1.2, sand.r, sand.g * 0.95, sand.b * 0.85, 0.6, 0.6, 5, 1.4);
          }
          for (let i = 0; i < 24; i++) fx.sparkles.emit(w.x + (Math.random() - .5) * 3, w.y + 1 + Math.random() * 4, w.z + (Math.random() - .5) * 3, (Math.random() - .5) * 3, 2 + Math.random() * 3, (Math.random() - .5) * 3, 1.4, 0.1, 2.6, 1.9, 1.0, 0.8, 0.8, 0, -0.4);
        }
      } else if (w.state === 'erupt') {
        const k = Math.min(1, w.t / WORM_ERUPT);
        w.ext = 0.08 + 0.92 * k * k * (3 - 2 * k);
        w.drift(dt);
        this.shake = Math.max(this.shake, 0.2 * (1 - smooth(15, 90, near)));
        // the sand slides off the rising flanks in sheets
        const nd = Math.floor(dt * 90 * k + Math.random());
        for (let i = 0; i < nd; i++) {
          const o = (((Math.random() * (NB - 4)) | 0) + 2) * 3, a = Math.random() * 6.28;
          fx.dust.emit(w.pts[o] + Math.cos(a) * 2, Math.max(w.y, w.pts[o + 1] - 1), w.pts[o + 2] + Math.sin(a) * 2, Math.cos(a) * 1.5, -0.5, Math.sin(a) * 1.5, 1.8, 0.9, sand.r, sand.g * 0.95, sand.b * 0.85, 0.35, 0.6, 3, 1.2);
        }
        if (k >= 1) { w.state = 'up'; w.t = 0; }
      } else if (w.state === 'up') {
        w.ext = 1 + 0.02 * Math.sin(time * 1.2 + w.ph);
        w.drift(dt);
        // sand pours off the raised body
        if (Math.random() < dt * 50) {
          const i = 6 + ((Math.random() * (NB - 8)) | 0), o = i * 3;
          fx.dust.emit(w.pts[o] + (Math.random() - .5) * 2.5, w.pts[o + 1], w.pts[o + 2] + (Math.random() - .5) * 2.5, (Math.random() - .5), -1, (Math.random() - .5), 1.8, 0.6, sand.r, sand.g * 0.95, sand.b * 0.85, 0.4, 0.5, 6, 0.6);
        }
        if (w.t >= WORM_UP) { w.state = 'retreat'; w.t = 0; }
      } else if (w.state === 'retreat') {
        const k = Math.min(1, w.t / WORM_RETREAT);
        w.ext = 1 - k * k * (3 - 2 * k);
        w.drift(dt * 0.5);
        if (Math.random() < dt * 60) {
          const a = Math.random() * 6.28;
          fx.dust.emit(w.x + Math.cos(a) * 1.2, w.y + 0.2, w.z + Math.sin(a) * 1.2, Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 1, 0.5, sand.r, sand.g * 0.95, sand.b * 0.85, 0.4, 0.8, 2, 1);
        }
        if (k >= 1) { w.state = 'spent'; w.setVisible(false); continue; }
      }
      w.pose(time);
    }

    // ---- who got hit
    for (const b of bodies) {
      if (b.slide < 0.3 || b.scripted) continue;
      const p = b.pos;
      for (const w of this.worms) {
        if (!w.active || w.ext < 0.45 || Math.abs(p.x - w.x) > 14 || Math.abs(p.z - w.z) > 14) continue;
        if ((w.lastHit.get(b) || -9) > time - 1.8) continue;
        const h = w.hit(p.x, p.y + 0.9, p.z);
        if (!h) continue;
        w.lastHit.set(b, time);
        this._knock(b, h.nx, h.nz, { slow: 0.4, stun: 1.0, hop: 7, shove: 7, charge: 0.4 });
        this._burst(p, sand, 40, 5);
        this.events.push({ type: 'bump', kind: 'worm', mine: b === player });
      }
      for (const rk of this.rocks) {
        const dx = p.x - rk.x, dz = p.z - rk.z;
        if (Math.abs(dx) > 3.5 || Math.abs(dz) > 3.5) continue;
        const d = Math.hypot(dx, dz), m = rk.r + ROCK_HIT;
        if (d >= m || p.y - rk.gy > rk.h * 0.85) continue;      // clear of it, or over the top
        const nx = d > 0.05 ? dx / d : 0, nz = d > 0.05 ? dz / d : 1;
        p.x = rk.x + nx * m; p.z = rk.z + nz * m;
        if ((this._hitT.get(b) || -9) > time - 0.9) continue;
        this._hitT.set(b, time);
        this._knock(b, nx, nz, { slow: 0.5, stun: 0.7, hop: 3.5, shove: 3 });
        this._burst(p, sand, 22, 3.5);
        this.events.push({ type: 'bump', kind: 'rock', mine: b === player });
      }
    }
  }

  _burst(p, sand, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = sp * (0.4 + Math.random());
      this.fx.dust.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * s, 1 + Math.random() * sp * 0.6, Math.sin(a) * s, 0.9 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, sand.r, sand.g * 0.95, sand.b * 0.85, 0.55, 1, 4, 1.2);
    }
  }

  /** For the autopilot: the lateral offset to ride at (null = stay central) so the next rock or worm is missed. */
  avoid(q) {
    let best = null, bestAhead = 1e9;
    const lane = q.d;
    for (const rk of this.rocks) {
      const ahead = rk.s - q.s;
      if (rk.d !== q.slide || ahead < 4 || ahead > 40 || ahead > bestAhead || Math.abs(rk.lat - lane) > rk.r + 3.2) continue;
      const room = tab(q.slide.Ft, rk.s) + 1;
      const side = rk.lat > 0 ? -1 : 1;
      const L = rk.lat + side * (rk.r + 3.4);
      best = Math.abs(L) > room + 1 ? rk.lat - side * (rk.r + 3.4) : L; bestAhead = ahead;
    }
    for (const w of this.worms) {
      if (w.d !== q.slide || w.state === 'idle' || w.state === 'spent' || w.state === 'retreat') continue;
      const ahead = w.s - q.s;
      if (ahead < -2 || ahead > 45) continue;
      const side = w.lat > 0 ? -1 : 1;
      best = clamp(w.lat + side * 4.6, -tab(q.slide.Ft, w.s) - 1, tab(q.slide.Ft, w.s) + 1); bestAhead = Math.min(bestAhead, ahead);
    }
    return best;
  }
}
