import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rngFor, range } from './seed.js';
import { addSite } from './layout.js';
import { SLIDES, slideAt, terrainHeight, smooth, clamp } from './heightfield.js';
import { coursePoint, tab } from './slidecourse.js';
import { shaft } from './stone.js';
import { makeSoftDot } from '../textures.js';

/**
 * The long sand slides (course geometry: slidecourse.js, ground: heightfield.js). Per world two of them:
 *
 *   The Great Dune       from the desert down a vast meandering trough into the sunken city
 *   The Golden Descent   past the broken bridge, through the last arches and shafts of evening light, down into the
 *                        depths (the colour script follows you down from gold to blue)
 *
 * On a slide the traveler (and every companion) is carried by the course (player.js _slidePhysics): it builds to
 * 18-28 m/s, the stick carves, kickers throw you into short glides, the halfpipe walls turn you back and nobody can
 * stop dead. This module feeds the controller each frame, keeps the formation on the course, drives the autopilot
 * and adds what you see and hear: the lip, streaming sand, light, arches, a long trail and spray.
 */

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
  float near = smoothstep(4., 26., d);
  float motes = 0.75 + 0.25 * sin(vUv.y * 40. - uTime * 1.3 + vW.x * 0.3);
  float a = (0.15 + 0.85 * vUv.y) * side * near * uIntensity * motes * (0.85 + 0.15 * sin(uTime * 0.5 + vW.z * 0.07));
  a *= smoothstep(0., 0.1, vUv.y);
  gl_FragColor = vec4(uColor * a, a);
}`;

// the long groove a rider leaves in the sand, with a faint gold glint along its bottom
const trailVert = /* glsl */`
attribute float aAge; attribute float aSide;
varying float vAge; varying float vSide;
#include <fog_pars_vertex>
void main() { vAge = aAge; vSide = aSide; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const trailFrag = /* glsl */`
uniform vec3 uSand, uGlint; uniform float uOp;
varying float vAge; varying float vSide;
#include <fog_pars_fragment>
void main() {
  float e = 1. - vSide * vSide;
  float fade = (1. - vAge) * smoothstep(0., 0.04, vAge);
  float core = exp(-vSide * vSide * 22.);
  gl_FragColor = vec4(uSand * (0.5 + 0.2 * e) + uGlint * core * 0.9, (0.42 * e + 0.25 * core) * fade * uOp);
#include <fog_fragment>
}`;

const TRAIL_N = 260, TRAIL_STEP = 0.8;
class Trail {
  constructor(scene, u) {
    this.pts = []; this.acc = 0;
    const nv = TRAIL_N * 2;
    this.pos = new Float32Array(nv * 3); this.age = new Float32Array(nv);
    const side = new Float32Array(nv), idx = [];
    for (let i = 0; i < TRAIL_N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; if (i < TRAIL_N - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...u }, vertexShader: trailVert, fragmentShader: trailFrag,
      transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.visible = false;
    this.geo = g;
    scene.add(this.mesh);
  }
  update(dt, who, riding) {
    const p = who.pos;
    if (riding && who.grounded) {
      const last = this.pts[this.pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > TRAIL_STEP) {
        this.pts.push({ x: p.x, z: p.z, t: 0 });
        if (this.pts.length > TRAIL_N) this.pts.shift();
      }
    } else if (riding && this.pts.length) this.pts[this.pts.length - 1].gap = true;
    for (const q of this.pts) q.t += dt;
    while (this.pts.length && this.pts[0].t > 40) this.pts.shift();
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    const P = this.pos, A = this.age;
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 1)], b = this.pts[Math.min(n - 1, i + 1)], q = this.pts[i];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const w = 0.32;
      for (const k of [0, 1]) {
        const sd = k ? w : -w, x = q.x - tz * sd, z = q.z + tx * sd;
        const o = (i * 2 + k) * 3;
        P[o] = x; P[o + 1] = terrainHeight(x, z) + 0.04; P[o + 2] = z;
        A[i * 2 + k] = q.gap ? 1 : Math.min(1, Math.max((n - 1 - i) / (TRAIL_N - 1), q.t / 40));
      }
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aAge.needsUpdate = true;
  }
}

const _q = {}, _c = {}, _c2 = {};
const exp = (k, dt) => 1 - Math.exp(-k * dt);

export class Slides {
  /** deps: { ruins, props, fx } */
  constructor(scene, { ruins, props, fx }) {
    this.scene = scene; this.ruins = ruins; this.props = props; this.fx = fx;
    this.list = SLIDES;
    this.hints = [];
    this.events = [];
    this.r = rngFor('slides-build');
    this.state = { k: 0, kind: null, u: 0, speed: 0 };    // for the audio
    this.stats = [];                                        // per ride: { id, t0, t1, dur, peak, kicks } (tests)
    this._ride = null;
    this._offT = new WeakMap();
    this.shaftMats = [];
    this.trailU = { uSand: { value: new THREE.Color(0.6, 0.4, 0.25) }, uGlint: { value: new THREE.Color(0.5, 0.33, 0.12) }, uOp: { value: 1 } };
    this.trails = new Map();
    this.glowTex = makeSoftDot();
    this.lips = [];
    for (const d of SLIDES) {
      const [x, z] = [d.fx[d.nf >> 1], d.fz[d.nf >> 1]];
      d.site = addSite('slide', x, z, { y: terrainHeight(x, z), r: d.Ls / 2, kind: d.kind, name: d.name, length: Math.round(d.Ls), drop: Math.round(d.hs - d.he), lip: { x: d.fx[0], z: d.fz[0] } });
      this._buildLip(d);
      if (d.kind === 'gold') this._buildGold(d); else this._buildDune(d);
      this._buildCloth(d);
    }
  }

  // ---------------------------------------------------------------- building
  _buildLip(d) {
    const r = this.ruins, P = coursePoint(d, 0, 0, _c);
    const y = terrainHeight(P.x, P.z);
    // two leaning standing stones frame the lip, gold-capped; a soft glow and a beam of light mark where the sand falls away
    const parts = [];
    for (const sd of [-1, 1]) {
      const lx = P.x - P.tz * sd * (tab(d.Wt, 0) + 3), lz = P.z + P.tx * sd * (tab(d.Wt, 0) + 3);
      const gy = terrainHeight(lx, lz), h = 11 + this.r() * 3;
      const g = shaft(1.0, 1.5, h, { poly: 4, flutes: 0, jag: 1.2, seed: this.r() * 30 }).translate(0, h / 2, 0);
      g.rotateZ(sd * 0.07); g.rotateY(Math.atan2(P.tx, P.tz));
      g.translate(lx, gy - 1.2, lz);
      parts.push(g);
      r.colliders.push({ kind: 'circle', x: lx, z: lz, r: 1.4, top: gy + h });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.2, 4), r.gold);
      cap.position.set(lx, gy - 1.2 + h + 0.9, lz); cap.rotation.y = 0.78;
      this.scene.add(cap);
    }
    const m = new THREE.Mesh(mergeGeometries(parts, false), r.stone);
    this.scene.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(2.2, 1.5, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.5 }));
    glow.scale.set(26, 12, 1); glow.position.set(P.x + P.tx * 6, y + 2, P.z + P.tz * 6);
    this.scene.add(glow);
    this._shafts(d, [[4, 0, 6, 70]]);
    this.lips.push({ d, glow, x: P.x, y, z: P.z });
  }

  /** Shafts of light falling onto the course: [[s, lat, radius, height], ...] (one merged mesh per slide). */
  _shafts(d, spec, color = new THREE.Color(2.3, 1.7, 0.9)) {
    const sun = new THREE.Vector3(-0.25, 0.9, -0.3).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sun);
    const geos = [];
    for (const [s, lat, rad, h] of spec) {
      const P = coursePoint(d, s, lat, _c2), y = terrainHeight(P.x, P.z);
      const g = new THREE.CylinderGeometry(rad * 0.55, rad, h, 18, 1, true).translate(0, h / 2, 0);
      g.applyQuaternion(q); g.translate(P.x, y - 1, P.z);
      geos.push(g);
    }
    const m = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0.6 }, uTime: { value: 0 }, uColor: { value: color } },
      vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), m);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.shaftMats.push({ m, d });
  }

  _buildDune(d) {
    // half-buried stones on the rims now and then, and red flags on the kickers
    const r = this.ruins;
    for (let s = 70; s < d.Ls - 60; s += 55 + this.r() * 50) {
      const sd = this.r() < 0.5 ? -1 : 1, P = coursePoint(d, s, sd * (tab(d.Wt, s) + 3 + this.r() * 6), _c);
      const gy = terrainHeight(P.x, P.z), h = 3 + this.r() * 6;
      const g = shaft(0.8 + this.r() * 0.5, 1.1, h, { poly: 4 + ((this.r() * 3) | 0), flutes: 0, jag: 0.8, seed: this.r() * 50 }).translate(0, h / 2, 0);
      const m = new THREE.Mesh(g, r.stone);
      m.position.set(P.x, gy - 1.5, P.z); m.rotation.set((this.r() - .5) * 0.4, this.r() * 6, (this.r() - .5) * 0.4);
      this.scene.add(m);
    }
    this._kickFlags(d);
  }

  _kickFlags(d) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a2410, emissive: 0x5a0e04, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    this.flags = this.flags || [];
    for (const sk of d.kicksS) for (const sd of [-1, 1]) {
      const P = coursePoint(d, sk, sd * (tab(d.Wt, sk) + 0.5), _c), gy = terrainHeight(P.x, P.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 5), this.ruins.stoneDark);
      pole.position.set(P.x, gy + 1.4, P.z); this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 2.2), mat);
      flag.position.set(P.x, gy + 2.8, P.z); flag.rotation.set(0.2, Math.atan2(P.tx, P.tz), 0.6);
      this.scene.add(flag);
      this.flags.push({ flag, ph: this.r() * 6 });
    }
  }

  _buildGold(d) {
    // the last of the city: great arches straddling the trough, columns on the walls, shafts of evening light
    const r = this.ruins, spec = [];
    const archS = [];
    for (let s = 75 + this.r() * 20; s < d.Ls - 120; s += 70 + this.r() * 45) archS.push(s);
    for (const s of archS) {
      const P = coursePoint(d, s, 0, _c);
      const W = tab(d.Wt, s), sc = (W + 1.6) / 4.2;
      // the arch's feet stand on the banks: base at the lower of them
      let y0 = 1e9;
      for (const sd of [-1, 1]) for (const o of [W + 2, W + 6, W + 10]) { const x = P.x - P.tz * sd * o, z = P.z + P.tx * sd * o; y0 = Math.min(y0, terrainHeight(x, z)); }
      y0 = Math.min(y0, terrainHeight(P.x, P.z) + 3);
      r._arch(P.x, P.z, y0, Math.atan2(-P.tx, -P.tz), sc);
      spec.push([s + 3, 0, 5 + this.r() * 2, 90]);
    }
    // columns high on the walls to weave past (only a rider riding the wall meets one)
    for (let s = 110; s < d.Ls - 100; s += 38 + this.r() * 40) {
      const sd = this.r() < 0.5 ? -1 : 1, lat = sd * (tab(d.Wt, s) - 3.2);
      if (archS.some((a) => Math.abs(a - s) < 12)) continue;
      const P = coursePoint(d, s, lat, _c), gy = terrainHeight(P.x, P.z);
      r._column(P.x, P.z, gy, 9 + this.r() * 6, this.r() < 0.45);
    }
    for (let s = 60; s < d.Ls - 40; s += 55 + this.r() * 30) if (!spec.some((q) => Math.abs(q[0] - s) < 25)) spec.push([s, (this.r() - 0.5) * 8, 4 + this.r() * 3, 80]);
    this._shafts(d, spec);
    this._kickFlags(d);
  }

  _buildCloth(d) {
    // floating cloth over each kicker: fly through it off the jump to fill your scarf
    const props = this.props;
    if (!props || !props.addPiece) return;
    for (const sk of d.kicksS) for (let i = 0; i < 3; i++) {
      const P = coursePoint(d, sk + 9 + i * 6, (i - 1) * 1.6, _c);
      props.addPiece(P.x, tab(d.F, sk + 9 + i * 6) + 3.4 + i * 0.4, P.z);
    }
    props.updateMatrices && props.updateMatrices();
  }

  // ---------------------------------------------------------------- per frame
  /** Feed one body's controller from the course under it; returns the query (or null). */
  _feed(body, extraV = 0) {
    const q = slideAt(body.pos.x, body.pos.z, _q);
    if (!q || !q.ok) { body.slide = 0; return null; }
    const d = q.slide, s = q.s;
    const w = smooth(-5, 1, s) * (1 - smooth(d.Ls - 6, d.Ls + 2, s)) * (1 - smooth(q.W + 0.5, q.W + 2.5, Math.abs(q.d)));
    body.slide = w; body.slideTx = q.tx; body.slideTz = q.tz; body.slideD = q.d; body.slideW = q.W; body.slideFw = q.Fw;
    body.slideVT = clamp(q.vT + extraV, 10, 28);
    return q;
  }

  /**
   * ctx: { player, group, camera, time, playing, sandU, env }
   * Call after player and group were updated (sets their slide state for the next step).
   */
  update(dt, ctx) {
    const { player, group, time } = ctx;
    const fx = this.fx;
    const q = this._feed(player);
    const riding = !!q && player.slide > 0.3;
    const pS = q ? q.s : null, pD = q ? q.slide : null;
    this._lastQ = q ? { s: q.s, d: q.slide } : null;

    // ---- the ride: hints, stats, audio state
    if (riding) {
      if (!this._ride || this._ride.d !== pD) { this._ride = { d: pD, id: pD.id, t0: time, peak: 0, kicks: 0, dist: 0 }; this.events.push({ type: 'slide-start', kind: pD.kind }); }
      const R = this._ride;
      R.peak = Math.max(R.peak, player.speed); R.dist += player.speed * dt; R.t1 = time; R.s = pS;
      for (const e of player.events) if (e.type === 'kick') { R.kicks++; this.events.push({ type: 'kick' }); }
    } else if (this._ride && (time - this._ride.t1 > 0.6)) {
      const R = this._ride;
      this.stats.push({ id: R.id, kind: R.d.kind, dur: +(R.t1 - R.t0).toFixed(1), peak: +R.peak.toFixed(1), kicks: R.kicks, dist: Math.round(R.dist), reachedEnd: R.s > R.d.Ls - 15 });
      this.events.push({ type: 'slide-end', kind: R.d.kind });
      this._ride = null;
    }
    const st = this.state;
    const kWant = riding ? 1 : 0;
    st.k += (kWant - st.k) * exp(riding ? 1.2 : 0.6, dt);
    if (riding) { st.kind = pD.kind; st.u = clamp(pS / pD.Ls, 0, 1); }
    st.speed = player.speed;

    // hints at the lip
    for (const L of this.lips) {
      const dd = Math.hypot(L.x - player.pos.x, L.z - player.pos.z);
      if (dd < 45) this.hints.push([`slide-${L.d.kind}`, L.d.kind === 'gold'
        ? 'The sand pours away into the depths in a long golden river. Let it carry you &mdash; <b>steer</b> to carve, <b>jump</b> off the crests.'
        : 'The dune falls away in one long slope toward the sunken city. Step onto it and let the sand carry you &mdash; <b>steer</b> to carve through the turns.', 9000]);
    }

    // ---- companions: ride the course with you, in formation
    if (group) {
      const pq = q && player.slide > 0.05 ? { s: q.s, d: q.slide } : null;
      for (const c of group.members) {
        if (!c.visible || c.state !== 'travel') { if (c.visible) c.p.slide = 0; continue; }
        const cq = this._feed(c.p);
        if (!cq) {
          // left off the course while the player rides it: back onto the sand behind them, out of view
          if (pq && pq.s > 25 && pq.s < pq.d.Ls - 30 && c.p.grounded) {
            const t = (this._offT.get(c) || 0) + dt; this._offT.set(c, t);
            if (t > 2.5) { this._placeOn(c, pq.d, pq.s - 22); this._offT.set(c, 0); }
          }
          continue;
        }
        this._offT.set(c, 0);
        c.behindT = 0;                                  // nobody sits down to wait on a slide
        if (pq && pq.d === cq.slide) {
          const slotS = pq.s + c._slideLead;
          const gap = slotS - cq.s;
          c.p.slideVT = clamp(player.speed + clamp(gap * 0.45, -5, 6), 10, 28);
          if (gap > 75 && c.p.grounded) this._placeOn(c, pq.d, pq.s - 22);
        }
      }
    }

    // ---- what you see
    this._fx(dt, ctx, q, riding);
    for (const sm of this.shaftMats) {
      sm.m.uniforms.uTime.value = time;
      const near = sm.d === pD ? 1 : 0.7;
      sm.m.uniforms.uIntensity.value = (sm.d.kind === 'gold' ? 0.75 : 0.45) * near * (ctx.env && ctx.env.pal ? 1 - 0.5 * ctx.env.pal.cave : 1);
    }
    if (this.flags) for (const f of this.flags) f.flag.rotation.z = 0.6 + Math.sin(time * 3.4 + f.ph) * 0.3;
    for (const L of this.lips) L.glow.material.opacity = 0.35 + 0.15 * Math.sin(time * 1.3);
    // trails
    if (ctx.env && ctx.env.pal) { this.trailU.uSand.value.copy(ctx.env.pal.shade).lerp(ctx.env.pal.lit, 0.45); this.trailU.uGlint.value.copy(ctx.env.pal.glit).multiplyScalar(0.35); }
    const bodies = [player, ...(group ? group.members.filter((c) => c.visible).map((c) => c.p) : [])];
    for (const b of bodies) {
      let t = this.trails.get(b);
      const on = b.slide > 0.3;
      if (!t) { if (!on) continue; t = new Trail(this.scene, this.trailU); this.trails.set(b, t); }
      t.update(dt, b, on);
    }
  }

  _placeOn(c, d, s) {
    const P = coursePoint(d, Math.max(0, s), (c.index % 2 ? -1 : 1) * 2, _c2);
    c.p.heading = Math.atan2(P.tx, P.tz);
    c.p.teleport(P.x, P.z);
    c.p.vel.set(P.tx * 18, 0, P.tz * 18);
  }

  _fx(dt, ctx, q, riding) {
    const fx = this.fx, p = ctx.player.pos, pl = ctx.player;
    const sand = ctx.env && ctx.env.pal ? ctx.env.pal.lit : new THREE.Color(1, 0.7, 0.4);
    // sand streaming over each lip you are near
    for (const L of this.lips) {
      if (Math.abs(L.z - p.z) > 120 || Math.abs(L.x - p.x) > 120) continue;
      const d = L.d, n = Math.floor(dt * 60 + Math.random());
      for (let i = 0; i < n; i++) {
        const s = Math.random() * 30, lat = (Math.random() - 0.5) * 2 * tab(d.Wt, s) * 0.8;
        const P = coursePoint(d, s, lat, _c2), y = terrainHeight(P.x, P.z);
        const sp = 3 + s * 0.15;
        fx.dust.emit(P.x, y + 0.08, P.z, P.tx * sp, 0.1, P.tz * sp, 1.6, 0.5 + Math.random() * 0.4, sand.r, sand.g * 0.95, sand.b * 0.85, 0.45, 0.3, 2, 1.0);
      }
      if (Math.random() < dt * 10) fx.sparkles.emit(L.x + (Math.random() - .5) * 10, L.y + 0.5 + Math.random() * 4, L.z + (Math.random() - .5) * 10, 0, 0.4, 0, 2.2, 0.1, 2.6, 1.9, 1.0, 0.8, 0.5, 0, -0.1);
    }
    if (!q) return;
    const d = q.slide;
    // streams of sand slipping down the walls and along the floor ahead of you
    const n = Math.floor(dt * (riding ? 70 : 25) + Math.random());
    for (let i = 0; i < n; i++) {
      const s = q.s + 4 + Math.random() * 45, sd = Math.random() < 0.5 ? -1 : 1;
      const lat = sd * (tab(d.Ft, s) + Math.random() * (tab(d.Wt, s) - tab(d.Ft, s)));
      const P = coursePoint(d, s, lat, _c2), y = terrainHeight(P.x, P.z);
      const down = -sd * 1.4;
      fx.dust.emit(P.x, y + 0.06, P.z, P.tx * 5 - P.tz * down, 0.05, P.tz * 5 + P.tx * down, 1.2, 0.45, sand.r, sand.g * 0.95, sand.b * 0.85, 0.35, 0.4, 1, 0.8);
    }
    // golden motes drifting in the light of the descent
    if (d.kind === 'gold' && Math.random() < dt * 30) {
      const a = Math.random() * 6.28, rr = 3 + Math.random() * 14;
      fx.sparkles.emit(p.x + Math.cos(a) * rr + pl.vel.x * 0.6, p.y + 1 + Math.random() * 6, p.z + Math.sin(a) * rr + pl.vel.z * 0.6, pl.vel.x * 0.3, 0.3, pl.vel.z * 0.3, 2, 0.08, 2.8, 2.0, 1.0, 0.9, 0.6, 0, -0.1);
    }
    if (!riding || !pl.grounded) return;
    // a rooster tail of sand off the carve, heavier the harder you turn and the faster you go
    const carve = Math.min(1, Math.abs(pl.turnRate) * 0.8), sp = pl.speed;
    const m = Math.floor(dt * (20 + sp * 3 + carve * 90) + Math.random());
    const hx = Math.sin(pl.heading), hz = Math.cos(pl.heading), side = Math.sign(pl.turnRate) || 1;
    for (let i = 0; i < m; i++) {
      const out = side * (1.5 + Math.random() * 3) * carve;
      fx.dust.emit(p.x - hx * 0.6, p.y + 0.2, p.z - hz * 0.6, -hx * sp * 0.25 + hz * out, 1.2 + Math.random() * 2.2 * (0.4 + carve), -hz * sp * 0.25 - hx * out,
        0.8 + Math.random() * 0.6, 0.55 + Math.random() * 0.4, sand.r, sand.g * 0.92, sand.b * 0.8, 0.5, 1.4, 4, 1.6);
    }
    if (Math.random() < dt * sp * 0.6) fx.sparkles.emit(p.x, p.y + 0.3, p.z, -hx * 3 + (Math.random() - .5) * 2, 1 + Math.random(), -hz * 3 + (Math.random() - .5) * 2, 0.9, 0.06, 2.6, 2.0, 1.1, 0.8, 1, 3, -0.2);
  }

  // ---------------------------------------------------------------- the formation on a slide
  /** group.js slot hook: on the course ahead of the player, staggered across the floor. Returns true when it set one. */
  slotFor(c, k, N, player, slot) {
    const q = this._lastQ;
    if (!q || player.slide < 0.05) { c._slideLead = 0; return false; }
    const lead = 5 + 3.5 * k + Math.max(0, (c.pers ? c.pers.pace : 0)) * 0.5;
    c._slideLead = lead;
    const lat = (k % 2 ? -1 : 1) * (1.6 + (k >> 1) * 1.1);
    const P = coursePoint(q.d, q.s + lead, lat, _c2);
    slot.set(P.x, 0, P.z);
    return true;
  }

  // ---------------------------------------------------------------- ?auto
  /** Autopilot: follow the course line (it carries you; just point down it). */
  auto(player) {
    const q = slideAt(player.pos.x, player.pos.z, _q);
    if (!q || q.s < -40 || q.s > q.slide.Ls - 30 || Math.abs(q.d) > q.W + 25) return null;   // near the end the route ahead takes over
    const P = coursePoint(q.slide, Math.max(0, q.s) + 18, 0, _c2);
    return { tx: P.x, tz: P.z, amt: 1 };
  }
}
