import * as THREE from 'three';
import { makeRobeTexture, makeScarfMask, makeBlobShadow } from './textures.js';
import { terrainHeight, terrainGradient, smooth, clamp, WIND } from './world/heightfield.js';

// ------------------------------------------------------------------ proportions (metres, feet at y = 0)
const HIP_Y = 0.64, HIP_X = 0.085, THIGH = 0.34, SHIN = 0.34;
const HEM_Y = 0.30, SHOULDER_Y = 1.12, HEAD_Y = 1.34;

/** Hooks the robe material so its lower half sways, flares and is kicked by the legs. */
function robeSwayMaterial(params) {
  const mat = new THREE.MeshStandardMaterial(params);
  const u = {
    uSway: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFlutter: { value: 0 },
    uStride: { value: 0 }, uStrideAmt: { value: 0 }, uFlare: { value: 0 },
  };
  mat.userData.sway = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSway; uniform float uTime, uFlutter, uStride, uStrideAmt, uFlare;`)
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

// ------------------------------------------------------------------ model
export function buildTraveler({ white = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const robeTex = makeRobeTexture(white);
  const emissive = white ? 0.42 : 0.2;
  const robeMat = robeSwayMaterial({ map: robeTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: robeTex, emissiveIntensity: emissive });
  const hoodCol = new THREE.Color(white ? 0xf4eee4 : 0xa82a15);
  const hoodMat = new THREE.MeshStandardMaterial({ color: hoodCol, roughness: 0.85, metalness: 0, emissive: hoodCol, emissiveIntensity: emissive });

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
  const faceMat = new THREE.MeshStandardMaterial({ color: white ? 0x2a2420 : 0x0c0504, roughness: 0.6 });
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.1925, 24, 16, Math.PI / 2 - 0.78, 1.56, Math.PI / 2 - 0.62, 1.12), faceMat);
  skull.add(face);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.9, 2.0) });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.015, 12), eyeMat);
    const d = new THREE.Vector3(sx * 0.3, 0.06, 0.95).normalize();
    eye.position.copy(d).multiplyScalar(0.196);
    eye.lookAt(d.clone().multiplyScalar(2));
    eye.scale.set(0.85, 1.55, 1);
    skull.add(eye); eyes.push(eye);
  }
  const tipPivot = new THREE.Group(); tipPivot.position.set(0, 0.15, -0.02); head.add(tipPivot);
  const tip = new THREE.Mesh(bentCone(0.13, 0.42, 0.16), hoodMat);
  tip.rotation.x = -0.12;
  tipPivot.add(tip);

  // neck wrap where the scarf begins
  const wrapMat = new THREE.MeshStandardMaterial({ color: white ? 0xf2ead8 : 0x8a160a, roughness: 0.8, emissive: white ? 0x50483c : 0x2a0402, emissiveIntensity: 0.8 });
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.05, 10, 28), wrapMat);
  wrap.rotation.x = Math.PI / 2 + 0.12; wrap.position.set(0, 1.17, -0.01); wrap.scale.set(1, 1.05, 0.8);
  body.add(wrap);

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

  const rig = { root, body, robe, head, tipPivot, legs, sway: robeMat.userData.sway, eyes };
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
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float m = texture2D(uMask, vUv).r;
  float charged = uCharge * uN;
  float lit = 1. - smoothstep(charged - 1.2, charged, vIdx);
  float edge = abs(vUv.x * 2. - 1.);
  vec3 base = uBase;
  base *= 0.9 + 0.18 * sin(vUv.y * 90. + vUv.x * 7.);
  base = mix(base, vec3(0.95, 0.62, 0.24), smoothstep(0.84, 0.93, edge));
  vec3 L = normalize(uSunDir);
  float diff = max(dot(N, L), 0.) * 0.6 + pow(max(dot(-N, L), 0.), 2.) * 0.55;   // thin cloth glows when back-lit
  vec3 col = base * (uAmb * 0.45 + uSunColor * (0.25 + diff));
  float shimmer = 0.85 + 0.15 * sin(uTime * 3. + vIdx * 0.7);
  vec3 glyphLit = vec3(3.2, 2.5, 1.5) * shimmer;
  vec3 glyphDim = vec3(0.5, 0.2, 0.09);
  col += m * mix(glyphDim, glyphLit, lit);
  // a faint warm sheen over the whole charged length
  col += base * lit * 0.25 * shimmer;
  col += uFlash * vec3(1.5, 1.0, 0.6) * (0.5 + 0.5 * m);
  float dist = length(cameraPosition - vW);
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
      const ph = time * 2.6 - i * 0.45;
      const wave = 2.2 * flutter * (0.35 + f);
      let ax = -drag * (vx - wx) + Math.sin(ph) * wave;
      let ay = -drag * vy - 5.5 + 3.4 * buoy + Math.sin(ph * 1.2 + 1.1) * wave * 1.2;
      let az = -drag * (vz - wz) + Math.cos(ph * 0.9) * wave;
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
    // light smoothing so the cloth curves instead of zig-zagging
    for (let i = 2; i < n - 1; i++) {
      const a = P[i - 1], b = P[i + 1], c = P[i];
      c.x += ((a.x + b.x) * 0.5 - c.x) * 0.3; c.y += ((a.y + b.y) * 0.5 - c.y) * 0.3; c.z += ((a.z + b.z) * 0.5 - c.z) * 0.3;
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
      if (i >= n - 2) w *= i === n - 1 ? 0.15 : 0.65;
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
const NO_INPUT = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false };

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
    this.events = [];

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
    const fwd = Math.sin(this.lean) * up - 0.1;
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
      const coldMul = 1 - 0.45 * this.cold;
      let speedTarget = WALK * coldMul * stun;
      if (this.grounded && wl > 0) {
        const uphill = (wx * gx + wz * gz);                // >0 when heading uphill
        speedTarget *= clamp(1 - 1.0 * Math.max(0, uphill) + 0.35 * Math.max(0, -uphill), 0.32, 1.25);
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
      this.flying = false;
      if (!this.grounded) {
        if (inp.jump && !this.frozen && this.stunned <= 0) {
          if (this.charge > 0.001) {
            this.flying = true;
            v.y += (6.6 - v.y) * exp(3.4, dt);
            const drain = 1 / (1.5 + 0.11 * this.scarf.n) * (1 + 0.35 * this.cold);
            this.charge = Math.max(0, this.charge - drain * dt);
          } else {
            v.y = Math.max(v.y - GRAVITY * dt, -3.2);       // glide on an empty scarf
          }
        } else v.y -= GRAVITY * (v.y > 0 ? 1 : 1.15) * dt;
        v.y = Math.max(v.y, -26);
      }

      // horizontal
      if (this.grounded) {
        if (surfAmt > 0) {
          const il = 1 / (s || 1);
          const acc = 28 * surfAmt;
          v.x += -gx * il * acc * dt; v.z += -gz * il * acc * dt;
        }
        const k = this.stunned > 0 ? 3 : (wishAmt > 0.05 ? 7.5 : 10) - 7 * surfAmt;
        const tx = wx * speedTarget * wishAmt, tz = wz * speedTarget * wishAmt;
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
      } else {
        const air = (this.flying ? 8.4 : 7.0) * coldMul;
        const kk = exp(this.flying ? 2.8 : 2.2, dt);
        // keep momentum in the air unless steering against it
        const hs = Math.hypot(v.x, v.z);
        const tAmt = wishAmt > 0.05 ? Math.max(air * wishAmt, Math.min(hs, SURF_MAX) * 0.98) : hs * 0.985;
        const tx = wishAmt > 0.05 ? wx * tAmt : v.x * 0.985, tz = wishAmt > 0.05 ? wz * tAmt : v.z * 0.985;
        v.x += (tx - v.x) * kk; v.z += (tz - v.z) * kk;
      }
      const hs = Math.hypot(v.x, v.z);
      if (hs > SURF_MAX) { v.x *= SURF_MAX / hs; v.z *= SURF_MAX / hs; }
      this.speed = Math.min(hs, SURF_MAX);

      // integrate
      const prevY = p.y;
      p.x += v.x * dt; p.z += v.z * dt; p.y += v.y * dt;
      this._collide();

      const gy = terrainHeight(p.x, p.z);
      if (this.grounded) {
        // leave the ground over crests when moving fast: the ground falls away faster than gravity could pull
        const groundVy = (gy - prevY) / dt;
        if (this.speed > 9 && groundVy < this._groundVy - GRAVITY * dt * 1.6 && groundVy < -2) {
          this.grounded = false; v.y = this._groundVy * 0.85; p.y = prevY + v.y * dt;
          this.airT = COYOTE;
        } else { p.y = gy; v.y = 0; this._groundVy = groundVy; }
      } else if (p.y <= gy && v.y <= 0) {
        const impact = -v.y;
        p.y = gy; v.y = 0; this.grounded = true; this._groundVy = 0;
        if (!wasGrounded && impact > 2.5) {
          this.events.push({ type: 'land', impact });
          this.squashV -= Math.min(6, impact * 0.55);
        }
      }
      this.surfing = this.grounded && surfAmt > 0.45 && this.speed > 8;

      // recharge
      if (this.grounded && !this.flying) this.charge = Math.min(1, this.charge + 0.28 * dt * (1 - 0.8 * this.cold));
    }

    // singing
    this.singing = !!inp.sing && !this.frozen;
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
    if (this.speed > 0.5) {
      const target = Math.atan2(v.x, v.z);
      dTurn = wrapAngle(target - this.heading);
      const k = this.surfing ? 5 : this.grounded ? 11 : 6;
      const step = dTurn * exp(k, dt);
      this.heading = wrapAngle(this.heading + step);
      this.turnRate += (step / Math.max(dt, 1e-3) - this.turnRate) * exp(10, dt);
    } else this.turnRate *= Math.exp(-8 * dt);

    this.surfK += ((this.surfing ? 1 : 0) - this.surfK) * exp(5, dt);
    this.flyK += ((!this.grounded ? (this.flying ? 1 : 0.55) : 0) - this.flyK) * exp(this.grounded ? 10 : 4, dt);

    // local-space velocity / acceleration
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const aFwd = this.accel.x * sh + this.accel.z * ch;
    const aSide = this.accel.x * ch - this.accel.z * sh;

    // lean: into acceleration, into turns, back on a slide, forward in flight
    const speedLean = clamp(this.speed / 22, 0, 0.16);
    const targetLean = this.flyK * (this.flying ? 0.5 : 0.18) + (1 - this.flyK) * (this.surfK * -0.16 + (1 - this.surfK) * speedLean)
      + clamp(aFwd * 0.012, -0.12, 0.14) * (this.grounded ? 1 : 0.4);
    this.lean += (targetLean - this.lean) * exp(7, dt);
    const targetRoll = clamp(-this.turnRate * this.speed * 0.022, -0.42, 0.42) * (this.grounded ? 1 : 1.3);
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
    body.position.set(sideSway, bob + crouch + 0.3 * this.collapse + breathe, 0);
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
    su.uFlare.value = this.flyK * (this.flying ? 1 : 0.5) + Math.max(0, -this.squash) * 0.8;

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
    rig.tipPivot.rotation.set(-this.tip.x * 0.7 - Math.sin(time * 2.1) * 0.04 * wind, 0, this.tip.y * 0.6);

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
    const flutter = clamp(this.speed / 14 + (this.flying ? 0.7 : 0) + this.sing * 0.4 + wind * 0.3, 0.2, 1.3);
    this._back.set(-sh, 0, -ch);
    this.scarf.update(dt, this._anchor, v, flutter, time, this._back, p, this.charge);
    this.scarf.uniforms.uCharge.value += (this.charge - this.scarf.uniforms.uCharge.value) * exp(8, dt);
    this.scarf.uniforms.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.scarf.uniforms.uFlash.value = this.flash;
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
