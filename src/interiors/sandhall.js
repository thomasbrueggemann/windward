// The Hall of Falling Sand: a long sunlit hall whose roof has fallen in. Sand pours through cracks in the walls and
// flows across the floor as a slow golden sea; shafts of light stand in the dust; a symbol waits at the far end.
import * as THREE from 'three';
import { Room, C, V, stoneMat, sandFloor, lightShaft, motes, makeAmbience, radialTex } from './common.js';
import { makeGlyphSprite, makeRingTexture } from '../textures.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range, sign } from '../world/seed.js';

const HW = 11, Z0 = -56, Z1 = 4, WALL_H = 15;

const fallVert = /* glsl */`
varying vec2 vUv; varying vec3 vW;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const fallFrag = /* glsl */`
precision highp float;
uniform float uTime, uSpeed, uLit; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main() {
  float x = vUv.x, y = vUv.y;
  float core = smoothstep(0., 0.35, x) * smoothstep(1., 0.65, x);
  float s = n(vec2(x * 9., y * 3. + uTime * uSpeed)) * 0.6 + n(vec2(x * 23., y * 7. + uTime * uSpeed * 1.6)) * 0.4;
  float a = core * smoothstep(0.25, 0.75, s + core * 0.25) * smoothstep(0., 0.06, 1. - y) * (0.55 + 0.45 * smoothstep(0., 0.2, y));
  vec3 col = uColor * (0.75 + 0.5 * s) * uLit;
  gl_FragColor = vec4(col, a * 0.85);
}`;
const flowFrag = /* glsl */`
precision highp float;
uniform float uTime; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main() {
  float side = 1. - abs(vUv.x * 2. - 1.);
  float s = n(vec2(vUv.x * 6., vUv.y * 2.2 - uTime * 0.55)) * 0.65 + n(vec2(vUv.x * 15., vUv.y * 6. - uTime * 0.9)) * 0.35;
  float a = smoothstep(0.0, 0.5, side) * smoothstep(0.35, 0.8, s) * smoothstep(1., 0.7, vUv.y) * smoothstep(0., 0.08, vUv.y);
  gl_FragColor = vec4(uColor * (0.8 + 0.5 * s), a * 0.55);
}`;

export class SandHall extends Room {
  constructor(door) {
    super(door, 'sandhall', 'The Hall of Falling Sand');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(range(r, 0.2, 0.45) * sign(r), 1, 0.22), sunC: C('#fff0cc'), sunI: 2.7, amb: C('#c49a78'), grd: C('#7a4a26'),
      floorSun: V(0.7 * sign(r), 0.22, -0.3), floorSunK: 0.7,
      fog: C('#d09868'), fogD: 0.01, bg: C('#f3d6a6'), exp: 0.85, bloom: 0.55, rays: 1.0, raysColor: C('#ffd6a0'), raysThreshold: 1.05,
      lit: C('#e8903c'), hi: C('#fff0c0'), shade: C('#3a1208'), rim: C('#ffe0b0'), glit: C('#fff6e0'), pools: true, glitter: 1.1,
      vigColor: C('#4a2410'), vignette: 0.42, fade: C('#fff1d8'), mood: 5, sand: C('#ffcf90'),
      dust: { color: C('#ffe2b8'), amount: 0.45, size: 0.05, opacity: 0.55 },
    });
    this.bounds = { x0: -HW, x1: HW, z0: Z0, z1: Z1 + 1.8 };
    this.camBounds = { x0: -HW, x1: HW, z0: Z0, z1: Z1 - 0.2 };
    this.ceiling = WALL_H - 0.6;
    this.spawn = { x: 0, z: Z1 - 1.6, heading: Math.PI };
    this.camDist = 7;

    // ----- where the sand comes in: cracks high in the walls and a breach in the far wall
    this.falls = [];
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 1 : -1;
      this.falls.push({ x: s * (HW - 0.2), z: -8 - i * 11 - range(r, 0, 5), top: range(r, 7, 12), w: range(r, 1.4, 2.3), y: 0 });
    }
    this.falls.push({ x: range(r, -3, 3), z: Z0 + 0.3, top: 13, w: 3.6, y: 0, big: true });
    this.pedestal = { x: range(r, -2.5, 2.5), z: Z0 + 8.5 };
    this.h0 = 0; this.h0 = this.height(this.pedestal.x, this.pedestal.z);
    this.pedestal.y = this.h0;

    this._buildArchitecture();
    this._buildSand();
    this._buildLight();
    this._buildGlyph();
    this.pois.push({ x: this.pedestal.x, y: this.pedestal.y + 2.4, z: this.pedestal.z });
  }

  height(x, z) {
    const ax = Math.abs(x);
    let h = 0.28 * Math.sin(x * 0.45 + z * 0.12) * Math.sin(z * 0.21 + 1.3) + 0.12 * Math.sin(x * 1.3 - z * 0.7);
    h += 2.4 * smooth(6.5, 11, ax);                                         // drifts piled against the walls
    h += 3.4 * smooth(-16, -50, z) * (0.7 + 0.3 * Math.cos(x * 0.3));        // the sand sea rising toward the breach
    if (this.falls) for (const f of this.falls) {
      const d2 = (x - f.x) ** 2 + (z - f.z) ** 2, s = f.big ? 4.5 : 2.4;
      h += (f.big ? 2.2 : 1.5) * Math.exp(-d2 / (2 * s * s));
    }
    h *= 1 - 0.9 * smooth(-2, 3, z);                                          // a level threshold by the door
    if (this.pedestal && this.h0) {
      const d = Math.hypot(x - this.pedestal.x, z - this.pedestal.z);
      h += (this.h0 - h) * (1 - smooth(2.2, 4.5, d));
    }
    return h;
  }

  _buildArchitecture() {
    const r = this.rng, s = this.scene;
    s.background = this.pal.bg;
    const wall = stoneMat(0xd8b88a, 0x4a2a14, 0.45, 2.4), dark = stoneMat(0xb08a62, 0x3a2010, 0.5, 2.2);
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b860, roughness: 0.45, metalness: 0.5, emissive: 0x6a3a08, emissiveIntensity: 0.7 });
    this.mats = { wall, dark, gold };
    // walls (the front one leaves the doorway open)
    for (const sx of [-1, 1]) this.box(1.4, WALL_H, Z1 - Z0 + 2.8, wall, sx * (HW + 0.7), -1, (Z0 + Z1) / 2);
    this.box(HW * 2 + 2.8, WALL_H, 1.4, wall, 0, -1, Z0 - 0.7);
    for (const sx of [-1, 1]) this.box(HW - 1.1, WALL_H, 1.4, wall, sx * (1.1 + (HW - 1.1) / 2), -1, Z1 + 0.7);
    this.box(2.4, WALL_H - 4.8, 1.4, wall, 0, 3.8, Z1 + 0.7, 0, false);
    this.exitDoor(0, Z1, { w: 2.2, h: 3.8, color: C('#fff0d6'), frameMat: gold });
    // a gold band and carved panels along the walls
    for (const sx of [-1, 1]) {
      this.box(0.12, 0.35, Z1 - Z0, gold, sx * (HW - 0.05), 4.2, (Z0 + Z1) / 2, 0, false);
      this.box(0.12, 0.2, Z1 - Z0, gold, sx * (HW - 0.05), 9.6, (Z0 + Z1) / 2, 0, false);
    }
    const glyphTex = [0, 1, 2, 3, 4, 5].map(makeGlyphSprite);
    for (let i = 0; i < 8; i++) {
      const sx = i % 2 ? 1 : -1, z = -4 - i * 6.5;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: glyphTex[i % 6], color: new THREE.Color(0.9, 0.55, 0.25), transparent: true, depthWrite: false }));
      m.position.set(sx * (HW - 0.06), 6.8, z); m.rotation.y = -sx * Math.PI / 2;
      s.add(m);
    }
    // two rows of columns, some broken and leaning, sunk into the sand
    this.columns = [];
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
      const x = sx * range(r, 6.6, 7.4), z = -5 - i * 8.2 + range(r, -0.6, 0.6);
      const gy = this.height(x, z);
      const broken = r() < 0.3, h = broken ? range(r, 3, 7) : WALL_H - 1.2;
      const c = this.column(x, z, gy - 1.0, 0.85, h + 1.0, wall, true);
      if (!broken) { this.box(2.2, 0.7, 2.2, wall, x, h - 0.2, z, 0, false); }
      else if (r() < 0.6) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.0, 12), dark);
        d.rotation.z = Math.PI / 2; d.rotation.y = range(r, 0, 3);
        const dx = x - sx * 2.4, dz = z + range(r, -2, 2);
        d.position.set(dx, this.height(dx, dz) + 0.35, dz); s.add(d);
        this.colliders.push({ kind: 'circle', x: dx, z: dz, r: 1.0, top: d.position.y + 0.8, bottom: -5 });
      }
      this.columns.push(c);
    }
    // the broken roof: beams across the hall, slabs between some of them, open sky where the light falls through
    this.holes = [];
    const beams = [];
    for (let z = Z1 - 2; z > Z0; z -= 8.2) beams.push(z);
    beams.forEach((z, i) => {
      if (r() < 0.25 && i > 0) return;
      this.box(HW * 2 + 1.4, 1.0, 1.2, dark, 0, WALL_H - 1.6, z, range(r, -0.03, 0.03), false);
    });
    for (let i = 0; i < beams.length - 1; i++) {
      const z = (beams[i] + beams[i + 1]) / 2;
      const last = i === beams.length - 2;
      const open = last || (i > 0 && r() < 0.55);
      if (open) {
        // a jagged hole: slabs only on the sides; the last one sits where its light falls on the pedestal
        const L = this.pal.sunDir;
        const hx = last ? clamp(this.pedestal.x + L.x / L.y * (WALL_H - this.h0), -5, 5) : range(r, -3, 3), hw = range(r, 2.2, 3.2);
        this.box(HW - hx - hw + 0.7, 0.8, 8.2, wall, (HW + 0.7 + hx + hw) / 2, WALL_H - 0.6, z, 0, false);
        this.box(HW + hx - hw + 0.7, 0.8, 8.2, wall, (-HW - 0.7 + hx - hw) / 2, WALL_H - 0.6, z, 0, false);
        this.holes.push({ x: hx, z, w: hw });
      } else this.box(HW * 2 + 1.4, 0.8, 8.2, wall, 0, WALL_H - 0.6, z, 0, false);
    }
    // bright sky above the roof (what the holes and god rays see)
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.15, 1.6), fog: false }));
    sky.rotation.x = Math.PI / 2; sky.position.y = WALL_H + 3; s.add(sky);
  }

  _buildSand() {
    const floor = sandFloor((x, z) => this.height(x, z), -HW - 0.6, HW + 0.6, Z0 - 0.6, Z1 + 1.8, 0.45);
    this.addSand(floor);
    // the sand pouring in
    const col = C('#ffcf8a');
    this.fallMats = [];
    for (const f of this.falls) {
      f.y = this.height(f.x, f.z);
      const len = f.top - f.y + 0.4;
      const m = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uSpeed: { value: 1.6 + this.rng() }, uLit: { value: 1.3 }, uColor: { value: col } }, vertexShader: fallVert, fragmentShader: fallFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.fallMats.push(m);
      for (const a of [0, Math.PI / 2]) {
        const g = new THREE.PlaneGeometry(f.w, len); g.translate(0, len / 2, 0);
        const mesh = new THREE.Mesh(g, m);
        const inset = f.big ? 0.6 : 0.5;
        mesh.position.set(f.x - Math.sign(f.x) * (f.big ? 0 : inset), f.y - 0.3, f.z + (f.big ? inset : 0));
        mesh.rotation.y = a + (f.big ? 0 : Math.PI / 2);
        mesh.renderOrder = 4;
        this.scene.add(mesh);
      }
      // a dark crack where it comes through
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(f.w * 1.4, 1.6), new THREE.MeshBasicMaterial({ color: 0x2a1408 }));
      if (f.big) { crack.position.set(f.x, f.top, Z0 + 0.02); }
      else { crack.position.set(f.x - Math.sign(f.x) * 0.02, f.top, f.z); crack.rotation.y = -Math.sign(f.x) * Math.PI / 2; }
      this.scene.add(crack);
      // a stream of sand flowing from its foot toward the middle of the hall
      this._flow(f);
    }
  }

  _flow(f) {
    const pts = [];
    let x = f.x - Math.sign(f.x) * (f.big ? 0 : 1.2), z = f.z + (f.big ? 1.5 : 0);
    for (let i = 0; i < 26; i++) {
      pts.push([x, z]);
      // follow the slope down, drifting toward the hall's centre and the door
      const e = 0.5, gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
      let dx = -gx * 3 - x * 0.04, dz = -gz * 3 + 0.35;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      x += dx * 0.9; z += dz * 0.9;
    }
    const n = pts.length, w = f.big ? 2.6 : 1.3;
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = pts[i], [qx, qz] = pts[Math.min(n - 1, i + 1)], [ox, oz] = pts[Math.max(0, i - 1)];
      let tx = qx - ox, tz = qz - oz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const ww = w * (0.6 + 0.6 * i / n);
      for (const s of [-1, 1]) {
        const vx = px - tz * ww * s, vz = pz + tx * ww * s, k = (i * 2 + (s > 0 ? 1 : 0));
        pos[k * 3] = vx; pos[k * 3 + 1] = this.height(vx, vz) + 0.05; pos[k * 3 + 2] = vz;
        uv[k * 2] = s > 0 ? 1 : 0; uv[k * 2 + 1] = i / (n - 1);
      }
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: C('#ffd9a0') } }, vertexShader: fallVert, fragmentShader: flowFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.fallMats.push(m);
    const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 2;
    this.scene.add(mesh);
  }

  _buildLight() {
    const P = this.pal, L = P.sunDir;
    this.pools = [];
    for (const h of this.holes) {
      const top = new THREE.Vector3(h.x, WALL_H - 0.2, h.z);
      let fy = 0;
      for (let k = 0; k < 4; k++) { const t = (top.y - fy) / L.y; fy = this.height(top.x - L.x * t, top.z - L.z * t); }
      const bottom = top.clone().addScaledVector(L, -(top.y - fy) / L.y);
      bottom.y = this.height(bottom.x, bottom.z);
      this.addShaft(lightShaft(top, bottom, h.w * 0.7, h.w * 0.95, C('#ffcf8a').multiplyScalar(0.9), 1.0));
      this.pools.push(new THREE.Vector4(bottom.x, bottom.z, h.w * 1.1, 1));
    }
    const u = this.sandFloors[0].userData.sandU;
    u.uPools.value.forEach((v, i) => { const p = this.pools[i]; if (p) v.copy(p); else v.set(0, 0, 1, 0); });
    u.uPoolColor.value.set(1.0, 0.7, 0.35);
    this.sun.position.copy(L).multiplyScalar(50); this.sun.target.position.set(0, 0, -20);
    this.dustMotes = motes(700, { x0: -HW, x1: HW, y0: 0, y1: WALL_H - 1, z0: Z0, z1: Z1 }, { color: C('#ffd9a8').multiplyScalar(0.9), size: 0.05, speed: 0.12, seed: 3 });
    this.scene.add(this.dustMotes);
  }

  _buildGlyph() {
    const { x, z, y } = this.pedestal, m = this.mats;
    this.box(2.6, 0.6, 2.6, m.dark, x, y - 0.3, z, 0.3, true);
    this.column(x, z, y + 0.3, 0.5, 1.1, m.wall, true, 8);
    this.box(1.3, 0.25, 1.3, m.gold, x, y + 1.4, z, 0.3, false);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlyphSprite((this.door.index + 3) % 6), color: new THREE.Color(3.6, 2.8, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    spr.scale.set(1.6, 1.6, 1);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeRingTexture(), color: new THREE.Color(1.6, 1.2, 0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.scale.set(3.4, 3.4, 1);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: new THREE.Color(1.4, 1.0, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(7, 7, 1);
    this.scene.add(spr, halo, glow);
    this.glyph = { spr, halo, glow, base: new THREE.Vector3(x, y + 2.6, z), taken: this.door.done, fade: this.door.done ? 0 : 1 };
    if (this.door.done) this.complete = true;
  }

  onEnter(ctx) {
    this.amb = makeAmbience(ctx.audio, [
      { noise: { type: 'bandpass', freq: 2600, q: 0.6 }, gain: 0.045, lfo: { rate: 0.13, depth: 500 } },
      { noise: { type: 'lowpass', freq: 320, q: 0.5 }, gain: 0.05 },
      { drone: [48, 55, 64], gain: 0.012, cut: 700 },
    ]);
  }

  update(dt, time, ctx) {
    this.tick(time);
    this.doorGlow(time);
    for (const m of this.fallMats) m.uniforms.uTime.value = time;
    this.dustMotes.userData.tick(time, ctx.camera, ctx.renderer);
    // sand spilling where the falls hit
    for (const f of this.falls) {
      if (Math.random() < dt * (f.big ? 14 : 6)) {
        const a = Math.random() * 6.28, s = 0.5 + Math.random() * 1.5;
        ctx.fx.dust.emit(f.x - Math.sign(f.x) * (f.big ? 0 : 0.5) + Math.cos(a) * 0.4, f.y + 0.2, f.z + (f.big ? 0.6 : 0) + Math.sin(a) * 0.4, Math.cos(a) * s, 0.6 + Math.random(), Math.sin(a) * s, 1.4, 0.6, 1, 0.84, 0.58, 0.35, 2.2, 0.3, 1.8);
      }
    }
    const g = this.glyph, p = ctx.player.pos;
    if (!g.taken) {
      g.spr.position.copy(g.base); g.spr.position.y += Math.sin(time * 1.4) * 0.18;
      g.halo.position.copy(g.spr.position); g.glow.position.copy(g.spr.position);
      g.halo.material.rotation = time * 0.3;
      if (Math.hypot(p.x - g.base.x, p.z - g.base.z) < 2.4 && Math.abs(p.y + 1 - g.base.y) < 2.6) {
        g.taken = true; this.complete = true; this.door.done = true;
        ctx.reward.glyph(g.spr.position);
      }
    } else g.fade = Math.max(0, g.fade - dt * 1.5);
    const k = g.fade;
    g.spr.material.opacity = k; g.halo.material.opacity = k; g.glow.material.opacity = 0.5 * k + 0.12;
    g.spr.visible = k > 0.01; g.halo.visible = k > 0.01;
    if (Math.random() < dt * 3 && k > 0.5) ctx.fx.sparkles.emit(g.base.x + (Math.random() - .5), g.base.y - 0.5, g.base.z + (Math.random() - .5), 0, 0.5, 0, 1.6, 0.1, 3, 2.3, 1.2, 0.8, 0.6, 0, -0.2);
  }

  auto() { return this.glyph.taken ? null : { x: this.glyph.base.x, z: this.glyph.base.z }; }
}
