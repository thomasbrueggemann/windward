// The Chamber of Memory: a long, dim gallery whose walls remember. Each mural wakes as you come near and its brazier
// catches; when the old story has been told, the far wall shows a part of it no shrine ever did, and the chamber's
// warmth fills your scarf.
import * as THREE from 'three';
import { Room, C, V, stoneMat, lightShaft, motes, makeAmbience, radialTex, canvasTex } from './common.js';
import { fabricMat, muralMat } from './surface.js';
import { drawGlyph } from '../textures.js';
import { rngFor } from '../world/seed.js';
import { drawMural, MURAL_COUNT } from '../murals.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range } from '../world/seed.js';

const HW = 6.5, Z1 = 3, Z0 = -36, H = 9.5;
const TW = 1024, TH = 576;

let _plaster = null, _relief = null;
/** Aged lime plaster: mottled, stained, hairline cracks and grit (shared by every panel). */
function plasterBase() {
  if (_plaster) return _plaster;
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d'), r = rngFor('plaster');
  const gr = g.createRadialGradient(TW / 2, TH / 2, TH * 0.2, TW / 2, TH / 2, TW * 0.62);
  gr.addColorStop(0, '#f2dcb4'); gr.addColorStop(0.7, '#d8b88a'); gr.addColorStop(1, '#b38a5c');
  g.fillStyle = gr; g.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 70; i++) {          // mottling and damp stains
    const x = r() * TW, y = r() * TH, rad = 30 + r() * 120, k = r() < 0.5;
    const rg = g.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, k ? 'rgba(120,70,30,0.10)' : 'rgba(255,240,210,0.10)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.strokeStyle = 'rgba(70,40,20,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * TW, y = r() * TH; g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 60; y += r() * 36; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 5000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(80,45,20,0.18)' : 'rgba(255,245,225,0.16)'; g.fillRect(r() * TW, r() * TH, 1 + r() * 2, 1 + r() * 2); }
  const eg = g.createLinearGradient(0, 0, 0, TH); eg.addColorStop(0, 'rgba(40,20,8,0.28)'); eg.addColorStop(0.18, 'rgba(0,0,0,0)'); eg.addColorStop(0.85, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(40,20,8,0.34)');
  g.fillStyle = eg; g.fillRect(0, 0, TW, TH);
  return (_plaster = c);
}
/** The plaster's own roughness as a height map (the painted lines are carved into it later). */
function reliefBase() {
  if (_relief) return _relief;
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d'), r = rngFor('relief');
  g.fillStyle = '#808080'; g.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 9000; i++) { const v = 100 + r() * 60 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * TW, r() * TH, 1 + r() * 4, 1 + r() * 3); }
  g.strokeStyle = 'rgba(30,30,30,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) { g.beginPath(); let x = r() * TW, y = r() * TH; g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 60; y += r() * 36; g.lineTo(x, y); } g.stroke(); }
  return (_relief = c);
}
let _flame = null;
/** A teardrop of flame: hot white core, orange body, ragged tip. */
function flameTex() {
  return _flame || (_flame = canvasTex(64, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h * 0.7, 2, w / 2, h * 0.62, h * 0.5);
    gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.95)'); gr.addColorStop(0.6, 'rgba(255,110,30,0.5)'); gr.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = gr; g.save(); g.translate(w / 2, h * 0.62); g.scale(0.62, 1.3); g.translate(-w / 2, -h * 0.62);
    g.fillRect(0, 0, w, h); g.restore();
    g.globalCompositeOperation = 'destination-in';
    const m = g.createLinearGradient(0, 0, 0, h); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.18, 'rgba(0,0,0,0.85)'); m.addColorStop(0.7, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = m; g.fillRect(0, 0, w, h);
  }));
}

export class Memory extends Room {
  constructor(door) {
    super(door, 'memory', 'The Chamber of Memory');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(0.15, 1, 0.25), sunC: C('#ffd2a0'), sunI: 1.4, amb: C('#7a5444'), grd: C('#2a1810'),
      fog: C('#24140c'), fogD: 0.022, bg: C('#120a06'), exp: 1.05, bloom: 0.75, bloomThreshold: 1.0, rays: 0.35, raysColor: C('#ffc890'),
      env: { top: C('#e8b078'), hor: C('#a86a3c'), bot: C('#4a2814'), sun: C('#ffd8a0') },
      sat: 1.08, contrast: 1.08, vignette: 0.5, vigColor: C('#1a0804'), shadowTint: C('#030000'), highTint: C('#060200'), mood: 9, sand: C('#a07850'),
    });
    this.bounds = { x0: -HW, x1: HW, z0: Z0, z1: Z1 + 1.8 };
    this.camBounds = { x0: -HW, x1: HW, z0: Z0, z1: Z1 - 0.2 };
    this.ceiling = H - 0.4;
    this.camDist = 6.2; this.camPitch = 0.14;
    this.spawn = { x: 0, z: Z1 - 1.6, heading: Math.PI };
    // the story in order on alternating walls (the shrines' visions), the secret one at the end
    const first = r() < 0.5 ? -1 : 1;
    this.panels = [0, 1, 2, 3].map((idx, i) => ({ idx, side: i % 2 ? -first : first, z: -6 - i * 6.6 }));
    this.panels.push({ idx: 4 % MURAL_COUNT, side: 0, z: Z0 + 0.2, final: true });
    this._build();
  }

  height() { return 0; }

  _build() {
    const s = this.scene, r = this.rng;
    s.background = this.pal.bg;
    const box = [-HW, HW, Z0, Z1], bounce = C('#ff9040').multiplyScalar(0.12);
    const wall = stoneMat(0xc8a47c, 0x3a1c0a, 0.4, 2.2, { box, block: [1.6, 0.7], strata: 0.4, aoH: 4.5, ao: 0.5, bounce, cracks: 0.6, drift: 0.5, sand: C('#b88a58') });
    const dark = stoneMat(0x8a6446, 0x241006, 0.4, 2, { block: [1.2, 0.5], strata: 0.5, aoH: 2, ao: 0.7, bounce, cracks: 0.5 });
    const gold = this.gold({ emissive: 0x7a4010, ei: 0.5 });
    const slab = stoneMat(0x7a5842, 0x1c0c04, 0.45, 1.6, { box, slab: 1.5, strata: 0, ao: 1, bounce, cracks: 0.5, drift: 1.2, sand: C('#a67c4c'), tile: 0.2, bump: 0.06, rough: 0.8 });
    // floor of worn slabs with a red cloth runner down the middle
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 2, Z1 - Z0 + 4, 1, 1), slab);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (Z0 + Z1) / 2);
    s.add(floor);
    const RL = Z1 - Z0 - 4, rg = new THREE.PlaneGeometry(2.2, RL, 6, 40), rpos = rg.attributes.position;
    for (let i = 0; i < rpos.count; i++) rpos.setZ(i, 0.015 + 0.012 * Math.sin(rpos.getY(i) * 1.9) * Math.sin(rpos.getX(i) * 3.1 + rpos.getY(i) * 0.7));   // a runner that has settled over the slabs
    rg.computeVertexNormals();
    const runner = new THREE.Mesh(rg, fabricMat(/* glsl */`varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
      void main() { vUv = uv; vGlow = 0.; vec4 wp = modelMatrix * vec4(position, 1.); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`, { uLines: { value: 0 } },
      { maxU: 1, weave: [180, 2000], hem: [0.03, 0.002], colA: [0.3, 0.025, 0.02], colB: [0.5, 0.05, 0.03], sheen: 0.7, trans: 0.2, glowK: 0 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(0, 0.02, (Z0 + Z1) / 2 - 1); s.add(runner);
    for (const sx of [-1, 1]) {      // gold braid down both edges
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, RL), gold); t.position.set(sx * 0.97, 0.04, (Z0 + Z1) / 2 - 1); s.add(t);
      const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, RL), gold); t2.position.set(sx * 0.82, 0.038, (Z0 + Z1) / 2 - 1); s.add(t2);
    }
    // walls, a coffered ceiling with an oculus over the end wall
    for (const sx of [-1, 1]) this.box(1.4, H + 1, Z1 - Z0 + 2.8, wall, sx * (HW + 0.7), -0.5, (Z0 + Z1) / 2);
    this.box(HW * 2 + 2.8, H + 1, 1.4, wall, 0, -0.5, Z0 - 0.7);
    for (const sx of [-1, 1]) this.box(HW - 1.1, H + 1, 1.4, wall, sx * (1.1 + (HW - 1.1) / 2), -0.5, Z1 + 0.7);
    this.box(2.4, H - 3.3, 1.4, wall, 0, 3.8, Z1 + 0.7, 0, false);
    this.exitDoor(0, Z1, { w: 2.2, h: 3.8, color: C('#ffe4c0'), frameMat: gold });
    this.box(HW * 2 + 1.4, 0.8, Z1 - Z0 - 6, dark, 0, H, (Z0 + Z1) / 2 + 2.5, 0, false);
    for (let z = Z1 - 1; z > Z0 + 5; z -= 4.2) this.box(HW * 2, 0.7, 0.6, dark, 0, H - 0.7, z, 0, false);
    for (const sx of [-1, 1]) this.box(0.6, 0.7, Z1 - Z0, dark, sx * (HW - 0.3), H - 0.7, (Z0 + Z1) / 2, 0, false);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 1.3), fog: false }));
    sky.rotation.x = Math.PI / 2; sky.position.set(0, H + 1.5, Z0 + 2.5); s.add(sky);
    this.oculus = this.addShaft(lightShaft(new THREE.Vector3(0, H + 0.5, Z0 + 2.5), new THREE.Vector3(0, 0, Z0 + 3.5), 1.6, 2.6, C('#ffcf98'), 0.0));
    this.sun.position.set(0, 40, -20); this.sun.target.position.set(0, 0, Z0);
    // gold bands and pilasters between the murals
    for (const sx of [-1, 1]) {
      this.box(0.1, 0.25, Z1 - Z0, gold, sx * (HW - 0.05), 6.3, (Z0 + Z1) / 2, 0, false);
      for (let z = Z1 - 3; z > Z0 + 1; z -= 6.6) this.box(0.5, H, 0.9, wall, sx * (HW - 0.25), 0, z + 3.3 - 6.6, 0, false);
    }
    // a frieze of glyphs inlaid in gold along the upper walls
    const friezeTex = canvasTex(1024, 128, (g, w, h) => { g.clearRect(0, 0, w, h); for (let i = 0; i < 8; i++) drawGlyph(g, i % 6, 64 + i * 128, 64, 86); });
    friezeTex.wrapS = THREE.RepeatWrapping; friezeTex.repeat.set((Z1 - Z0) / 8.8, 1); friezeTex.anisotropy = 8;
    const frMat = new THREE.MeshStandardMaterial({ map: friezeTex, color: 0xe8b860, roughness: 0.3, metalness: 0.9, alphaTest: 0.5, emissive: 0x5a3008, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    (this.envMats = this.envMats || []).push(frMat);
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - Z0, 1.1), frMat); f.rotation.y = -sx * Math.PI / 2; f.position.set(sx * (HW - 0.06), 7.6, (Z0 + Z1) / 2); s.add(f);
      this.box(0.14, 1.5, Z1 - Z0, dark, sx * (HW - 0.07), 6.85, (Z0 + Z1) / 2, 0, false);
      this.box(0.2, 0.18, Z1 - Z0, gold, sx * (HW - 0.1), 8.55, (Z0 + Z1) / 2, 0, false);
    }
    // the murals and their braziers
    const flame = radialTex('rgba(255,250,230,1)', 'rgba(255,170,80,0.5)');
    for (const p of this.panels) {
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      p.canvas = c; p.tex = new THREE.CanvasTexture(c); p.tex.colorSpace = THREE.SRGBColorSpace; p.tex.anisotropy = 8;
      p.tmp = document.createElement('canvas'); p.mask = document.createElement('canvas'); p.rcan = document.createElement('canvas'); p.rcan.width = TW; p.rcan.height = TH;
      p.rtex = new THREE.CanvasTexture(p.rcan); p.rtex.anisotropy = 8;
      p.t = this.door.done ? 1 : 0; p.drawn = -1;
      const w = p.final ? 9 : 5.6, h = w * TH / TW;
      p.mat = muralMat(p.tex, p.rtex); p.mat.color.setRGB(0.55, 0.5, 0.45); (this.envMats = this.envMats || []).push(p.mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), p.mat);
      const y = p.final ? 4.6 : 3.4;
      if (p.final) { m.position.set(0, y, Z0 + 0.05); }
      else { m.position.set(p.side * (HW - 0.04), y, p.z); m.rotation.y = -p.side * Math.PI / 2; }
      s.add(m); p.mesh = m;
      // the frame
      const fw = w + 0.5, fh = h + 0.5;
      for (const [ox, oy, bw, bh] of [[0, fh / 2, fw, 0.22], [0, -fh / 2, fw, 0.22], [-fw / 2, 0, 0.22, fh], [fw / 2, 0, 0.22, fh]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.16), gold);
        b.position.set(ox, oy, 0.05); m.add(b);
      }
      const inner = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.06, 0.1), dark);   // a shadow-gap moulding between plaster and gold
      for (const oy of [h / 2 + 0.04, -h / 2 - 0.04]) { const q = inner.clone(); q.position.set(0, oy, 0.03); m.add(q); }
      // a brazier below
      const bx = p.final ? 0 : p.side * (HW - 1.1), bz = p.final ? Z0 + 2.2 : p.z;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 0.5, 12), gold); bowl.position.set(bx, 1.05, bz); s.add(bowl);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 0.85, 8), dark); stem.position.set(bx, 0.42, bz); s.add(stem);
      this.colliders.push({ kind: 'circle', x: bx, z: bz, r: 0.6, top: 1.3, bottom: -1 });
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(), color: new THREE.Color(2.4, 1.5, 0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      fl.position.set(bx, 1.75, bz); fl.scale.set(0.8, 1.5, 1); s.add(fl);
      // the glow it throws on the floor and up the wall
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: radialTex(), color: new THREE.Color(1.2, 0.55, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(bx, 0.06, bz); s.add(pool); p.pool = pool;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: new THREE.Color(1.2, 0.6, 0.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      halo.position.set(bx, 1.8, bz); halo.scale.set(6, 6, 1); s.add(halo);
      p.fire = fl; p.halo = halo; p.bpos = new THREE.Vector3(bx, 1.8, bz); p.bx = bx; p.bz = bz; p.lit = p.t;
      this.pois.push({ x: p.final ? 0 : p.side * (HW - 2), y: y, z: p.final ? Z0 + 3 : p.z });
      this._draw(p);
    }
    this.dust = motes(400, { x0: -HW, x1: HW, y0: 0, y1: H, z0: Z0, z1: Z1 }, { color: C('#ffcfa0').multiplyScalar(0.7), size: 0.045, speed: 0.1, seed: 41 });
    s.add(this.dust);
    if (this.door.done) this.complete = true;
  }

  /** Repaint a mural texture: aged plaster, then the vision revealed up to p.t, carved into the relief map. */
  _draw(p) {
    const g = p.canvas.getContext('2d'), rg = p.rcan.getContext('2d');
    g.globalAlpha = 1; g.drawImage(plasterBase(), 0, 0);
    rg.globalAlpha = 1; rg.filter = 'none'; rg.drawImage(reliefBase(), 0, 0);
    if (p.t > 0) {
      drawMural(p.tmp, p.idx, p.t, { w: TW, h: TH });
      g.drawImage(p.tmp, 0, 0);
      p.mask.width = TW; p.mask.height = TH;
      const mg = p.mask.getContext('2d'); mg.drawImage(p.tmp, 0, 0); mg.globalCompositeOperation = 'source-in'; mg.fillStyle = '#fff'; mg.fillRect(0, 0, TW, TH);
      rg.filter = 'blur(1.4px)'; rg.drawImage(p.mask, 0, 0); rg.filter = 'none';
    }
    p.tex.needsUpdate = true; p.rtex.needsUpdate = true;
    p.drawn = p.t;
  }

  onEnter(ctx) {
    this.amb = makeAmbience(ctx.audio, [
      { drone: [43, 50, 55], gain: 0.016, cut: 600 },
      { noise: { type: 'lowpass', freq: 240, q: 0.5 }, gain: 0.035 },
      { noise: { type: 'bandpass', freq: 1400, q: 1.5 }, gain: 0.0 },    // crackle of the braziers
    ]);
    if (!this.complete) ctx.hint('memory', 'These walls remember. <b>Walk close</b> to see.', 6000);
  }

  update(dt, time, ctx) {
    this.tick(time);
    this.doorGlow(time);
    this.dust.userData.tick(time, ctx.camera, ctx.renderer);
    const pp = ctx.player.pos;
    const told = this.panels.filter((p) => !p.final && p.t >= 1).length;
    let redrew = false, fire = 0;
    for (const p of this.panels) {
      const near = p.final ? Math.abs(pp.z - p.z) < 12 && told >= 4 : Math.abs(pp.z - p.z) < 4.5 && Math.abs(pp.x - p.side * HW) < 7;
      if (near && p.t < 1) {
        p.t = Math.min(1, p.t + dt / (p.final ? 9 : 6.5));
        if (p.t >= 1 && this.amb) this.amb.bell(p.final ? 62 : 55 + p.idx * 2, 0.06, 5);
      }
      // repaint at most one mural per frame, only when its reveal moved on
      if (!redrew && p.t - p.drawn > 0.035 || (p.t >= 1 && p.drawn < 1 && !redrew)) { this._draw(p); redrew = true; }
      p.lit += ((p.t > 0 ? 1 : 0) - p.lit) * Math.min(1, dt * 1.5);
      const flick = 0.85 + 0.15 * Math.sin(time * 13 + p.z) * Math.sin(time * 7.3 + p.idx);
      p.fire.material.opacity = p.lit * flick; p.fire.scale.set(0.9 + 0.1 * flick, 1.3 + 0.3 * flick, 1);
      p.halo.material.opacity = 0.45 * p.lit * flick;
      p.pool.material.opacity = 0.55 * p.lit * flick;
      const mu = p.mat.userData.u; mu.uBrazK.value = 2.4 * p.lit * flick; mu.uBrazV.value.copy(p.bpos).applyMatrix4(ctx.camera.matrixWorldInverse);
      const k = 0.55 + 0.5 * smooth(0, 0.3, p.t);
      p.mesh.material.color.setRGB(k * 1.05, k * 0.95, k * 0.85);
      fire += p.lit;
      if (p.lit > 0.5 && Math.random() < dt * 3) ctx.fx.sparkles.emit(p.bx + (Math.random() - .5) * 0.3, 1.7, p.bz + (Math.random() - .5) * 0.3, (Math.random() - .5) * 0.3, 1.2, (Math.random() - .5) * 0.3, 1.2, 0.06, 3, 1.6, 0.6, 0.9, 0.5, -0.3, -0.3);
    }
    if (this.amb) this.amb.set(2, 0.004 * fire);
    const fin = this.panels[4];
    this.oculus.material.uniforms.uIntensity.value += ((told >= 4 ? 0.9 : 0) - this.oculus.material.uniforms.uIntensity.value) * Math.min(1, dt);
    if (told >= 4) ctx.hint('memory-end', 'Light falls on the far wall.', 4000);
    if (fin.t >= 1 && !this.complete) {
      this.complete = true; this.door.done = true;
      ctx.reward.charge(new THREE.Vector3(0, 4, Z0 + 1));
      ctx.hint('memory-done', 'The story is told. Its warmth fills your scarf.', 6000);
    }
    this.pal.exp = 0.95 + 0.05 * fire;
  }

  auto(P) {
    if (this.complete) return null;
    const next = this.panels.find((p) => p.t < 1 && (!p.final || this.panels.filter((q) => !q.final && q.t >= 1).length >= 4));
    if (!next) return null;
    const x = next.final ? 0 : next.side * (HW - 2.4), z = next.final ? Z0 + 6 : next.z + 0.8;
    return { x, z, stop: Math.hypot(P.pos.x - x, P.pos.z - z) < 1.2 };
  }
}
Memory.fadeColor = new THREE.Color(0.12, 0.07, 0.04);
