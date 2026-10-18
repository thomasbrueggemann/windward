// The Hall of Falling Sand: a long sunlit hall whose roof has fallen in. Sand pours through cracks in the walls and
// flows across the floor as a slow golden sea; shafts of light stand in the dust; a symbol waits at the far end.
import * as THREE from 'three';
import { Room, C, V, stoneMat, sandFloor, lightShaft, motes, makeAmbience, radialTex, canvasTex } from './common.js';
import { makeGlyphSprite, makeRingTexture } from '../textures.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range, sign, rngFor } from '../world/seed.js';

const HW = 11, Z0 = -56, Z1 = 4, WALL_H = 15;

const fallVert = /* glsl */`
varying vec2 vUv; varying vec3 vW;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const noiseGlsl = /* glsl */`
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }`;
// a curtain of sand: a slow body of clumps, fast fine streaks inside it, single grains catching the light, a billowing foot
const fallFrag = /* glsl */`
precision highp float;
uniform float uTime, uSpeed, uLit; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vW;
${noiseGlsl}
void main() {
  float y = vUv.y, t = uTime * uSpeed;
  float spread = mix(1.0, 0.5, pow(y, 1.4)) * (1. + 0.12 * sin(t * 0.7 + y * 5.));
  float xx = (vUv.x - 0.5) * 2. / spread + (n(vec2(y * 3., t * 0.3)) - 0.5) * 0.25 * (1. - y);
  float prof = clamp(1. - xx * xx, 0., 1.);
  float body = n(vec2(xx * 4.5, y * 2.2 + t * 1.15)) * 0.6 + n(vec2(xx * 9., y * 5. + t * 1.7)) * 0.4;
  float streak = n(vec2(xx * 22., y * 4. + t * 4.2)) * 0.6 + n(vec2(xx * 41., y * 9. + t * 6.5)) * 0.4;
  vec2 cell = vec2(xx * 34., y * 70. + t * 7.);
  float hh = h(floor(cell)), grain = step(0.9, hh) * smoothstep(0.45, 0., length(fract(cell) - 0.5));
  float dens = prof * (0.5 * body + 0.5 * streak) + prof * 0.25;
  float a = smoothstep(0.2, 0.72, dens + 0.08) * pow(prof, 0.45);
  // the foot spreads into a billow that fades out
  float foot = 1. - smoothstep(0., 0.2, y);
  float billow = n(vec2(vUv.x * 7., y * 6. - t * 0.4)) * foot;
  a = max(a * (1. - foot * 0.35), billow * 0.55 * (0.4 + 0.6 * prof * 0. + 0.6 * smoothstep(0., 0.25, vUv.x) * smoothstep(1., 0.75, vUv.x)));
  a *= smoothstep(0., 0.05, 1. - y) * (0.5 + 0.5 * smoothstep(0., 0.08, y));
  float edge = 1. - prof;
  vec3 col = uColor * (0.62 + 0.6 * body + 0.3 * streak) * uLit * (1. + 0.7 * edge * edge);   // thin edges glow where light passes through
  col += grain * vec3(1., 0.88, 0.6) * 1.8 * prof;
  gl_FragColor = vec4(col, a * 0.8);
}`;
const flowFrag = /* glsl */`
precision highp float;
uniform float uTime; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vW;
${noiseGlsl}
void main() {
  float side = 1. - abs(vUv.x * 2. - 1.);
  float s = n(vec2(vUv.x * 6., vUv.y * 2.2 - uTime * 0.55)) * 0.65 + n(vec2(vUv.x * 15., vUv.y * 6. - uTime * 0.9)) * 0.35;
  float lines = 0.5 + 0.5 * sin((vUv.x * 14. + n(vec2(vUv.y * 5. - uTime * 0.2, vUv.x * 3.)) * 3.) * 6.2831);
  float a = smoothstep(0.0, 0.5, side) * smoothstep(0.35, 0.8, s) * smoothstep(1., 0.7, vUv.y) * smoothstep(0., 0.08, vUv.y);
  float grain = step(0.93, h(floor(vec2(vUv.x * 40., vUv.y * 120. - uTime * 2.2)))) * side;
  gl_FragColor = vec4(uColor * (0.75 + 0.45 * s + 0.12 * lines) + grain * 0.9, a * 0.6);
}`;
// grains thrown up where the sand lands: one draw call, ballistic on the GPU
const sprayVert = /* glsl */`
attribute vec4 aSeed; attribute vec3 aOrg; attribute vec2 aDir; uniform float uTime, uScale;
varying float vA;
void main() {
  float life = 0.6 + 0.5 * aSeed.w, ph = fract(uTime * (0.45 + 0.4 * aSeed.x) + aSeed.y);
  float t = ph * life, sp = 0.8 + 2.4 * aSeed.z;
  vec3 p = aOrg + vec3(aDir.x * sp * t * (0.6 + aSeed.x), 2.6 * aSeed.w * t * 2.2 - 4.9 * t * t * 1.3, aDir.y * sp * t * (0.6 + aSeed.x));
  p.xz += vec2(-aDir.y, aDir.x) * (aSeed.x - 0.5) * 0.6 * ph;
  vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
  vA = smoothstep(0., 0.08, ph) * (1. - ph) * smoothstep(0.3, 2., -mv.z);
  gl_PointSize = clamp(0.07 * (0.5 + aSeed.z) * uScale / max(0.1, -mv.z), 1., 14.);
}`;
const sprayFrag = /* glsl */`
precision highp float; uniform vec3 uColor; varying float vA;
void main() { float d = length(gl_PointCoord - 0.5) * 2.; float a = smoothstep(1., 0.2, d); gl_FragColor = vec4(uColor * a * vA, a * vA * 0.9); }`;

let _crack = null;
/** A ragged dark opening with a crumbled lip, for where the sand pours through the wall. */
function crackTex() {
  return _crack || (_crack = canvasTex(128, 192, (g, w, h) => {
    const r = rngFor('crack');
    g.clearRect(0, 0, w, h);
    g.filter = 'blur(2px)';
    g.fillStyle = '#e9b27a';
    g.beginPath();
    const pts = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([w * (0.5 - 0.3 * Math.sin(t * Math.PI) - r() * 0.07), h * (0.02 + 0.96 * t)]); }
    for (let i = 14; i >= 0; i--) { const t = i / 14; pts.push([w * (0.5 + 0.3 * Math.sin(t * Math.PI) + r() * 0.07), h * (0.02 + 0.96 * t)]); }
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.fill();
    g.filter = 'blur(3px)'; g.fillStyle = '#1a0a04';
    g.beginPath();
    pts.forEach(([x, y], i) => { const k = 0.82, cx = w / 2; (i ? g.lineTo(cx + (x - cx) * k, h / 2 + (y - h / 2) * 0.94) : g.moveTo(cx + (x - cx) * k, h / 2 + (y - h / 2) * 0.94)); });
    g.fill();
  }));
}

export class SandHall extends Room {
  constructor(door) {
    super(door, 'sandhall', 'The Hall of Falling Sand');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(range(r, 0.2, 0.45) * sign(r), 1, 0.22), sunC: C('#fff0cc'), sunI: 2.7, amb: C('#c49a78'), grd: C('#7a4a26'),
      floorSun: V(0.7 * sign(r), 0.22, -0.3), floorSunK: 0.7,
      fog: C('#d09868'), fogD: 0.01, bg: C('#f3d6a6'), exp: 0.85, bloom: 0.55, rays: 1.0, raysColor: C('#ffd6a0'), raysThreshold: 1.05,
      lit: C('#e8903c'), hi: C('#fff0c0'), shade: C('#64301a'), rim: C('#ffe0b0'), glit: C('#fff6e0'), pools: true, glitter: 1.1,
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
    const box = [-HW, HW, Z0, Z1], bounce = C('#ff9a48').multiplyScalar(0.2), sandC = C('#e6a860');
    const wall = stoneMat(0xd8b88a, 0x4a2a14, 0.16, 2.4, { box, sandY: 2.5, sand: sandC, bounce, strata: 0.62, aoH: 6, ao: 0.5, block: [2.6, 1.05], cracks: 0.5 });
    const dark = stoneMat(0xb08a62, 0x3a2010, 0.18, 2.2, { box, strata: 0.9, bounce, ao: 0.62, aoH: 4 });
    const colM = stoneMat(0xd8b88a, 0x4a2a14, 0.16, 2.4, { sandY: 0.5, sand: sandC, bounce, strata: 1.1, tile: 0.22, aoH: 5, ao: 0.55, block: [1000, 1.6], cracks: 0.4 });
    const gold = this.gold({ emissive: 0x6a3a08, ei: 0.4 });
    this.mats = { wall, dark, gold, col: colM };
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
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xe8b860, roughness: 0.32, metalness: 0.9, envMap: null, map: glyphTex[i % 6], alphaTest: 0.55, emissive: 0x6a3a08, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
      (this.envMats = this.envMats || []).push(m.material);
      m.position.set(sx * (HW - 0.37), 6.8, z); m.rotation.y = -sx * Math.PI / 2;
      s.add(m);
      this.box(0.3, 2.3, 2.3, dark, sx * (HW - 0.15), 5.65, z, 0, false);   // a slab the glyph is inlaid into
      this.box(0.36, 2.0, 2.0, wall, sx * (HW - 0.18), 5.8, z, 0, false);
    }
    // two rows of columns, some broken and leaning, sunk into the sand
    this.columns = [];
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
      const x = sx * range(r, 6.6, 7.4), z = -5 - i * 8.2 + range(r, -0.6, 0.6);
      const gy = this.height(x, z);
      const broken = r() < 0.3, h = broken ? range(r, 3, 7) : WALL_H - 1.2;
      const c = this.column(x, z, gy - 1.0, 0.85, h + 1.0, colM, true, 16);
      if (!broken) { this.box(2.2, 0.7, 2.2, dark, x, h - 0.2, z, 0, false); }
      else if (r() < 0.6) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.0, 16), colM);
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
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(f.w * 1.7, 2.4), new THREE.MeshBasicMaterial({ map: crackTex(), color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      if (f.big) { crack.position.set(f.x, f.top, Z0 + 0.02); }
      else { crack.position.set(f.x - Math.sign(f.x) * 0.02, f.top, f.z); crack.rotation.y = -Math.sign(f.x) * Math.PI / 2; }
      this.scene.add(crack);
      // a stream of sand flowing from its foot toward the middle of the hall
      this._flow(f);
    }
    this._spray();
  }

  /** Grains thrown up and a soft billow where each fall lands. */
  _spray() {
    const N = 46, n = this.falls.length * N, org = new Float32Array(n * 3), dir = new Float32Array(n * 2), sd = new Float32Array(n * 4), r = this.rng;
    this.falls.forEach((f, k) => {
      const nx = f.big ? 0 : -Math.sign(f.x), nz = f.big ? 1 : 0;
      for (let i = 0; i < N; i++) {
        const o = k * N + i, a = (r() - 0.5) * Math.PI * 1.3, c = Math.cos(a), sn = Math.sin(a);
        org[o * 3] = f.x + nx * 0.45 + (r() - 0.5) * f.w * 0.5; org[o * 3 + 1] = f.y + 0.1; org[o * 3 + 2] = f.z + nz * 0.45 + (r() - 0.5) * (f.big ? f.w * 0.5 : 0.6);
        dir[o * 2] = nx * c - nz * sn; dir[o * 2 + 1] = nz * c + nx * sn;
        for (let q = 0; q < 4; q++) sd[o * 4 + q] = r();
      }
      const bill = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.3)'), color: C('#e8a860').multiplyScalar(f.big ? 0.5 : 0.32), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
      bill.position.set(f.x + nx * 0.9, f.y + 0.9, f.z + nz * 0.9); bill.scale.set(f.big ? 7 : 4, f.big ? 4.2 : 2.6, 1);
      this.scene.add(bill); (this.billows = this.billows || []).push(bill);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aOrg', new THREE.BufferAttribute(org, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 2)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.sprayU = { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: C('#ffd9a0').multiplyScalar(1.1) } };
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.sprayU, vertexShader: sprayVert, fragmentShader: sprayFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; pts.renderOrder = 5;
    this.scene.add(pts);
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
    this.sprayU.uTime.value = time; this.sprayU.uScale.value = ctx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
    this.billows.forEach((b, i) => { b.material.opacity = 0.5 + 0.12 * Math.sin(time * 0.9 + i * 2); });
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
