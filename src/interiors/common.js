// Shared building blocks for the interiors: the Room base class, materials, light shafts, sand floors,
// interior exit doors and a tiny procedural ambience layer on top of the AudioEngine.
import * as THREE from 'three';
import { makeSandUniforms, makeSandMaterial } from '../world/terrain.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stoneMat, goldMat, makeEnv } from './surface.js';
import { rngFor } from '../world/seed.js';
import { clamp } from '../world/heightfield.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

export { stoneMat };

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function radialTex(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.3, mid); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

/** Vertical gradient (top -> bottom), softened at the sides: the light filling a doorway. */
export function doorLightTex() {
  return canvasTex(64, 256, (g) => {
    const lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, 'rgba(255,255,255,0.75)'); lg.addColorStop(0.55, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = lg; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'destination-in';
    const hg = g.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0.25)'); hg.addColorStop(0.25, 'rgba(0,0,0,1)'); hg.addColorStop(0.75, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
  });
}

// ------------------------------------------------------------------ light shafts (additive soft cones: core + haze, drifting dust)
const beamVert = /* glsl */`
attribute float aLayer;
varying vec2 vUv; varying float vEdge; varying vec3 vW; varying float vL;
void main() {
  vUv = uv; vL = aLayer;
  vec4 wp = modelMatrix * vec4(position, 1.);
  vW = wp.xyz;
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vEdge = abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const beamFrag = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uTime, uIntensity, uTop, uBottom;
varying vec2 vUv; varying float vEdge; varying vec3 vW; varying float vL;
float hb(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float nb(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hb(i), hb(i+vec2(1,0)), f.x), mix(hb(i+vec2(0,1)), hb(i+vec2(1,1)), f.x), f.y); }
void main() {
  float core = 1. - vL;
  float e = pow(vEdge, mix(1.1, 2.1, core));
  float along = smoothstep(0., uBottom, vUv.y) * smoothstep(1., 1. - uTop, vUv.y) * (0.4 + 0.6 * vUv.y);
  // slow sheets and streaks of dust crossing the beam
  vec2 q = vec2(vUv.x * 11., vUv.y * 2.6 - uTime * 0.04);
  float n = nb(q + vec2(sin(vUv.y * 5. - uTime * 0.07), cos(vUv.x * 9. + uTime * 0.05)) * 0.8) * 0.65 + nb(vec2(vUv.x * 40., vUv.y * 9. - uTime * 0.1)) * 0.35;
  float dens = 0.45 + 1.0 * n;
  // single grains catching the light
  vec2 cell = vec2(vUv.x * 90., vUv.y * 160. - uTime * 0.35);
  float hh = hb(floor(cell)), gl = step(0.955, hh) * smoothstep(0.4, 0., length(fract(cell) - 0.5)) * (0.5 + 0.5 * sin(uTime * 2.3 + hh * 80.));
  float near = smoothstep(0.4, 3.5, distance(cameraPosition, vW));
  float a = e * along * dens * uIntensity * mix(0.45, 1., core) * near;
  float g = gl * e * along * uIntensity * 0.9 * core * near;
  gl_FragColor = vec4(uColor * (a + g * 2.2), a + g);
}`;
/** A soft shaft of light from `top` down to `bottom` (Vector3s), radius r0 at the top, r1 at the bottom. */
export function lightShaft(top, bottom, r0, r1, color, intensity = 1, { topFade = 0.08, bottomFade = 0.12, haze = true } = {}) {
  const len = top.distanceTo(bottom);
  const mk = (k, layer) => {
    const g = new THREE.CylinderGeometry(r0 * k, r1 * k, len, 24, 1, true);
    g.translate(0, -len / 2, 0);
    g.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(layer), 1));
    return g;
  };
  const geo = haze ? mergeGeometries([mk(1, 0), mk(1.55, 1)]) : mk(1, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uIntensity: { value: intensity }, uTop: { value: topFade }, uBottom: { value: bottomFade } },
    vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(top);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bottom.clone().sub(top).normalize());
  m.renderOrder = 3; m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------ sand floors (the open world's sand shader)
/** A heightfield mesh over [x0,x1]x[z0,z1] from `fn(x, z)`, shaded like the dunes outside; `keep(x, z)` trims it. */
export function sandFloor(fn, x0, x1, z0, z1, step = 0.5, keep = null) {
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), tr = new Float32Array(nx * nz);
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hs[j * nx + i] = fn(x0 + i * step, z0 + j * step);
  const H = (i, j) => hs[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const o = j * nx + i;
    pos[o * 3] = x0 + i * step; pos[o * 3 + 1] = hs[o]; pos[o * 3 + 2] = z0 + j * step;
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
    const il = 1 / Math.hypot(dx, 1, dz);
    nor[o * 3] = -dx * il; nor[o * 3 + 1] = il; nor[o * 3 + 2] = -dz * il;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (keep && !keep(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aTrench', new THREE.BufferAttribute(tr, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const u = makeSandUniforms();
  const mat = makeSandMaterial(u);
  detailSand(mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.userData.sandU = mat.uniforms;
  return mesh;
}

// extra ripple detail, sparkle and wall occlusion for the indoor sand (patched into the open world's sand shader; no-ops if it changed)
const sandDecl = /* glsl */`
uniform vec4 uWall; uniform vec3 uCirc; uniform float uWallK;
float jh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec2 jh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float jv(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(jh(i), jh(i+vec2(1,0)), f.x), mix(jh(i+vec2(0,1)), jh(i+vec2(1,1)), f.x), f.y); }
vec3 roomDetail(vec3 N, vec3 P, float dist){
  float near = 1. - smoothstep(8., 55., dist);
  vec2 wd = normalize(vec2(0.86, 0.5));
  float warp = (jv(P.xz * 0.31) - 0.5) * 3.4 + (jv(P.xz * 1.3) - 0.5) * 0.8;
  float s = dot(P.xz, wd) * 15. + warp * 2.;
  float r1 = cos(s - 0.9 * sin(s)) * (1. - 0.75 * cos(s));
  vec2 wd2 = vec2(-wd.y, wd.x);
  float s2 = dot(P.xz, wd2) * 31. + (jv(P.xz * 0.9) - 0.5) * 9.;
  float r2 = cos(s2 - 0.6 * sin(s2));
  float patch_ = smoothstep(0.25, 0.7, jv(P.xz * 0.12 + 3.));
  N.xz -= wd * r1 * 0.05 * near * (0.35 + 0.65 * patch_) + wd2 * r2 * 0.016 * near * patch_;
  vec2 g = vec2(jh(floor(P.xz * 70.)), jh(floor(P.xz * 70.) + 4.2)) - 0.5;
  N.xz += g * 0.05 * near;
  return normalize(N);
}
float roomSparkle(vec2 pxz, vec3 H, vec3 Ng, float dist){
  float acc = 0.;
  for (int i = 0; i < 2; i++) {
    float cs = i == 0 ? 0.04 : 0.1;
    vec2 cell = floor(pxz / cs), r = jh2(cell + float(i) * 7.3);
    float present = step(i == 0 ? 0.9 : 0.94, jh(cell + 5.1 + float(i)));
    vec3 rn = normalize(Ng + (vec3(r.x, jh(cell + 1.7), r.y) - 0.5) * vec3(1.7, 0.9, 1.7));
    float tw = 0.45 + 0.55 * sin(uTime * (1.5 + 3. * r.x) + r.y * 40.);
    acc += present * pow(clamp(dot(rn, H), 0., 1.), 160.) * tw * (i == 0 ? 1. : 1.6);
  }
  return acc * (1. - smoothstep(9., 38., dist));
}
float roomAO(vec2 p){
  float d = uWallK > 0. ? (uCirc.z > 0. ? uCirc.z - length(p - uCirc.xy) : min(min(p.x - uWall.x, uWall.y - p.x), min(p.y - uWall.z, uWall.w - p.y))) : 9.;
  d += (jv(p * 0.8) - 0.5) * 0.8;
  return 1. - uWallK * (1. - smoothstep(0., 3.4, d));
}
`;
function detailSand(mat) {
  mat.uniforms.uWall = { value: new THREE.Vector4(-1e3, 1e3, -1e3, 1e3) }; mat.uniforms.uCirc = { value: new THREE.Vector3(0, 0, 0) }; mat.uniforms.uWallK = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    let f = sh.fragmentShader;
    f = f.replace(/void\s+main\s*\(\s*\)\s*\{/, sandDecl + 'void main(){');
    f = f.replace('vec3 N = rippleNormal(Ng, vWorld, dist);', 'vec3 N = rippleNormal(Ng, vWorld, dist); N = roomDetail(N, vWorld, dist);');
    f = f.replace('// --- aerial perspective', 'col *= roomAO(vWorld.xz);\n  // --- aerial perspective');
    f = f.replace('col = col + spec * (1. - snowAmt * 0.5) + glitter;', 'col = col + spec * (1. - snowAmt * 0.5) + glitter + uGlit * roomSparkle(vWorld.xz, H, Ng, dist) * 3.2 * uGlitterGain * (0.3 + 0.7 * tone);');
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'jsandx1';
}

/** Light a sand floor from a room palette ({sunDir, sunC, sunI, lit, hi, shade, rim, glit, fog, amb, fogD}). */
export function lightSand(u, p) {
  // under a roof the floor is lit by bounce light from low angles; the pools under the shafts carry the sun
  u.uSunDir.value.copy(p.floorSun || p.sunDir);
  u.uSunColor.value.copy(p.sunC).multiplyScalar(p.sunI * 0.4 * (p.floorSunK ?? 1));
  u.uLit.value.copy(p.lit); u.uHi.value.copy(p.hi); u.uShade.value.copy(p.shade);
  u.uRim.value.copy(p.rim); u.uGlit.value.copy(p.glit); u.uFog.value.copy(p.fog); u.uAmb.value.copy(p.amb);
  u.uFogD.value = p.fogD; u.uGlitterGain.value = p.glitter ?? 1; u.uCave.value = p.pools ? 1 : 0;
  if (p.rock) u.uRock.value.copy(p.rock);
}

export function disposeScene(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (seen.has(m)) continue; seen.add(m);
      for (const k in m) { const v = m[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k].value; if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } }
      m.dispose();
    }
  });
}

// ------------------------------------------------------------------ ambience
/**
 * Room tone built on the AudioEngine's context: looping filtered noise beds and soft drones, faded in on entry and
 * released on exit. `layers`: [{ noise: {type, freq, q}, gain, lfo? } | { drone: [midi...], type, gain, cut }].
 */
export function makeAmbience(audio, layers) {
  if (!audio || !audio.ready || !audio.ctx) return null;
  const ctx = audio.ctx, t = ctx.currentTime, nodes = [], gains = [];
  const out = ctx.createGain(); out.gain.value = 0; out.connect(audio.ambBus);
  for (const L of layers) {
    const g = ctx.createGain(); g.gain.value = L.gain; g.connect(out); gains.push(g);
    if (L.noise) {
      const s = audio._noiseSrc(); const f = ctx.createBiquadFilter();
      f.type = L.noise.type; f.frequency.value = L.noise.freq; f.Q.value = L.noise.q ?? 0.7;
      s.connect(f); f.connect(g); s.start(); nodes.push(s);
      if (L.lfo) { const o = ctx.createOscillator(); o.frequency.value = L.lfo.rate; const og = ctx.createGain(); og.gain.value = L.lfo.depth; o.connect(og); og.connect(f.frequency); o.start(); nodes.push(o); }
      L.filter = f;
    } else if (L.drone) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = L.cut ?? 900; f.connect(g);
      for (const m of L.drone) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = L.type || 'sine'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); o.detune.value = det;
        o.connect(f); o.start(); nodes.push(o);
      }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09 + Math.random() * 0.05; const lg = ctx.createGain(); lg.gain.value = L.gain * 0.4;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(); nodes.push(lfo);
    }
  }
  out.gain.setTargetAtTime(1, t, 1.2);
  return {
    out, gains, layers,
    set(i, v) { gains[i] && gains[i].gain.setTargetAtTime(v, ctx.currentTime, 0.4); },
    bell(midi, vol = 0.05, dur = 3) { audio._bell(midi, ctx.currentTime + Math.random() * 0.05, vol, dur, audio.ambBus); },
    stop() {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, 0.35);
      for (const n of nodes) { try { n.stop(now + 2.5); } catch (e) { /* already stopped */ } }
      setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } }, 3000);
    },
  };
}

// ------------------------------------------------------------------ rooms
/** Default look; each room overrides what it needs. */
export function basePalette() {
  return {
    sunDir: V(0.3, 0.9, 0.25), sunC: C('#fff0d8'), sunI: 2.4, amb: C('#8a90b8'), grd: C('#a07850'),
    fog: C('#d8b890'), fogD: 0.012, bg: C('#2a1c14'), exp: 1.0, bloom: 0.5, bloomRadius: 0.7, bloomThreshold: 1.15,
    rays: 0, raysColor: C('#ffd8a0'), raysThreshold: 1.25, sat: 1.1, contrast: 1.06, vignette: 0.38, vigColor: C('#3a2014'),
    shadowTint: C('#000008'), highTint: C('#050200'), grain: 0.025, fade: C('#fff6e6'), mood: 5, indoor: 1,
    lit: C('#ffb44a'), hi: C('#fff0b8'), shade: C('#5a1208'), rim: C('#ffe6b8'), glit: C('#fff4d8'), rock: C('#5a4a42'),
    dust: { color: C('#ffe0b0'), amount: 0.35, size: 0.06, opacity: 0.5 }, sand: C('#ffcf90'),
  };
}

export class Room {
  /** door: the door record (index, kind, chapter...); name: shown on entry. */
  constructor(door, kind, name) {
    this.door = door; this.kind = kind; this.name = name;
    this.rng = rngFor(`interior:${door.index}:${kind}`);
    this.scene = new THREE.Scene();
    this.pal = basePalette();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.01);
    // exactly one directional + one hemisphere light, like the open world, so no material needs recompiling inside
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.2);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.colliders = [];
    this.exits = [];          // [{x, z, hx, hz, y0, y1}] walk into one to leave
    this.pois = [];           // points companions drift over to look at
    this.bounds = null;       // {circle: r, cx, cz} or {x0, x1, z0, z1}
    this.ceiling = Infinity;
    this.camDist = 6.5; this.camHeight = 1.4; this.camPitch = 0.16;
    this.spawn = { x: 0, z: 0, heading: Math.PI };
    this.probeY = 1;          // the height the ground is asked for (lets cloth platforms stack)
    this.ledges = false;
    this.sandFloors = [];
    this.shafts = [];
    this.updrafts = null;
    this.amb = null;
    this.complete = false;
  }

  // ---------------------------------------------------------------- ground and walls
  height(/* x, z, y */) { return 0; }

  /** Keep a body (Player) inside the room's walls. */
  clampBody(P, r = 0.45) {
    const p = P.pos, v = P.vel, b = this.bounds;
    if (!b) return;
    if (b.circle) {
      const dx = p.x - (b.cx || 0), dz = p.z - (b.cz || 0), d = Math.hypot(dx, dz), R = b.circle - r;
      if (d > R) {
        const nx = dx / d, nz = dz / d;
        p.x = (b.cx || 0) + nx * R; p.z = (b.cz || 0) + nz * R;
        const vn = v.x * nx + v.z * nz; if (vn > 0) { v.x -= vn * nx; v.z -= vn * nz; }
      }
    } else {
      if (p.x < b.x0 + r) { p.x = b.x0 + r; v.x = Math.max(0, v.x); }
      if (p.x > b.x1 - r) { p.x = b.x1 - r; v.x = Math.min(0, v.x); }
      if (p.z < b.z0 + r) { p.z = b.z0 + r; v.z = Math.max(0, v.z); }
      if (p.z > b.z1 - r) { p.z = b.z1 - r; v.z = Math.min(0, v.z); }
    }
    if (p.y > this.ceiling - 2) { p.y = this.ceiling - 2; v.y = Math.min(0, v.y); }
  }

  /** Keep the camera inside the walls and under the roof. */
  clampCam(pos) {
    const b = this.camBounds || this.bounds, m = 0.35;
    if (b && b.circle) {
      const dx = pos.x - (b.cx || 0), dz = pos.z - (b.cz || 0), d = Math.hypot(dx, dz), R = b.circle - m;
      if (d > R) { pos.x = (b.cx || 0) + dx / d * R; pos.z = (b.cz || 0) + dz / d * R; }
    } else if (b) {
      pos.x = clamp(pos.x, b.x0 + m, b.x1 - m); pos.z = clamp(pos.z, b.z0 + m, b.z1 - m);
    }
    if (pos.y > this.ceiling - 0.5) pos.y = this.ceiling - 0.5;
  }

  inExit(p) {
    for (const e of this.exits) {
      if (Math.abs(p.x - e.x) < e.hx && Math.abs(p.z - e.z) < e.hz && p.y > (e.y0 ?? -1e9) && p.y < (e.y1 ?? 1e9)) return e;
    }
    return null;
  }

  lookTarget(P) {
    let best = null, bd = 16;
    for (const q of this.pois) { const d = Math.hypot(q.x - P.pos.x, q.z - P.pos.z); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  // ---------------------------------------------------------------- per frame (rooms override)
  update(/* dt, time, ctx */) {}
  /** A song (the player's or a companion's) sung at `pos` reaching `r` metres. */
  onSong(/* pos, r, big, ctx */) {}
  /** ?auto: where to go next ({x, z, sing, jump, glide, dive}) or null when done (then the controller heads out). */
  auto(/* P, ctx */) { return null; }
  onEnter(/* ctx */) {}
  onExit() { if (this.amb) { this.amb.stop(); this.amb = null; } }

  /** Shared per-frame light: sand floors, shafts' shimmer. */
  tick(time) {
    for (const f of this.sandFloors) { lightSand(f.userData.sandU, this.pal); f.userData.sandU.uTime.value = time; }
    for (const s of this.shafts) s.material.uniforms.uTime.value = time;
  }

  addSand(mesh, wallK = 0.4) {
    this.sandFloors.push(mesh); this.scene.add(mesh); lightSand(mesh.userData.sandU, this.pal);
    const u = mesh.userData.sandU, b = this.bounds;
    if (b && u.uWall) { if (b.circle) u.uCirc.value.set(b.cx || 0, b.cz || 0, b.circle); else u.uWall.value.set(b.x0, b.x1, b.z0, b.z1); u.uWallK.value = wallK; }
    return mesh;
  }
  /** Gold trim, lit by the room's little environment (set in prepare()). */
  gold(o) { const m = goldMat(null, o); (this.envMats = this.envMats || []).push(m); return m; }
  /** Called once with the renderer before the first compile: builds the environment the metals reflect. */
  prepare(renderer) {
    const P = this.pal, e = P.env || {};
    this.envRT = makeEnv(renderer, { top: e.top || P.bg.clone().multiplyScalar(1.2), hor: e.hor || P.fog.clone().multiplyScalar(1.1), bot: e.bot || P.sand.clone().multiplyScalar(0.55), sun: e.sun || P.sunC.clone().multiplyScalar(P.sunI * 0.55), sunDir: P.sunDir });
    for (const m of this.envMats || []) { m.envMap = this.envRT.texture; m.needsUpdate = true; }
  }
  addShaft(m) { this.shafts.push(m); this.scene.add(m); return m; }

  /** A box mesh (+ optional collider). rotY in radians; y is the bottom. */
  box(w, h, d, mat, x, y, z, rotY = 0, solid = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.geometry.translate(0, h / 2, 0);
    m.position.set(x, y, z); m.rotation.y = rotY;
    this.scene.add(m);
    if (solid) this.colliders.push({ kind: 'box', x, z, hx: w / 2, hz: d / 2, rot: -rotY, top: y + h, bottom: y - 0.5 });
    return m;
  }
  column(x, z, y, r, h, mat, solid = true, segs = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, h, segs), mat);
    m.geometry.translate(0, h / 2, 0); m.position.set(x, y, z);
    this.scene.add(m);
    if (solid) this.colliders.push({ kind: 'circle', x, z, r: r + 0.05, top: y + h, bottom: y - 0.5 });
    return m;
  }

  /**
   * The way back out: an opening at (x, z) in a wall facing -Z (into the room), filled with the light of the world
   * outside. Walking into it leaves. Returns the group.
   */
  exitDoor(x, z, { w = 2.2, h = 3.8, depth = 1.6, color = C('#ffe8c8'), frameMat = null, y = 0, rot = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot;
    const light = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: doorLightTex(), color: color.clone().multiplyScalar(2.4), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    light.position.set(0, h / 2, depth);
    g.add(light);
    // light spilling onto the floor in front of the opening
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(w * 3, 6), new THREE.MeshBasicMaterial({
      map: radialTex(), color: color.clone().multiplyScalar(0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    spill.rotation.x = -Math.PI / 2; spill.position.set(0, 0.12, -0.8);
    g.add(spill);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: color.clone().multiplyScalar(0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.scale.set(w * 3.2, h * 1.6, 1); halo.position.set(0, h * 0.55, depth - 0.3);
    g.add(halo);
    if (frameMat) {
      const t = 0.5;
      for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.BoxGeometry(t, h + 0.4, 0.8), frameMat); j.position.set(s * (w / 2 + t / 2), (h + 0.4) / 2, 0); g.add(j); }
      const l = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * t + 0.4, 0.55, 1.0), frameMat); l.position.set(0, h + 0.4 + 0.27, 0); g.add(l);
    }
    this.scene.add(g);
    // the opening's sides stop the traveler; the light at its back is the threshold
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const W = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const s of [-1, 1]) { const [cx, cz] = W(s * (w / 2 + 0.3), depth / 2); this.colliders.push({ kind: 'box', x: cx, z: cz, hx: 0.3, hz: depth / 2 + 0.2, rot: -rot, top: y + h + 1, bottom: y - 1 }); }
    { const [cx, cz] = W(0, depth + 0.35); this.colliders.push({ kind: 'box', x: cx, z: cz, hx: w / 2 + 0.3, hz: 0.3, rot: -rot, top: y + h + 1, bottom: y - 1 }); }
    const [ex, ez] = W(0, depth * 0.62);
    const ax = Math.abs(cs) > 0.7;
    this.exits.push({ x: ex, z: ez, hx: ax ? w / 2 - 0.15 : depth * 0.4, hz: ax ? depth * 0.4 : w / 2 - 0.15, y0: y - 1, y1: y + h });
    g.userData.light = light; g.userData.halo = halo; g.userData.base = color.clone();
    this.doorFx = this.doorFx || [];
    this.doorFx.push(g);
    return g;
  }

  /** Brighten the way out once the room's gift is found (and breathe gently otherwise). */
  doorGlow(time) {
    if (!this.doorFx) return;
    const k = (this.complete ? 1.35 : 1) * (0.92 + 0.08 * Math.sin(time * 1.4));
    for (const g of this.doorFx) {
      g.userData.light.material.color.copy(g.userData.base).multiplyScalar(2.4 * k);
      g.userData.halo.material.opacity = 0.75 * k;
    }
  }

  dispose() {
    this.onExit();
    if (this.updrafts) this.updrafts = null;
    disposeScene(this.scene);
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
  }
}

/** Points shimmering in a box (motes in sunbeams, fireflies, star dust); one draw call, animated on the GPU. */
export function motes(n, box, { color = new THREE.Color(1, 0.9, 0.7), size = 0.08, speed = 0.15, seed = 1, rise = 0 } = {}) {
  const r = rngFor('motes' + seed);
  const pos = new Float32Array(n * 3), sd = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = box.x0 + (box.x1 - box.x0) * r(); pos[i * 3 + 1] = box.y0 + (box.y1 - box.y0) * r(); pos[i * 3 + 2] = box.z0 + (box.z1 - box.z0) * r();
    sd[i * 4] = r(); sd[i * 4 + 1] = r(); sd[i * 4 + 2] = r(); sd[i * 4 + 3] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const u = { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: color.clone() }, uSize: { value: size }, uSpeed: { value: speed }, uRise: { value: rise }, uH: { value: box.y1 - box.y0 }, uY0: { value: box.y0 }, uAlpha: { value: 1 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uScale, uSize, uSpeed, uRise, uH, uY0;
      varying float vA, vG;
      void main() {
        vec3 p = position;
        float t = uTime * uSpeed;
        p.x += sin(t * (0.7 + aSeed.x) + aSeed.y * 30.) * 0.8;
        p.z += cos(t * (0.6 + aSeed.z) + aSeed.x * 30.) * 0.8;
        p.y = uY0 + mod(p.y - uY0 + uTime * uRise * (0.5 + aSeed.w) + sin(t + aSeed.z * 20.) * 0.4, uH);
        vec4 mv = viewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        vA = (0.4 + 0.6 * sin(uTime * (1.0 + 2.0 * aSeed.w) + aSeed.y * 40.) * 0.5 + 0.5) * smoothstep(0.5, 2.5, -mv.z);
        vG = pow(0.5 + 0.5 * sin(uTime * (2. + 5. * aSeed.z) + aSeed.x * 90.), 14.);   // brief glints as a grain turns to the light
        gl_PointSize = clamp(uSize * (0.6 + aSeed.x) * uScale / max(0.1, -mv.z), 1., 30.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; uniform vec3 uColor; uniform float uAlpha; varying float vA, vG;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.; float a = smoothstep(1., 0., d); float core = smoothstep(0.35, 0., d); gl_FragColor = vec4(uColor * (a * 0.7 + core * (0.8 + vG * 3.5)) * vA * uAlpha, a * vA * uAlpha); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.renderOrder = 4;
  pts.userData.tick = (time, camera, renderer) => {
    u.uTime.value = time;
    u.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  return pts;
}

export { C, V };
