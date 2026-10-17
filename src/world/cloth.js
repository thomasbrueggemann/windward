import * as THREE from 'three';

/** Shared lighting uniforms for every cloth-like shader (updated from the palette each frame). */
export const clothUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.5, 0.5, 0.6) }, uFog: { value: new THREE.Color() }, uFogD: { value: 0.0005 },
};

const fragCommon = /* glsl */`
precision highp float;
uniform float uTime, uFogD;
uniform vec3 uSunDir, uSunColor, uAmb, uFog;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
float vnz(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
/** plain weave: x = thread relief (-1..1), faded with distance so it never shimmers */
float weaveRelief(vec2 uv, vec2 f, float dist) { return sin(uv.x * f.x) * sin(uv.y * f.y) * (1. - smoothstep(4., 18., dist)); }
/** soft translucency + velvet sheen shared by all the cloth creatures */
vec3 clothLight(vec3 base, vec3 N, vec3 V, float thin) {
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float diff = max(ndl, 0.) * 0.6 + pow(max(-ndl, 0.), 2.) * 0.6;
  vec3 col = base * (uAmb * 0.5 + uSunColor * (0.2 + diff));
  col += base * vec3(1.3, 0.5, 0.22) * uSunColor * pow(clamp(-dot(V, L), 0., 1.), 3.) * (0.45 + 0.55 * (1. - abs(dot(V, N)))) * thin * 0.55;
  float fres = pow(1. - abs(dot(V, N)), 2.6);
  col += vec3(1.0, 0.5, 0.28) * (uSunColor * 0.7 + uAmb * 0.35) * fres * 0.3;
  return col;
}
`;


export const clothFrag = fragCommon + /* glsl */`
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  vec3 Ng = normalize(cross(dFdx(vW), dFdy(vW))); if (dot(Ng, vN) < 0.) Ng = -Ng;
  vec3 N = normalize(mix(normalize(vN), Ng, 0.6)); if (!gl_FrontFacing) N = -N;
  float wv = weaveRelief(vUv, vec2(520., 520.), dist);
  float dye = vnz(vUv * vec2(6., 18.)) * 0.6 + vnz(vUv * vec2(23., 70.)) * 0.4;
  vec3 base = mix(vec3(0.42, 0.03, 0.02), vec3(0.95, 0.17, 0.05), vUv.x * 0.6 + 0.4 * (0.5 + 0.5 * sin(vUv.y * 12.)));
  base *= 0.7 + 0.3 * dye + 0.07 * wv;
  float dash = step(0.35, fract(vUv.x * 26. + 0.5));
  float line = smoothstep(0.06, 0.0, abs(vUv.y - 0.5)) + 0.7 * dash * (smoothstep(0.022, 0.0, abs(vUv.y - 0.2)) + smoothstep(0.022, 0.0, abs(vUv.y - 0.8)));
  line *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  vec3 col = clothLight(base, N, V, 0.8);
  vec3 ember = mix(vec3(0.7, 0.28, 0.1), vec3(3.2, 2.3, 1.2), vGlow);
  col += line * ember * (0.85 + 0.15 * wv);
  col += vGlow * 0.35 * base + vGlow * vGlow * vec3(0.5, 0.25, 0.08) * (1. - abs(dot(V, N)));
  col = mix(col, uFog, 1. - exp(-pow(dist * uFogD, 2.)));
  gl_FragColor = vec4(col, 1.);
}`;

const instVert = /* glsl */`
attribute float iPhase; attribute float iGlow; attribute float iScale;
uniform float uTime;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 p = position;
  float x = p.x / 0.6;
  float tw = sin(uTime * 1.3 + iPhase) * 1.0 * x;
  float c = cos(tw), s = sin(tw);
  vec3 n = vec3(0., -s, c);
  p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  p.z += sin(uTime * 3.2 + iPhase + p.x * 5.) * 0.12 * abs(x);
  p.y += sin(uTime * 2.1 + iPhase + p.x * 3.) * 0.08 * abs(x);
  p *= iScale;
  vec4 wp = instanceMatrix * vec4(p, 1.);
  wp.y += sin(uTime * 0.8 + iPhase * 2.) * 0.4;
  wp.x += sin(uTime * 0.5 + iPhase) * 0.5;
  vW = wp.xyz; vN = mat3(instanceMatrix) * n; vUv = uv; vGlow = iGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Instanced floating cloth pieces (they recharge the scarf). */
export function makeFloatingCloth(scene, capacity = 120) {
  const geo = new THREE.PlaneGeometry(1.2, 0.5, 14, 4);
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const scale = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPhase', phase); geo.setAttribute('iGlow', glow); geo.setAttribute('iScale', scale);
  const mat = new THREE.ShaderMaterial({ uniforms: clothUniforms, vertexShader: instVert, fragmentShader: clothFrag, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  return { mesh, phase, glow, scale, capacity };
}

// ------------------------------------------------------------- big dormant cloth banners
const bannerFrag = fragCommon + /* glsl */`
uniform float uAwake, uPulse;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float wv = weaveRelief(vUv, vec2(1900., 380.), dist);
  float dye = vnz(vUv * vec2(40., 7.)) * 0.6 + vnz(vUv * vec2(160., 30.)) * 0.4;
  vec3 gray = vec3(0.36, 0.35, 0.34) * (0.85 + 0.15 * sin(vUv.x * 60. + vUv.y * 6.)) * (0.8 + 0.35 * dye) * (1. + 0.08 * wv);
  vec3 red = mix(vec3(0.5, 0.04, 0.02), vec3(1.0, 0.2, 0.06), 0.5 + 0.5 * sin(vUv.x * 14. + uTime)) * (0.8 + 0.35 * dye) * (1. + 0.08 * wv);
  vec3 base = mix(gray, red, smoothstep(0.0, 1.0, uAwake));
  float line = smoothstep(0.05, 0.0, abs(vUv.y - 0.5)) + smoothstep(0.03, 0.0, abs(vUv.y - 0.12)) + smoothstep(0.03, 0.0, abs(vUv.y - 0.88));
  float dash = step(0.5, fract(vUv.x * 36.));
  // glyph row between the stitched borders: small diamonds that light up as the cloth wakes
  vec2 gp = vec2(fract(vUv.x * 18.) - 0.5, (vUv.y - 0.31) * 5.);
  float glyph = smoothstep(0.08, 0.0, abs(abs(gp.x) + abs(gp.y) - 0.34)) * step(abs(vUv.y - 0.31), 0.1) + smoothstep(0.08, 0.0, abs(abs(gp.x) + abs(vUv.y * 5. - 3.75) - 0.34)) * step(abs(vUv.y - 0.75), 0.1);
  vec3 col = clothLight(base, N, V, 0.9);
  vec3 glow = mix(vec3(0.15), vec3(2.8, 1.9, 1.0), uAwake) * (1. + uPulse * 1.5);
  col += line * dash * glow + glyph * glow * 0.8;
  col += uPulse * 0.4 * base;
  col = mix(col, uFog, 1. - exp(-pow(dist * uFogD, 2.)));
  gl_FragColor = vec4(col, 1.);
}`;
const bannerVert = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() { vUv = uv; vN = normal; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;

export class ClothBanner {
  /** Hangs between world points a and b; width along the vertical. */
  constructor(scene, a, b, width = 4.2) {
    this.a = a.clone(); this.b = b.clone(); this.width = width;
    this.awake = 0; this.pulse = 0; this.target = 0;
    this.segU = 34; this.segV = 6;
    this.geo = new THREE.PlaneGeometry(1, 1, this.segU, this.segV);
    this.geo.boundingSphere = new THREE.Sphere(a.clone().lerp(b, 0.5), a.distanceTo(b) + 30);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...clothUniforms, uAwake: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: bannerVert, fragmentShader: bannerFrag, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.center = a.clone().lerp(b, 0.5);
    this.len = a.distanceTo(b);
    this.dir = b.clone().sub(a).normalize();
    this.side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.rebuild(0);
  }

  rebuild(time) {
    const pos = this.geo.attributes.position.array;
    const nor = this.geo.attributes.normal.array;
    const { segU, segV } = this;
    const aw = this.awake;
    let k = 0;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;                       // 0 top .. 1 bottom (PlaneGeometry: first row is top)
      for (let i = 0; i <= segU; i++) {
        const u = i / segU;
        const sag = Math.sin(u * Math.PI);
        // dormant: draped, sagging between posts; awake: lifted and rippling in the wind
        const hang = (1 - aw) * (1.6 + 4.4 * sag);
        const lift = aw * (2.5 + 4.5 * sag + Math.sin(time * 1.6 + u * 7.0) * 0.8 * sag);
        const wave = Math.sin(time * (1.4 + aw * 1.5) + u * 9. + v * 2.) * (0.25 + 1.3 * aw) * sag;
        const base = this.a.clone().lerp(this.b, u);
        const y = base.y - v * this.width * (1 - 0.6 * aw) - hang + lift + 3.0;
        pos[k] = base.x + this.side.x * wave;
        pos[k + 1] = y + Math.sin(time * 2.2 + u * 5. + v) * 0.3 * aw * sag;
        pos[k + 2] = base.z + this.side.z * wave;
        nor[k] = this.side.x; nor[k + 1] = 0; nor[k + 2] = this.side.z;
        k += 3;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  update(dt, time) {
    this.awake += (this.target - this.awake) * (1 - Math.exp(-0.8 * dt));
    if (this.target > 0.5 && this.awake > 0.98) this.awake = 1;
    this.pulse = Math.max(0, this.pulse - dt * 1.4);
    this.mat.uniforms.uAwake.value = this.awake;
    this.mat.uniforms.uPulse.value = this.pulse;
    this.rebuild(time);
  }
}
