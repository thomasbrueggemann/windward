import * as THREE from 'three';
import { rng } from '../noise.js';
import { terrainHeight, terrainGradient, pathX, zAtProgress, clamp, smooth } from './heightfield.js';
import { makeFloatingCloth, ClothBanner, clothUniforms } from './cloth.js';
import { makeGlyphSprite, makeSoftDot, makeRingTexture } from '../textures.js';

const GLYPH_SPOTS = [
  // [z, lateral offset, extra height]
  [-45, 9, 0], [-150, -16, 1.5], [-285, 30, 0], [-430, -26, 2.5], [-560, 12, 0],
  [-700, 6, 0], [-790, -10, 2], [-905, 18, 0], [-985, -6, 4],
  [-1085, 4, 0], [-1190, -10, 3], [-1300, 12, 0], [-1425, -8, 5],
  [-1625, 10, 0], [-1770, -14, 1], [-1900, 8, 0],
];

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

export class Props {
  constructor(scene, ruins, fx) {
    this.scene = scene; this.ruins = ruins; this.fx = fx;
    this.r = rng(4242);
    this.events = [];

    // ---------------------------------------------------- collectible glyphs
    this.glyphs = [];
    const gtex = [0, 1, 2, 3, 4, 5].map(makeGlyphSprite);
    const ringTex = makeRingTexture();
    GLYPH_SPOTS.forEach(([z, off, up], i) => {
      const x = pathX(z) + off, y = terrainHeight(x, z) + 1.8 + up;
      const mat = new THREE.SpriteMaterial({ map: gtex[i % 6], color: new THREE.Color(3.4, 2.7, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const spr = new THREE.Sprite(mat); spr.scale.set(1.7, 1.7, 1); spr.position.set(x, y, z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(1.6, 1.2, 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      halo.scale.set(3.4, 3.4, 1); halo.position.copy(spr.position);
      scene.add(spr, halo);
      this.glyphs.push({ spr, halo, base: new THREE.Vector3(x, y, z), phase: i * 1.7, taken: false, fade: 1 });
    });

    // ---------------------------------------------------- floating cloth
    this.cloth = makeFloatingCloth(scene, 150);
    this.pieces = [];
    const r = this.r;
    const addPiece = (x, y, z, banner = -1) => {
      const i = this.pieces.length; if (i >= this.cloth.capacity) return;
      this.pieces.push({ pos: new THREE.Vector3(x, y, z), glow: 0, scale: banner >= 0 ? 0 : 1, banner, yaw: r() * 6.28, tilt: (r() - .5) * 0.6 });
      this.cloth.phase.array[i] = r() * 20;
      this.cloth.scale.array[i] = banner >= 0 ? 0 : 1;
      this.cloth.mesh.count = this.pieces.length;
    };
    this.addPiece = addPiece;
    for (let z = -70; z > -2030; z -= 55 + r() * 45) {
      const n = 2 + ((r() * 3) | 0);
      const cx = pathX(z) + (r() - .5) * 36;
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - .5) * 14, zz = z + (r() - .5) * 14;
        // keep pieces off the canyon walls: float just above the local ground
        addPiece(x, terrainHeight(x, zz) + 1.8 + r() * 4.2, zz);
      }
    }
    this.updateMatrices();

    // ---------------------------------------------------- dormant banners (they wake when sung to)
    this.banners = [];
    const extra = [[-140, 24], [-385, 20], [-1700, 22]];
    for (const [z, span] of extra) {
      const x = pathX(z);
      ruins._postPair(x, z, 0, new THREE.Vector3(Math.cos(0.3), 0, Math.sin(0.3)), span);
    }
    ruins.posts.forEach((pp, bi) => {
      const b = new ClothBanner(scene, pp.a, pp.b, 4.4);
      b.index = bi; b.awakened = false;
      b.pieces = [];
      const c = b.center;
      for (let k = 0; k < 4; k++) {
        const ox = (k - 1.5) * 4.5;
        const pi = this.pieces.length;
        addPiece(c.x + b.dir.x * ox, c.y + 4 + (k % 2) * 2.5, c.z + b.dir.z * ox, bi);
        b.pieces.push(pi);
      }
      this.banners.push(b);
    });
    this.updateMatrices();

    // ---------------------------------------------------- shafts of light in the depths
    this.shafts = [];
    const sunC = new THREE.Vector3(-0.2, 0.9, -0.28).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunC);
    const shaftMats = [];
    for (let z = zAtProgress(0.55); z > zAtProgress(0.735); z -= 38 + r() * 14) {
      const cx = ruins._canyonCentre(z) + (r() - .5) * 22;
      const floor = terrainHeight(cx, z);
      const geo = new THREE.CylinderGeometry(4 + r() * 3, 7 + r() * 4, 80, 20, 1, true);
      geo.translate(0, 40, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(2.2, 1.7, 0.9) } },
        vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(cx, floor - 1, z); mesh.quaternion.copy(q);
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      scene.add(mesh);
      shaftMats.push(m);
      this.shafts.push({ mesh, x: cx, z });
    }
    this.shaftMats = shaftMats;

    // ---------------------------------------------------- footprints
    const FP = 140;
    const fgeo = new THREE.PlaneGeometry(0.2, 0.42); fgeo.rotateX(-Math.PI / 2);
    const age = new THREE.InstancedBufferAttribute(new Float32Array(FP).fill(99), 1).setUsage(THREE.DynamicDrawUsage);
    fgeo.setAttribute('iAge', age);
    const fm = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.2, 0.06, 0.03) } },
      vertexShader: `attribute float iAge; varying float vA; varying vec2 vUv; void main(){ vA = iAge; vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; varying float vA; varying vec2 vUv; void main(){ float d = length((vUv - .5) * vec2(2.2, 1.4)); float a = smoothstep(1., .3, d) * 0.38 * (1. - clamp(vA / 70., 0., 1.)); gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.foot = new THREE.InstancedMesh(fgeo, fm, FP);
    this.foot.frustumCulled = false; this.foot.renderOrder = 2;
    this.footAge = age; this.footN = FP; this.footNext = 0; this.footSide = 1;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < FP; i++) this.foot.setMatrixAt(i, zero);
    scene.add(this.foot);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  updateMatrices() {
    const m = this._m || new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.pieces.forEach((p, i) => {
      e.set(p.tilt, p.yaw, 0, 'YXZ'); q.setFromEuler(e);
      m.compose(p.pos, q, new THREE.Vector3(1, 1, 1));
      this.cloth.mesh.setMatrixAt(i, m);
    });
    this.cloth.mesh.instanceMatrix.needsUpdate = true;
    this.cloth.mesh.count = this.pieces.length;
  }

  addFootprint(player) {
    const p = player.pos;
    const side = (this.footSide *= -1);
    const hx = Math.cos(player.heading) * 0.16 * side, hz = -Math.sin(player.heading) * 0.16 * side;
    const x = p.x + hx, z = p.z + hz, y = terrainHeight(x, z) + 0.04;
    const g = terrainGradient(x, z);
    const n = this._v.set(-g.x, 1, -g.z).normalize();
    const up = n.clone();
    const f = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
    f.addScaledVector(up, -f.dot(up)).normalize();
    const rgt = new THREE.Vector3().crossVectors(up, f).normalize();
    const mat = new THREE.Matrix4().makeBasis(rgt, up, f).setPosition(x, y, z);
    const i = this.footNext; this.footNext = (this.footNext + 1) % this.footN;
    this.foot.setMatrixAt(i, mat); this.foot.instanceMatrix.needsUpdate = true;
    this.footAge.array[i] = 0;
  }

  /** @returns events: {type:'glyph'|'awaken'|'recharge'} */
  update(dt, time, player, env, fx) {
    const ev = this.events; ev.length = 0;
    clothUniforms.uTime.value = time;
    const pp = player.pos;

    // footsteps
    for (const e of player.events) if (e === 'step' && player.grounded) this.addFootprint(player);
    const fa = this.footAge.array; for (let i = 0; i < this.footN; i++) if (fa[i] < 99) fa[i] += dt;
    this.footAge.needsUpdate = true;

    // glyph collectibles
    for (const g of this.glyphs) {
      if (g.taken) { g.fade = Math.max(0, g.fade - dt * 3); g.spr.material.opacity = g.halo.material.opacity = g.fade; if (g.fade <= 0) { g.spr.visible = g.halo.visible = false; } continue; }
      const bob = Math.sin(time * 1.6 + g.phase) * 0.25;
      g.spr.position.set(g.base.x, g.base.y + bob, g.base.z);
      g.halo.position.copy(g.spr.position);
      g.halo.material.rotation = time * 0.3;
      const pulse = 1 + 0.07 * Math.sin(time * 3 + g.phase);
      g.spr.scale.set(1.7 * pulse, 1.7 * pulse, 1);
      const d = g.spr.position.distanceTo(pp.clone().setY(pp.y + 1.1));
      if (d < 2.4) {
        g.taken = true; player.addGlyph(); player.flash = 1; ev.push({ type: 'glyph', n: player.glyphs });
        for (let i = 0; i < 46; i++) {
          const a = Math.random() * 6.28, b = (Math.random() - 0.3) * 3, s = 1 + Math.random() * 3;
          fx.sparkles.emit(g.base.x, g.spr.position.y, g.base.z, Math.cos(a) * s, b + 1.5, Math.sin(a) * s, 1.2 + Math.random(), 0.16, 3, 2.4, 1.3, 1, 1.4, 0.4, -0.5);
        }
      }
    }

    // floating cloth: recharge + glow
    let recharging = false;
    const sing = player.sing;
    this.pieces.forEach((p, i) => {
      if (p.banner >= 0) {
        const b = this.banners[p.banner];
        const want = b.awake > 0.55 ? 1 : 0;
        p.scale += (want - p.scale) * (1 - Math.exp(-1.6 * dt));
        this.cloth.scale.array[i] = p.scale;
      }
      if (p.scale < 0.5) return;
      const dx = p.pos.x - pp.x, dy = p.pos.y - (pp.y + 1.0), dz = p.pos.z - pp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let target = 0;
      if (d2 < 6.0 * 6.0) {
        target = 1;
        if (player.charge < 1 && !player.frozen) { player.charge = Math.min(1, player.charge + 2.4 * dt); recharging = true; }
      }
      if (sing > 0.4 && d2 < 30 * 30) target = Math.max(target, 0.9);
      p.glow += (target - p.glow) * (1 - Math.exp(-(target > p.glow ? 6 : 1.2) * dt));
      this.cloth.glow.array[i] = p.glow;
    });
    this.cloth.glow.needsUpdate = true; this.cloth.scale.needsUpdate = true;
    if (recharging && Math.random() < 0.5) {
      const a = player.scarf.pts[1 + ((Math.random() * (player.scarf.n - 1)) | 0)];
      fx.sparkles.emit(a.x, a.y, a.z, 0, 0.6, 0, 0.7, 0.1, 3, 2.3, 1.2, 1, 1, 0, -0.4);
    }
    if (recharging) ev.push({ type: 'recharge' });

    // banners wake when sung to
    for (const b of this.banners) {
      const d = Math.hypot(b.center.x - pp.x, b.center.z - pp.z);
      if (player.sing > 0.4 && d < 22 + b.len * 0.35 && !b.target) {
        b.target = 1; b.pulse = 1; b.awakened = true;
        ev.push({ type: 'awaken', banner: b });
        for (let i = 0; i < 40; i++) {
          const t = Math.random(), px = b.a.x + (b.b.x - b.a.x) * t, pz = b.a.z + (b.b.z - b.a.z) * t;
          fx.sparkles.emit(px, b.center.y + Math.random() * 3, pz, (Math.random() - .5), 1 + Math.random() * 2, (Math.random() - .5), 1.5, 0.2, 3, 1.6, 0.7, 1, 1, 0, -0.4);
        }
      }
      if (d < 140) b.update(dt, time);
    }

    // shafts
    const cave = env.pal.cave;
    for (const m of this.shaftMats) { m.uniforms.uIntensity.value = cave * 0.55; m.uniforms.uTime.value = time; }
    return ev;
  }
}
