import * as THREE from 'three';
import { makeRobeTexture, makeWeaveNormal, makeScarfMask, makeBlobShadow, makeSoftDot } from './textures.js';
import { terrainHeight, terrainGradient, smooth, clamp, WIND } from './world/heightfield.js';

// ------------------------------------------------------------------ proportions (metres, feet at y = 0)
const HIP_Y = 0.64, HIP_X = 0.085, THIGH = 0.34, SHIN = 0.34;
const HEM_Y = 0.30, SHOULDER_Y = 1.12, HEAD_Y = 1.34;

let _weave;
/** Woven-cloth physical material: velvet sheen, weave normals, glossy gold thread (roughness/metal map), sun translucency, optional hem dust. */
function fabricMaterial(params, tex, { dust = false, trans = 1, sheenColor = 0xffa070 } = {}) {
  const nm = _weave || (_weave = makeWeaveNormal()), mr = tex.userData.mr;
  nm.repeat.set(10, 5);
  const mat = new THREE.MeshPhysicalMaterial({
    ...params, map: tex, emissiveMap: tex, roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1, normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55),
    sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(sheenColor),
  });
  const dustCode = dust ? `{
  float dn = vn(vMapUv * vec2(60., 24.)) * 0.6 + vn(vMapUv * vec2(210., 90.)) * 0.4;
  dustK = smoothstep(0.50 + dn * 0.12, 0.30, vLY) * (0.45 + 0.55 * dn);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.6, 0.38) * (0.8 + 0.4 * dn), dustK * 0.45);
}` : '';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying float vLY;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLY = position.y;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `varying float vLY;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float dustK = 0.;
${dustCode}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.92, dustK);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1. - dustK * 0.75;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  // thin cloth lit from behind: warm light bleeding through, strongest at grazing angles
  vec3 Lv = directionalLights[0].direction, Vv = normalize(vViewPosition);
  float back = pow(clamp(-dot(Vv, Lv), 0., 1.), 2.5) * (0.35 + 0.65 * (1. - abs(dot(Vv, normal))));
  reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * vec3(1.15, 0.5, 0.28) * back * ${(0.55 * trans).toFixed(2)} * (1. - dustK * 0.5);
}
#endif`);
  };
  return mat;
}

/** Hooks the robe material so its lower half sways, flares and is kicked by the legs. */
function robeSwayMaterial(params, tex, sheenColor) {
  const mat = fabricMaterial(params, tex, { dust: true, sheenColor });
  const u = {
    uSway: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFlutter: { value: 0 },
    uStride: { value: 0 }, uStrideAmt: { value: 0 }, uFlare: { value: 0 },
    uSpread: { value: 0 }, uTuck: { value: 0 },
  };
  mat.userData.sway = u;
  const fab = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    fab(shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSway; uniform float uTime, uFlutter, uStride, uStrideAmt, uFlare, uSpread, uTuck;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float h = clamp((${SHOULDER_Y.toFixed(2)} - position.y) / ${(SHOULDER_Y - HEM_Y).toFixed(2)}, 0., 1.);
  float w = h * h;
  vec2 dir = normalize(position.xz + 1e-5);
  float a = atan(position.z, position.x);
  transformed.xz += uSway.xz * w;
  transformed.y += uSway.y * w;
  // the shins push the front of the hem forward on each stride
  float front = smoothstep(-0.2, 0.9, dir.y);
  float k0 = max(0., sin(uStride)), k1 = max(0., -sin(uStride));
  float kick = k0 * smoothstep(-0.35, 0.6, dir.x) + k1 * smoothstep(0.35, -0.6, dir.x);
  transformed.z += w * w * front * uStrideAmt * 0.13 * kick;
  // billow open in flight
  transformed.xz += dir * w * uFlare * 0.16;
  transformed.y += w * uFlare * 0.07;
  // glide: the robe opens sideways like a wing and its hem trails back and lifts
  transformed.x *= 1. + uSpread * 0.6 * h;
  transformed.z = transformed.z * (1. - uSpread * 0.25 * h) - uSpread * w * 0.2;
  transformed.y += uSpread * w * 0.1;
  // dive: wrapped tight around the body, streaming out behind
  transformed.xz *= 1. - uTuck * 0.38 * h;
  transformed.z -= uTuck * w * 0.4;
  transformed.y += uTuck * w * 0.16;
  // travelling ripples around the hem
  float rip = sin(a * 6. + uTime * 6.5 + position.y * 9.) * 0.6 + sin(a * 11. - uTime * 9.) * 0.4;
  transformed.xz += dir * w * uFlutter * 0.028 * rip;
  transformed.y += w * w * uFlutter * 0.035 * sin(a * 5. - uTime * 5.);
}`);
  };
  return mat;
}

function bentCone(r, h, bend, seg = 18) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(Math.max(0.002, r * Math.pow(1 - t, 0.85)), t * h)); }
  const g = new THREE.LatheGeometry(pts, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setZ(i, p.getZ(i) - bend * t * t); }
  g.computeVertexNormals();
  return g;
}

/** One sleeve panel in body space (pivot at the shoulder): a soft, slightly cupped cloth wing. */
function wingGeometry(sx, nu = 7, nv = 6) {
  const pos = [], uv = [], ind = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const tx = 0.62 * u, ty = -0.1 * u * u, tz = -0.03 * u;                       // top edge: shoulder to wrist
      const bx = 0.05 + 0.3 * u, by = -0.66 + 0.36 * u, bz = -0.04 - 0.06 * u;      // bottom edge: hip to wrist
      const x = tx + (bx - tx) * v, y = ty + (by - ty) * v;
      const z = tz + (bz - tz) * v - 0.07 * Math.sin(Math.PI * v) * u;             // cupped back like a sail
      pos.push(sx * x, y, z); uv.push(u * 0.5, 0.3 + v * 0.5);
      if (i < nu && j < nv) { const a = j * (nu + 1) + i, b = a + nu + 1; ind.push(a, b, a + 1, a + 1, b, b + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ model
export function buildTraveler({ white = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const robeTex = makeRobeTexture(white);
  const emissive = white ? 0.42 : 0.2;
  const sheen = white ? 0xfff0d8 : 0xffa070;
  const robeMat = robeSwayMaterial({ side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: emissive }, robeTex, sheen);
  const hoodCol = new THREE.Color(white ? 0xf4eee4 : 0xa82a15);
  const hoodMaker = (shade) => {
    const m = new THREE.MeshPhysicalMaterial({ color: hoodCol, roughness: 0.8, metalness: 0, emissive: hoodCol, emissiveIntensity: emissive, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(sheen) });
    if (shade) m.onBeforeCompile = (sh) => {
      // the hood's opening: cloth falls into deep shadow toward the face
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vLP;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec3 vLP;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
float hoodAO; { float fr = smoothstep(0.02, 0.17, vLP.z); float d = length((vLP.xy - vec2(0., -0.012)) * vec2(1.3, 0.92)); hoodAO = mix(1., smoothstep(0.09, 0.27, d), fr); hoodAO = mix(0.12, 1., hoodAO); }
diffuseColor.rgb *= hoodAO;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= hoodAO * hoodAO;');
    };
    return m;
  };
  const hoodMat = hoodMaker(true), tipMat = hoodMaker(false);

  // robe: narrow at the shoulders, falling into a wide, soft hem just below the knees
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.345, HEM_Y + 0.012), new THREE.Vector2(0.375, HEM_Y), new THREE.Vector2(0.365, HEM_Y + 0.08),
    new THREE.Vector2(0.32, 0.52), new THREE.Vector2(0.275, 0.72), new THREE.Vector2(0.24, 0.90),
    new THREE.Vector2(0.225, 1.02), new THREE.Vector2(0.19, 1.10), new THREE.Vector2(0.135, 1.16), new THREE.Vector2(0.085, 1.19),
  ]).getPoints(40);
  const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), robeMat);
  body.add(robe);

  // head: hood + dark face with two glowing eyes; a tall soft point that flops behind
  const head = new THREE.Group(); head.position.y = HEAD_Y; body.add(head);
  const skull = new THREE.Group(); skull.scale.set(0.93, 1.13, 1.0); head.add(skull);
  skull.add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 20), hoodMat));
  // an oval of shadow inside the hood
  const faceMat = new THREE.MeshLambertMaterial({ color: white ? 0x120d0a : 0x050202 });
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 18), faceMat);
  face.scale.set(0.8, 0.9, 0.42); face.position.set(0, -0.012, 0.13);
  skull.add(face);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.9, 2.0) });
  const eyes = [], haloMat = new THREE.SpriteMaterial({ map: makeSoftDot(), color: new THREE.Color(1.4, 1.0, 0.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.015, 12), eyeMat);
    // sit on the face's oval surface, angled slightly outward
    const ex = sx * 0.046, ey = 0.008;
    const ez = 0.13 + 0.063 * Math.sqrt(Math.max(0, 1 - (ex / 0.12) ** 2 - (ey / 0.135) ** 2)) + 0.004;
    eye.position.set(ex, ey, ez);
    eye.rotation.y = sx * 0.45;
    eye.scale.set(0.85, 1.55, 1);
    const halo = new THREE.Sprite(haloMat); halo.scale.set(0.12, 0.075, 1); eye.add(halo);   // soft bloom halo
    skull.add(eye); eyes.push(eye);
  }
  const tipPivot = new THREE.Group(); tipPivot.position.set(0, 0.15, -0.02); head.add(tipPivot);
  const tip = new THREE.Mesh(bentCone(0.13, 0.42, 0.16), tipMat);
  tip.rotation.x = -0.12;
  tipPivot.add(tip);

  // neck wrap where the scarf begins
  const wrapMat = new THREE.MeshPhysicalMaterial({ sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(sheen), color: white ? 0xf2ead8 : 0x8a160a, roughness: 0.8, emissive: white ? 0x50483c : 0x2a0402, emissiveIntensity: 0.8 });
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.05, 10, 28), wrapMat);
  wrap.rotation.x = Math.PI / 2 + 0.12; wrap.position.set(0, 1.17, -0.01); wrap.scale.set(1, 1.05, 0.8);
  body.add(wrap);

  // sleeve "wings": cloth panels from shoulder to wrist to hem, folded away (scale 0) until the traveler glides
  const wingMat = fabricMaterial({ side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: emissive }, robeTex, { trans: 1.6, sheenColor: sheen });
  const wings = [1, -1].map((sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.16, 1.07, -0.03);
    const mesh = new THREE.Mesh(wingGeometry(sx), wingMat);
    pivot.add(mesh);
    pivot.scale.set(0.001, 0.4, 1);
    pivot.visible = false;
    body.add(pivot);
    return { pivot, mesh, side: sx };
  });

  // thin dark legs: thigh + shin per side, solved by IK every frame
  const legMat = new THREE.MeshStandardMaterial({ color: white ? 0xd8cfc0 : 0x1c0e09, roughness: 0.7 });
  const thighGeo = new THREE.CylinderGeometry(0.036, 0.03, 1, 8); thighGeo.translate(0, 0.5, 0);
  const shinGeo = new THREE.CylinderGeometry(0.029, 0.021, 1, 8); shinGeo.translate(0, 0.5, 0);
  const footGeo = new THREE.SphereGeometry(1, 10, 6); footGeo.scale(0.034, 0.024, 0.075); footGeo.translate(0, 0.012, 0.03);
  const legs = [0, 1].map((i) => {
    const thigh = new THREE.Mesh(thighGeo, legMat), shin = new THREE.Mesh(shinGeo, legMat), foot = new THREE.Mesh(footGeo, legMat);
    root.add(thigh, shin, foot);
    return { side: i === 0 ? 1 : -1, thigh, shin, foot };
  });

  const rig = { root, body, robe, head, tipPivot, legs, sway: robeMat.userData.sway, eyes, wings };
  root.userData.rig = rig;
  // rest pose so static clones (the ending's white travelers) stand on their feet
  poseLegs(rig, [new THREE.Vector3(HIP_X, 0, 0.02), new THREE.Vector3(-HIP_X, 0, -0.02)]);
  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return root;
}

const _hip = new THREE.Vector3(), _knee = new THREE.Vector3(), _d = new THREE.Vector3(), _fwd = new THREE.Vector3(), _side = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
function placeBone(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-4;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(_Y, _d.multiplyScalar(1 / len));
  mesh.scale.set(1, len, 1);
}

/** Two-bone IK in model space; knees bend forward. feet: model-space ankle targets. */
function poseLegs(rig, feet, footPitch = [0, 0]) {
  const body = rig.body;
  body.updateMatrix();
  rig.legs.forEach((leg, i) => {
    _hip.set(HIP_X * leg.side, HIP_Y, 0).applyMatrix4(body.matrix);
    const f = feet[i];
    _d.subVectors(f, _hip);
    let dist = _d.length();
    const maxL = (THIGH + SHIN) * 0.999;
    if (dist > maxL) { f.copy(_hip).addScaledVector(_d, maxL / dist); dist = maxL; }
    _d.subVectors(f, _hip).normalize();
    // knee direction: forward, perpendicular to the hip→foot line
    _fwd.set(0, 0, 1).addScaledVector(_d, -_d.z).normalize();
    const a = (THIGH * THIGH + dist * dist - SHIN * SHIN) / (2 * THIGH * dist);
    const along = THIGH * a, out = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
    _knee.copy(_hip).addScaledVector(_d, along).addScaledVector(_fwd, out);
    placeBone(leg.thigh, _hip, _knee);
    placeBone(leg.shin, _knee, f);
    leg.foot.position.copy(f);
    leg.foot.rotation.set(footPitch[i] || 0, 0, 0);
  });
}

// ------------------------------------------------------------------ scarf
const scarfVert = /* glsl */`
attribute float aIdx;
varying vec2 vUv; varying float vIdx; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv; vIdx = aIdx; vN = normal; vW = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const scarfFrag = /* glsl */`
precision highp float;
uniform sampler2D uMask;
uniform float uCharge, uN, uTime, uFlash, uFogD;
uniform vec3 uSunDir, uSunColor, uAmb, uFog, uBase;
varying vec2 vUv; varying float vIdx; varying vec3 vN; varying vec3 vW;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
void main() {
  // frayed end: the last stretch unravels into loose threads of different lengths
  float tipT = clamp((vIdx - (uN - 3.2)) / 2.2, 0., 1.);
  if (tipT > 0.) {
    float c = floor(vUv.x * 28.), keep = 0.25 + 0.75 * h21(vec2(c, 7.));
    float broken = step(0.82, h21(vec2(c, floor(vUv.y * 18.))));
    if (tipT > keep * (1. - 0.25 * broken) || (tipT > 0.55 && h21(vec2(c, floor(vUv.y * 90.))) < tipT * 0.5)) discard;
  }
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW), wf = 1. - smoothstep(3., 12., dist);
  float m = texture2D(uMask, vUv).r, halo = texture2D(uMask, vUv, 3.).r;
  float charged = uCharge * uN;
  float lit = 1. - smoothstep(charged - 1.2, charged, vIdx);
  float edge = abs(vUv.x * 2. - 1.);
  // plain weave: warp threads run along the scarf, weft across
  float warp = sin(vUv.x * 188.), weft = sin(vUv.y * 360.);
  float weave = warp * weft, grain = 0.5 + 0.5 * weft;
  vec3 base = uBase;
  base *= 0.88 + 0.1 * sin(vUv.y * 90. + vUv.x * 7.) + (0.1 * weave + 0.05 * warp) * wf;
  base = mix(base, vec3(0.95, 0.62, 0.24), smoothstep(0.84, 0.93, edge));
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float diff = max(ndl, 0.) * 0.6 + pow(max(-ndl, 0.), 2.) * 0.55;   // thin cloth glows when back-lit
  vec3 col = base * (uAmb * 0.45 + uSunColor * (0.25 + diff));
  // translucency: sun bleeding through the cloth toward the viewer
  col += base * vec3(1.2, 0.5, 0.25) * uSunColor * pow(clamp(-dot(V, L), 0., 1.), 3.) * (0.5 + 0.5 * (1. - abs(dot(V, N)))) * 0.6;
  // velvet sheen at grazing angles + a satin streak from the warp threads
  float fres = pow(1. - abs(dot(V, N)), 2.5);
  col += vec3(1.0, 0.55, 0.3) * (uSunColor * 0.8 + uAmb * 0.4) * fres * 0.55 * (0.8 + 0.2 * warp);
  float shimmer = 0.85 + 0.15 * sin(uTime * 3. + vIdx * 0.7);
  vec3 glyphLit = vec3(3.2, 2.5, 1.5) * shimmer;
  vec3 glyphDim = vec3(0.5, 0.2, 0.09);
  // glyphs are glowing gold thread: slightly beaded along the weave, with a soft halo bleeding into the cloth
  float thread = m * (0.78 + 0.22 * (0.5 + 0.5 * weft));
  col += thread * mix(glyphDim, glyphLit, lit) + halo * 0.35 * mix(glyphDim * 0.4, glyphLit * 0.4, lit);
  // a faint warm sheen over the whole charged length
  col += base * lit * 0.25 * shimmer;
  col += uFlash * vec3(1.5, 1.0, 0.6) * (0.5 + 0.5 * m);
  col = mix(col, uFog, 1. - exp(-pow(dist * uFogD, 2.)));
  gl_FragColor = vec4(col, 1.);
}`;

export class Scarf {
  constructor(scene, maxN = 34) {
    this.maxN = maxN; this.n = 10; this.seg = 0.28;
    this.pts = Array.from({ length: maxN }, () => new THREE.Vector3());
    this.prev = Array.from({ length: maxN }, () => new THREE.Vector3());
    const pos = new Float32Array(maxN * 6), nor = new Float32Array(maxN * 6), uv = new Float32Array(maxN * 4), idx = new Float32Array(maxN * 2);
    const ind = [];
    for (let i = 0; i < maxN; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i * 0.5; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i * 0.5;
      idx[i * 2] = i; idx[i * 2 + 1] = i;
      if (i < maxN - 1) { const a = i * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    geo.setIndex(ind);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;
    const mask = makeScarfMask();
    this.uniforms = {
      uMask: { value: mask }, uCharge: { value: 1 }, uN: { value: 10 }, uTime: { value: 0 }, uFlash: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.6) },
      uFog: { value: new THREE.Color() }, uFogD: { value: 0.0005 }, uBase: { value: new THREE.Color(0.62, 0.10, 0.045) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: scarfVert, fragmentShader: scarfFrag, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3(); this.tmpC = new THREE.Vector3(); this.tmpD = new THREE.Vector3();
    this.side = new THREE.Vector3(1, 0, 0);
  }

  setLength(n) {
    n = clamp(Math.round(n), 8, this.maxN);
    for (let i = this.n; i < n; i++) { this.pts[i].copy(this.pts[Math.max(0, this.n - 1)]); this.prev[i].copy(this.pts[i]); }
    this.n = n; this.uniforms.uN.value = n;
  }

  reset(anchor, backDir) {
    for (let i = 0; i < this.maxN; i++) {
      this.pts[i].copy(anchor).addScaledVector(backDir, i * this.seg * 0.8);
      this.prev[i].copy(this.pts[i]);
    }
  }

  /**
   * Verlet ribbon. `back` is the traveler's backward direction, `body` = {x, y, z} feet position for robe collision,
   * `buoy` 0..1 how much the charged cloth floats.
   */
  update(dt, anchor, vel, flutter, time, back, body, buoy = 0.5) {
    const n = this.n, L = this.seg, P = this.pts, Q = this.prev;
    P[0].copy(anchor); Q[0].copy(anchor);
    const speed = Math.hypot(vel.x, vel.z);
    const wx = WIND.x * 1.6, wz = WIND.z * 1.6;
    const idt = 1 / Math.max(dt, 1e-4);
    const drag = 2.4;
    // rest pose: hangs down the back when still, streams out level at speed or when charged in flight
    const down = clamp(0.95 - speed * 0.1 - buoy * 0.25, 0.12, 0.95), hor = Math.sqrt(1 - down * down);
    for (let i = 1; i < n; i++) {
      const p = P[i], q = Q[i];
      // velocities in m/s; air drag is relative to the wind, so the cloth streams behind a moving traveler
      const vx = (p.x - q.x) * idt, vy = (p.y - q.y) * idt, vz = (p.z - q.z) * idt;
      q.copy(p);
      const f = i / n;
      // a flag-like wave travelling down the cloth, quicker and stronger the faster the air rushes past
      const ph = time * (2.6 + speed * 0.45) - i * 0.62;
      const wave = (2.0 + speed * 0.9) * flutter * (0.3 + f);
      const sx = -back.z, sz = back.x;            // sideways, across the traveler's back
      const flap = Math.sin(ph) * wave, lift = Math.sin(ph * 1.3 + 1.1) * wave * 1.25;
      let ax = -drag * (vx - wx) + sx * flap + Math.sin(ph * 0.7) * wave * 0.3;
      let ay = -drag * vy - 5.5 + 3.4 * buoy + lift;
      let az = -drag * (vz - wz) + sz * flap + Math.cos(ph * 0.9) * wave * 0.3;
      if (back) {
        const K = 9 / (1 + i * 0.6);
        const along = 0.12 + i * L, hz = along * hor, vt = along * down;
        ax += (anchor.x + back.x * hz - p.x) * K; ay += (anchor.y - vt - p.y) * K; az += (anchor.z + back.z * hz - p.z) * K;
      }
      p.x += (vx + ax * dt) * dt; p.y += (vy + ay * dt) * dt; p.z += (vz + az * dt) * dt;
    }
    // distance constraints (a few passes, both directions for stiffness)
    for (let it = 0; it < 5; it++) {
      for (let i = 1; i < n; i++) {
        const a = P[i - 1], b = P[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-5;
        const k = (d - L) / d;
        if (i === 1) { b.x -= dx * k; b.y -= dy * k; b.z -= dz * k; }
        else { a.x += dx * k * 0.5; a.y += dy * k * 0.5; a.z += dz * k * 0.5; b.x -= dx * k * 0.5; b.y -= dy * k * 0.5; b.z -= dz * k * 0.5; }
      }
      P[0].copy(anchor);
      // keep the cloth outside the robe's cone
      if (body) {
        for (let i = 1; i < Math.min(n, 8); i++) {
          const p = P[i];
          const hy = p.y - body.y;
          if (hy < 0 || hy > 1.25) continue;
          const rr = 0.2 + 0.19 * clamp((1.12 - hy) / 0.82, 0, 1) + 0.05;
          const dx = p.x - body.x, dz = p.z - body.z, d = Math.hypot(dx, dz);
          if (d < rr) {
            const ox = d > 1e-4 ? dx / d : back.x, oz = d > 1e-4 ? dz / d : back.z;
            p.x = body.x + ox * rr; p.z = body.z + oz * rr;
          }
        }
      }
    }
    // light smoothing so the cloth curves instead of zig-zagging (frame-rate independent)
    const sm = 1 - Math.pow(0.8, dt * 60);
    for (let i = 2; i < n - 1; i++) {
      const a = P[i - 1], b = P[i + 1], c = P[i];
      c.x += ((a.x + b.x) * 0.5 - c.x) * sm; c.y += ((a.y + b.y) * 0.5 - c.y) * sm; c.z += ((a.z + b.z) * 0.5 - c.z) * sm;
    }
    for (let i = 2; i < n; i++) {
      const gy = terrainHeight(P[i].x, P[i].z) + 0.06;
      if (P[i].y < gy) { P[i].y = gy; Q[i].x += (P[i].x - Q[i].x) * 0.3; Q[i].z += (P[i].z - Q[i].z) * 0.3; }
    }
    this._rebuild(time, flutter, back);
  }

  _rebuild(time, flutter, back) {
    const n = this.n, P = this.pts;
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array;
    const t = this.tmpA, s = this.tmpB, nn = this.tmpC, up = this.tmpD;
    // a stable "across" vector: the traveler's shoulder line, carried down the ribbon (parallel transport)
    const prevS = this.side;
    if (back) prevS.set(-back.z, 0, back.x);
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      t.subVectors(b, a); if (t.lengthSq() < 1e-8) t.set(0, 0, -1); t.normalize();
      // project the previous side vector onto the plane normal to the tangent
      s.copy(prevS).addScaledVector(t, -prevS.dot(t));
      if (s.lengthSq() < 1e-4) { up.set(0, 1, 0); s.crossVectors(t, up); }
      s.normalize();
      prevS.copy(s);
      // gentle twist for a fluttering ribbon
      const f = i / Math.max(1, n - 1);
      const ang = Math.sin(time * 3.0 - i * 0.5) * (0.12 + 0.55 * flutter) * f;
      nn.crossVectors(s, t);
      const c = Math.cos(ang), sn = Math.sin(ang);
      const sx = s.x * c + nn.x * sn, sy = s.y * c + nn.y * sn, sz = s.z * c + nn.z * sn;
      const nx = nn.x * c - s.x * sn, ny = nn.y * c - s.y * sn, nz = nn.z * c - s.z * sn;
      let w = 0.16 * (1 - 0.2 * f);
      if (i === 0) w *= 0.7;
      if (i >= n - 2) w *= i === n - 1 ? 0.9 : 0.97;
      const o = i * 6, p = P[i];
      pos[o] = p.x - sx * w; pos[o + 1] = p.y - sy * w; pos[o + 2] = p.z - sz * w;
      pos[o + 3] = p.x + sx * w; pos[o + 4] = p.y + sy * w; pos[o + 5] = p.z + sz * w;
      nor[o] = nor[o + 3] = nx; nor[o + 1] = nor[o + 4] = ny; nor[o + 2] = nor[o + 5] = nz;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
}

// ------------------------------------------------------------------ controller
const WALK = 6.0;
const SURF_MAX = 25;
const GRAVITY = 15;
const COYOTE = 0.14, JUMP_BUFFER = 0.14;
const STRIDE = 1.45;                 // metres per footfall
const NO_INPUT = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false, dive: false, glide: false, glidePressed: false };

// ------------------------------------------------------------------ flight modes (all fed by the scarf)
// flutter: hold jump with charge — rise on the scarf (drains it)
// glide:   robe spread, slow sink, fast forward flight with banked turns; free (no charge)
// dive:    tucked plunge that trades height for speed; pulling out converts the fall into a forward swoop
// soar:    inside an updraft column the wind carries you up and refills the scarf
const FLUTTER_RISE = 6.6;
const GLIDE_SPEED = 14, GLIDE_SINK = 1.7, GLIDE_TURN = 1.6;       // m/s, m/s, rad/s
const DIVE_G = 22, DIVE_VMAX = 32, DIVE_HSPEED = 16;              // m/s², m/s, m/s
const SWOOP_MAX = 36;                                             // horizontal cap right after a pull-out
const AIR_MAX = 36;
const SOAR_RISE = 11;
const RIBBON_R = 4.5, RIBBON_BOOST = 8, RIBBON_CD = 6, RIBBON_MIN_SPEED = 5;

const exp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(scene, { white = false, scarfBase = null } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.model = buildTraveler({ white });
    this.rig = this.model.userData.rig;
    this.body = this.rig.body;
    this.group.add(this.model);
    scene.add(this.group);

    this.scarf = new Scarf(scene);
    if (scarfBase) this.scarf.uniforms.uBase.value.copy(scarfBase);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.turnRate = 0;
    this.grounded = true;
    this.airT = 0;           // time since last on the ground (coyote time)
    this.jumpBuf = 0;        // buffered jump press
    this.charge = 1;
    this.glyphs = 0;
    this.sing = 0;
    this.singing = false;
    this.flying = false;
    this.surfing = false;
    this.surfK = 0;          // smoothed 0..1 surf pose
    this.flyK = 0;           // smoothed 0..1 flight pose
    this.speed = 0;
    this.cold = 0;           // 0..1, slows the traveler in the snow
    this.lean = 0; this.roll = 0;
    this.frozen = false;     // cutscenes
    this.scripted = false;   // position driven externally (ending)
    this.collapse = 0;       // 0..1, lying in the snow (ending)
    this.flash = 0;
    this.stunned = 0;
    this.lookTarget = null;  // world point the hood turns toward
    this.push = new THREE.Vector3();   // external wind (m/s) the traveler is pressed by
    this.speedMul = 1;
    this.phase = 0;          // walk cycle (radians; one footfall per PI)
    this.strideAmt = 0;      // 0..1 how much the legs are walking
    this.squash = 0; this.squashV = 0;
    this.sway = new THREE.Vector3(); this.swayV = new THREE.Vector3();
    this.tip = new THREE.Vector2(); this.tipV = new THREE.Vector2();
    this.headYaw = 0; this.headPitch = 0;
    this.prevVel = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.idleT = 0;
    this._anchor = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._feet = [new THREE.Vector3(), new THREE.Vector3()];
    this._lastGy = 0; this._groundVy = 0;
    this.colliders = [];
    this.shelters = [];
    this.ledges = false;     // ground has drops (interior platforms): stepping off falls instead of snapping down
    this.events = [];
    // flight modes
    this.mode = 'ground';    // ground | fall | flutter | glide | dive | soar
    this.glideLatch = false; // glide toggled on (until landing / toggled off)
    this.diveBlock = false;  // after an automatic pull-out, dive needs a fresh press
    this.glideK = 0; this.diveK = 0; this.soarK = 0; this.flutK = 0; this.swoopK = 0;
    this.updraftK = 0;       // 0..1 strength of the updraft we are in
    this.swoopT = 0;         // > 0 right after a dive pull-out
    this.boostT = 0;         // > 0 during a ribbon boost (trail)
    this.boostCd = 0;
    this.diveT = 0; this.diveTop = 0;
    this.ribbonSources = []; // array (or function returning one) of Vector3-likes (cloth creatures, companions) that give a ribbon boost when flown close to
    this._ribbonCd = new WeakMap();
    this._clock = 0;
    this._flapT = 0;
    this.stats = { lastSwoop: null, peakDive: 0 };
    this._upd = { k: 0, sx: 0, sz: 0, cx: 0, cz: 0 };

    // soft blob shadow
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: makeBlobShadow(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
    sh.renderOrder = 1;
    this.shadow = sh;
    scene.add(sh);
  }

  teleport(x, z) {
    this.pos.set(x, terrainHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.grounded = true; this.airT = 0;
    this.mode = 'ground'; this.flying = false; this.glideLatch = false; this.swoopT = 0; this.boostT = 0;
    this.group.position.copy(this.pos);
    this._lastGy = this.pos.y;
    this._updateAnchor();
    this.scarf.reset(this._anchor, new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)));
  }

  setVisible(v) { this.group.visible = v; this.scarf.mesh.visible = v; this.shadow.visible = v; }

  scarfLength() { return 10 + this.glyphs * 2; }
  addGlyph() { this.glyphs++; this.scarf.setLength(this.scarfLength()); this.charge = 1; }
  tear(amount = 3) {
    const lost = Math.min(amount, this.glyphs * 2 > 0 ? Math.ceil(amount / 2) : 0);
    this.glyphs = Math.max(0, this.glyphs - lost);
    this.scarf.setLength(this.scarfLength());
    this.charge = 0;
    this.stunned = 1.2;
    return lost;
  }

  _updateAnchor() {
    const a = this._anchor;
    const sy = Math.sin(this.heading), cy = Math.cos(this.heading);
    // the neck, just behind the shoulders, following the body's lean and bob
    const up = 1.13 * (1 - 0.8 * this.collapse);
    const fwd = Math.sin(this.lean) * up - 0.1 + this.body.position.z;
    a.set(this.pos.x + sy * fwd, this.pos.y + this.body.position.y + Math.cos(this.lean) * up, this.pos.z + cy * fwd);
  }

  /** @param camYaw radians; camera sits behind the player at this yaw */
  update(dt, input, camYaw, time, env) {
    this.events.length = 0;
    const p = this.pos, v = this.vel;
    const inp = this.frozen ? NO_INPUT : input;
    if (this.stunned > 0) this.stunned -= dt;
    const stun = this.stunned > 0 ? 0.25 : 1;
    let surfAmt = 0, wishAmt = 0;

    if (!this.scripted) {
      // camera-relative wish direction
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      let wx = fx * inp.my + rx * inp.mx, wz = fz * inp.my + rz * inp.mx;
      const wl = Math.hypot(wx, wz);
      wishAmt = Math.min(1, wl);
      if (wl > 1e-4) { wx /= wl; wz /= wl; }

      // terrain
      const g = terrainGradient(p.x, p.z);
      const gx = g.x, gz = g.z, s = Math.hypot(gx, gz);
      surfAmt = smooth(0.27, 0.52, s);
      const coldMul = 1 - 0.35 * this.cold;
      let speedTarget = WALK * coldMul * stun * this.speedMul;
      if (this.grounded && wl > 0) {
        const uphill = (wx * gx + wz * gz);                // >0 when heading uphill
        speedTarget *= clamp(1 - 0.8 * Math.max(0, uphill) + 0.35 * Math.max(0, -uphill), 0.4, 1.25);
      }

      // jump (with coyote time + input buffering) & flight
      const wasGrounded = this.grounded;
      if (inp.jumpPressed) this.jumpBuf = JUMP_BUFFER; else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
      this.airT = this.grounded ? 0 : this.airT + dt;
      if (this.jumpBuf > 0 && (this.grounded || this.airT < COYOTE) && !this.frozen && this.stunned <= 0 && v.y <= 0.5) {
        v.y = 6.4; this.grounded = false; this.airT = COYOTE; this.jumpBuf = 0;
        this.squashV -= 2.5;
        this.events.push({ type: 'jump' });
      }
      this._clock += dt;
      const canAct = !this.frozen && this.stunned <= 0;
      const prevMode = this.mode;
      if (inp.glidePressed && canAct && !this.grounded) this.glideLatch = !this.glideLatch;
      if (!inp.dive) this.diveBlock = false;

      // updrafts: shared by everyone who passes env (player and companions)
      const upd = env && env.updrafts ? env.updrafts.sample(p, this._upd) : null;
      this.updraftK = upd ? upd.k : 0;
      // walking into a column: the wind takes you
      if (this.grounded && this.updraftK > 0.45 && canAct && !this.scripted) {
        this.grounded = false; v.y = Math.max(v.y, 4.5); this.airT = COYOTE; this.glideLatch = true;
        this.events.push({ type: 'liftoff' });
      }

      const gyNow = terrainHeight(p.x, p.z);
      const hAbove = p.y - gyNow;
      let mode = 'ground';
      if (!this.grounded) {
        if (inp.dive && canAct && !this.diveBlock && (prevMode === 'dive' || hAbove > 2.5)) mode = 'dive';
        else if (this.updraftK > 0.04 && canAct) mode = 'soar';
        else if (inp.jump && canAct && this.charge > 0.001) mode = 'flutter';
        else if (canAct && (this.glideLatch || inp.glide || (inp.jump && this.charge <= 0.001) || this.swoopT > 0)) mode = 'glide';
        else mode = 'fall';
      }
      // pulling out of a dive: the fall becomes forward speed, strongest close to the ground
      if (prevMode === 'dive' && mode !== 'dive' && !this.grounded) this._swoop(hAbove);
      if (mode === 'dive' && hAbove < 1.2 + Math.max(0, -v.y) * 0.16 && v.y < -4) {
        this._swoop(hAbove); this.diveBlock = true; mode = 'glide';
      }
      if (mode === 'dive' && prevMode !== 'dive') { this.diveT = 0; this.diveTop = p.y; this.events.push({ type: 'dive' }); }
      if (mode === 'glide' && prevMode !== 'glide' && prevMode !== 'soar') this.events.push({ type: 'glide' });
      if (mode === 'soar' && prevMode !== 'soar') this.events.push({ type: 'soar' });
      if (mode === 'soar') this.glideLatch = true;         // sail off the top of a column in a glide
      this.mode = mode;
      this.flying = mode === 'flutter';
      this.swoopT = Math.max(0, this.swoopT - dt);
      this.boostT = Math.max(0, this.boostT - dt);
      this.boostCd = Math.max(0, this.boostCd - dt);

      // vertical
      if (!this.grounded) {
        if (mode === 'flutter') {
          // rise in soft beats rather than a steady elevator
          const beat = 0.75 + 0.5 * Math.max(0, Math.sin(this._clock * 8.5));
          v.y += (FLUTTER_RISE - v.y) * exp(3.4 * beat, dt);
          const drain = 1 / (1.5 + 0.11 * this.scarf.n) * (1 + 0.35 * this.cold);
          this.charge = Math.max(0, this.charge - drain * dt);
          this._flapT -= dt;
          if (this._flapT <= 0) { this._flapT = 0.37; this.events.push({ type: 'flap', soft: false }); }
        } else if (mode === 'glide') {
          // sink slowly; momentum from a swoop or a jump carries you up a little first
          const sink = GLIDE_SINK + 1.2 * this.cold;
          if (v.y > -sink) v.y = Math.max(-sink, v.y - (this.swoopT > 0 ? 6 : 10) * dt);
          else v.y += (-sink - v.y) * exp(2.2, dt);
          this._flapT -= dt;
          if (this._flapT <= 0) { this._flapT = 1.1 + Math.random() * 0.5; this.events.push({ type: 'flap', soft: true }); }
        } else if (mode === 'dive') {
          v.y = Math.max(v.y - DIVE_G * dt, -DIVE_VMAX);
          this.diveT += dt;
        } else if (mode === 'soar') {
          const k = this.updraftK;
          v.y += (SOAR_RISE * k - 1.0 * (1 - k) - v.y) * exp(0.8 + 2.4 * k, dt);
          this.charge = Math.min(1, this.charge + 0.4 * k * dt);
        } else {
          v.y -= GRAVITY * (v.y > 0 ? 1 : 1.15) * dt;
        }
        v.y = Math.max(v.y, mode === 'dive' ? -DIVE_VMAX : -26);
      }

      // horizontal
      if (this.grounded) {
        // pressing uphill digs in: the slope barely drags you back, so steep dunes are a slow trudge, not a wall
        const climb = s > 1e-4 ? wishAmt * clamp((wx * gx + wz * gz) / s, 0, 1) : 0;
        if (surfAmt > 0) {
          const il = 1 / (s || 1);
          const acc = 28 * surfAmt * (1 - 0.9 * climb);
          v.x += -gx * il * acc * dt; v.z += -gz * il * acc * dt;
        }
        const hs0 = Math.hypot(v.x, v.z);
        // sliding sand barely brakes; carrying speed onto flatter ground runs out gradually instead of stopping dead
        let k = this.stunned > 0 ? 3 : (wishAmt > 0.05 ? 7.5 : 10) * (1 - 0.93 * surfAmt * (1 - climb));
        k *= 1 - 0.75 * smooth(WALK * 1.15, WALK * 2.6, hs0) * (1 - surfAmt);
        const tx = wx * speedTarget * wishAmt + this.push.x, tz = wz * speedTarget * wishAmt + this.push.z;
        if (surfAmt > 0.3 && wishAmt > 0.05) {
          // carve: rotate momentum toward the stick instead of braking
          const hs = Math.hypot(v.x, v.z);
          if (hs > 2) {
            const cur = Math.atan2(v.x, v.z), want = Math.atan2(wx, wz);
            const turn = clamp(wrapAngle(want - cur), -2.6 * dt, 2.6 * dt);
            const na = cur + turn;
            v.x = Math.sin(na) * hs; v.z = Math.cos(na) * hs;
          }
        }
        const kk = exp(k, dt);
        v.x += (tx - v.x) * kk; v.z += (tz - v.z) * kk;
      } else if (mode === 'glide' || mode === 'soar' || mode === 'dive') {
        // banked flight: momentum is turned toward the stick at a limited rate, like a paraglider
        let hs = Math.hypot(v.x, v.z);
        let cur = hs > 0.8 ? Math.atan2(v.x, v.z) : this.heading;
        const turnMax = mode === 'soar' ? 2.4 : mode === 'dive' ? 1.1 : GLIDE_TURN;
        let brake = 0;
        if (wishAmt > 0.05) {
          const want = Math.atan2(wx, wz);
          const dA = wrapAngle(want - cur);
          brake = Math.abs(dA) > 2.3 ? wishAmt : 0;          // stick against the flight: flare and slow down
          cur += clamp(dA, -turnMax * dt, turnMax * dt) * (brake ? 0.5 : 1) * Math.min(1, wishAmt * 1.5);
        }
        let target, k;
        if (mode === 'dive') { target = DIVE_HSPEED + Math.min(8, Math.max(0, -v.y) * 0.2); k = 0.9; }
        else if (mode === 'soar') { target = wishAmt > 0.05 ? 8 : 3; k = wishAmt > 0.05 ? 0.8 : 1.6; }
        else { target = GLIDE_SPEED * (1 - 0.45 * brake) * coldMul; k = hs > target ? (this.swoopT > 0 ? 0.12 : 0.35) : 1.1; }
        hs += (target - hs) * exp(k, dt);
        v.x = Math.sin(cur) * hs; v.z = Math.cos(cur) * hs;
        if (mode === 'soar' && upd) {
          // the column spirals you round its axis and, unless you steer out, holds you in it
          const hold = wishAmt > 0.05 ? 0.3 : 1;
          v.x += (upd.sx * 3 + upd.cx * 9 * hold) * dt; v.z += (upd.sz * 3 + upd.cz * 9 * hold) * dt;
        }
        v.x += this.push.x * 0.8 * dt; v.z += this.push.z * 0.8 * dt;
      } else {
        const air = (this.flying ? 8.4 : 7.0) * coldMul;
        const kk = exp(this.flying ? 2.8 : 2.2, dt);
        // keep momentum in the air unless steering against it
        const hs = Math.hypot(v.x, v.z);
        const tAmt = wishAmt > 0.05 ? Math.max(air * wishAmt, Math.min(hs, SURF_MAX) * 0.98) : hs * 0.985;
        const tx = wishAmt > 0.05 ? wx * tAmt : v.x * 0.985, tz = wishAmt > 0.05 ? wz * tAmt : v.z * 0.985;
        v.x += (tx - v.x) * kk; v.z += (tz - v.z) * kk;
        v.x += this.push.x * 0.8 * dt; v.z += this.push.z * 0.8 * dt;
      }
      if (!this.grounded) this._ribbons(dt);
      const hs = Math.hypot(v.x, v.z);
      // the ground can't carry more than surfing speed; the air can, briefly, after a swoop or boost
      if (this.grounded && hs > SURF_MAX) { const t = (SURF_MAX + (hs - SURF_MAX) * Math.exp(-4 * dt)) / hs; v.x *= t; v.z *= t; }
      const cap = !this.grounded && this.swoopT <= 0 && this.boostT <= 0 && mode !== 'dive' ? SWOOP_MAX : AIR_MAX;
      if (hs > cap) { v.x *= cap / hs; v.z *= cap / hs; }
      this.speed = Math.min(hs, cap);
      if (mode === 'dive') this.stats.peakDive = Math.max(this.stats.peakDive, Math.hypot(hs, v.y));

      // integrate
      const prevY = p.y;
      p.x += v.x * dt; p.z += v.z * dt; p.y += v.y * dt;
      this._collide();

      const gy = terrainHeight(p.x, p.z);
      if (this.grounded) {
        // leave the ground over crests when moving fast: the ground falls away faster than gravity could pull
        const groundVy = (gy - prevY) / dt;
        // interiors with ledges (cloth platforms): walking off an edge is a fall, not a snap down to the floor below
        if (this.ledges && gy < prevY - 0.9) {
          this.grounded = false; v.y = Math.min(0, this._groundVy); this.airT = 0;
        } else if (this.speed > 9 && groundVy < this._groundVy - GRAVITY * dt * 1.6 && groundVy < -2) {
          this.grounded = false; v.y = this._groundVy * 0.85; p.y = prevY + v.y * dt;
          this.airT = COYOTE;
        } else { p.y = gy; v.y = 0; this._groundVy = groundVy; }
      } else if (p.y <= gy && v.y <= 0) {
        const impact = -v.y;
        p.y = gy; v.y = 0; this.grounded = true; this._groundVy = 0;
        const fromDive = this.mode === 'dive';
        this.glideLatch = false; this.swoopT = 0; this.mode = 'ground'; this.flying = false;
        if (!wasGrounded && impact > 2.5) {
          this.events.push({ type: 'land', impact, dive: fromDive });
          this.squashV -= Math.min(6, impact * 0.55);
        }
      }
      this.surfing = this.grounded && surfAmt > 0.45 && this.speed > 8;

      // recharge
      if (this.grounded && !this.flying) this.charge = Math.min(1, this.charge + 0.28 * dt * (1 - 0.8 * this.cold));
    }

    // singing
    // a tap still sings a short note
    if (inp.sing && !this._singHeld) this.singMin = 0.32;
    this._singHeld = !!inp.sing;
    this.singMin = Math.max(0, (this.singMin || 0) - dt);
    this.singing = (!!inp.sing || this.singMin > 0) && !this.frozen;
    this.sing += ((this.singing ? 1 : 0) - this.sing) * exp(this.singing ? 5 : 3, dt);

    this._animate(dt, time, env, wishAmt);
  }

  _animate(dt, time, env, wishAmt) {
    const p = this.pos, v = this.vel, rig = this.rig;

    // acceleration (for secondary motion)
    this.accel.subVectors(v, this.prevVel).multiplyScalar(1 / Math.max(dt, 1e-3));
    this.prevVel.copy(v);
    const al = this.accel.length(); if (al > 60) this.accel.multiplyScalar(60 / al);

    // facing: turn toward the direction of travel; walking turns quicker than sliding
    let dTurn = 0;
    // face where we are going under our own power, not where the wind shoves us
    const ox = v.x - this.push.x, oz = v.z - this.push.z;
    if (Math.hypot(ox, oz) > 0.5) {
      const target = Math.atan2(ox, oz);
      dTurn = wrapAngle(target - this.heading);
      const k = this.surfing ? 5 : this.grounded ? 11 : 6;
      const step = dTurn * exp(k, dt);
      this.heading = wrapAngle(this.heading + step);
      this.turnRate += (step / Math.max(dt, 1e-3) - this.turnRate) * exp(10, dt);
    } else this.turnRate *= Math.exp(-8 * dt);

    this.surfK += ((this.surfing ? 1 : 0) - this.surfK) * exp(5, dt);
    const md = this.grounded ? 'ground' : this.mode;
    this.flyK += ((!this.grounded ? (this.flying || md === 'glide' || md === 'soar' || md === 'dive' ? 1 : 0.55) : 0) - this.flyK) * exp(this.grounded ? 10 : 4, dt);
    const mk = (cur, on, up = 4, down = 6) => cur + ((on ? 1 : 0) - cur) * exp(on ? up : down, dt);
    this.glideK = mk(this.glideK, md === 'glide', 3.5, this.grounded ? 9 : 4);
    this.soarK = mk(this.soarK, md === 'soar', 2.5, 2);
    this.diveK = mk(this.diveK, md === 'dive', 6, 4);
    this.flutK = mk(this.flutK, md === 'flutter', 6, 4);
    this.swoopK += ((this.swoopT > 0 ? Math.min(1, this.swoopT) : 0) - this.swoopK) * exp(6, dt);
    // how much of the pose is driven by a flight mode rather than the walking/jumping rig
    const airPose = clamp(this.glideK + this.soarK + this.diveK, 0, 1);

    // local-space velocity / acceleration
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const aFwd = this.accel.x * sh + this.accel.z * ch;
    const aSide = this.accel.x * ch - this.accel.z * sh;

    // lean: into acceleration, into turns, back on a slide, forward in flight
    const speedLean = clamp(this.speed / 22, 0, 0.16);
    const targetLean = this.flyK * (this.flying ? 0.5 : 0.18) + (1 - this.flyK) * (this.surfK * -0.16 + (1 - this.surfK) * speedLean)
      + clamp(aFwd * 0.012, -0.12, 0.14) * (this.grounded ? 1 : 0.4)
      + clamp(-(this.push.x * sh + this.push.z * ch) * 0.035, -0.1, 0.3);   // bend into a headwind
    const modeLean = (this.glideK * 0.62 + this.soarK * 0.18 + this.diveK * 1.25) / Math.max(airPose, 1e-3) + clamp(-v.y * 0.006, -0.05, 0.12) * this.diveK;
    this.lean += (THREE.MathUtils.lerp(targetLean, modeLean, airPose) - this.lean) * exp(7, dt);
    // banked turns: gliders lean well into the curve
    const bankMax = 0.42 + 0.3 * (this.glideK + this.soarK);
    const targetRoll = clamp(-this.turnRate * this.speed * (0.022 + 0.012 * this.glideK), -bankMax, bankMax) * (this.grounded ? 1 : 1.3)
      + Math.sin(time * 1.1) * 0.06 * this.soarK;
    this.roll += (targetRoll - this.roll) * exp(6, dt);

    // walk cycle: one footfall every STRIDE metres, legs scaled by speed
    const walking = this.grounded && !this.surfing ? smooth(0.2, 2.2, this.speed) : 0;
    this.strideAmt += (walking - this.strideAmt) * exp(walking > this.strideAmt ? 10 : 6, dt);
    const prevPhase = this.phase;
    if (walking > 0.01) this.phase += (this.speed / STRIDE) * Math.PI * dt;
    else if (this.strideAmt < 0.05) {
      // settle feet: snap the cycle to the nearest standing pose
      const target = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase += (target - this.phase) * exp(6, dt);
    }
    // a foot lands when its swing reaches the front (phase = PI/2 + k*PI)
    const fall = (x) => Math.floor((x - Math.PI / 2) / Math.PI);
    if (fall(prevPhase) !== fall(this.phase) && walking > 0.3) {
      const foot = ((fall(this.phase) % 2) + 2) % 2 === 0 ? 0 : 1;
      const side = foot === 0 ? 1 : -1;
      const fx = p.x + ch * HIP_X * side * 1.4 + sh * 0.18, fz = p.z - sh * HIP_X * side * 1.4 + ch * 0.18;
      this.events.push({ type: 'step', x: fx, z: fz, side, heading: this.heading });
    }

    // a groove in the sand while sliding
    if (this.surfing) {
      this._slideD = (this._slideD ?? 0) + this.speed * dt;
      if (this._slideD > 0.55) { this._slideD = 0; this.events.push({ type: 'step', x: p.x, z: p.z, side: 0, heading: this.heading, slide: true }); }
    }

    // squash & stretch spring (landings, take-off)
    this.squashV += (-this.squash * 140 - this.squashV * 14) * dt;
    this.squash += this.squashV * dt;
    this.squash = clamp(this.squash, -0.35, 0.25);

    // body transform
    const ph = this.phase, sa = this.strideAmt;
    const bob = -Math.abs(Math.sin(ph)) * 0.05 * sa + 0.025 * sa;   // highest at mid-stance
    const sideSway = Math.sin(ph) * 0.022 * sa;
    const breathe = Math.sin(time * 1.7) * 0.006 * (1 - sa);
    const crouch = this.surfK * -0.1 + Math.min(0, this.squash) * 0.45 - 0.04 * this.flyK * (this.flying ? 0 : 1);
    this.group.position.copy(p);
    this.group.rotation.y = this.heading;
    const body = this.body;
    // flight poses pivot about the traveler's middle instead of the feet
    const C = 0.62 * airPose;
    body.position.set(sideSway, bob + crouch + 0.3 * this.collapse + breathe + C * (1 - Math.cos(this.lean)), -C * Math.sin(this.lean));
    body.rotation.set(this.lean + Math.sin(ph * 2) * 0.03 * sa, Math.sin(ph) * 0.07 * sa, this.roll + 1.4 * this.collapse);
    const sq = 1 + this.squash;
    body.scale.set((1 + this.sing * 0.035) / Math.sqrt(sq), (1 + this.sing * 0.035) * sq, (1 + this.sing * 0.035) / Math.sqrt(sq));

    // legs
    const feet = this._feet;
    const halfStride = clamp(this.speed * 0.065, 0, 0.36) * sa;
    const lift = (0.07 + 0.08 * Math.min(1, this.speed / 6)) * sa;
    const pitch = [0, 0];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const lph = ph + (i === 0 ? 0 : Math.PI);
      const swing = Math.sin(lph);                       // +1 front, -1 back
      const up = Math.max(0, Math.cos(lph)) * lift;      // foot lifts while it travels forward
      let fx = HIP_X * side * 0.95, fy = up, fz = swing * halfStride + 0.03;
      pitch[i] = -Math.cos(lph) * 0.5 * sa;
      // standing: one foot a little forward
      fz += (1 - sa) * (i === 0 ? 0.05 : -0.04);
      // surfing: feet planted together, one forward like a board stance
      fx = THREE.MathUtils.lerp(fx, HIP_X * side * 1.25, this.surfK);
      fz = THREE.MathUtils.lerp(fz, i === 0 ? 0.16 : -0.12, this.surfK);
      fy = THREE.MathUtils.lerp(fy, 0, this.surfK);
      // airborne: tuck when jumping, trail behind when flying
      const air = this.flyK;
      const tuckY = this.flying ? 0.24 + 0.05 * Math.sin(time * 6 + i * 2) : 0.2 + (i === 0 ? 0.06 : 0);
      const tuckZ = this.flying ? -0.2 - 0.05 * Math.sin(time * 6 + i * 2) : (i === 0 ? 0.08 : -0.06);
      fy = THREE.MathUtils.lerp(fy, tuckY, air);
      fz = THREE.MathUtils.lerp(fz, tuckZ, air);
      if (air > 0.01) pitch[i] = THREE.MathUtils.lerp(pitch[i], this.flying ? 0.9 : 0.4, air);
      // glide / soar: legs trail straight out behind, gently scissoring; dive: knees pulled up tight
      if (airPose > 0.01) {
        const gw = (this.glideK + this.soarK) / Math.max(airPose, 1e-3), dw = this.diveK / Math.max(airPose, 1e-3);
        // hip and body axes in model space (the body is leaning by `lean` about x)
        const cl = Math.cos(this.lean), sl = Math.sin(this.lean);
        const hy = body.position.y + HIP_Y * cl, hz = body.position.z + HIP_Y * sl;
        const sc = Math.sin(time * 2.2 + i * Math.PI) * 0.05;
        // glide: legs straight down the body axis, gently scissoring; dive: knees drawn up toward the chest
        const gl = 0.66, dl = 0.3, df = 0.2 + (i === 0 ? 0.05 : -0.02);
        const gy2 = hy - cl * gl + sl * sc, gz2 = hz - sl * gl - cl * sc;
        const dy2 = hy - cl * dl - sl * df, dz2 = hz - sl * dl + cl * df;
        fy = THREE.MathUtils.lerp(fy, gy2 * gw + dy2 * dw, airPose);
        fz = THREE.MathUtils.lerp(fz, gz2 * gw + dz2 * dw, airPose);
        fx = THREE.MathUtils.lerp(fx, HIP_X * side * (0.9 * gw + 0.55 * dw), airPose);
        pitch[i] = THREE.MathUtils.lerp(pitch[i], 1.1 * gw + 1.3 * dw, airPose);
      }
      // collapse (ending): legs fold under the robe
      fy += 0.3 * this.collapse; fz -= 0.2 * this.collapse;
      // plant on the local slope
      if (this.grounded) {
        const wx = p.x + fx * ch + fz * sh, wz = p.z - fx * sh + fz * ch;
        fy += clamp(terrainHeight(wx, wz) - p.y, -0.25, 0.25) * (1 - this.surfK * 0.5);
      }
      feet[i].set(fx, fy, fz);
    }
    poseLegs(rig, feet, pitch);
    for (const leg of rig.legs) leg.thigh.visible = leg.shin.visible = leg.foot.visible = this.collapse < 0.6;

    // robe secondary motion: a damped spring that lags behind acceleration, with wind and stride kicks
    const wind = env && env.pal ? 0.25 + 0.6 * env.pal.snow : 0.25;
    const wlx = WIND.x * ch - WIND.z * sh, wlz = WIND.x * sh + WIND.z * ch;
    const tsx = clamp(-aSide * 0.006, -0.12, 0.12) + wlx * 0.04 * wind;
    const tsz = clamp(-aFwd * 0.006, -0.12, 0.12) - clamp(this.speed * 0.006, 0, 0.1) + wlz * 0.04 * wind - 0.08 * this.surfK;
    const tsy = (!this.grounded ? clamp(-v.y * 0.012, -0.05, 0.08) : 0);
    this.swayV.x += ((tsx - this.sway.x) * 90 - this.swayV.x * 9) * dt;
    this.swayV.y += ((tsy - this.sway.y) * 90 - this.swayV.y * 9) * dt;
    this.swayV.z += ((tsz - this.sway.z) * 90 - this.swayV.z * 9) * dt;
    this.sway.addScaledVector(this.swayV, dt);
    const su = rig.sway;
    su.uSway.value.copy(this.sway);
    su.uTime.value = time;
    su.uFlutter.value = clamp(0.25 + this.speed / 12 + this.flyK * 0.8 + wind * 0.4 + this.sing * 0.4, 0, 1.6);
    su.uStride.value = ph;
    su.uStrideAmt.value = sa * Math.min(1, this.speed / 5);
    su.uFlare.value = (this.flyK * (this.flying ? 1 : 0.5) + Math.max(0, -this.squash) * 0.8) * (1 - this.diveK) + 0.3 * this.soarK;
    su.uSpread.value = clamp(this.glideK + this.soarK * 0.85, 0, 1) * (1 - this.diveK);
    su.uTuck.value = this.diveK;

    // sleeve wings: spread wide to glide, beat while fluttering, folded away in a dive and on the ground
    const spread = clamp(this.glideK + this.soarK * 0.9 + this.flutK * 0.45, 0, 1) * (1 - this.diveK);
    for (const w of rig.wings) {
      w.pivot.visible = spread > 0.02;
      if (!w.pivot.visible) continue;
      const beat = Math.sin(time * 8.5) * this.flutK;
      const ripple = Math.sin(time * 3.1 + w.side) * 0.05 * (this.glideK + this.soarK);
      w.pivot.scale.set(Math.max(0.001, spread), 0.4 + 0.6 * spread, 1);
      // hang down beside the robe when half-open, out level when fully spread; a little dihedral; beats on flaps
      w.pivot.rotation.set(0.12 * spread, -w.side * 0.12 * spread, w.side * (-(1 - spread) * 0.9 + ripple + beat * 0.45 + 0.08 * spread));
    }

    // head looks toward points of interest, and the hood tip flops with the motion
    let wantYaw = clamp(-this.turnRate * 0.12, -0.5, 0.5), wantPitch = 0;
    if (this.lookTarget) {
      const dx = this.lookTarget.x - p.x, dz = this.lookTarget.z - p.z;
      const dy = this.lookTarget.y - (p.y + 1.4);
      const yaw = wrapAngle(Math.atan2(dx, dz) - this.heading);
      if (Math.abs(yaw) < 1.9) { wantYaw = clamp(yaw, -1.0, 1.0); wantPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.45, 0.35); }
    } else if (this.speed < 0.3) {
      // idle: glance around now and then
      this.idleT += dt;
      wantYaw = Math.sin(this.idleT * 0.37) * Math.sin(this.idleT * 0.23 + 1) * 0.8;
      wantPitch = -0.08 + Math.sin(this.idleT * 0.31) * 0.08;
    } else this.idleT = 0;
    if (this.sing > 0.1) wantPitch = THREE.MathUtils.lerp(wantPitch, -0.35, this.sing);
    this.headYaw += (wantYaw - this.headYaw) * exp(4, dt);
    this.headPitch += (wantPitch - this.headPitch) * exp(4, dt);
    rig.head.rotation.set(this.headPitch - this.lean * 0.4, this.headYaw, 0, 'YXZ');
    const tipTx = clamp(aFwd * 0.02 + this.speed * 0.025, -0.5, 0.9) + (!this.grounded ? clamp(v.y * 0.05, -0.4, 0.5) : 0);
    const tipTz = clamp(aSide * 0.02 - this.turnRate * 0.12, -0.6, 0.6);
    this.tipV.x += ((tipTx - this.tip.x) * 70 - this.tipV.x * 6) * dt;
    this.tipV.y += ((tipTz - this.tip.y) * 70 - this.tipV.y * 6) * dt;
    this.tip.addScaledVector(this.tipV, dt);
    // in fast flight the hood's point streams back along the body
    rig.tipPivot.rotation.set(-this.tip.x * 0.7 - Math.sin(time * 2.1) * 0.04 * wind - 1.9 * this.diveK - 0.35 * this.glideK, 0, this.tip.y * 0.6);

    // shadow
    const shd = this.shadow;
    const gy = terrainHeight(p.x, p.z);
    const up = Math.max(0, p.y - gy);
    const sd = env && env.sunDir ? env.sunDir : _Y;
    shd.position.set(p.x - sd.x * 0.15, gy + 0.05, p.z - sd.z * 0.15);
    shd.rotation.x = -Math.PI / 2;
    const sc = 1.3 + up * 0.18 + 0.4 * this.collapse;
    shd.scale.set(sc, sc * 1.1, 1);
    shd.material.opacity = 0.7 / (1 + up * 0.25);

    // scarf
    this._updateAnchor();
    const flutter = clamp(this.speed / 14 + (this.flying ? 0.7 : 0) + this.sing * 0.4 + wind * 0.3 + this.diveK * 0.4 + this.boostT * 0.5, 0.2, 1.5);
    this._back.set(-sh, 0, -ch);
    this.scarf.update(dt, this._anchor, v, flutter, time, this._back, p, Math.max(this.charge * (1 - this.diveK), this.soarK * 0.8, this.boostT > 0 ? 1 : 0));
    this.scarf.uniforms.uCharge.value += (this.charge - this.scarf.uniforms.uCharge.value) * exp(8, dt);
    this.scarf.uniforms.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.scarf.uniforms.uFlash.value = this.flash;
  }

  /** Pull out of a dive: the vertical speed swings round into forward speed and a short rising arc. */
  _swoop(hAbove) {
    const v = this.vel;
    const vd = Math.max(0, -v.y);
    const near = 1 - smooth(4, 24, hAbove);              // pulling out low is worth more
    const eff = 0.25 + 0.5 * near;
    const boost = vd * eff;
    let hs = Math.hypot(v.x, v.z);
    const dx = hs > 0.5 ? v.x / hs : Math.sin(this.heading), dz = hs > 0.5 ? v.z / hs : Math.cos(this.heading);
    const before = hs;
    hs = Math.min(SWOOP_MAX, hs + boost);
    v.x = dx * hs; v.z = dz * hs;
    v.y = Math.min(6, 1 + vd * 0.2 * (0.5 + near));
    this.swoopT = 1.6; this.glideLatch = true;
    this.squashV += 1.5;
    this.stats.lastSwoop = { fall: +vd.toFixed(2), before: +before.toFixed(2), after: +hs.toFixed(2), height: +hAbove.toFixed(2), divedFor: +this.diveT.toFixed(2), dropped: +(this.diveTop - this.pos.y).toFixed(2) };
    if (vd > 6) this.events.push({ type: 'swoop', boost: hs - before, speed: hs });
  }

  /** Flying close to a cloth creature or another traveler: a short charged boost with a trail. */
  _ribbons(dt) {
    if (this.boostCd > 0 || this.frozen || Math.hypot(this.vel.x, this.vel.y, this.vel.z) < RIBBON_MIN_SPEED) return;
    const list = typeof this.ribbonSources === 'function' ? this.ribbonSources() : this.ribbonSources;
    if (!list || !list.length) return;
    const p = this.pos, v = this.vel;
    for (const s of list) {
      if (!s || s === p) continue;
      const dx = s.x - p.x, dy = s.y - (p.y + 0.9), dz = s.z - p.z;
      if (dx * dx + dy * dy + dz * dz > RIBBON_R * RIBBON_R) continue;
      if ((this._ribbonCd.get(s) ?? -1e9) > this._clock) continue;
      this._ribbonCd.set(s, this._clock + RIBBON_CD);
      const hs = Math.hypot(v.x, v.z);
      const fx = hs > 0.5 ? v.x / hs : Math.sin(this.heading), fz = hs > 0.5 ? v.z / hs : Math.cos(this.heading);
      v.x += fx * RIBBON_BOOST; v.z += fz * RIBBON_BOOST;
      v.y = Math.max(v.y, 0) + 3.5;
      this.charge = Math.min(1, this.charge + 0.3);
      this.flash = Math.max(this.flash, 0.7);
      this.boostT = 1.1; this.boostCd = 2;
      this.events.push({ type: 'ribbon', x: s.x, y: s.y, z: s.z });
      return;
    }
  }

  _collide() {
    const p = this.pos, r = 0.45;
    for (const c of this.colliders) {
      if (p.y > c.top) continue;
      if (c.kind === 'circle') {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-4) {
          const nx = dx / d, nz = dz / d;
          p.x = c.x + nx * m; p.z = c.z + nz * m;
          // slide along the surface instead of stopping dead
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
        }
      } else {
        // oriented box
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
        const hx = c.hx + r, hz = c.hz + r;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
          let nx = lx, nz = lz, nlx = 0, nlz = 0;
          if (px < pz) { nx = Math.sign(lx || 1) * hx; nlx = Math.sign(lx || 1); } else { nz = Math.sign(lz || 1) * hz; nlz = Math.sign(lz || 1); }
          p.x = c.x + nx * cs - nz * sn; p.z = c.z + nx * sn + nz * cs;
          const wnx = nlx * cs - nlz * sn, wnz = nlx * sn + nlz * cs;
          const vn = this.vel.x * wnx + this.vel.z * wnz;
          if (vn < 0) { this.vel.x -= vn * wnx; this.vel.z -= vn * wnz; }
        }
      }
    }
  }

  isSheltered() {
    const p = this.pos;
    for (const s of this.shelters) {
      if (p.y >= s.y) continue;
      const dx = p.x - s.x, dz = p.z - s.z;
      if (s.hx !== undefined) { if (Math.abs(dx) < s.hx && Math.abs(dz) < s.hz) return true; }
      else if (dx * dx + dz * dz < s.r * s.r) return true;
    }
    return false;
  }
}
