// The Tower of Wind: a hollow stone tower open to the sky. A column of wind rises through its middle and cloth
// ledges spiral up its walls; ride the wind (or hop ledge to ledge on the scarf's charge) to the gallery at the top,
// where a tablet remembers the travelers who flew here before. A second doorway up there leads straight back out.
import * as THREE from 'three';
import { Room, C, V, stoneMat, sandFloor, lightShaft, motes, makeAmbience, radialTex } from './common.js';
import { fabricMat } from './surface.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Updrafts } from '../world/updrafts.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range } from '../world/seed.js';

const RT = 9, TH = 66, TOPY = 52, COL_R = 3.4, RING_IN = 4.4, DOOR_H = 3.8, GAP = 1.45 / RT;

const ledgeVert = /* glsl */`
attribute vec2 aRA;        // x: radial fraction (0 inner free edge .. 1 at the wall), y: along the arc 0..1
uniform float uTime, uSeed;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 p = position;
  float free = 1. - aRA.x;
  p.y += sin(uTime * 2.3 + aRA.y * 9. + uSeed) * 0.07 * free * free - 0.12 * sin(aRA.y * 3.14159) * free;
  vec4 wp = modelMatrix * vec4(p, 1.);
  vW = wp.xyz; vN = vec3(0., 1., 0.); vUv = vec2(aRA.y * 3., aRA.x); vGlow = 0.35;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

function arcGeometry(a0, a1, r0, r1, y, segA = 16, segR = 4) {
  const pos = [], ra = [], idx = [];
  for (let i = 0; i <= segA; i++) for (let j = 0; j <= segR; j++) {
    const a = a0 + (a1 - a0) * i / segA, rr = r0 + (r1 - r0) * j / segR;
    pos.push(Math.sin(a) * rr, y, Math.cos(a) * rr); ra.push(j / segR, i / segA);
  }
  for (let i = 0; i < segA; i++) for (let j = 0; j < segR; j++) {
    const q = i * (segR + 1) + j;
    idx.push(q, q + 1, q + segR + 1, q + 1, q + segR + 2, q + segR + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRA', new THREE.Float32BufferAttribute(ra, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Tower extends Room {
  constructor(door) {
    super(door, 'tower', 'The Tower of Wind');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(range(r, -0.2, 0.2), 1, range(r, -0.2, 0.2)), sunC: C('#fff4e4'), sunI: 2.4, amb: C('#a9b6cc'), grd: C('#8a6a50'),
      floorSun: V(0.6, 0.35, 0.4), floorSunK: 0.7,
      fog: C('#cbbfae'), fogD: 0.0085, bg: C('#efe2cc'), exp: 0.88, bloom: 0.55, rays: 1.1, raysColor: C('#ffe9c8'), raysThreshold: 1.05,
      lit: C('#e0a462'), hi: C('#fff2d6'), shade: C('#5a2a1a'), rim: C('#ffe8c8'), glit: C('#ffffff'), pools: true,
      sat: 1.05, vignette: 0.36, vigColor: C('#3a3040'), mood: 7, sand: C('#f0d0a8'), indoor: 0.7,
    });
    this.bounds = { circle: RT };
    this.ceiling = TH;
    this.ledges = true;
    this.camDist = 7.2; this.camPitch = 0.22;
    this.spawn = { x: 0, z: RT - 2.3, heading: Math.PI };

    // cloth ledges spiralling up the wall
    this.platforms = [];
    const a0 = range(r, 0, Math.PI * 2), dir = r() < 0.5 ? 1 : -1;
    for (let i = 0; i < 8; i++) {
      const a = a0 + dir * i * range(r, 0.85, 1.05), span = range(r, 0.55, 0.75);
      this.platforms.push({ a, span, r0: range(r, 5.0, 5.6), y: 5.5 + i * 5.6 + range(r, -0.5, 0.5) });
    }
    this.altarA = wrap(a0 + dir * 8 * 0.95 + Math.PI * 0.35);
    this.topDoorA = wrap(this.altarA + Math.PI * 0.75 * (r() < 0.5 ? 1 : -1));

    this._buildShell();
    this._buildLedges();
    this._buildAltar();
    this.updrafts = new Updrafts(this.scene, [{ x: 0, z: 0, r: COL_R, h: TOPY + 7, y: 0 }]);
  }

  height(x, z, y = 1) {
    const d = Math.hypot(x, z);
    let h = 0.12 * Math.sin(x * 0.7) * Math.cos(z * 0.6) + 0.5 * smooth(5, RT, d);
    if (d > RING_IN && y >= TOPY - 0.05) return TOPY;
    if (d > 4.6) {
      const a = Math.atan2(x, z);
      for (const p of this.platforms || []) {
        if (p.y > y || p.y <= h) continue;
        if (d >= p.r0 && Math.abs(wrap(a - p.a)) < p.span / 2) h = p.y;
      }
    }
    return h;
  }

  _buildShell() {
    const s = this.scene, r = this.rng;
    s.background = this.pal.bg;
    const bounce = C('#ffd8a8').multiplyScalar(0.3), sandC = C('#f6dcae');
    const wall = stoneMat(0xf0cc98, 0x6a4424, 0.5, 2.6, { polar: RT + 0.4, block: [3.0, 1.25], strata: 0.42, sandY: 1.6, sand: sandC, bounce, aoH: 10, ao: 0.72, cracks: 0.5 });
    const dark = stoneMat(0xa88a6a, 0x2a1a10, 0.2, 2.2, { slab: 1.5, strata: 0.8, bounce, aoH: 3, ao: 0.7 });
    const gold = this.gold({ emissive: 0x6a3a08, ei: 0.4 });
    this.mats = { wall, dark, gold };
    this.sandBase = sandC;
    const band = (y0, y1, gapAt) => {
      const g = gapAt === null ? new THREE.CylinderGeometry(RT + 0.4, RT + 0.4, y1 - y0, 48, 1, true)
        : new THREE.CylinderGeometry(RT + 0.4, RT + 0.4, y1 - y0, 48, 1, true, gapAt + GAP, Math.PI * 2 - 2 * GAP);
      g.translate(0, (y0 + y1) / 2, 0);
      const m = new THREE.Mesh(g, wall); m.material.side = THREE.DoubleSide; s.add(m);
    };
    band(-1, DOOR_H + 0.6, 0);
    band(DOOR_H + 0.6, TOPY - 0.2, null);
    band(TOPY - 0.2, TOPY + DOOR_H + 0.6, this.topDoorA);
    band(TOPY + DOOR_H + 0.6, TH, null);
    // gold rings and slit windows that throw thin blades of light across the shaft
    for (let y = 9; y < TH; y += 11) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(RT + 0.25, 0.14, 10, 96), gold); t.rotation.x = Math.PI / 2; t.position.y = y; s.add(t);
    }
    const slitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2), fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, y = 8 + i * 6.5 + range(r, -1, 1);
      const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 2.2), slitMat);
      sl.position.set(Math.sin(a) * (RT + 0.3), y, Math.cos(a) * (RT + 0.3)); sl.rotation.y = a; s.add(sl);
      const top = new THREE.Vector3(Math.sin(a) * RT, y, Math.cos(a) * RT);
      const bot = new THREE.Vector3(-Math.sin(a) * RT * 0.6, y - 9, -Math.cos(a) * RT * 0.6);
      this.addShaft(lightShaft(top, bot, 0.25, 1.2, C('#ffe2b8').multiplyScalar(0.55), 0.6, { bottomFade: 0.45 }));
    }
    // the sky above the open top
    const sky = new THREE.Mesh(new THREE.CircleGeometry(RT + 2, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.1), fog: false }));
    sky.rotation.x = Math.PI / 2; sky.position.y = TH + 0.5; s.add(sky);
    this.addShaft(lightShaft(new THREE.Vector3(0, TH, 0), new THREE.Vector3(0, 0, 0), RT * 0.75, RT * 0.5, C('#fff0d8').multiplyScalar(0.25), 0.6, { topFade: 0.02, bottomFade: 0.3, haze: false }));
    this.sun.position.copy(this.pal.sunDir).multiplyScalar(60); this.sun.target.position.set(0, 0, 0);
    // floor
    this.addSand(sandFloor((x, z) => this.height(x, z, 0), -RT - 0.5, RT + 0.5, -RT - 0.5, RT + 1.6, 0.4, (x, z) => Math.hypot(x, z) < RT + 1.2));
    this.sandFloors[0].userData.sandU.uPools.value[0].set(0, 0, 4.5, 0.5);
    // a stone dais around the foot of the wind
    const dais = new THREE.Mesh(new THREE.TorusGeometry(COL_R + 0.6, 0.16, 6, 48), gold); dais.rotation.x = Math.PI / 2; dais.position.y = 0.1; s.add(dais);
    // doorways: at the foot, and one at the top gallery
    this.exitDoor(0, RT - 1.2, { w: 2.2, h: DOOR_H, depth: 1.6, color: C('#ffeccc'), frameMat: gold });
    const ta = this.topDoorA, tr = RT - 1.2;
    this.exitDoor(Math.sin(ta) * tr, Math.cos(ta) * tr, { w: 2.2, h: DOOR_H, depth: 1.6, color: C('#fff2dc'), frameMat: gold, y: TOPY, rot: ta });
    // the top gallery: a ring of stone around the wind's crown
    const ring = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RT + 0.4, 48, 1), dark); ring.rotation.x = -Math.PI / 2; ring.position.y = TOPY; ring.material = dark.clone(); ring.material.side = THREE.DoubleSide; s.add(ring);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(RING_IN, RING_IN, 0.7, 48, 1, true), dark); lip.position.y = TOPY - 0.35; lip.material.side = THREE.DoubleSide; s.add(lip);
    this.dust = motes(500, { x0: -RT, x1: RT, y0: 0, y1: TH, z0: -RT, z1: RT }, { color: C('#fff0d8').multiplyScalar(0.8), size: 0.06, speed: 0.2, seed: 21, rise: 0.8 });
    s.add(this.dust);
  }

  _buildLedges() {
    const s = this.scene;
    this.ledgeMats = [];
    const ropes = [];
    this.platforms.forEach((p, i) => {
      const m = fabricMat(ledgeVert, { uSeed: { value: i * 3.1 } }, { maxU: 3, weave: [120, 300], hem: [0.03, 0.02], glowK: 0.3, colA: [0.3, 0.02, 0.015], colB: [0.78, 0.12, 0.04], sheen: 0.35, trans: 0.6 });
      const mesh = new THREE.Mesh(arcGeometry(p.a - p.span / 2, p.a + p.span / 2, p.r0 - 0.2, RT + 0.1, p.y, 24, 6), m);
      mesh.frustumCulled = false;
      s.add(mesh);
      this.ledgeMats.push(m);
      // cords from the wall to the free edge's corners
      for (const e of [-1, 1]) {
        const a = p.a + e * p.span / 2 * 0.95;
        ropes.push(Math.sin(a) * (p.r0 - 0.1), p.y, Math.cos(a) * (p.r0 - 0.1), Math.sin(a) * RT, p.y + 3.2, Math.cos(a) * RT);
      }
      this.pois.push({ x: Math.sin(p.a) * 6.5, y: p.y + 1, z: Math.cos(p.a) * 6.5 });
    });
    // twisted cords, each a thin tube from the wall to the free edge's corner
    const cords = [];
    for (let k = 0; k < ropes.length; k += 6) {
      const a = new THREE.Vector3(ropes[k], ropes[k + 1], ropes[k + 2]), b = new THREE.Vector3(ropes[k + 3], ropes[k + 4], ropes[k + 5]);
      const mid = a.clone().lerp(b, 0.5); mid.y -= 0.25;
      cords.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 6, 0.025, 5));
    }
    s.add(new THREE.Mesh(mergeGeometries(cords), new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.9, emissive: 0x2a1408, emissiveIntensity: 0.6 })));
    // long banners hanging down the wall between the ledges
    for (let i = 0; i < 5; i++) {
      const a = this.platforms[i].a + Math.PI * 0.5 + i, len = 10 + i * 1.5, y = 12 + i * 8;
      const pg = new THREE.PlaneGeometry(1.4, len, 1, 12); pg.translate(0, -len / 2, 0);
      const ra = new Float32Array(pg.attributes.position.count * 2);
      for (let k = 0; k < pg.attributes.position.count; k++) { ra[k * 2] = 1 + pg.attributes.position.getY(k) / len; ra[k * 2 + 1] = pg.attributes.uv.getX(k); }
      pg.setAttribute('aRA', new THREE.BufferAttribute(ra, 2));
      const m = new THREE.Mesh(pg, fabricMat(/* glsl */`
        attribute vec2 aRA; uniform float uTime, uSeed; varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
        void main() { vec3 p = position; float f = 1. - aRA.x; float w = sin(uTime * 1.7 + p.y * 0.5 + uSeed) * 0.35 * f;
          p.z += w + 0.07 * sin(p.x * 6. + p.y * 1.3 + uTime * 0.8 + uSeed) * f;   // folds running down the cloth
          vec3 n0 = normalize(vec3(0., -0.35 * 0.5 * cos(uTime * 1.7 + p.y * 0.5 + uSeed) * f, 1.) + vec3(0.07 * 6. * cos(p.x * 6. + p.y * 1.3 + uTime * 0.8 + uSeed) * f * 0.4, 0., 0.));
          vec4 wp = modelMatrix * vec4(p, 1.); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * n0); vUv = vec2(aRA.x, aRA.y); vGlow = 0.2;
          gl_Position = projectionMatrix * viewMatrix * wp; }`, { uSeed: { value: i } }, { maxU: 1, weave: [900, 110], hem: [0.012, 0.06], glowK: 0.2 }));
      m.position.set(Math.sin(a) * (RT - 0.15), y, Math.cos(a) * (RT - 0.15)); m.rotation.y = a + Math.PI;
      m.frustumCulled = false;
      s.add(m);
    }
  }

  _buildAltar() {
    const a = this.altarA, d = RT - 2.2, x = Math.sin(a) * d, z = Math.cos(a) * d, m = this.mats;
    this.box(2.2, 0.8, 1.6, m.dark, x, TOPY, z, a, true);
    // the tablet: a slab of light with the old story drawn on it
    const tab = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.2), map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.7)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    tab.position.set(x * 0.98, TOPY + 2.2, z * 0.98); tab.rotation.y = a;
    this.scene.add(tab);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: new THREE.Color(1.6, 1.2, 0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(6, 6, 1); glow.position.copy(tab.position); this.scene.add(glow);
    this.altar = { x, z, y: TOPY, tab, glow, used: this.door.done };
    if (this.door.done) this.complete = true;
    this.pois.push({ x, y: TOPY + 2, z });
  }

  onEnter(ctx) {
    this.amb = makeAmbience(ctx.audio, [
      { noise: { type: 'bandpass', freq: 650, q: 7 }, gain: 0.03, lfo: { rate: 0.21, depth: 260 } },
      { noise: { type: 'lowpass', freq: 260, q: 0.5 }, gain: 0.05 },
      { drone: [50, 57, 64, 69], gain: 0.01, cut: 1400 },
    ]);
    if (!this.complete) ctx.hint('tower', 'The wind rises through the tower. <b>Walk into it</b> and let it carry you up.', 7000);
  }

  /** The camera never sits inside a cloth ledge: slide it in toward the open middle instead. */
  clampCam(pos, target) {
    super.clampCam(pos);
    const d = Math.hypot(pos.x, pos.z);
    if (d < 4.4) return;
    const a = Math.atan2(pos.x, pos.z);
    for (const p of this.platforms) {
      if (pos.y < p.y - 1.4 || pos.y > p.y + 0.7 || d < p.r0 - 0.6 || Math.abs(wrap(a - p.a)) > p.span / 2 + 0.08) continue;
      const k = (p.r0 - 0.7) / d;
      pos.x *= k; pos.z *= k;
      return;
    }
  }

  /** Companions left on the floor while you ride the wind follow you up it. */
  followerSlot(c, P, slot) {
    if (P.pos.y - c.pos.y > 2.5 && c.p.grounded) slot.set(0, 0, 0);
  }

  update(dt, time, ctx) {
    this.tick(time);
    this.doorGlow(time);
    this.updrafts.update(dt, time, ctx.camera, ctx.renderer, { pal: this.pal });
    this.dust.userData.tick(time, ctx.camera, ctx.renderer);
    const P = ctx.player;
    const hk = clamp(P.pos.y / TOPY, 0, 1);
    if (this.amb) { this.amb.set(0, 0.025 + 0.06 * hk + 0.04 * P.soarK); }
    const A = this.altar;
    const k = A.used ? 0.35 : 0.85 + 0.15 * Math.sin(time * 1.6);
    A.tab.material.opacity = k; A.glow.material.opacity = 0.5 * k;
    if (!A.used && Math.abs(P.pos.y - TOPY) < 1 && Math.hypot(P.pos.x - A.x, P.pos.z - A.z) < 2.6) {
      A.used = true;
      ctx.reward.vision(5, () => { this.complete = true; this.door.done = true; ctx.reward.glyph(A.tab.position); ctx.hint('tower-out', 'A doorway opens onto the sky. Or <b>dive</b> back down the wind.', 6000); });
    }
    if (!A.used && Math.random() < dt * 4) ctx.fx.sparkles.emit(A.x + (Math.random() - .5) * 2, TOPY + 1 + Math.random() * 2, A.z + (Math.random() - .5) * 2, 0, 0.3, 0, 2, 0.08, 2.8, 2.2, 1.2, 0.8, 0.5, 0, -0.1);
  }

  auto(P) {
    if (this.complete) {
      // on the gallery: walk round the ring (not across the open crown) to the high doorway
      if (P.pos.y < TOPY - 0.5) return null;
      const pa = Math.atan2(P.pos.x, P.pos.z), da = wrap(this.topDoorA - pa);
      if (Math.abs(da) < 0.5) return null;
      const a = pa + Math.sign(da) * 0.45;
      return { x: Math.sin(a) * 7, z: Math.cos(a) * 7 };
    }
    if (this.altar.used) return { x: P.pos.x, z: P.pos.z, stop: true };
    if (P.pos.y < TOPY - 0.5) {
      // ride the wind; near its crown, steer out over the gallery toward the altar
      if (P.pos.y > TOPY + 1.5 || (!P.grounded && P.pos.y > TOPY - 3 && P.vel.y < 1)) return { x: this.altar.x, z: this.altar.z, glide: true };
      if (P.mode === 'soar' && Math.hypot(P.pos.x, P.pos.z) < COL_R) return { x: 0, z: 0, stop: true };   // let the wind carry you
      return { x: 0, z: 0, slow: !P.grounded };
    }
    return { x: this.altar.x, z: this.altar.z, slow: true, stop: Math.hypot(P.pos.x - this.altar.x, P.pos.z - this.altar.z) < 1.5 };
  }
}
Tower.fadeColor = new THREE.Color(1.0, 0.97, 0.9);
