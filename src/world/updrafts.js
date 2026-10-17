import * as THREE from 'three';
import { rngFor, range, sign } from './seed.js';
import { PLAN } from './layout.js';
import { terrainHeight, pathX, zAtProgress, smooth } from './heightfield.js';
import { clothUniforms, clothFrag } from './cloth.js';

/**
 * Magic wind columns: swirling sand, golden motes and red cloth ribbons spiralling upward. Gliding (or walking)
 * into one carries the traveler high and refills the scarf.
 *
 * Positions come from a function / array of `{ x, z, r?, h? }` so a procedural world can feed its own:
 *   new Updrafts(scene, () => myWorld.updraftSpots())   or   updrafts.setPositions(list)
 * `sample(pos, out)` is what the flight controller calls; it never needs to know where the columns came from.
 */

/** Default spots along the hand-made route: a few in the dunes, one in each plaza of the ruined city, two on the ascent. */
export function defaultUpdraftPositions() {
  const r = rngFor('updrafts');
  const at = (p, dx = 0, dz = 0, rad = 5, h = 40) => { const z = zAtProgress(p) + dz; return { x: pathX(z) + dx, z, r: rad, h }; };
  const pz = PLAN.plazas.map((q) => q.p);
  return [
    at(0.037 + range(r, 0, 0.01), sign(r) * range(r, 12, 20), 0, 5.5, 36),     // just past the first gateway: the first taste of soaring
    at(range(r, 0.10, 0.14), sign(r) * range(r, 14, 24), 0, 5.5, 40),
    at(range(r, 0.18, 0.22), sign(r) * range(r, 14, 24), 0, 5.5, 44),
    at(PLAN.shrines[0].p - 0.025, -Math.sign(PLAN.shrines[0].side) * range(r, 10, 16), 0, 5, 42),   // before the first shrine
    at(pz[0], range(r, -3, 3), 10, 5, 46),     // in each plaza of the ruined city
    at(pz[1], range(r, -3, 3), 10, 4.5, 44),
    at(pz[2], sign(r) * range(r, 10, 16), -12, 5, 48),
    at(range(r, 0.79, 0.82), sign(r) * range(r, 9, 14), 0, 5, 40),     // the ascent, where gusts push you back down
    at(range(r, 0.85, 0.88), sign(r) * range(r, 8, 13), 0, 5, 42),
  ];
}

const POINTS_PER = 340, RIBBONS_PER = 4, RIB_SEG = 40;

const pointVert = /* glsl */`
attribute vec4 aCol; attribute vec4 aSeed; attribute float aR;
uniform float uTime, uScale, uFogD;
varying vec4 vC;
void main() {
  float h = aCol.w;
  float hf = fract(aSeed.y + uTime * (0.05 + 0.07 * aSeed.w) * (40. / h));
  float ang = aSeed.x * 6.2832 + uTime * (0.9 + 1.5 * aSeed.w) + hf * 5.0;
  float rad = aR * (0.2 + 0.95 * aSeed.z) * (0.7 + 0.6 * hf);
  vec3 w = vec3(aCol.x + cos(ang) * rad, aCol.y + hf * h, aCol.z + sin(ang) * rad);
  vec4 mv = viewMatrix * vec4(w, 1.);
  gl_Position = projectionMatrix * mv;
  float gold = step(0.6, aSeed.w);
  float a = smoothstep(0., 0.07, hf) * smoothstep(1., 0.7, hf);
  float dist = -mv.z;
  a *= exp(-pow(dist * uFogD * 1.4, 2.)) * smoothstep(1.5, 5., dist);
  vC = mix(vec4(1.0, 0.8, 0.55, 0.5 * a), vec4(2.6, 1.9, 1.0, 0.95 * a), gold);
  gl_PointSize = clamp(mix(0.42, 0.17, gold) * uScale / max(0.1, dist), 1., 60.);
}`;
const pointFrag = /* glsl */`
precision highp float;
varying vec4 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.;
  float a = smoothstep(1., 0., d);
  gl_FragColor = vec4(vC.rgb, vC.a * a * a);
}`;

const ribbonVert = /* glsl */`
attribute vec2 aTS; attribute vec4 aCol; attribute vec4 aRib;
uniform float uTime;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  float t = aTS.x, s = aTS.y, h = aCol.w, r = aRib.x;
  float len = 0.42;
  float head = fract(aRib.y + uTime * aRib.z * (40. / h));
  float hf = head - (1. - t) * len;
  float ang = aRib.y * 6.2832 + hf * h * 0.32 + uTime * 1.3;
  float rad = r * (0.5 + 0.55 * hf);
  vec3 radial = vec3(cos(ang), 0., sin(ang));
  vec3 c = vec3(aCol.x, aCol.y + hf * h, aCol.z) + radial * rad;
  c += radial * sin(uTime * 4. + t * 18. + aRib.y * 9.) * 0.18;
  float width = aRib.w * sin(3.1416 * t) * smoothstep(0., 0.06, hf) * smoothstep(1., 0.86, hf);
  vec3 across = normalize(vec3(-sin(ang) * 0.35, 1., cos(ang) * 0.35));
  vec3 w = c + across * s * width;
  vW = w; vN = radial; vUv = vec2(s * 0.5 + 0.5, t * 3.); vGlow = 0.55 + 0.25 * sin(uTime * 2. + aRib.y * 7.);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const shaftVert = /* glsl */`
varying vec3 vN; varying vec3 vW; varying float vY;
void main() { vY = uv.y; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const shaftFrag = /* glsl */`
precision highp float;
uniform float uTime, uFogD;
varying vec3 vN; varying vec3 vW; varying float vY;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float side = pow(1. - abs(dot(normalize(vN), V)), 1.5);
  float d = length(cameraPosition - vW);
  float a = side * smoothstep(0., 0.15, vY) * smoothstep(1., 0.55, vY) * 0.34 * smoothstep(3., 14., d) * exp(-pow(d * uFogD, 2.));
  a *= 0.8 + 0.2 * sin(vY * 30. - uTime * 3.);
  gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * a, a);
}`;

export class Updrafts {
  constructor(scene, positions = defaultUpdraftPositions) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cols = [];
    this.pointU = { uTime: { value: 0 }, uScale: { value: 600 }, uFogD: { value: 0.0005 } };
    this.shaftU = { uTime: { value: 0 }, uFogD: { value: 0.0005 } };
    this.setPositions(positions);
  }

  /** Replace the columns. `positions`: array or function returning [{ x, z, r?, h? }]. */
  setPositions(positions) {
    const list = typeof positions === 'function' ? positions() : positions || [];
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry && o.geometry.dispose(); }
    this.cols = list.map((c) => {
      const r = c.r ?? 5, h = c.h ?? 40;
      const y0 = (c.y ?? terrainHeight(c.x, c.z)) - 1.5;
      return { x: c.x, z: c.z, r, h, y0 };
    });
    if (!this.cols.length) return;
    this._buildPoints();
    this._buildRibbons();
    this._buildShafts();
  }

  _buildPoints() {
    const n = this.cols.length * POINTS_PER;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), seed = new Float32Array(n * 4), rr = new Float32Array(n);
    let k = 0;
    for (const c of this.cols) {
      for (let i = 0; i < POINTS_PER; i++, k++) {
        pos[k * 3] = c.x; pos[k * 3 + 1] = c.y0; pos[k * 3 + 2] = c.z;
        col.set([c.x, c.y0, c.z, c.h], k * 4);
        seed.set([Math.random(), Math.random(), Math.random(), Math.random()], k * 4);
        rr[k] = c.r;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aR', new THREE.BufferAttribute(rr, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({ uniforms: this.pointU, vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 4;
    this.group.add(pts);
  }

  _buildRibbons() {
    const nr = this.cols.length * RIBBONS_PER, nv = nr * (RIB_SEG + 1) * 2;
    const pos = new Float32Array(nv * 3), ts = new Float32Array(nv * 2), col = new Float32Array(nv * 4), rib = new Float32Array(nv * 4);
    const ind = [];
    let v = 0;
    for (const c of this.cols) {
      for (let j = 0; j < RIBBONS_PER; j++) {
        const phase = j / RIBBONS_PER + Math.random() * 0.2, speed = 0.05 + Math.random() * 0.03, width = 0.45 + Math.random() * 0.15;
        const base = v;
        for (let i = 0; i <= RIB_SEG; i++) {
          for (const s of [-1, 1]) {
            pos.set([c.x, c.y0, c.z], v * 3);
            ts.set([i / RIB_SEG, s], v * 2);
            col.set([c.x, c.y0, c.z, c.h], v * 4);
            rib.set([c.r * 0.8, phase, speed, width], v * 4);
            v++;
          }
          if (i < RIB_SEG) { const a = base + i * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTS', new THREE.BufferAttribute(ts, 2));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    g.setAttribute('aRib', new THREE.BufferAttribute(rib, 4));
    g.setIndex(ind);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({ uniforms: clothUniforms, vertexShader: ribbonVert, fragmentShader: clothFrag, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  _buildShafts() {
    const m = new THREE.ShaderMaterial({ uniforms: this.shaftU, vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (const c of this.cols) {
      const g = new THREE.CylinderGeometry(c.r * 1.2, c.r * 0.7, c.h, 24, 1, true);
      g.translate(0, c.h / 2, 0);
      const s = new THREE.Mesh(g, m);
      s.position.set(c.x, c.y0, c.z);
      s.renderOrder = 3;
      this.group.add(s);
    }
  }

  /**
   * Lift at a world position. Returns `out` with k (0..1 strength), sx/sz (swirl direction scaled by k) and
   * cx/cz (pull toward the column's axis, 0 at the axis growing to 1 at its rim, scaled by k).
   */
  sample(p, out = { k: 0, sx: 0, sz: 0, cx: 0, cz: 0 }) {
    out.k = 0; out.sx = 0; out.sz = 0; out.cx = 0; out.cz = 0;
    for (const c of this.cols) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const R = c.r * 1.25 + 1.2;
      if (dx * dx + dz * dz > R * R) continue;
      const d = Math.hypot(dx, dz);
      const y = p.y - c.y0;
      const vert = smooth(-3, 0.5, y) * (1 - smooth(c.h - 9, c.h + 2, y));
      const k = (1 - smooth(c.r * 0.55, c.r * 1.25, d)) * vert;
      if (k > out.k || (out.k === 0 && vert > 0)) {
        out.k = k;
        const il = d > 1e-3 ? 1 / d : 0;
        out.sx = -dz * il * k; out.sz = dx * il * k;
        // the pull toward the axis reaches a little past the lift so a drifting traveler is drawn back in
        const pull = Math.min(1.2, d / c.r) * (1 - smooth(c.r * 1.15, R, d)) * vert;
        out.cx = -dx * il * pull; out.cz = -dz * il * pull;
      }
    }
    return out;
  }

  /** Nearest column (for hints / debugging). */
  nearest(p) {
    let best = null, bd = 1e9;
    for (const c of this.cols) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd) { bd = d; best = c; } }
    return best ? { col: best, dist: bd } : null;
  }

  update(dt, time, camera, renderer, env) {
    this.pointU.uTime.value = time; this.shaftU.uTime.value = time;
    const fogD = env && env.pal ? env.pal.fogD : 0.0005;
    this.pointU.uFogD.value = fogD; this.shaftU.uFogD.value = fogD;
    const h = renderer.domElement.height;
    this.pointU.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
