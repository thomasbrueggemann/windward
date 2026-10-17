import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeStoneNoise } from '../textures.js';
import { palette } from './palette.js';

// ------------------------------------------------------------------ geometry: weathered, chipped, bevelled stone
const hash3 = (x, y, z) => { let h = Math.imul(x * 374761393 + y * 668265263 + z * 1274126177, 1103515245); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Smooth 3D value noise in [0,1]. */
export function vn3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), L(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
    L(L(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), L(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v), w);
}
/** Drop uv/normal, weld seams, smooth normals. */
export function finish(g) {
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-3); g.computeVertexNormals(); return g;
}
/** Extrusions: flat shading on the big caps (no pillowy normals across long triangles), smooth bevels and walls. */
export function finishExtrude(geo) {
  const pos = geo.attributes.position.array, part = (gr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos.slice(gr.start * 3, (gr.start + gr.count) * 3), 3)); return g; };
  const caps = part(geo.groups.find((g) => g.materialIndex === 0)), sides = part(geo.groups.find((g) => g.materialIndex === 1));
  caps.computeVertexNormals();
  const sm = mergeVertices(sides, 1e-3); sm.computeVertexNormals();
  return mergeGeometries([caps, sm.toNonIndexed()], false);
}
/** Position-only noise displacement (keeps welded seams closed). */
export function weather(g, amp, freq, seed = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + (vn3(x * freq + seed, y * freq, z * freq) - 0.5) * amp, y + (vn3(x * freq, y * freq + seed + 7, z * freq) - 0.5) * amp, z + (vn3(x * freq, y * freq, z * freq + seed + 13) - 0.5) * amp);
  }
  return g;
}

/** A bevelled block with chipped edges and low-frequency erosion, centred on the origin. */
export function chunk(w, h, d, { r = 0.22, chip = 1, seed = 0, amp = 1 } = {}) {
  const A = [w / 2, h / 2, d / 2];
  r = Math.min(r, Math.min(...A) * 0.6);
  const ns = A.map((a) => Math.max(4, Math.min(9, Math.round(a * 2 / 3) + 3)));
  const g = new THREE.BoxGeometry(w, h, d, ns[0], ns[1], ns[2]);
  const p = g.attributes.position;
  const rem = (v, a, n) => { const i = Math.round((v / a + 1) * n / 2); return i <= 0 ? -a : i >= n ? a : -(a - r) + 2 * (a - r) * (i - 1) / (n - 2); };
  const sd = seed * 3.7 + w * 0.13 + h * 0.31;
  const dim = Math.min(...A);
  for (let i = 0; i < p.count; i++) {
    let x = rem(p.getX(i), A[0], ns[0]), y = rem(p.getY(i), A[1], ns[1]), z = rem(p.getZ(i), A[2], ns[2]);
    const ix = Math.max(-(A[0] - r), Math.min(A[0] - r, x)), iy = Math.max(-(A[1] - r), Math.min(A[1] - r, y)), iz = Math.max(-(A[2] - r), Math.min(A[2] - r, z));
    const dx = x - ix, dy = y - iy, dz = z - iz, len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const n3 = vn3(x * 0.9 + sd, y * 0.9, z * 0.9 + sd * 1.7);
      const rr = r * (1 + chip * Math.max(0, n3 - 0.52) * 4.5);
      x = ix + dx / len * rr; y = iy + dy / len * rr; z = iz + dz / len * rr;
    }
    // erosion: soft lumps along the (approximate) surface normal
    const nx = x / (A[0] * A[0]), ny = y / (A[1] * A[1]), nz = z / (A[2] * A[2]), nl = Math.hypot(nx, ny, nz) || 1;
    const disp = ((vn3(x * 0.33 + sd, y * 0.33, z * 0.33) - 0.5) * 0.4 + (vn3(x * 1.3, y * 1.3 + sd, z * 1.3) - 0.5) * 0.12) * Math.min(1, dim * 0.7) * amp;
    p.setXYZ(i, x + nx / nl * disp, y + ny / nl * disp, z + nz / nl * disp);
  }
  return finish(g);
}

/** Fluted, tapered shaft (also stalactites, drums, obelisks via `poly`). Base at y = -H/2. */
export function shaft(rt, rb, H, { radial = 36, hseg = 8, flutes = 9, jag = 0, poly = 0, wob = 0.04, seed = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, H, radial, hseg, false);
  const p = g.attributes.position, sd = seed * 5.3;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-6) {
      const th = Math.atan2(z, x), t = y / H + 0.5;
      let k = 1 + 0.025 * Math.sin(Math.PI * t) + (vn3(Math.cos(th) * 1.5 + sd, y * 0.5, Math.sin(th) * 1.5) - 0.5) * wob;
      if (flutes) k *= 1 - 0.05 * Math.pow(Math.abs(Math.sin(th * flutes / 2)), 0.7);
      if (poly) { const s = Math.PI * 2 / poly; k *= Math.cos(s / 2) / Math.cos(((th % s) + s) % s - s / 2); }
      x *= k; z *= k;
    }
    if (jag && y > H / 2 - 1e-4) y -= jag * (0.55 * vn3(x * 1.4 + sd, 3, z * 1.4) + 0.45 * (x / Math.max(rt, rb) * 0.5 + 0.5)) * 1.0;
    p.setXYZ(i, x, y, z);
  }
  return finish(g);
}

/** Ornate column: stepped base, fluted entasis shaft, echinus + abacus capital — one geometry, base at y = 0. */
export function column(H, { broken = false, seed = 0 } = {}) {
  const parts = [
    chunk(2.7, 0.55, 2.7, { r: 0.16, seed }).translate(0, 0.28, 0),
    chunk(2.15, 0.28, 2.15, { r: 0.1, seed: seed + 1 }).translate(0, 0.69, 0),
    shaft(0.85, 1.02, H, { jag: broken ? Math.min(1.6, H * 0.35) : 0, flutes: 9, seed }).translate(0, 0.6 + H / 2, 0),
  ];
  if (!broken) {
    parts.push(shaft(1.34, 0.88, 0.32, { radial: 24, hseg: 2, flutes: 0, wob: 0.02, seed }).translate(0, 0.6 + H + 0.16, 0));
    parts.push(chunk(2.5, 0.5, 2.5, { r: 0.14, seed: seed + 2 }).translate(0, 0.6 + H + 0.57, 0));
    for (const g of parts.slice(-2)) g.rotateY(0.2);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((q) => q.dispose());
  return g;
}

/** Stone / rock shader patch ---------------------------------------------------------------- */
const VERT_PARS = /* glsl */`attribute vec2 aInfo; varying vec3 vWp; varying vec3 vWn; varying vec3 vOp; varying vec3 vOn; varying vec2 vInfo;`;
const VERT_BODY = /* glsl */`vWp = (modelMatrix * vec4(transformed, 1.)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal); vInfo = aInfo; vOp = transformed + modelMatrix[3].xyz; vOn = objectNormal;`;
const FRAG_PARS = /* glsl */`
uniform sampler2D uNoise; uniform vec3 uDust; uniform float uGlow; uniform vec4 uP; uniform vec3 uGold;
varying vec3 vWp; varying vec3 vWn; varying vec3 vOp; varying vec3 vOn; varying vec2 vInfo;
float sH, sAO, sInl, sRough, sUnd, sVar;
vec4 triS(vec3 p, vec3 w, float sc) { return texture2D(uNoise, p.zy * sc) * w.x + texture2D(uNoise, p.xz * sc) * w.y + texture2D(uNoise, p.xy * sc) * w.z; }
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 stonePerturb(vec3 sp, vec3 sn, vec2 dh, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * sn - g);
}`;
const FRAG_COLOR = /* glsl */`
{
  vec3 sN = normalize(vWn);
  vec3 sw = pow(abs(normalize(vOn)), vec3(6.)); sw /= (sw.x + sw.y + sw.z);
  vec4 nA = triS(vOp, sw, 0.09), nB = triS(vOp, sw, 0.55);
  float sUp = sN.y, hb = vWp.y - vInfo.x;
  float side = 1. - smoothstep(0.55, 0.95, abs(sUp));
  float fadeD = 1. - smoothstep(70., 260., length(vWp - cameraPosition));
  // layered sediment: harder beds stand proud, each with its own tone
  float sy = vWp.y * 1.15 + (nA.r - .5) * 1.7 + (nA.g - .5) * 0.5;
  float lid = floor(sy), lf = fract(sy), hard = h11(lid);
  float ridge = smoothstep(0., 0.12, lf) * (1. - smoothstep(0.5, 1., lf));
  float strata = ridge * (0.35 + hard) * uP.x * side * fadeD;
  float hgt = strata * 0.08 + (nA.g - .5) * 0.22 + (nB.g - .5) * 0.08 + (nB.a - .5) * 0.03;
  // cracks in the harder, drier patches
  float cr = (1. - smoothstep(0., 0.12, nA.b)) * fadeD;
  float crack = cr * smoothstep(0.5, 0.7, nA.r + (nB.g - .5) * 0.25) * smoothstep(0.38, 0.62, nB.g + (nA.g - .5) * 0.5) * uP.w * (0.4 + 0.6 * side);
  hgt -= crack * 0.06;
  // wind-blown sand: on top faces, drifted against the foot
  float sandTop = smoothstep(0.48, 0.86, sUp + (nA.g - .5) * 0.6 + (nB.g - .5) * 0.22) * uP.y;
  float sandBase = (1. - smoothstep(0., 0.55 + nA.r * 1.4 + (nB.g - .5) * 0.6, hb)) * uP.z;
  float sand = clamp(max(sandTop, sandBase), 0., 1.);
  hgt = mix(hgt, sin(dot(vWp.xz, vec2(0.9, 0.45)) * 3.6 + nA.r * 7.) * 0.025 + (nB.g - .5) * 0.04, sand);
  vec3 st = diffuseColor.rgb;
  st *= 1. + (hard - .5) * 0.15 * uP.x * side * fadeD + (nA.r - .5) * 0.28 + (nB.g - .5) * 0.12 + strata * 0.14;
  float sk = texture2D(uNoise, vec2(dot(vWp.xz, normalize(vec2(sN.z, -sN.x) + 1e-4)) * 0.23, vWp.y * 0.017)).g;
  st *= 1. - smoothstep(0.55, 0.85, sk) * side * 0.3;
  st = mix(st, st * vec3(.7, .64, .7), crack);
  float under = smoothstep(-0.2, -0.75, sUp);
  sUnd = under; sVar = 0.3 + 1.3 * (nA.g * 0.55 + nA.r * 0.3 + nB.g * 0.15) - strata * 0.4;
  st *= 1. - under * 0.42;
  sAO = mix(1. - 0.5 * uP.z, 1., smoothstep(0., 2.6, hb)) * (1. - crack * 0.55) * (0.78 + 0.22 * smoothstep(0.2, 0.75, nA.g)) * (1. - under * 0.2);
  sRough = 1. - under * 0.18;
  // carved frieze with gold inlay
  float inl = 0.;
  if (vInfo.y > 0.5) {
    float bv = (vWp.y - vInfo.y) / 1.05;
    float inb = step(0., bv) * step(bv, 1.) * side;
    float bu = dot(vWp.xz, normalize(vec2(sN.z, -sN.x) + 1e-4));
    float cz = abs(fract(bu * 0.8) - 0.5) * 2.;
    float chev = 1. - smoothstep(0.035, 0.08, abs(bv - (0.26 + 0.48 * cz)));
    float rail = 1. - smoothstep(0.02, 0.05, min(abs(bv - 0.07), abs(bv - 0.93)));
    float dia = 1. - smoothstep(0.05, 0.1, abs(fract(bu * 0.4 + 0.5) - 0.5) * 1.6 + abs(bv - 0.5) * 0.9);
    float worn = smoothstep(0.1, 0.28, nB.g + nA.g * 0.3);
    inl = max(max(chev, rail), dia) * inb * worn * (1. - sand);
    float bm = smoothstep(-0.02, 0.07, bv) * (1. - smoothstep(0.93, 1.02, bv)) * inb;
    hgt -= bm * 0.07 + inl * 0.05;
    st *= 1. - bm * 0.16;
    st = mix(st, uGold, inl);
  }
  sInl = inl;
  sH = hgt;
  float edge = clamp(length(fwidth(sN)) * 3., 0., 1.);
  st *= 1. + edge * 0.3 * (1. - sand);
  diffuseColor.rgb = mix(st, uDust * (0.88 + 0.24 * nB.g), sand * 0.93);
}`;

/** Patch a MeshStandardMaterial with procedural sandstone. `p` = (strata, sand on tops, sand at foot, cracks). */
export function patchStone(mat, key, { p = [1, 1, 1, 1], dust = 1.2, glowMul = 1 } = {}) {
  mat.userData.stone = true;
  mat.userData.dustMul = dust;
  mat.userData.glowMul = glowMul;
  const u = { uP: { value: new THREE.Vector4(...p) }, uDust: { value: new THREE.Color() }, uNoise: SHARED.uNoise, uGlow: SHARED.uGlow, uGold: SHARED.uGold };
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor * sRough, 0.34, sInl), 0.2, 1.);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.85, sInl);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = stonePerturb(-vViewPosition, normal, vec2(dFdx(sH), dFdy(sH)), faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = totalEmissiveRadiance * sAO + vec3(1.9, 1.05, 0.34) * sInl * uGlow + uDust * sUnd * sVar * 0.17;');
  };
  mat.customProgramCacheKey = () => 'stone-' + key;
  return mat;
}

const SHARED = { uNoise: { value: null }, uGlow: { value: 0.5 }, uGold: { value: new THREE.Color(0.9, 0.55, 0.16) } };
/** Lazy shared noise texture. */
export function stoneNoise() { if (!SHARED.uNoise.value) SHARED.uNoise.value = makeStoneNoise(256); return SHARED.uNoise.value; }

const _c = new THREE.Color();
/** Per-frame palette response: sand colour follows the terrain, the inlay breathes with dusk / caves. */
export function updateStone(mats, dusk) {
  const g = Math.min(1, 0.4 + 0.75 * dusk + 0.55 * palette.cave);
  SHARED.uGlow.value = g;
  for (const m of mats) {
    const u = m.userData.u;
    u.uDust.value.copy(palette.grd).lerp(palette.hi, 0.18).multiplyScalar(m.userData.dustMul);
  }
}

/** Per-vertex ground height + frieze height attribute (world y; 0 = none). */
export function dress(mesh, ground, band = 0) {
  const n = mesh.geometry.attributes.position.count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = ground; a[i * 2 + 1] = band; }
  mesh.geometry.setAttribute('aInfo', new THREE.BufferAttribute(a, 2));
  return mesh;
}
