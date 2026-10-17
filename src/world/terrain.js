import * as THREE from 'three';
import { terrainHeight, terrainHeightFar, trenchAmount, WIND } from './heightfield.js';
import { FOOTPRINTS } from './layout.js';

export const CHUNK = 64;
const N = 48;                 // quads per chunk edge
const STEP = CHUNK / N;
const RADIUS = 7;             // chunks kept around the traveler
const SKIRT = 9;

// ---------------------------------------------------------------- sand shader
const vert = /* glsl */`
attribute float aTrench;
attribute float aCav;
varying vec3 vWorld;
varying vec3 vN;
varying float vTrench;
varying float vCav;
void main() {
  vWorld = position;
  vN = normal;
  vTrench = aTrench;
  vCav = aCav;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */`
precision highp float;
uniform vec3 uSunDir, uSunColor, uLit, uHi, uShade, uRim, uGlit, uFog, uRock, uSnowCol, uAmb;
uniform float uFogD, uSnow, uCave, uTime, uGlitterGain, uFogTint;
uniform vec2 uWind;
uniform vec4 uPools[10];
uniform vec3 uPoolColor;
// challenge passages: painted marks (guardian beam spots, shelter glows), ice, the dark flood, sand rivers
uniform vec4 uMarks[8]; uniform vec3 uMarkCol[8]; uniform int uMarkN;
uniform vec4 uIce[4]; uniform float uIceRot[4]; uniform int uIceN;
uniform vec4 uFlood; uniform float uFloodK;
uniform vec4 uStream[4]; uniform vec2 uStreamDir[4]; uniform int uStreamN;
varying vec3 vWorld;
varying vec3 vN;
varying float vTrench;
varying float vCav;
uniform vec4 uContact[24];

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
  float present = step(0.70, hash12(cell + 17.3));
  vec3 rn = normalize(N + (vec3(r.x, hash12(cell + 3.1), r.y) - 0.5) * vec3(1.6, 1.1, 1.6));
  vec2 f = fract(pxz / cs) - .5;
  float disc = smoothstep(0.5, 0.2, length(f));            // round point, soft edge keeps it from crawling
  return present * disc * pow(sat(dot(rn, H)), 320.);
}

float aaf(float x){ return 1. - smoothstep(0.7, 2.2, fwidth(x)); }
float gStreak;

vec3 rippleNormal(vec3 N, vec3 P, float dist){
  float near = 1. - smoothstep(18., 120., dist);
  float mid  = 1. - smoothstep(90., 600., dist);
  vec2 wd = normalize(uWind), wp = vec2(-wd.y, wd.x);
  float steep = smoothstep(0.10, 0.42, 1. - N.y);
  vec2 dirDown = normalize(N.xz + 1e-4);

  // wind ripples: crests perpendicular to the wind, bent by low-frequency noise
  float s = dot(P.xz, wd);
  float n09 = vnoise(P.xz * 0.09);
  float warp = (n09 - .5) * 2.6 + (vnoise(P.xz * 0.42) - .5) * 0.7;
  float r = (s + warp) * 9.5;
  float d1 = cos(r - 0.8 * sin(r)) * (1. - 0.8 * cos(r));
  float rpatch = smoothstep(0.30, 0.62, vnoise(P.xz * 0.045 + 7.));
  float a1 = (1. - steep * 0.35) * d1 * 0.07 * near * rpatch * aaf(r);
  // secondary fine ripples riding the crests, only in the patches
  float rf = (s + warp * 1.4 + sin(s * 3.1) * 0.12) * 29.;
  float a4 = cos(rf - 0.6 * sin(rf)) * 0.030 * (1. - smoothstep(10., 70., dist)) * rpatch * aaf(rf);
  // larger, softer ripples that survive in the distance
  float rm = (s + warp * 2.) * 1.9;
  float d3 = cos(rm - 0.7 * sin(rm)) * (1. - 0.7 * cos(rm));
  float a3 = d3 * 0.035 * mid * (1. - steep * 0.6) * aaf(rm);
  // wind-swept streaks: noise stretched along the wind
  vec2 sq = vec2(s, dot(P.xz, wp));
  float st = vnoise(sq * vec2(0.22, 5.5)) * .65 + vnoise(sq * vec2(0.9, 17.)) * .35 * aaf(sq.y * 107.);
  gStreak = (st - .5) * (1. - smoothstep(40., 260., dist)) * 2. * aaf(sq.y * 34.);
  float sn = (1. + uSnow * 0.25) * (1. - 0.4 * uCave);
  vec3 n = N;
  n.xz -= wd * (a1 + a3 + a4) * sn;
  n.xz += wp * gStreak * 0.025 * near;
  // fine grain, smooth noise so it filters instead of shimmering
  vec2 g2 = P.xz * 52.;
  float ga = aaf(g2.x) * (1. - smoothstep(25., 90., dist));
  n.xz += (vec2(vnoise(g2), vnoise(g2 + 17.3)) - .5) * 0.11 * ga;
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
  float tone = smoothstep(0.50, 0.62, mix(dg, d, 0.5));
  float cav = clamp(vCav, -1., 1.), lsun = sat(dot(Ng, L));
  vec3 sand = mix(uShade, uLit, tone);
  sand = mix(sand, uHi, smoothstep(0.80, 1.0, d) * 0.30);
  sand += uAmb * (0.045 + 0.095 * (1. - tone) * (0.55 + 0.45 * Ng.y));      // soft sky-coloured fill in the shadow
  // subsurface-ish: saturated glow along the terminator, warm bounce light filling the shadow faces
  float term = exp(-pow((mix(dg, d, 0.5) - 0.57) * 11., 2.));
  sand += uLit * vec3(0.9, 0.42, 0.22) * term * 0.10;
  sand += uLit * (1. - tone) * (0.07 + 0.05 * sat(-N.y * .5 + .5)) * sat(1.6 - dist * 0.002);
  sand *= 1. + gStreak * 0.045;
  // macro volume: troughs darker, crests lifted, ripples self-shade at grazing light
  float rsh = clamp((dot(N, L) - dot(Ng, L)) * 5., -.45, .45) * smoothstep(0., .25, dot(Ng, L)) * (1. - smoothstep(40., 260., dist));
  sand *= (1. - 0.42 * sat(cav)) * (1. + 0.14 * sat(-cav)) * (1. + rsh);
  float cv = vnoise(vWorld.xz * 0.004) * 0.6 + vnoise(vWorld.xz * 0.021) * 0.4;
  sand *= mix(vec3(0.94, 0.88, 0.86), vec3(1.07, 1.01, 0.90), cv);

  // --- rock on steep faces, snow on heights / in the cold
  float rockAmt = smoothstep(0.86, 0.58, Ng.y);
  float strata = .5 + .5 * sin(vWorld.y * 0.8 + vnoise(vWorld.xz * 0.05) * 5.);
  vec2 rq = vWorld.xz * 0.35 + vWorld.y * 0.12;
  float rk = (vnoise(rq) * .6 + vnoise(rq * 2.7 + 5.) * .4) * (1. - smoothstep(150., 900., dist));
  float rtone = tone * (0.8 + 0.4 * rk) + (rk - .5) * 0.12 * rockAmt;
  vec3 rock = uRock * (0.30 + 0.9 * rtone) * (0.85 + 0.25 * strata) * (0.9 + 0.2 * vnoise(vec2(vWorld.x * 0.05 + vWorld.z * 0.03, vWorld.y * 0.9)));
  // out in the open desert, steep faces are packed sand catching bounce light, not black stone
  rock = mix(rock, sand * vec3(0.78, 0.66, 0.6) * (0.85 + 0.25 * strata), 0.65 * (1. - uCave) * (1. - uSnow));
  float snowHigh = smoothstep(470., 640., vWorld.y + 45. * vnoise(vWorld.xz * 0.012)) * (1. - 0.75 * rockAmt);
  float snowAmt = max(uSnow * (1. - 0.55 * rockAmt), snowHigh);
  float sk = smoothstep(0.5, 0.82, mix(dg, d, 0.6));
  vec3 snow = mix(uSnowCol * vec3(0.36, 0.47, 0.8), uSnowCol * 0.95, sk);
  snow += uSnowCol * vec3(0.05, 0.12, 0.22) * (1. - sk) * (0.5 + 0.5 * vnoise(vWorld.xz * 0.3)) + uSnowCol * vec3(0.9, 0.55, 0.4) * term * 0.03;
  snow *= 1. + gStreak * 0.03;
  vec3 col = mix(sand, rock, rockAmt);
  col = mix(col, snow, snowAmt);

  // --- canyon darkness
  col *= mix(1., 0.40, vTrench * uCave);
  // contact darkening around built footprints
  float ao = 0.;
  if (dist < 260.) for (int i = 0; i < 24; i++) {
    vec4 c = uContact[i];
    if (c.z <= 0.) break;
    float dd = length(vWorld.xz - c.xy) - c.z;
    ao = max(ao, smoothstep(2.6 + c.z * 0.5, -0.3, dd) * 0.5);
  }
  col *= 1. - ao * (1. - smoothstep(120., 260., dist));

  // --- specular layers: rim + "ocean" sheen, plus glitter
  vec3 H = normalize(L + V);
  float ndh = sat(dot(normalize(mix(Ng, N, 0.12)), H));
  float ocean = pow(ndh, 60.) * 0.9 + pow(ndh, 9.) * 0.05;
  float ndhR = sat(dot(N, H));
  float crest = pow(ndhR, 260.) * (1. - smoothstep(30., 200., dist)) * 0.7;
  ocean += crest;
  float lit = smoothstep(0.0, 0.35, dot(Ng, L));
  ocean *= lit * (1. - rockAmt * 0.8);
  float fres = pow(1. - sat(dot(N, V)), 3.2);
  vec3 rim = uRim * fres * (0.25 + 0.75 * tone) * 0.55 * (1. - 0.35 * uCave);
  vec3 spec = max(uSunColor * ocean * 0.55, rim);

  float px = length(fwidth(vWorld.xz));
  float lod = log2(max(px * 2.2, 0.004));
  float l0 = floor(lod), f = lod - l0;
  float g = (1. - f) * glitterLayer(vWorld.xz, exp2(l0), H, Ng) + f * glitterLayer(vWorld.xz, exp2(l0 + 1.), H, Ng);
  float sunward = 0.55 + 1.1 * pow(sat(dot(-V, L)), 2.);
  vec3 glitter = uGlit * g * 9. * uGlitterGain * sunward * (0.25 + 1.1 * lsun) * (1. - rockAmt) * (1. - smoothstep(300., 1100., dist));
  // snow crystals: denser, sharper, cool-white twinkle
  float gs = glitterLayer(vWorld.xz + 31.7, exp2(l0), H, N) * (1. - f) + glitterLayer(vWorld.xz + 31.7, exp2(l0 + 1.), H, N) * f;
  glitter += vec3(0.9, 0.97, 1.) * gs * 9. * sunward * snowAmt * smoothstep(0.1, 0.5, dot(Ng, L));

  float wet = uCave * smoothstep(0.45, 0.7, vnoise(vWorld.xz * 0.05) * .7 + vnoise(vWorld.xz * 0.23) * .3) * (1. - rockAmt);
  col *= 1. - wet * 0.25;
  spec += uAmb * (pow(ndhR, 24.) * 0.5 + fres * 0.5) * wet * 0.8 + uSunColor * pow(ndhR, 300.) * wet * 1.2;
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

  // --- passages
  if (uIceN > 0) {
    for (int i = 0; i < 4; i++) {
      if (i >= uIceN) break;
      vec4 ic = uIce[i];
      vec2 d = vWorld.xz - ic.xy;
      float cs = cos(uIceRot[i]), sn = sin(uIceRot[i]);
      vec2 q = vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs) / ic.zw;
      float e = length(q) + (vnoise(vWorld.xz * 0.35) - 0.5) * 0.08;
      float m = 1. - smoothstep(0.88, 0.97, e);
      if (m <= 0.) continue;
      float gl = pow(sat(dot(reflect(-V, Ng), L)), 24.) * 1.4 + pow(1. - sat(dot(Ng, V)), 2.) * 0.35;
      float crack = smoothstep(0.92, 0.985, vnoise(vWorld.xz * 1.7)) * 0.25;
      vec3 ice = vec3(0.26, 0.45, 0.74) * (0.42 + 0.4 * tone) + vec3(0.85, 0.93, 1.0) * (gl + crack);
      col = mix(col, ice, m * 0.9);
      col += vec3(0.6, 0.85, 1.0) * m * smoothstep(0.80, 0.9, e) * 0.5;   // a bright rim so the edge reads
    }
  }
  if (uFloodK > 0.) {
    float u = dot(vWorld.xz, uFlood.xy);
    float inZ = smoothstep(uFlood.z, uFlood.z + 4., u) * (1. - smoothstep(uFlood.w - 4., uFlood.w, u));
    float dmin = 9.;
    for (int i = 0; i < 10; i++) { vec4 pl = uPools[i]; if (pl.w <= 0.) continue; dmin = min(dmin, length(vWorld.xz - pl.xy) / pl.z); }
    float m = inZ * smoothstep(0.45, 0.7, vTrench) * smoothstep(0.8, 0.93, Ng.y) * smoothstep(0.72, 0.92, dmin) * uFloodK;
    if (m > 0.) {
      vec2 fl = -uFlood.xy;
      float s = dot(vWorld.xz, fl) - uTime * 1.6;
      float w = dot(vWorld.xz, vec2(-fl.y, fl.x));
      float streak = smoothstep(0.55, 1., vnoise(vec2(s * 0.35, w * 1.6))) * 0.8 + smoothstep(0.6, 1., vnoise(vec2(s * 1.1 + 7., w * 4.)));
      vec3 flood = (vec3(0.012, 0.016, 0.04) + vec3(0.035, 0.05, 0.1) * streak) * mix(1., 0.5, vTrench * uCave);
      col = mix(col, flood, m * 0.92);
    }
  }
  if (uStreamN > 0) {
    for (int i = 0; i < 4; i++) {
      if (i >= uStreamN) break;
      vec4 st = uStream[i]; vec2 dir = uStreamDir[i];
      vec2 d = vWorld.xz - st.xy;
      float a = dot(d, dir), c = dot(d, vec2(-dir.y, dir.x));
      float m = (1. - smoothstep(st.z - 6., st.z, abs(a))) * (1. - smoothstep(st.w - 1.2, st.w, abs(c)));
      if (m <= 0.) continue;
      float s = a - uTime * 6.;
      float flow = smoothstep(0.35, 1., vnoise(vec2(s * 0.45, c * 1.3))) + 0.6 * smoothstep(0.5, 1., vnoise(vec2(s * 1.4 + 3., c * 3.)));
      col = mix(col, col * 1.25 + uPoolColor * 0.22, m * 0.6);
      col += uPoolColor * flow * m * 0.38;
    }
  }
  if (uMarkN > 0) {
    for (int i = 0; i < 8; i++) {
      if (i >= uMarkN) break;
      vec4 mk = uMarks[i];
      float d = length(vWorld.xz - mk.xy) / mk.z;
      if (d > 1.15) continue;
      float a;
      if (mk.w > 0.) a = mk.w * (0.22 * smoothstep(1.0, 0.4, d) + 0.75 * smoothstep(0.82, 0.95, d) * smoothstep(1.06, 0.97, d));
      else a = -mk.w * exp(-d * d * 3.);
      col += uMarkCol[i] * a;
    }
  }

  // --- aerial perspective: blue-ward extinction with distance, Mie forward glow toward the sun, valleys hold haze
  float fd = pow(dist * uFogD, 2.);
  float fogF = 1. - exp(-fd);
  float cs = sat(dot(-V, L));
  float mie = pow(cs, 6.) * 0.12 + pow(cs, 40.) * 0.22;
  vec3 fogCol = uFog + uSunColor * mie * (0.4 + 0.6 * fogF);
  fogCol = mix(fogCol, uAmb * 0.75 + uFog * 0.45, smoothstep(0.12, 0.75, fogF) * 0.4 * (1. - cs * 0.7) * (1. - uCave));
  fogCol = mix(fogCol, uAmb * 0.9 + uFog * 0.25, uFogTint * smoothstep(0.1, 0.8, fogF));
  float hz = 1. - exp(-dist * 0.00035 * exp(-max(0., vWorld.y - cameraPosition.y * 0.5) * 0.012));
  vec3 ext = exp(-fd * vec3(0.80, 1.0, 1.4));
  col = col * ext + fogCol * (1. - ext);
  col = mix(col, fogCol, sat(hz * 0.30 * (1. - uCave) * (1. - fogF)));

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
    uContact: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
    uPools: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) }, uPoolColor: { value: new THREE.Color(1.0, 0.62, 0.28) },
    uMarks: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uMarkCol: { value: Array.from({ length: 8 }, () => new THREE.Color()) }, uMarkN: { value: 0 },
    uIce: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1, 1)) }, uIceRot: { value: [0, 0, 0, 0] }, uIceN: { value: 0 },
    uFlood: { value: new THREE.Vector4() }, uFloodK: { value: 0 },
    uStream: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1, 1)) }, uStreamDir: { value: Array.from({ length: 4 }, () => new THREE.Vector2(1, 0)) }, uStreamN: { value: 0 },
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
  const tr = new Float32Array(M * M), cv = new Float32Array(M * M);
  // coarse cavity: neighbours-average minus centre on an 8 m grid (shared formula, so chunk edges match), bilinear to vertices
  const CG = 11, cav = new Float32Array(9 * 9), hc = new Float32Array(CG * CG);
  for (let j = 0; j < CG; j++) for (let i = 0; i < CG; i++) hc[j * CG + i] = terrainHeight(x0 + (i - 1) * 8, z0 + (j - 1) * 8);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    const c = (j + 1) * CG + i + 1;
    cav[j * 9 + i] = ((hc[c - 1] + hc[c + 1] + hc[c - CG] + hc[c + CG]) * 0.25 - hc[c]) * 0.5;
  }
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
    const gx = Math.min(7.999, ci / 6), gz = Math.min(7.999, cj / 6), ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
    cv[o] = (cav[iz * 9 + ix] * (1 - fx) + cav[iz * 9 + ix + 1] * fx) * (1 - fz) + (cav[(iz + 1) * 9 + ix] * (1 - fx) + cav[(iz + 1) * 9 + ix + 1] * fx) * fz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aTrench', new THREE.BufferAttribute(tr, 1));
  g.setAttribute('aCav', new THREE.BufferAttribute(cv, 1));
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

  _contacts(px, pz) {
    if (this._cn === FOOTPRINTS.length && Math.hypot(px - (this._cx ?? 1e9), pz - (this._cz ?? 1e9)) < 3) return;
    this._cn = FOOTPRINTS.length; this._cx = px; this._cz = pz;
    const near = FOOTPRINTS.filter((f) => f.r > 0.6 && Math.hypot(f.x - px, f.z - pz) < 300 + f.r).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    const arr = this.material.uniforms.uContact.value;
    for (let i = 0; i < 24; i++) { const f = near[i]; if (f) arr[i].set(f.x, f.z, Math.min(f.r, 14), 1); else arr[i].set(0, 0, 0, 0); }
  }

  update(px, pz, budgetMs = 4) {
    this._contacts(px, pz);
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
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), tr = new Float32Array(nx * nz), cv = new Float32Array(nx * nz);
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
    cv[o] = ((at(i - 2, j) + at(i + 2, j) + at(i, j - 2) + at(i, j + 2)) * 0.25 - hs[o]) * 0.12;
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
  g.setAttribute('aCav', new THREE.BufferAttribute(cv, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}
