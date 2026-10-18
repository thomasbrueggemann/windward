// Surfaces for the interiors: a tileable noise atlas, weathered triplanar stone (cracks, strata, slabs, sand drifts, baked-style
// occlusion and warm bounce), image based gold, and fabric with weave, sheen and translucency.
import * as THREE from 'three';
import { rngFor } from '../world/seed.js';
import { clothUniforms } from '../world/cloth.js';

// ------------------------------------------------------------------ noise atlas: R fbm, G crack distance, B grain, A warp fbm
let _nz = null;
export function noiseTex() {
  if (_nz) return _nz;
  const S = 256, d = new Uint8Array(S * S * 4), r = rngFor('interior-noise');
  const lattice = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const sm = (t) => t * t * (3 - 2 * t);
  const vn = (L, n, x, y) => {
    const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const a = L[(iy % n) * n + (ix % n)], b = L[(iy % n) * n + ((ix + 1) % n)], c = L[((iy + 1) % n) * n + (ix % n)], e = L[((iy + 1) % n) * n + ((ix + 1) % n)];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  };
  const octs = (fr) => fr.map((n) => ({ n, L: lattice(n) }));
  const A = octs([4, 8, 16, 32, 64]), B = octs([2, 4, 8, 16]);
  const fbm = (o, x, y) => { let s = 0, w = 0.5, t = 0; for (const q of o) { s += vn(q.L, q.n, x, y) * w; t += w; w *= 0.52; } return s / t; };
  // periodic voronoi for the crack network
  const G = 9, pts = []; for (let i = 0; i < G * G; i++) pts.push([r(), r()]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    const f = fbm(A, u, v), wa = fbm(B, u, v);
    const wu = u + (fbm(B, u + 0.3, v + 0.7) - 0.5) * 0.045, wv = v + (fbm(B, u + 0.9, v + 0.1) - 0.5) * 0.045;
    const cx = Math.floor(wu * G), cy = Math.floor(wv * G);
    let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = (cx + i + G) % G, gy = (cy + j + G) % G, p = pts[gy * G + gx];
      const dx = (cx + i + p[0]) - wu * G, dy = (cy + j + p[1]) - wv * G, dd = Math.hypot(dx, dy);
      if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
    }
    d[o] = Math.min(255, f * 255 * 1.15); d[o + 1] = Math.min(255, (f2 - f1) * 255 * 1.1); d[o + 2] = r() * 255; d[o + 3] = wa * 255;
  }
  // soften the grain channel a little so mips average well
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  _nz = t;
  return t;
}

// ------------------------------------------------------------------ weathered triplanar stone
const stoneHead = /* glsl */`
uniform sampler2D uNz; uniform float uTile, uStrata, uSandY, uAOk, uAOh, uFloorY, uBumpK, uSlab, uDrift, uCracks, uPolar; uniform vec2 uBlock;
uniform vec3 uSandCol, uBounceCol; uniform vec4 uBox; uniform float uBoxOn;
varying vec3 vWP; varying vec3 vWN;
float sHt; float sSand;
float h11(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// three-axis blend that only fetches the axes that matter (flat walls and floors need one or two taps, not three)
vec4 tri(vec3 p, vec3 bw, vec3 dx, vec3 dy){
  vec4 r = vec4(0.);
  if (bw.x > 0.) r += textureGrad(uNz, p.zy, dx.zy, dy.zy) * bw.x;
  if (bw.y > 0.) r += textureGrad(uNz, p.xz + 0.37, dx.xz, dy.xz) * bw.y;
  if (bw.z > 0.) r += textureGrad(uNz, p.xy + 0.71, dx.xy, dy.xy) * bw.z;
  return r;
}
vec3 stoneBump(vec3 n, vec3 pos, float h, float k){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - k * g);
}
`;
const stoneColor = /* glsl */`
{
  vec3 wn = normalize(vWN);
  vec3 bw = pow(abs(wn), vec3(5.)); bw = max(bw / (bw.x + bw.y + bw.z) - 0.03, 0.); bw /= (bw.x + bw.y + bw.z);
  vec3 p = vWP * uTile, dpx = dFdx(p), dpy = dFdy(p);
  vec4 a = tri(p, bw, dpx, dpy);
  vec3 q = p * 4.13;
  vec4 b = tri(q, bw, dpx * 4.13, dpy * 4.13);
  float vert = 1. - abs(wn.y), flat_ = smoothstep(0.55, 0.9, wn.y);
  float cmask = smoothstep(0.52, 0.78, a.a * 0.7 + b.r * 0.3 + (a.r - 0.5) * 0.4) * uCracks;
  float crack = (1. - smoothstep(0.0, 0.05, a.g + (b.r - 0.5) * 0.04)) * cmask * (1. - flat_ * 0.5);
  // strata: horizontal layers of different hardness that weather in and out
  float sw = step(0.01, uStrata) * vert;
  float st = vWP.y * uStrata + (a.a - 0.5) * 2.4 + (a.r - 0.5) * 0.5;
  float band = sin(st * 6.2831) * 0.5 + 0.5, lh = h11(floor(st));
  float ht = a.r * 0.5 + b.r * 0.2 + b.b * 0.1 + a.a * 0.2 - crack * 0.9 + (band - 0.5) * 0.3 * sw + (lh - 0.5) * 0.2 * sw;
  vec3 c = diffuseColor.rgb * mix(0.7, 1.24, a.r) * mix(0.95, 1.05, b.b);
  c *= 1. - crack * 0.6;
  c = mix(c, c * vec3(1.1, 0.96, 0.8), a.a * 0.8);
  c *= mix(1., 0.87 + 0.26 * lh, sw * 0.7) * mix(1., 0.93 + 0.14 * band, sw);
  // courses of cut blocks on walls: soft joints, a little tint per block, chipped edges
  if (uBlock.x > 0.) {
    float hu = uPolar > 0. ? atan(vWP.x, vWP.z) * uPolar : (abs(wn.x) > abs(wn.z) ? vWP.z : vWP.x), row = floor(vWP.y / uBlock.y);
    float bu = hu / uBlock.x + h11(row * 3.7) * 7.;
    vec2 f = vec2(fract(bu), fract(vWP.y / uBlock.y)), e = min(f, 1. - f) * uBlock;
    float chip = (b.r - 0.5) * 0.03 + (a.r - 0.5) * 0.02;
    float j = 1. - smoothstep(0.012, 0.045, min(e.x, e.y) + chip);
    float bt = h22(vec2(floor(bu), row)).x;
    float k = vert * (1. - flat_);
    ht -= j * 0.7 * k; c *= mix(1., (0.86 + 0.28 * bt) * (1. - 0.35 * j), k);
  }
  // slabs on floors
  if (uSlab > 0.) {
    vec2 sp = vWP.xz / vec2(uSlab, uSlab * 1.7); sp.x += mod(floor(sp.y), 2.) * 0.5;
    vec2 f = fract(sp), id = floor(sp), e = min(f, 1. - f) * vec2(uSlab, uSlab * 1.7);
    float j = 1. - smoothstep(0.014, 0.06, min(e.x, e.y)), tint = h22(id).x;
    ht -= j * 0.8 * flat_; c *= mix(1., (0.78 + 0.4 * tint) * (1. - 0.45 * j), flat_);
  }
  // occlusion: dark near the floor and in the wall corners, grime in the cracks
  float h0 = vWP.y - uFloorY;
  float ao = mix(uAOk, 1., smoothstep(0., uAOh, h0 + (a.r - 0.5) * 0.8)) * (1. - 0.35 * crack);
  if (uBoxOn > 0.) {
    float dx = min(vWP.x - uBox.x, uBox.y - vWP.x), dz = min(vWP.z - uBox.z, uBox.w - vWP.z);
    ao *= 1. - 0.42 * (1. - smoothstep(0., 2.2, dx)) * (1. - smoothstep(0., 2.2, dz)) * (1. - flat_ * 0.5);
    // sand drifted against the walls and into the corners, softening the joints
    float dr = clamp((1. - smoothstep(0., 1.9, min(dx, dz) + (a.r - 0.5) * 1.6)) * flat_ * uDrift, 0., 1.);
    c = mix(c, uSandCol * (0.82 + 0.34 * b.b), dr); ht = mix(ht, b.b * 0.2 + 0.4 * sin((vWP.x + vWP.z) * 17. + a.r * 6.) * 0.2, dr * 0.85);
  }
  sSand = 0.;
  if (uSandY > -90.) {
    float sy = uSandY + (a.r - 0.5) * 1.2 + (b.r - 0.5) * 0.4;
    sSand = smoothstep(sy + 0.55, sy - 0.1, vWP.y) * (1. - crack * 0.35);
    c = mix(c, uSandCol * (0.84 + 0.32 * b.b), sSand);
    ht = mix(ht, b.b * 0.25 + 0.35 * sin(vWP.y * 21. + a.r * 8.) * 0.2, sSand * 0.8);
    ao = mix(ao, 1., sSand * 0.5);
  }
  diffuseColor.rgb = c * ao;
  sHt = ht;
}
`;
const stoneRough = /* glsl */`roughnessFactor = clamp(roughnessFactor * mix(0.84, 1.06, sHt) + (1. - roughnessFactor) * 0.0 + sSand * 0.06, 0.3, 1.);`;
const stoneNormal = /* glsl */`normal = stoneBump(normal, -vViewPosition, sHt, uBumpK);`;
const stoneEmis = /* glsl */`{ vec3 wn2 = normalize(vWN); float bh = 0.35 + 0.65 * smoothstep(8., 0., vWP.y - uFloorY); totalEmissiveRadiance += uBounceCol * diffuseColor.rgb * bh * (0.45 + 0.55 * (0.5 - 0.5 * wn2.y)); }`;

/**
 * Weathered stone, mapped triplanar from a shared noise atlas. opts: tile (1/metres per atlas repeat), strata (layers per metre, 0 off),
 * sandY (height up to which sand covers walls, -99 off), floorY, ao (darkest occlusion near the floor) and aoH, bump, slab (floor slab
 * size in metres, 0 off), box [x0, x1, z0, z1] (room footprint: corner occlusion and sand drifts), drift, sand (colour), bounce (colour).
 */
export function stoneMat(color, emissive = 0x000000, ei = 0.5, bumpScale = 2, opts = {}) {
  const o = { tile: 0.16, strata: 0.55, sandY: -99, floorY: 0, ao: 0.55, aoH: 3.5, bump: 0.05, slab: 0, box: null, drift: 1, sand: new THREE.Color('#d8a868'), bounce: new THREE.Color(0, 0, 0), rough: 0.93, cracks: 0.6, block: null, ...opts };
  if (o.polar && o.block) o.block = [2 * Math.PI * o.polar / Math.max(4, Math.round(2 * Math.PI * o.polar / o.block[0])), o.block[1]];
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough, metalness: 0, emissive, emissiveIntensity: ei });
  const u = {
    uNz: { value: noiseTex() }, uTile: { value: o.tile }, uStrata: { value: o.strata }, uSandY: { value: o.sandY }, uAOk: { value: o.ao }, uAOh: { value: o.aoH },
    uFloorY: { value: o.floorY }, uBumpK: { value: o.bump * (bumpScale / 2) }, uSlab: { value: o.slab }, uDrift: { value: o.drift },
    uCracks: { value: o.cracks }, uPolar: { value: o.polar || 0 }, uBlock: { value: new THREE.Vector2(...(o.block || [0, 0])) }, uSandCol: { value: new THREE.Color(o.sand) }, uBounceCol: { value: new THREE.Color(o.bounce) },
    uBox: { value: new THREE.Vector4(...(o.box || [0, 0, 0, 0])) }, uBoxOn: { value: o.box ? 1 : 0 },
  };
  m.userData.stoneU = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = mat3(modelMatrix) * objectNormal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + stoneHead)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + stoneColor)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + stoneRough)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + stoneNormal)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + stoneEmis);
  };
  m.customProgramCacheKey = () => 'jstone1';
  m.clone = function () { const c = stoneMat(color, emissive, ei, bumpScale, opts); c.side = this.side; return c; };
  return m;
}

// ------------------------------------------------------------------ gold lit by a little room environment
export function goldMat(env, { color = 0xe8b860, emissive = 0x6a3a08, ei = 0.35 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.92, emissive, emissiveIntensity: ei, envMap: env || null, envMapIntensity: 1.1 });
  return m;
}

/** A tiny PMREM'd gradient (sky, horizon, ground, one bright lobe toward the sun) so metals and sheens have something to reflect. */
export function makeEnv(renderer, { top, hor, bot, sun, sunDir }) {
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: top }, uHor: { value: hor }, uBot: { value: bot }, uSun: { value: sun }, uDir: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uTop, uHor, uBot, uSun, uDir; varying vec3 vP; void main(){ vec3 d = normalize(vP); vec3 c = mix(uHor, d.y > 0. ? uTop : uBot, pow(abs(d.y), 0.55)); c += uSun * pow(max(dot(d, uDir), 0.), 18.); gl_FragColor = vec4(c, 1.); }',
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.03);
  pm.dispose(); mat.dispose(); sc.children[0].geometry.dispose();
  return rt;
}

// ------------------------------------------------------------------ fabric: weave, sheen, translucency, hems and glowing thread
export const fabricFrag = /* glsl */`
precision highp float;
uniform float uTime, uFogD, uMaxU, uGlowK, uSheen, uTrans, uBaseAO, uLines; uniform vec2 uWeave;
uniform vec3 uSunDir, uSunColor, uAmb, uFog, uColA, uColB, uThread, uGlowCol;
uniform vec2 uHem;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
float hs(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  // weave: warp and weft threads, faded out where they would alias
  vec2 wc = vUv * uWeave;
  vec2 tw = abs(fract(wc) - 0.5) * 2.;
  float thr = (0.5 + 0.5 * sin(wc.x * 6.2831 + step(0.5, fract(wc.y * 0.5)) * 3.14159)) * (0.5 + 0.5 * sin(wc.y * 6.2831 + step(0.5, fract(wc.x * 0.5)) * 3.14159));
  float aa = clamp(1. - fwidth(wc.x) * 1.4, 0., 1.);
  float weave = mix(0.5, thr, aa);
  float slub = vn(vUv * uWeave * 0.07 + 3.) * 0.6 + vn(vUv * uWeave * 0.3) * 0.4;
  // gentle ripple of the cloth from its own folds
  vec3 dx = dFdx(vW), dy = dFdy(vW);
  float hgt = (weave * 0.6 + slub * 0.4) * 0.012 * aa + (vn(vUv * 9. + uTime * 0.0) - 0.5) * 0.01;
  vec3 r1 = cross(dy, N), r2 = cross(N, dx); float det = dot(dx, r1);
  N = normalize(abs(det) * N - sign(det) * 7. * (dFdx(hgt) * r1 + dFdy(hgt) * r2));
  vec3 base = mix(uColA, uColB, vUv.x * 0.6 + 0.4 * (0.5 + 0.5 * sin(vUv.y * 12.)));
  base *= 0.86 + 0.2 * slub + 0.1 * (weave - 0.5);
  base *= mix(1., 0.4 + 0.6 * smoothstep(0., 0.5, vUv.x), uBaseAO);   // the cup of a flower is shadowed by its own petals
  // hem: a turned edge, darker and stiffer, with a row of stitches and a thread of light
  float e = min(min(vUv.y / uHem.y, (1. - vUv.y) / uHem.y), min(vUv.x / uHem.x, (uMaxU - vUv.x) / uHem.x));
  float hem = smoothstep(1.2, 0.6, e), seam = smoothstep(0.12, 0., abs(e - 1.)) * step(0.5, fract((wc.x + wc.y) * 0.22));
  base = mix(base, base * 0.78, hem);
  float line = smoothstep(0.07, 0.0, abs(vUv.y - 0.5)) + 0.6 * smoothstep(0.035, 0.0, abs(vUv.y - 0.2)) + 0.6 * smoothstep(0.035, 0.0, abs(vUv.y - 0.8));
  line *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(uMaxU, uMaxU - 0.12 * uMaxU, vUv.x);
  line *= (0.75 + 0.25 * weave) * uLines;
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float front = max(ndl, 0.), back = max(-ndl, 0.);
  // thin cloth passes light: the shaded face glows with the colour of the cloth, brightest when the light is behind it
  float rimT = pow(1. - abs(dot(N, V)), 2.);
  vec3 trans = base * base * uSunColor * (back * 1.15 + 0.15 * rimT) * uTrans * 2.2;
  vec3 diff = base * (uAmb * 0.55 + uSunColor * (0.16 + front * 0.62));
  // sheen along the edges of the nap
  vec3 sheen = mix(base, vec3(1., 0.8, 0.6), 0.45) * uSunColor * pow(1. - max(dot(N, V), 0.), 4.) * (0.2 + 0.6 * front + 0.4 * back) * uSheen;
  vec3 col = diff + trans + sheen;
  col *= 1. - 0.3 * hem * 0.0;
  col += (line + seam * 0.8) * mix(uThread, uGlowCol * 1.9, vGlow);
  col += vGlow * uGlowK * base;
  col = mix(col, uFog, 1. - exp(-pow(dist * uFogD, 2.)));
  gl_FragColor = vec4(col, 1.);
}`;

/** A fabric material for a vertex shader that supplies vUv, vGlow, vN, vW (like the cloth shaders); extra uniforms merge in. */
export function fabricMat(vertexShader, extra = {}, opt = {}) {
  const o = { colA: [0.42, 0.03, 0.02], colB: [0.95, 0.17, 0.05], thread: [0.7, 0.28, 0.1], glow: [3.2, 2.3, 1.2], maxU: 1, weave: 120, hem: [0.05, 0.04], trans: 0.8, glowK: 0.35, sheen: 0.45, ...opt };
  const u = {
    ...clothUniforms,
    uColA: { value: new THREE.Color(...o.colA) }, uColB: { value: new THREE.Color(...o.colB) }, uThread: { value: new THREE.Color(...o.thread) }, uGlowCol: { value: new THREE.Color(...o.glow).multiplyScalar(1 / 1.9) },
    uBaseAO: { value: 0 }, uLines: { value: 1 }, uMaxU: { value: o.maxU }, uWeave: { value: new THREE.Vector2().fromArray([].concat(o.weave, o.weave)) }, uHem: { value: new THREE.Vector2(...o.hem) }, uSheen: { value: o.sheen }, uTrans: { value: o.trans }, uGlowK: { value: o.glowK }, ...extra,
  };
  return new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader: fabricFrag, side: THREE.DoubleSide, extensions: { derivatives: true } });
}


// ------------------------------------------------------------------ murals: carved relief, gold inlay, raked by the brazier's light
export function muralMat(map, relief) {
  const m = new THREE.MeshStandardMaterial({ map, bumpMap: relief, bumpScale: -4, roughness: 0.86, metalness: 0, color: 0xffffff });
  const u = { uBrazV: { value: new THREE.Vector3() }, uBrazK: { value: 0 }, uBrazCol: { value: new THREE.Color(1, 0.55, 0.22) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uBrazV, uBrazCol; uniform float uBrazK;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat gold = smoothstep(0.36, 0.1, distance(diffuseColor.rgb, vec3(0.78, 0.37, 0.04)));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, gold);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, gold);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{ vec3 Lv = uBrazV + vViewPosition; float ld = length(Lv); Lv /= ld; float att = uBrazK / (1. + ld * ld * 0.07);
  reflectedLight.directDiffuse += uBrazCol * diffuseColor.rgb * max(dot(normal, Lv), 0.) * att;
  vec3 Hh = normalize(Lv + normalize(vViewPosition)); reflectedLight.directSpecular += uBrazCol * pow(max(dot(normal, Hh), 0.), 26.) * att * (0.12 + gold * 1.8); }`);
  };
  m.customProgramCacheKey = () => 'jmural1';
  return m;
}
