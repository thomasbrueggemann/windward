import * as THREE from 'three';
import { terrainHeight, terrainGradient, pathX, zAtProgress, clamp, smooth } from './heightfield.js';
import { rngFor } from './seed.js';
import { PLAN, onPath, addSite } from './layout.js';
import { makeFloatingCloth, ClothBanner, clothUniforms } from './cloth.js';
import { makeGlyphSprite, makeSoftDot, makeRingTexture } from '../textures.js';

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

const BEAM_GEO = (() => { const g = new THREE.PlaneGeometry(1.6, 70); g.translate(0, 35, 0); return g; })();
function makeBeamTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 256;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 256, 0, 0);
  lg.addColorStop(0, 'rgba(255,240,210,1)'); lg.addColorStop(0.15, 'rgba(255,230,180,0.55)'); lg.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = lg; g.fillRect(0, 0, 32, 256);
  g.globalCompositeOperation = 'destination-in';
  const hg = g.createLinearGradient(0, 0, 32, 0);
  hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hg; g.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Props {
  constructor(scene, ruins, fx) {
    this.scene = scene; this.ruins = ruins; this.fx = fx;
    this.r = rngFor('props');
    this.events = [];
    this._pending = [];
    this._camPos = null;

    // ---------------------------------------------------- collectible glyphs
    this.glyphs = [];
    const gtex = [0, 1, 2, 3, 4, 5].map(makeGlyphSprite);
    const beamTex = makeBeamTexture();
    const ringTex = makeRingTexture();
    const inside = (x, z) => ruins.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r ?? Math.hypot(c.hx, c.hz)) + 2);
    PLAN.glyphs.forEach(({ p, side, up }, i) => {
      // slide toward the path until clear of any stone
      let [x, z] = onPath(p, side);
      for (let k = 0; k < 12 && inside(x, z); k++) x -= side / 12;
      const y = terrainHeight(x, z) + 1.8 + up;
      addSite('glyph', x, z, { y, r: 1, index: i });
      const mat = new THREE.SpriteMaterial({ map: gtex[i % 6], color: new THREE.Color(3.4, 2.7, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const spr = new THREE.Sprite(mat); spr.scale.set(1.7, 1.7, 1); spr.position.set(x, y, z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(1.6, 1.2, 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      halo.scale.set(3.4, 3.4, 1); halo.position.copy(spr.position);
      // a thin pillar of light so the symbol can be spotted from far across the dunes
      const beam = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(2.2, 1.7, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      beam.position.set(x, y, z); beam.renderOrder = 4;
      scene.add(spr, halo, beam);
      this.glyphs.push({ spr, halo, beam, base: new THREE.Vector3(x, y, z), phase: i * 1.7, taken: false, fade: 1 });
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
    for (let z = -70; z > zAtProgress(0.993); z -= 55 + r() * 45) {
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
    const firstPost = ruins.posts.length;
    for (const { p, span } of PLAN.banners) {
      const [x, z] = onPath(p), a = 0.3 * (r() < 0.5 ? -1 : 1) + (r() - .5) * 0.2;
      ruins._postPair(x, z, 0, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), span);
      addSite('banner', x, z, { y: terrainHeight(x, z), r: span / 2 });
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
    /** the banner that teaches singing */
    this.intro = this.banners[firstPost];
    this.updateMatrices();

    // ---------------------------------------------------- shafts of light in the depths
    this.shafts = [];
    const sunC = new THREE.Vector3(-0.2, 0.9, -0.28).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunC);
    const shaftMats = [];
    for (let z = zAtProgress(0.55); z > zAtProgress(0.735); z -= 38 + r() * 14) {
      const cx = ruins._canyonCentre(z) + (r() - .5) * 22;
      const floor = terrainHeight(cx, z);
      const rb = 7 + r() * 4;
      const geo = new THREE.CylinderGeometry(4 + r() * 3, rb, 80, 20, 1, true);
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
      this.shafts.push({ mesh, x: cx, z, r: rb });
      addSite('shaft', cx, z, { y: floor, r: rb });
    }
    this.shaftMats = shaftMats;

    // ---------------------------------------------------- footprints
    const FP = 260;
    const fgeo = new THREE.PlaneGeometry(0.15, 0.32); fgeo.rotateX(-Math.PI / 2);
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

  addFootprint(e) {
    const x = e.x, z = e.z, y = terrainHeight(x, z) + 0.04;
    const g = terrainGradient(x, z);
    const up = this._v.set(-g.x, 1, -g.z).normalize();
    const f = new THREE.Vector3(Math.sin(e.heading), 0, Math.cos(e.heading));
    f.addScaledVector(up, -f.dot(up)).normalize();
    const rgt = new THREE.Vector3().crossVectors(up, f).normalize();
    const mat = this._m.makeBasis(rgt, up, f).setPosition(x, y, z);
    if (e.slide) mat.scale(this._v.set(2.6, 1, 2.2));
    const i = this.footNext; this.footNext = (this.footNext + 1) % this.footN;
    this.foot.setMatrixAt(i, mat); this.foot.instanceMatrix.needsUpdate = true;
    this.footAge.array[i] = 0;
  }

  /** A released, held song: wakes every dormant banner and sets floating cloth glowing within `radius`. */
  wake(p, radius, fx) {
    for (const b of this.banners) {
      if (b.target) continue;
      if (Math.hypot(b.center.x - p.x, b.center.z - p.z) < radius + b.len * 0.35) this._awaken(b, fx);
    }
    for (const pc of this.pieces) if (pc.pos.distanceToSquared(p) < radius * radius) pc.glow = 1;
  }

  _awaken(b, fx) {
    b.target = 1; b.pulse = 1; b.awakened = true;
    this._pending.push({ type: 'awaken', banner: b });
    for (let i = 0; i < 40; i++) {
      const t = Math.random(), px = b.a.x + (b.b.x - b.a.x) * t, pz = b.a.z + (b.b.z - b.a.z) * t;
      fx.sparkles.emit(px, b.center.y + Math.random() * 3, pz, (Math.random() - .5), 1 + Math.random() * 2, (Math.random() - .5), 1.5, 0.2, 3, 1.6, 0.7, 1, 1, 0, -0.4);
    }
  }

  /** @returns events: {type:'glyph'|'awaken'|'recharge'} */
  update(dt, time, player, env, fx) {
    const ev = this.events; ev.length = 0;
    ev.push(...this._pending); this._pending.length = 0;
    clothUniforms.uTime.value = time;
    const pp = player.pos;

    // footsteps
    for (const e of player.events) if (e.type === 'step' && player.grounded) this.addFootprint(e);
    const fa = this.footAge.array; for (let i = 0; i < this.footN; i++) if (fa[i] < 99) fa[i] += dt;
    this.footAge.needsUpdate = true;

    // glyph collectibles
    for (const g of this.glyphs) {
      if (g.taken) {
        g.fade = Math.max(0, g.fade - dt * 3); g.spr.material.opacity = g.halo.material.opacity = g.fade;
        g.beam.material.opacity *= Math.exp(-4 * dt);
        if (g.fade <= 0) { g.spr.visible = g.halo.visible = false; g.beam.visible = g.beam.material.opacity > 0.01; }
        continue;
      }
      const bob = Math.sin(time * 1.6 + g.phase) * 0.25;
      {
        const dd = Math.hypot(g.base.x - pp.x, g.base.z - pp.z);
        const cam = this._camPos;
        g.beam.material.opacity = smooth(12, 40, dd) * (1 - smooth(380, 520, dd)) * (0.55 + 0.15 * Math.sin(time * 2 + g.phase)) * (1 - 0.6 * env.pal.snow);
        g.beam.visible = g.beam.material.opacity > 0.005;
        if (cam) g.beam.rotation.y = Math.atan2(cam.x - g.base.x, cam.z - g.base.z);
      }
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
      if (player.sing > 0.4 && d < 22 + b.len * 0.35 && !b.target) this._awaken(b, fx);
      if (d < 140) b.update(dt, time);
    }

    // shafts
    const cave = env.pal.cave;
    for (const m of this.shaftMats) { m.uniforms.uIntensity.value = cave * 0.55; m.uniforms.uTime.value = time; }
    return ev;
  }
}
