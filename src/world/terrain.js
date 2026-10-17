import * as THREE from 'three';
import { terrainHeight, terrainHeightFar, trenchAmount, WIND } from './heightfield.js';

export const CHUNK = 64;
const N = 48;                 // quads per chunk edge
const STEP = CHUNK / N;
const RADIUS = 7;             // chunks kept around the traveler
const SKIRT = 9;

// ---------------------------------------------------------------- sand shader
const vert = /* glsl */`
attribute float aTrench;
varying vec3 vWorld;
varying vec3 vN;
varying float vTrench;
void main() {
  vWorld = position;
  vN = normal;
  vTrench = aTrench;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */`
precision highp float;
uniform vec3 uSunDir, uSunColor, uLit, uHi, uShade, uRim, uGlit, uFog, uRock, uSnowCol, uAmb;
uniform float uFogD, uSnow, uCave, uTime, uGlitterGain, uFogTint;
uniform vec2 uWind;
uniform vec4 uPools[10];
uniform vec3 uPoolColor;
varying vec3 vWorld;
varying vec3 vN;
varying float vTrench;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float sat(float x){ return clamp(x, 0., 1.); }

float glitterLayer(vec2 pxz, float cs, vec3 H, vec3 N){
  vec2 cell = floor(pxz / cs);
  vec2 r = hash22(cell);
  float present = step(0.82, hash12(cell + 17.3));
  vec3 rn = normalize(N + (vec3(r.x, hash12(cell + 3.1), r.y) - 0.5) * vec3(1.5, 1.0, 1.5));
  return present * pow(sat(dot(rn, H)), 140.);
}

vec3 rippleNormal(vec3 N, vec3 P, float dist){
  float near = 1. - smoothstep(18., 120., dist);
  float mid  = 1. - smoothstep(90., 600., dist);
  vec2 wd = normalize(uWind);
  float steep = smoothstep(0.10, 0.42, 1. - N.y);
  vec2 dirDown = normalize(N.xz + 1e-4);

  // wind ripples: crests perpendicular to the wind, bent by low-frequency noise
  float s = dot(P.xz, wd);
  float warp = (vnoise(P.xz * 0.09) - .5) * 2.6 + (vnoise(P.xz * 0.42) - .5) * 0.7;
  float r = (s + warp) * 9.5;
  float d1 = cos(r - 0.8 * sin(r)) * (1. - 0.8 * cos(r));
  // contour ripples follow the height on steep faces
  float rc = (P.y + (vnoise(P.xz * 0.09) - .5) * 5.0 + (vnoise(P.xz * 0.5) - .5) * 0.6) * 6.5;
  float d2 = cos(rc - 0.8 * sin(rc)) * (1. - 0.8 * cos(rc));

  float rpatch = smoothstep(0.30, 0.62, vnoise(P.xz * 0.045 + 7.));
  float a1 = (1. - steep * 0.35) * d1 * 0.055 * near * rpatch;
  float a2 = 0.;
  // larger, softer ripples that survive in the distance
  float rm = (s + warp * 2.) * 1.9;
  float d3 = cos(rm - 0.7 * sin(rm)) * (1. - 0.7 * cos(rm));
  float a3 = d3 * 0.035 * mid * (1. - steep * 0.6);

  float sn = 1. + uSnow * 0.5;
  vec3 n = N;
  n.xz -= wd * (a1 + a3) * sn;
  n.xz += dirDown * a2;
  // fine grain
  vec2 gr = vec2(hash12(floor(P.xz * 38.)), hash12(floor(P.xz * 38.) + 9.7)) - .5;
  n.xz += gr * 0.06 * near;
  return normalize(n);
}

void main(){
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 Ng = normalize(vN);
  vec3 N = rippleNormal(Ng, vWorld, dist);
  vec3 L = normalize(uSunDir);

  // --- phenomenological diffuse: high contrast between warm lit side and saturated shadow side
  float d = sat(dot(N, L) * .5 + .5);
  float dg = sat(dot(Ng, L) * .5 + .5);
  float tone = smoothstep(0.46, 0.68, mix(dg, d, 0.5));
  vec3 sand = mix(uShade, uLit, tone);
  sand = mix(sand, uHi, smoothstep(0.80, 1.0, d) * 0.30);
  sand += uAmb * 0.045;
  float cv = vnoise(vWorld.xz * 0.004) * 0.6 + vnoise(vWorld.xz * 0.021) * 0.4;
  sand *= mix(vec3(0.94, 0.88, 0.86), vec3(1.07, 1.01, 0.90), cv);

  // --- rock on steep faces, snow on heights / in the cold
  float rockAmt = smoothstep(0.86, 0.58, Ng.y);
  float strata = .5 + .5 * sin(vWorld.y * 0.8 + vnoise(vWorld.xz * 0.05) * 5.);
  vec3 rock = uRock * (0.30 + 0.9 * tone) * (0.85 + 0.25 * strata);
  float snowHigh = smoothstep(470., 640., vWorld.y + 45. * vnoise(vWorld.xz * 0.012)) * (1. - 0.75 * rockAmt);
  float snowAmt = max(uSnow * (1. - 0.55 * rockAmt), snowHigh);
  vec3 snow = mix(uSnowCol * vec3(0.36, 0.47, 0.8), uSnowCol * 0.95, smoothstep(0.5, 0.82, mix(dg, d, 0.6)));
  vec3 col = mix(sand, rock, rockAmt);
  col = mix(col, snow, snowAmt);

  // --- canyon darkness
  col *= mix(1., 0.40, vTrench * uCave);

  // --- specular layers: rim + "ocean" sheen, plus glitter
  vec3 H = normalize(L + V);
  float ndh = sat(dot(normalize(mix(Ng, N, 0.12)), H));
  float ocean = pow(ndh, 60.) * 0.9 + pow(ndh, 9.) * 0.05;
  float lit = smoothstep(0.0, 0.35, dot(Ng, L));
  ocean *= lit * (1. - rockAmt * 0.8);
  float fres = pow(1. - sat(dot(N, V)), 3.2);
  vec3 rim = uRim * fres * (0.25 + 0.75 * tone) * 0.55 * (1. - 0.35 * uCave);
  vec3 spec = max(uSunColor * ocean * 0.55, rim);

  float lod = log2(max(dist * 0.0016, 0.012));
  float l0 = floor(lod), f = lod - l0;
  float g = (1. - f) * glitterLayer(vWorld.xz, exp2(l0), H, Ng) + f * glitterLayer(vWorld.xz, exp2(l0 + 1.), H, Ng);
  vec3 glitter = uGlit * g * 4.5 * uGlitterGain * (0.30 + 0.70 * tone) * (1. - rockAmt);

  col = col + spec * (1. - snowAmt * 0.5) + glitter;

  // --- warm pools where shafts of light reach the canyon floor
  if (uCave > 0.01) {
    float pool = 0.;
    for (int i = 0; i < 10; i++) {
      vec4 pl = uPools[i];
      if (pl.w <= 0.) continue;
      float d = length(vWorld.xz - pl.xy) / pl.z;
      pool += pl.w * (exp(-d * d * 2.5) + 0.12 * exp(-d * d * 0.5));
    }
    pool = min(pool, 1.2) * uCave;
    col = col * (1. + pool * 0.6) + uPoolColor * pool * (0.12 + 0.3 * tone) + uPoolColor * g * pool * 3.;
  }

  // --- aerial perspective (haze warms toward the sun)
  float fogF = 1. - exp(-pow(dist * uFogD, 2.));
  float sunAmt = pow(sat(dot(-V, L)), 5.);
  vec3 fogCol = uFog + uSunColor * sunAmt * 0.07;
  fogCol = mix(fogCol, uAmb * 0.9 + uFog * 0.25, uFogTint * smoothstep(0.1, 0.8, fogF));
  // valleys hold more haze
  fogF = sat(fogF + (1. - exp(-max(0., 18. - vWorld.y) * 0.004)) * 0.0);
  col = mix(col, fogCol, fogF);

  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSandUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(-0.6, 0.4, -0.6) },
    uSunColor: { value: new THREE.Color() },
    uLit: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() }, uGlit: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
    uRock: { value: new THREE.Color('#5a4a42') }, uSnowCol: { value: new THREE.Color('#eef4fb') }, uAmb: { value: new THREE.Color() },
    uFogD: { value: 0.0005 }, uFogTint: { value: 0 }, uSnow: { value: 0 }, uCave: { value: 0 }, uTime: { value: 0 }, uGlitterGain: { value: 1 },
    uWind: { value: new THREE.Vector2(WIND.x, WIND.z) },
    uPools: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) }, uPoolColor: { value: new THREE.Color(1.0, 0.62, 0.28) },
  };
}

export function makeSandMaterial(uniforms, fogScale = 1) {
  const u = {};
  for (const k in uniforms) u[k] = uniforms[k];
  u.uFogD = { value: uniforms.uFogD.value };
  u.uFogTint = { value: fogScale < 1 ? 0.4 : 0 };
  const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag });
  m.userData.fogScale = fogScale;
  return m;
}

// ---------------------------------------------------------------- geometry
const M = N + 3;                // grid incl. one skirt ring on each side
const sharedIndex = (() => {
  const idx = new Uint16Array(((M - 1) * (M - 1)) * 6);
  let k = 0;
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  return new THREE.BufferAttribute(idx, 1);
})();

const _hs = new Float32Array((N + 3) * (N + 3));

function buildChunkGeometry(cx, cz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const H = N + 3;
  // heights for grid -1..N+1
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) {
    const h = terrainHeight(x0 + (i - 1) * STEP, z0 + (j - 1) * STEP);
    _hs[j * H + i] = h;
    if (h < minY) minY = h; if (h > maxY) maxY = h;
  }
  const pos = new Float32Array(M * M * 3);
  const nor = new Float32Array(M * M * 3);
  const tr = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const ci = Math.min(N, Math.max(0, i - 1)), cj = Math.min(N, Math.max(0, j - 1));
    const skirt = (i === 0 || j === 0 || i === M - 1 || j === M - 1);
    const hx = ci + 1, hz = cj + 1;                          // index into _hs
    const h = _hs[hz * H + hx];
    const dhdx = (_hs[hz * H + hx + 1] - _hs[hz * H + hx - 1]) / (2 * STEP);
    const dhdz = (_hs[(hz + 1) * H + hx] - _hs[(hz - 1) * H + hx]) / (2 * STEP);
    const il = 1 / Math.hypot(dhdx, 1, dhdz);
    const o = j * M + i;
    const wx = x0 + ci * STEP, wz = z0 + cj * STEP;
    pos[o * 3] = wx; pos[o * 3 + 1] = h - (skirt ? SKIRT : 0); pos[o * 3 + 2] = wz;
    nor[o * 3] = -dhdx * il; nor[o * 3 + 1] = il; nor[o * 3 + 2] = -dhdz * il;
    tr[o] = trenchAmount(wx, wz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aTrench', new THREE.BufferAttribute(tr, 1));
  g.setIndex(sharedIndex);
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(x0 + CHUNK / 2, (minY + maxY) / 2, z0 + CHUNK / 2),
    Math.hypot(CHUNK / 2, CHUNK / 2, (maxY - minY) / 2 + SKIRT) + 1);
  return g;
}

/** Streams near-field terrain chunks around the traveler. */
export class Terrain {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.chunks = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _key(cx, cz) { return cx + ',' + cz; }

  _add(cx, cz) {
    const mesh = new THREE.Mesh(buildChunkGeometry(cx, cz), this.material);
    mesh.matrixAutoUpdate = false;
    mesh.userData.c = [cx, cz];
    this.group.add(mesh);
    this.chunks.set(this._key(cx, cz), mesh);
  }

  /** Build every chunk within `r` chunks synchronously (used on load). */
  prime(px, pz, r) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (!this.chunks.has(this._key(pcx + dx, pcz + dz))) this._add(pcx + dx, pcz + dz);
    }
  }

  update(px, pz, budgetMs = 4) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    for (const [k, m] of this.chunks) {
      const [cx, cz] = m.userData.c;
      if (Math.abs(cx - pcx) > RADIUS + 1 || Math.abs(cz - pcz) > RADIUS + 1) {
        this.group.remove(m); m.geometry.dispose(); this.chunks.delete(k);
      }
    }
    const t0 = performance.now();
    // nearest-first
    for (let ring = 0; ring <= RADIUS; ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (this.chunks.has(this._key(cx, cz))) continue;
        this._add(cx, cz);
        if (performance.now() - t0 > budgetMs) return;
      }
    }
  }
}

/** One coarse mesh for the whole level (finer around the mountain); sits a little below the near chunks. */
export function buildFarTerrain(material) {
  // non-uniform grid lines: dense where the mountain's ridges need it, sparse elsewhere
  const lines = (a, b, fineA, fineB, fine, coarse) => {
    const out = [a];
    let v = a;
    while (v < b) { v += (v >= fineA && v < fineB) ? fine : coarse; out.push(Math.min(v, b)); }
    return out;
  };
  const xs = lines(-3400, 3400, -1500, 1500, 16, 34);
  const zs = lines(-4300, 900, -3900, -1450, 16, 34).reverse();      // +z (start) first
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), tr = new Float32Array(nx * nz);
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hs[j * nx + i] = terrainHeightFar(xs[i], zs[j]);
  const at = (i, j) => hs[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const o = j * nx + i;
    const trv = trenchAmount(xs[i], zs[j]);
    tr[o] = trv;
    // sink the coarse mesh inside the canyon so its interpolated walls never poke through the near chunks
    pos[o * 3] = xs[i]; pos[o * 3 + 1] = hs[o] - 7 - 30 * Math.min(1, trv * 3); pos[o * 3 + 2] = zs[j];
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
    const dhdx = (at(i1, j) - at(i0, j)) / (xs[i1] - xs[i0]);
    const dhdz = (at(i, j1) - at(i, j0)) / (zs[j1] - zs[j0]);
    const il = 1 / Math.hypot(dhdx, 1, dhdz);
    nor[o * 3] = -dhdx * il; nor[o * 3 + 1] = il; nor[o * 3 + 2] = -dhdz * il;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c;
    idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aTrench', new THREE.BufferAttribute(tr, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}
