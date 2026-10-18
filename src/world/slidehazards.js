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
const WORM_RUMBLE = 1.0, WORM_ERUPT = 0.4, WORM_UP = 2.6, WORM_RETREAT = 0.9;
const M = 16, NB = 28, NR = NB + 5;      // radial segments, body rings, total rings (body + 5 mouth rings)
const BASE = [0.6, 0.4, 0.24], RIB = [0.82, 0.64, 0.42], INSIDE = [0.42, 0.07, 0.06], IVORY = [0.95, 0.9, 0.78];
const _c = {}, _tg = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _L = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

class Worm {
  constructor(scene, mat, d, s) {
    this.d = d; this.s = s; this.state = 'idle'; this.t = 0; this.ext = 0; this.ph = Math.random() * 6;
    this.lat = 0; this.x = 0; this.y = 0; this.z = 0; this.tx = 0; this.tz = 1; this.nx = 1; this.nz = 0;
    const nv = NR * M;
    this.pos = new Float32Array(nv * 3); this.nrm = new Float32Array(nv * 3); this.col = new Float32Array(nv * 3);
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
    this.pts = new Float32Array(NB * 3); this.rad = new Float32Array(NB);
    // colours never change: pale ribs along the body, ivory teeth, a dark red throat
    const col = this.col, put = (i, j, c) => { const o = (i * M + j) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < NB; i++) for (let j = 0; j < M; j++) put(i, j, mix(BASE, RIB, 0.5 + 0.5 * Math.sin(i * 2.1) - (j > M * 0.5 ? 0.12 : 0)));
    for (let j = 0; j < M; j++) { put(NB, j, j & 1 ? IVORY : BASE); put(NB + 1, j, mix(INSIDE, BASE, 0.3)); put(NB + 2, j, INSIDE); put(NB + 3, j, mix(INSIDE, [0.1, 0.01, 0.01], 0.6)); put(NB + 4, j, [0.05, 0.005, 0.005]); }
  }

  /** The worm will come up at (s, lat) on the course. */
  start(lat) {
    const P = coursePoint(this.d, this.s, lat, _c);
    this.lat = lat; this.x = P.x; this.z = P.z; this.tx = P.tx; this.tz = P.tz; this.nx = -P.tz; this.nz = P.tx;
    this.y = terrainHeight(P.x, P.z);
    this.state = 'rumble'; this.t = 0; this.ext = 0; this.mesh.visible = true; this.lastHit = new WeakMap();
    this.pose(0);
  }

  get active() { return this.state === 'erupt' || this.state === 'up' || this.state === 'retreat'; }

  /** Shape the spine for the current extension and write the rings. */
  pose(time) {
    const e = this.ext;
    const Hy = -1.3 + 7.4 * e, ah = -4.2 * e + Math.sin(time * 1.7 + this.ph) * 0.5 * e, sw = Math.sin(time * 1.1 + this.ph) * 0.9 * e;
    const p1y = -4.5 + (Hy + 4.5) * 0.6, p2a = ah + 3.0 * e, p2y = Hy + 2.6 * e;
    const at = (u, out) => {
      const w = 1 - u, b0 = w * w * w, b1 = 3 * w * w * u, b2 = 3 * w * u * u, b3 = u * u * u;
      const a = b2 * p2a + b3 * ah, y = b0 * -4.5 + b1 * p1y + b2 * p2y + b3 * Hy, l = sw * u * u;
      return out.set(this.x + this.tx * a + this.nx * l, this.y + y, this.z + this.tz * a + this.nz * l);
    };
    const P = this.pts, R = this.rad, pos = this.pos, nrm = this.nrm;
    for (let i = 0; i < NB; i++) {
      const u = i / (NB - 1) * 0.97;
      at(u, _a); P[i * 3] = _a.x; P[i * 3 + 1] = _a.y; P[i * 3 + 2] = _a.z;
      R[i] = (1.2 - 0.25 * smooth(0.1, 0.9, u)) * (1 + 0.06 * Math.sin(i * 2.3 - time * 2.2));
    }
    _L.set(this.nx, 0, this.nz);
    const ring = (i, cx, cy, cz, tgx, tgy, tgz, r, tooth = 0) => {
      _tg.set(tgx, tgy, tgz).normalize();
      _e1.copy(_L).addScaledVector(_tg, -_L.dot(_tg)).normalize();
      _e2.crossVectors(_tg, _e1);
      for (let j = 0; j < M; j++) {
        const an = j / M * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
        const dx = _e1.x * ca + _e2.x * sa, dy = _e1.y * ca + _e2.y * sa, dz = _e1.z * ca + _e2.z * sa;
        const odd = tooth && (j & 1), rr = odd ? r * 0.8 : r, f = odd ? tooth : 0;
        const o = (i * M + j) * 3;
        pos[o] = cx + dx * rr + _tg.x * f; pos[o + 1] = cy + dy * rr + _tg.y * f; pos[o + 2] = cz + dz * rr + _tg.z * f;
        nrm[o] = dx; nrm[o + 1] = dy; nrm[o + 2] = dz;
      }
    };
    for (let i = 0; i < NB; i++) {
      const a = Math.max(0, i - 1), b = Math.min(NB - 1, i + 1);
      ring(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2], R[i]);
    }
    // the maw: a flared lip with teeth, then a throat narrowing along the same line
    const k = NB - 1, tx = P[k * 3] - P[(k - 1) * 3], ty = P[k * 3 + 1] - P[(k - 1) * 3 + 1], tz = P[k * 3 + 2] - P[(k - 1) * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1, ux = tx / tl, uy = ty / tl, uz = tz / tl;
    const cx = P[k * 3], cy = P[k * 3 + 1], cz = P[k * 3 + 2];
    [[0.4, 1.85, 0.5], [0.65, 1.3, 0], [1.3, 0.8, 0], [2.0, 0.4, 0], [2.6, 0.03, 0]].forEach(([d, r, tooth], q) => ring(NB + q, cx + ux * d, cy + uy * d, cz + uz * d, tx, ty, tz, r, tooth));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }

  /** Returns the horizontal push direction {nx, nz} if a body with its chest at (x, y, z) is inside the worm, else null. */
  hit(x, y, z) {
    const P = this.pts, R = this.rad;
    for (let i = 4; i < NB; i++) {
      const py = P[i * 3 + 1];
      if (py < this.y - 0.3) continue;
      const r = R[i] + (i === NB - 1 ? 0.6 : 0.5), dx = x - P[i * 3], dy = y - py, dz = z - P[i * 3 + 2];
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
    const wormMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, emissive: 0x3a1c0c, emissiveIntensity: 0.55, side: THREE.DoubleSide });
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
          const ahead = w.s - q.s, trig = clamp(player.speed * 1.7 + 4, 26, 62);
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
        const n = Math.floor(dt * (60 + 90 * k) + Math.random());
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.28, rr = Math.random() * (1 + 2.4 * k);
          fx.dust.emit(w.x + Math.cos(a) * rr, w.y + 0.1, w.z + Math.sin(a) * rr, Math.cos(a) * (1 + 2 * k), 1.5 + Math.random() * (2 + 3 * k), Math.sin(a) * (1 + 2 * k),
            0.9 + Math.random() * 0.6, 0.5 + Math.random() * 0.5, sand.r, sand.g * 0.95, sand.b * 0.85, 0.5, 0.8, 1.5, 1.2);
        }
        this.shake = Math.max(this.shake, 0.1 * k * (1 - smooth(10, 60, near)));
        if (w.t >= WORM_RUMBLE) {
          w.state = 'erupt'; w.t = 0;
          this.events.push({ type: 'worm-erupt', near });
          for (let i = 0; i < 90; i++) {
            const a = Math.random() * 6.28, sp = 2 + Math.random() * 7;
            fx.dust.emit(w.x + Math.cos(a) * 0.8, w.y + 0.2, w.z + Math.sin(a) * 0.8, Math.cos(a) * sp, 3 + Math.random() * 7, Math.sin(a) * sp,
              1.2 + Math.random(), 0.7 + Math.random() * 0.8, sand.r, sand.g * 0.95, sand.b * 0.85, 0.6, 0.6, 5, 1.4);
          }
          for (let i = 0; i < 24; i++) fx.sparkles.emit(w.x + (Math.random() - .5) * 3, w.y + 1 + Math.random() * 4, w.z + (Math.random() - .5) * 3, (Math.random() - .5) * 3, 2 + Math.random() * 3, (Math.random() - .5) * 3, 1.4, 0.1, 2.6, 1.9, 1.0, 0.8, 0.8, 0, -0.4);
        }
      } else if (w.state === 'erupt') {
        const k = Math.min(1, w.t / WORM_ERUPT);
        w.ext = 0.08 + 0.92 * (1 - (1 - k) ** 3) + 0.08 * Math.sin(Math.PI * k);
        this.shake = Math.max(this.shake, 0.2 * (1 - smooth(10, 70, near)));
        if (k >= 1) { w.state = 'up'; w.t = 0; }
      } else if (w.state === 'up') {
        w.ext = 1 + 0.025 * Math.sin(time * 3 + w.ph);
        // sand pours off the raised body
        if (Math.random() < dt * 40) {
          const i = 6 + ((Math.random() * (NB - 8)) | 0), o = i * 3;
          fx.dust.emit(w.pts[o] + (Math.random() - .5) * 1.5, w.pts[o + 1], w.pts[o + 2] + (Math.random() - .5) * 1.5, (Math.random() - .5), -1, (Math.random() - .5), 1.2, 0.35, sand.r, sand.g * 0.95, sand.b * 0.85, 0.4, 0.5, 6, 0.6);
        }
        if (w.t >= WORM_UP) { w.state = 'retreat'; w.t = 0; }
      } else if (w.state === 'retreat') {
        const k = Math.min(1, w.t / WORM_RETREAT);
        w.ext = 1 - k * k * (3 - 2 * k);
        if (Math.random() < dt * 60) {
          const a = Math.random() * 6.28;
          fx.dust.emit(w.x + Math.cos(a) * 1.2, w.y + 0.2, w.z + Math.sin(a) * 1.2, Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 1, 0.5, sand.r, sand.g * 0.95, sand.b * 0.85, 0.4, 0.8, 2, 1);
        }
        if (k >= 1) { w.state = 'spent'; w.mesh.visible = false; continue; }
      }
      w.pose(time);
    }

    // ---- who got hit
    for (const b of bodies) {
      if (b.slide < 0.3 || b.scripted) continue;
      const p = b.pos;
      for (const w of this.worms) {
        if (!w.active || w.ext < 0.3 || Math.abs(p.x - w.x) > 9 || Math.abs(p.z - w.z) > 9) continue;
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
