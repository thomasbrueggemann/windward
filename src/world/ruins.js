import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addPlaza, terrainHeight, pathX, zAtProgress, progressAt, trenchCenter } from './heightfield.js';
import { rngFor, mulberry32, range, sign, pick } from './seed.js';
import { PLAN, CORRIDOR, addSite, occupy, isFree, onPath } from './layout.js';
import { makeGlyphSprite } from '../textures.js';
import { palette } from './palette.js';
import { chunk, shaft, column, finishExtrude, weather, patchStone, stoneNoise, updateStone, dress } from './stone.js';

const HDR_AMBER = new THREE.Color(3.4, 1.9, 0.7);

const SHADOW_VERT = /* glsl */`
uniform vec4 uRow; varying float vH;
#include <fog_pars_vertex>
void main() { vH = dot(uRow, vec4(position, 1.)); vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const SHADOW_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uOp; varying float vH;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(uCol, uOp * mix(1., 0.42, smoothstep(0., 16., vH)));
#include <fog_fragment>
}`;
const DECAL_VERT = /* glsl */`
attribute vec4 iSize; varying vec2 vP; varying vec4 vS;
#include <fog_pars_vertex>
void main() { vS = iSize; vP = position.xz * 2. * (iSize.xy + iSize.z); vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const DECAL_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uOp; varying vec2 vP; varying vec4 vS;
#include <fog_pars_fragment>
void main() {
  vec2 q = abs(vP) - vS.xy + vS.w;
  float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - vS.w;
  float a = 1. - smoothstep(0., vS.z, d); a *= a;
  gl_FragColor = vec4(uCol, a * uOp);
#include <fog_fragment>
}`;

/** Ruined city, shrines, buried monoliths and the canyon's rock bridges. */
export class Ruins {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];
    this.shelters = [];
    this.shrines = [];
    this.posts = [];            // banner post pairs
    this.casters = [];
    this.windowMats = [];
    this.decals = [];
    stoneNoise();
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, ...o });
    this.stone = patchStone(std({ color: 0xd9b98c, emissive: 0x4a2a14, emissiveIntensity: 0.55 }), 'a', { dust: 1.25 });
    this.stoneDark = patchStone(std({ color: 0xb08a62, emissive: 0x3a2010, emissiveIntensity: 0.55 }), 'b', { dust: 1.25 });
    this.gold = new THREE.MeshStandardMaterial({ color: 0xe8b860, roughness: 0.4, metalness: 0.65, emissive: 0x6a3a08, emissiveIntensity: 0.8 });
    this.rock = patchStone(std({ color: 0x2c4258, roughness: 1, emissive: 0x06101c, emissiveIntensity: 1 }), 'r', { p: [0.9, 0.55, 0, 0.6], dust: 2.0, glowMul: 0 });
    this.stoneMats = [this.stone, this.stoneDark, this.rock];
    this.shadowU = { uCol: { value: new THREE.Color(0x30101a) }, uOp: { value: 0.5 } };
    this.decalU = { uCol: { value: new THREE.Color(0x30101a) }, uOp: { value: 0.55 } };
    this._tmp = new THREE.Matrix4();
    this._S = new THREE.Matrix4();
    this._lastSun = new THREE.Vector3(9, 9, 9);
    this.glyphTex = makeGlyphSprite(0);
    this.rv = mulberry32(4711);   // visual-only randomness: never touches the layout stream

    this.r = rngFor('ruins');
    this.build();
  }

  // ------------------------------------------------------------ helpers
  _shadowMat(mesh, y0) {
    const e = mesh.matrixWorld.elements;
    return new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uRow: { value: new THREE.Vector4(e[1], e[5], e[9], e[13] - y0) }, ...this.shadowU },
      vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
  }
  /** opt: band (local y of the carved frieze), sg (cheap shadow geometry), contact [hx, hz, margin, strength, corner] */
  _place(mesh, x, y, z, rotY = 0, shadowY = null, opt = {}) {
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
    mesh.updateMatrixWorld(true);
    if (mesh.material.userData.stone && !mesh.geometry.attributes.aInfo) dress(mesh, shadowY ?? terrainHeight(x, z), opt.band !== undefined ? y + opt.band : 0);
    const sg = opt.sg ?? mesh.userData.sg;
    if (shadowY !== null) {
      const sh = new THREE.Mesh(sg || mesh.geometry, this._shadowMat(mesh, shadowY));
      sh.matrixAutoUpdate = false; sh.frustumCulled = false; sh.renderOrder = 2;
      this.scene.add(sh);
      this.casters.push({ mesh, sh, y0: shadowY });
    }
    if (opt.contact) this._contact(x, z, rotY, ...opt.contact);
    return mesh;
  }
  _contact(x, z, rot, hx, hz, m = 1.6, k = 0.55, rad = 0.3) { this.decals.push({ x, z, rot, hx, hz, m, k, rad, y: terrainHeight(x, z) + 0.05 }); }
  _solid(c) { this.colliders.push(c); occupy(c.x, c.z, c.r ?? Math.hypot(c.hx, c.hz)); }
  /** Weathered block with its base at local y = `yo` (default: centred). A plain box doubles as the planar-shadow caster. */
  _box(w, h, d, mat = this.stone, yo = 0, o = {}) {
    const g = chunk(w, h, d, { seed: this.rv() * 50, ...o }).translate(0, yo, 0);
    const m = new THREE.Mesh(g, mat);
    m.userData.sg = new THREE.BoxGeometry(w, h, d).translate(0, yo, 0);
    return m;
  }
  _blk(w, h, d, mat = this.stone, o = {}) { return this._box(w, h, d, mat, h / 2, o); }

  _column(x, z, y0, h, broken = false) {
    const H = broken ? h * (0.35 + this.r() * 0.35) : h;
    const g = column(H, { broken, seed: this.rv() * 40 });
    const m = new THREE.Mesh(g, this.stone);
    m.userData.sg = mergeGeometries([new THREE.BoxGeometry(2.6, 0.7, 2.6).translate(0, 0.35, 0), new THREE.CylinderGeometry(0.85, 1.02, H, 8).translate(0, 0.6 + H / 2, 0)]);
    this._place(m, x, y0 - 0.2, z, 0, y0, { band: broken || this.rv() < 0.4 ? undefined : 0.6 + H - 1.5, contact: [1.35, 1.35, 1.7, 0.5, 1.3] });
    if (broken) {
      // a fallen drum lying in the sand beside the stump
      const drum = dress(new THREE.Mesh(shaft(0.9, 0.9, 2.2, { radial: 24, hseg: 4, flutes: 9, jag: 0.25, seed: this.rv() * 9 }), this.stone), y0);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(x + 2.6 + this.r() * 2, y0 + 0.7, z + (this.r() - .5) * 4);
      this.group.add(drum);
    }
    this._solid({ kind: 'circle', x, z, r: 1.15, top: y0 + H + 1 });
  }

  _wall(x, z, y0, len, h, rot) {
    const w = this._blk(len, h, 1.4, this.stoneDark, { chip: 2, r: 0.18 });
    this._place(w, x, y0 - 0.2, z, rot, y0, { contact: [len / 2, 0.7, 1.4, 0.5, 0.3] });
    // ragged top
    const n = 3;
    for (let i = 0; i < n; i++) {
      const sh = h * (0.2 + this.r() * 0.35), sw = len / n * 0.6;
      const b = this._blk(sw, sh, 1.2, this.stoneDark, { chip: 2.5, r: 0.16 });
      const off = (i - (n - 1) / 2) * (len / n);
      this._place(b, x + Math.cos(rot) * off, y0 - 0.2 + h - 0.15, z - Math.sin(rot) * off, rot, y0);
    }
    this._solid({ kind: 'box', x, z, hx: len / 2, hz: 0.7, rot: -rot, top: y0 + h });
  }

  _tower(x, z, y0, rot, h) {
    const parts = [[7.2, h * 0.52, 7.2], [5.4, h * 0.3, 5.4], [3.8, h * 0.18, 3.8]];
    let y = y0 - 0.3;
    parts.forEach(([w, hh, d], i) => {
      const gs = [chunk(w, hh, d, { seed: this.rv() * 40 }).translate(0, hh / 2, 0),
        chunk(w + 0.9, 0.5, d + 0.9, { r: 0.14, seed: this.rv() * 40 }).translate(0, hh - 0.1, 0),
        chunk(w + 0.6, 0.6, d + 0.6, { r: 0.16, seed: this.rv() * 40 }).translate(0, 0.2, 0)];
      const b = new THREE.Mesh(mergeGeometries(gs, false), this.stone);
      b.userData.sg = new THREE.BoxGeometry(w, hh, d).translate(0, hh / 2, 0);
      this._place(b, x, y, z, rot, y0, { band: hh * 0.78 - 1.05 + 0.4, contact: i ? undefined : [w / 2 + 0.4, d / 2 + 0.4, 2.2, 0.55, 0.5] });
      // glowing windows (dusk lights)
      const wm = new THREE.MeshBasicMaterial({ color: HDR_AMBER.clone().multiplyScalar(0.0) });
      this.windowMats.push(wm);
      for (const sgn of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), wm);
        win.position.set(sgn * w * 0.18, hh * 0.45, d / 2 + 0.22);
        b.add(win);
        const win2 = win.clone(); win2.position.set(w / 2 + 0.22, hh * 0.45, sgn * d * 0.18); win2.rotation.y = Math.PI / 2; b.add(win2);
      }
      y += hh;
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 3.4, 4), this.gold); roof.geometry.translate(0, 1.7, 0);
    this._place(roof, x, y, z, rot + Math.PI / 4, y0);
    this._solid({ kind: 'box', x, z, hx: 3.7, hz: 3.7, rot: -rot, top: y0 + h });
  }

  _arch(x, z, y0, rot, s = 1) {
    const sh = new THREE.Shape();
    const W = 8 * s, H = 17 * s, w = 4.2 * s, hh = 11 * s;
    sh.moveTo(-W, 0); sh.lineTo(-W, H - W); sh.absarc(0, H - W, W, Math.PI, 0, true); sh.lineTo(W, 0); sh.lineTo(w, 0);
    sh.lineTo(w, hh - w); sh.absarc(0, hh - w, w, 0, Math.PI, false); sh.lineTo(-w, 0); sh.closePath();
    const bv = 0.3 * s, dp = 2.6 * s - 2 * bv;
    const geo = new THREE.ExtrudeGeometry(sh, { depth: dp, bevelEnabled: true, bevelSize: bv, bevelThickness: bv, bevelOffset: -bv, bevelSegments: 2, curveSegments: 18, steps: 1 });
    geo.translate(0, 0, -dp / 2);
    const m = new THREE.Mesh(finishExtrude(weather(geo, 0.2 * s, 0.45, this.rv() * 30)), this.stone);
    m.userData.sg = new THREE.ExtrudeGeometry(sh, { depth: 2.6 * s, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -1.3 * s);
    this._place(m, x, y0 - 0.2, z, rot, y0, { band: H * 0.3 });
    for (const sgn of [-1, 1]) {
      const lx = sgn * (W + w) / 2;
      const cx = x + Math.cos(rot) * lx, cz = z - Math.sin(rot) * lx;
      this._contact(cx, cz, rot, (W - w) / 2 + 0.2, 1.5 * s, 2, 0.5, 0.4);
      this._solid({ kind: 'box', x: cx, z: cz, hx: (W - w) / 2, hz: 1.4 * s, rot: -rot, top: y0 + H });
    }
  }

  _hall(x, z, y0, rot) {
    // roofed colonnade — shelter from the guardians
    const roof = this._blk(26, 1.6, 18, this.stone, { r: 0.3 });
    this._place(roof, x, y0 + 11.5, z, rot, y0, { band: 0.3 });
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [lx, lz] of [[-10, -6], [-10, 6], [10, -6], [10, 6], [0, -6], [0, 6]]) {
      this._column(x + cs * lx + sn * lz, z - sn * lx + cs * lz, y0, 11.4, false);
    }
    this.shelters.push({ x, z, r: 13, y: y0 + 11 });
  }

  _ziggurat(x, z, y0, rot) {
    let y = y0 - 0.3;
    [[34, 3.2], [27, 3.2], [20, 3.2], [13, 3.2]].forEach(([w, h], i) => {
      const b = this._blk(w, h, w * 0.85, i % 2 ? this.stoneDark : this.stone, { r: 0.35, chip: 1.4 });
      this._place(b, x, y, z, rot, y0, { band: 1.85, contact: i ? undefined : [w / 2 + 0.4, w * 0.425 + 0.4, 3.4, 0.55, 0.6] });
      y += h;
    });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), new THREE.MeshBasicMaterial({ color: 0x1a0a08 }));
    door.position.set(0, 4, 34 * 0.85 / 2 + 0.05);
    this.group.add(door);
    door.position.set(x + Math.sin(rot) * 14.5, y0 + 4, z + Math.cos(rot) * 14.5); door.rotation.y = rot;
    this._solid({ kind: 'box', x, z, hx: 17, hz: 14.5, rot: -rot, top: y0 + 12.8 });
  }

  _postPair(cx, cz, y0, spanDir, span, h = 17) {
    const rot = Math.atan2(spanDir.x, spanDir.z);
    const out = [];
    for (const sgn of [-1, 1]) {
      const px = cx + spanDir.x * span / 2 * sgn, pz = cz + spanDir.z * span / 2 * sgn;
      const y = terrainHeight(px, pz);
      const p = this._blk(1.5, h, 1.5, this.stone, { r: 0.14 });
      this._place(p, px, y - 0.4, pz, rot, y, { band: 3.2, contact: [0.8, 0.8, 1.3, 0.5, 0.4] });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 4), this.gold); cap.geometry.translate(0, 1.3, 0);
      this._place(cap, px, y - 0.4 + h, pz, rot + Math.PI / 4, y);
      this._solid({ kind: 'circle', x: px, z: pz, r: 1.1, top: y + h });
      out.push(new THREE.Vector3(px, y + h - 2.5, pz));
    }
    this.posts.push({ a: out[0], b: out[1] });
    return out;
  }

  _shrine(x, z) {
    const pl = addPlaza(x, z, 12, 34);
    const y0 = pl.h;
    const plat = new THREE.Mesh(shaft(7.5, 8.6, 1.0, { radial: 32, hseg: 2, flutes: 0, poly: 8, wob: 0.02, seed: 3 }).translate(0, 0.5, 0), this.stone);
    this._place(plat, x, y0 - 0.2, z, 0.2, y0, { contact: [8.6, 8.6, 3.4, 0.55, 8.6] });
    const step = new THREE.Mesh(shaft(5.2, 6.2, 1.0, { radial: 32, hseg: 2, flutes: 0, poly: 8, wob: 0.02, seed: 4 }).translate(0, 0.5, 0), this.stoneDark);
    this._place(step, x, y0 + 0.8, z, 0.2, y0);
    const ob = new THREE.Mesh(shaft(1.2, 1.9, 11, { radial: 32, hseg: 14, flutes: 0, poly: 4, wob: 0.05, seed: 5 }).translate(0, 5.5, 0), this.stone);
    this._place(ob, x, y0 + 1.7, z, 0.8, y0, { band: 2.4 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 4), this.gold); tip.geometry.translate(0, 1.1, 0);
    this._place(tip, x, y0 + 12.7, z, 0.8, y0);
    // glowing glyph panel
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: this.glyphTex, color: new THREE.Color(3.4, 2.6, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    glyph.position.set(x, y0 + 7, z); this.group.add(glyph);
    // soft beacon
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,200,120,.35)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(2.2, 1.6, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    beacon.scale.set(34, 34, 1); beacon.position.set(x, y0 + 13.4, z); this.group.add(beacon);
    this._solid({ kind: 'circle', x, z, r: 2.2, top: y0 + 13 });
    this.shrines.push({ x, y: y0, z, glyph, beacon, seen: false });
  }

  _rockBridge(x, z, y, w, d, t, rot = 0) {
    // a natural arch: thin at the crown, swelling into the canyon walls
    const hw = w / 2, sh = new THREE.Shape();
    const top = (u) => t / 2 + 5 * (1 - u * u) + Math.sin(u * 9) * 1.2;
    const bot = (u) => -t / 2 - 26 * Math.pow(Math.abs(u), 2.4);
    sh.moveTo(-hw, bot(-1));
    for (let i = -20; i <= 20; i++) { const u = i / 20; sh.lineTo(u * hw, top(u)); }
    for (let i = 20; i >= -20; i--) { const u = i / 20; sh.lineTo(u * hw, bot(u)); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: d, steps: 4, bevelEnabled: true, bevelSize: 1.6, bevelThickness: 2.2, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -d / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const n = Math.sin(px * 0.31 + pz * 0.9) + Math.sin(py * 0.7 + px * 0.13) * 0.8 + Math.sin(pz * 1.7 + py * 0.4);
      p.setXYZ(i, px + n * 0.45, py + n * 0.55, pz + n * 0.5);
    }
    const m = dress(new THREE.Mesh(finishExtrude(geo), this.rock), -999);
    this._place(m, x, y, z, rot);
    this.shelters.push({ x, z, hx: 44, hz: d / 2 + 2, y: y - t / 2 + 2 });
    for (let i = 0; i < 5; i++) {
      const hs = 4 + this.r() * 9;
      const c = dress(new THREE.Mesh(shaft(1.1 + this.r() * 1.5, 0.12, hs, { radial: 10, hseg: 5, flutes: 0, wob: 0.25, seed: i }), this.rock), -999);
      c.rotation.x = Math.PI; c.position.set(x + (this.r() - .5) * w * 0.5, y - t / 2 - hs / 2 + 1.5, z + (this.r() - .5) * d * 0.6);
      this.group.add(c);
    }
  }

  // ------------------------------------------------------------ layout
  build() {
    const r = this.r;

    // ----- shrines at the end of each chapter
    PLAN.shrines.forEach((s, i) => {
      const [x, z] = onPath(s.p, s.side);
      this._shrine(x, z);
      addSite('shrine', x, z, { y: this.shrines[i].y, r: 8, index: i });
    });

    // ----- the ruined city: three plazas, laid out in path-relative coordinates (lx across, lz along)
    PLAN.plazas.forEach((d, pi) => this._plaza(d, pi));

    // ----- monoliths half-buried in the dunes (scale + landmarks; on the mountain they shelter from the gusts)
    const mono = (x, z, kind) => {
      const y = terrainHeight(x, z);
      const h = 5 + r() * 9;
      let m;
      if (kind === 0) { m = new THREE.Mesh(shaft(0.9, 1.1, h, { radial: 20, hseg: 8, flutes: 0, wob: 0.14, jag: 0.5, seed: this.rv() * 9 }).translate(0, h / 2, 0), this.stone); }
      else if (kind === 1) { m = this._blk(2 + r() * 2, h, 1.2, this.stone, { chip: 2.5 }); }
      else { m = this._blk(6 + r() * 4, 1.4, 3 + r() * 2, this.stone, { chip: 2 }); }
      m.rotation.set((r() - .5) * 0.3, r() * 6.28, (r() - .5) * 0.35);
      m.position.set(x, y - 1.6 - r() * 2, z);
      dress(m, y);
      this.group.add(m);
      this._solid({ kind: 'circle', x, z, r: kind === 2 ? 2.8 : 1.1, top: y + (kind === 2 ? 0 : h * 0.7) });
      addSite('monolith', x, z, { y, r: 3 });
    };
    const monoPs = [];
    for (let p = 0.02; p < 0.30; p += (22 + r() * 40) / 2045) monoPs.push(p);
    for (let p = 0.792; p < 0.993; p += (30 + r() * 50) / 2045) monoPs.push(p);
    for (const p of monoPs) {
      const side = sign(r);
      const [x, z] = onPath(p, side * (14 + r() * 70));
      mono(x, z + (r() - .5) * 10, (r() * 3) | 0);
    }
    // the first landmark: a standing gateway right ahead of the spawn point
    {
      const g = PLAN.gateway, z = g.z, x = pathX(z) + g.dx, y = terrainHeight(x, z), rot = g.rot;
      const lintel = this._blk(14, 2.2, 2.4, this.stone, { r: 0.3 });
      this._place(lintel, x, y + 10.5, z, rot, null, { band: 0.6 });
      for (const sx of [-6, 6]) {
        const col = new THREE.Mesh(shaft(1.1, 1.3, 14, { radial: 36, hseg: 10, flutes: 9, seed: 21 }).translate(0, 7, 0), this.stone);
        const px = x + sx * Math.cos(rot), pz = z - sx * Math.sin(rot);
        this._place(col, px, terrainHeight(px, pz) - 2.2, pz, 0);
        this._solid({ kind: 'circle', x: px, z: pz, r: 1.3, top: 40 });
      }
      addSite('gateway', x, z, { y, r: 7, rot });
    }

    // ----- the depths: natural bridges spanning the canyon, leaving gaps for shafts of light
    const gapEvery = 3 + (r() < 0.35 ? 1 : 0);
    for (let z = zAtProgress(0.535), i = 0; z > zAtProgress(0.735); z -= 52 + r() * 22, i++) {
      if (i % gapEvery === gapEvery - 1) continue;
      const cx = this._canyonCentre(z) + (r() - .5) * 10, y = -11 - r() * 5;
      this._rockBridge(cx, z, y, 150, 15 + r() * 14, 7 + r() * 4, (r() - .5) * 0.15);
      addSite('bridge', cx, z, { y, r: 20 });
    }
    this._buildDecals();
  }

  /** One instanced draw of soft contact-occlusion pools where stone meets sand. */
  _buildDecals() {
    const n = this.decals.length; if (!n) return;
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), sz = new Float32Array(n * 4);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...this.decalU }, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const im = new THREE.InstancedMesh(g, mat, n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    this.decals.forEach((d, i) => {
      q.setFromAxisAngle(up, d.rot);
      M.compose(new THREE.Vector3(d.x, d.y, d.z), q, new THREE.Vector3(2 * (d.hx + d.m), 1, 2 * (d.hz + d.m)));
      im.setMatrixAt(i, M); sz.set([d.hx, d.hz, d.m, d.rad], i * 4);
    });
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(sz, 4));
    im.frustumCulled = false; im.renderOrder = 1;
    this.scene.add(im);
    this.decalMesh = im;
  }

  /** One plaza of the ruined city. Coordinates are path-relative: lx across the path (mirrored per seed), lz along it. */
  _plaza(d, pi) {
    const rr = mulberry32(d.seed), m = d.mirror;
    const zc = zAtProgress(d.p), xc = pathX(zc);
    const pl = addPlaza(xc, zc, 50, 80);
    const y0 = pl.h;
    const J = (v, a = 2.5) => v + (rr() - .5) * 2 * a;
    const head = (z) => Math.atan((pathX(z - 1) - pathX(z + 1)) / -2);
    // keep anything solid of radius `rad` out of the walking corridor
    const safe = (lx, rad) => { const s = Math.sign(lx) || sign(rr); return s * Math.max(Math.abs(lx), rad + CORRIDOR + 0.5); };
    const P = (lx, lz) => { const z = zc + lz; return [pathX(z) + m * lx, z]; };
    const R = (rot, lz) => m * rot + head(zc + lz);
    const column = (lx, lz, h, broken) => { const [x, z] = P(safe(lx, 1.3), lz); this._column(x, z, y0, h, broken); };
    const tower = (lx, lz, rot, h) => { const [x, z] = P(safe(lx, 5.3), lz); this._tower(x, z, y0, R(rot, lz), h); };
    const wall = (lx, lz, len, h, rot) => { const [x, z] = P(safe(lx, len / 2 + 0.7), lz); this._wall(x, z, y0, len, h, R(rot, lz)); };
    const hall = (lx, lz, rot) => { const [x, z] = P(safe(lx, 13), lz); this._hall(x, z, y0, R(rot, lz)); };
    const arch = (lz, s, dx = 0) => { const [x, z] = P(dx, lz); this._arch(x, z, y0, head(z), s); };
    const posts = (lz, span) => { const [x, z] = P(0, lz), h = head(z); this._postPair(x, z, y0, new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)), span); };
    const H = (h) => h * range(rr, 0.82, 1.18);
    const br = (p = 0.22) => rr() < p;

    if (d.kind === 'gate') {
      arch(J(28, 4), range(rr, 1.05, 1.3));
      tower(J(-26), J(18), J(0.2, 0.15), H(30));
      tower(J(28), J(-6, 6), J(-0.1, 0.15), H(24));
      const n = 2 * (2 + ((rr() * 3) | 0)), gap = J(12, 1.5), step = range(rr, 13, 17);
      for (let i = 0; i < n; i++) column((i % 2 ? 1 : -1) * gap, -4 - Math.floor(i / 2) * step, H(13), br());
      wall(J(14), J(28, 2), J(16, 3), H(6), J(0.1, 0.2));
      wall(J(-30, 4), J(-22, 4), J(20, 4), H(8), J(1.4, 0.2));
      posts(J(-38, 3), J(24, 3));
    } else if (d.kind === 'colonnade') {
      const rows = 5 + ((rr() * 3) | 0), half = range(rr, 11.5, 14.5), step = range(rr, 13, 16.5), z0 = (rows - 1) * step / 2;
      for (let i = 0; i < rows; i++) for (const sx of [-half, half]) column(sx, z0 - i * step, H(14), br(0.18));
      hall(J(-40, 4), J(-4, 6), J(0.15, 0.2));
      tower(J(36, 4), J(14, 6), J(-0.3, 0.2), H(34));
      wall(J(30, 4), J(-30, 4), J(24, 4), H(7), J(0.6, 0.3));
      posts(z0 + 8, J(28, 2));
      posts(-z0 - 10 + J(0, 2), J(22, 2));
    } else {
      const zs = sign(rr);
      { const [x, z] = P(safe(J(-24, 3), 22.4), J(-30, 4)); this._ziggurat(x, z, y0, R(J(0, 0.15), -30)); }
      const n = 3 + ((rr() * 3) | 0), sp = range(rr, 14, 18);
      for (let i = 0; i < n; i++) column(-(n - 1) * sp / 2 + i * sp, J(6, 2), H(12), br(0.25));
      hall(J(38, 4), J(18, 5) * zs, J(-0.2, 0.2));
      tower(J(-40, 4), J(22, 5) * zs, J(0.3, 0.2), H(28));
      arch(J(40, 4), range(rr, 0.9, 1.1), J(0, 1.5));
      wall(J(36, 4), J(-24, 4) * zs, J(18, 3), H(6), J(1.2, 0.3));
    }
    // scattered debris: broken drums, wall stubs and the odd lone tower, wherever there is room
    const extras = 2 + ((rr() * 4) | 0);
    for (let k = 0, tries = 0; k < extras && tries < 40; tries++) {
      const kind = pick(rr, ['col', 'col', 'wall', 'tower']);
      const rad = kind === 'tower' ? 5.3 : kind === 'wall' ? 6 : 1.3;
      const lx = sign(rr) * range(rr, 16, 62), lz = range(rr, -58, 58);
      const [x, z] = P(lx, lz);
      if (!isFree(x, z, rad)) continue;
      if (kind === 'col') column(lx, lz, H(12), true);
      else if (kind === 'wall') wall(lx, lz, range(rr, 8, 14), H(5), range(rr, 0, 3));
      else tower(lx, lz, range(rr, -0.4, 0.4), H(20));
      k++;
    }
    addSite('plaza', xc, zc, { y: y0, r: 50, kind: d.kind, index: pi, progress: progressAt(zc) });
  }

  /** Points along the path centre that are inside a collider (should be empty). */
  pathBlockers(step = 1) {
    const out = [], pr = 0.45 + 0.3;
    for (let z = -5; z > zAtProgress(0.995); z -= step) {
      const x = pathX(z);
      for (const c of this.colliders) {
        let hit;
        if (c.kind === 'circle') hit = Math.hypot(x - c.x, z - c.z) < c.r + pr;
        else {
          const cs = Math.cos(c.rot), sn = Math.sin(c.rot), dx = x - c.x, dz = z - c.z;
          hit = Math.abs(dx * cs + dz * sn) < c.hx + pr && Math.abs(-dx * sn + dz * cs) < c.hz + pr;
        }
        if (hit && terrainHeight(x, z) < c.top) { out.push({ x, z, p: progressAt(z), c }); break; }
      }
    }
    return out;
  }

  _canyonCentre(z) { return trenchCenter(z); }

  // ------------------------------------------------------------ per-frame
  update(sunDir, dusk) {
    // planar shadows (only when the sun moved)
    if (this._lastSun.distanceToSquared(sunDir) > 1e-6) {
      this._lastSun.copy(sunDir);
      // clamp the shadow elevation so low suns don't smear shadows across the whole plain
      const lx = sunDir.x, ly = Math.max(0.32, sunDir.y), lz = sunDir.z;
      for (const c of this.casters) {
        const y0 = c.y0 + 0.07;
        this._S.set(
          1, -lx / ly, 0, y0 * lx / ly,
          0, 0, 0, y0,
          0, -lz / ly, 1, y0 * lz / ly,
          0, 0, 0, 1);
        c.sh.matrix.copy(this._S).multiply(c.mesh.matrixWorld);
        c.sh.matrixWorldNeedsUpdate = true;
      }
    }
    // shadows and contact occlusion take the chapter's shade colour; stone sand follows the terrain
    this.shadowU.uCol.value.copy(palette.shade).multiplyScalar(0.5);
    this.decalU.uCol.value.copy(palette.shade).multiplyScalar(0.4);
    updateStone(this.stoneMats, dusk);
    // window lights come on toward dusk
    const k = THREE.MathUtils.smoothstep(dusk, 0.0, 1.0);
    for (const m of this.windowMats) m.color.copy(HDR_AMBER).multiplyScalar(k);
  }
}
