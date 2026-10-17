import * as THREE from 'three';
import { terrainHeight } from './world/heightfield.js';
import { clothUniforms } from './world/cloth.js';

const vert = /* glsl */`
attribute float aSize, aGH; attribute vec4 aColor; attribute vec3 aVel;
uniform float uScale, uStretch, uAspect, uStar;
varying vec4 vColor; varying vec2 vDir; varying float vStretch, vBright, vSz, vId;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = clip;
  // motion streaks: stretch the sprite along the particle's on-screen velocity
  vec3 vv = (viewMatrix * vec4(aVel, 0.)).xyz;
  vec4 c2 = projectionMatrix * (mv + vec4(vv * 0.04, 0.));
  vec2 sd = c2.xy / c2.w - clip.xy / clip.w; sd.x *= uAspect;
  vDir = dot(sd, sd) > 1e-12 ? normalize(sd) : vec2(1., 0.);
  float stretch = 1. + clamp(length(aVel) * uStretch, 0., 5.);
  vBright = uStar * smoothstep(1.3, 3., max(aColor.r, max(aColor.g, aColor.b)));
  vSz = 1. + 0.9 * vBright;
  float base = aSize * uScale / max(0.1, -mv.z) * vSz;
  float ps = clamp(base * stretch, 1., 220.);
  gl_PointSize = ps;
  vStretch = max(1., ps / max(base, 1.));
  vId = float(gl_VertexID);
  // soft contact with the ground instead of a hard intersection
  vColor = vec4(aColor.rgb, aColor.a * smoothstep(-0.05, aSize * 0.7 + 0.05, aGH));
}`;
const frag = /* glsl */`
precision highp float;
uniform float uTime, uLit; uniform vec3 uSunV, uSunC, uAmb;
varying vec4 vColor; varying vec2 vDir; varying float vStretch, vBright, vSz, vId;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.; p.y = -p.y;
  vec2 q = vec2(dot(p, vDir), dot(p, vec2(-vDir.y, vDir.x)));
  q.y *= vStretch; q *= vSz;
  float a = smoothstep(1., 0., length(q)); a *= a;
  if (vStretch > 1.4) a *= 0.35 + 0.65 * smoothstep(-1., 1., q.x);   // bright head, fading tail
  vec3 col = vColor.rgb;
  if (uLit > 0.5) {
    // each grain is a tiny sphere lit by the sun: a warm crescent and the odd glinting facet
    vec3 n = vec3(p, sqrt(max(1. - dot(p, p), 0.)));
    vec3 h = normalize(uSunV + vec3(0., 0., 1.));
    col = col * (uAmb * 0.8 + uSunC * (0.3 + max(dot(n, uSunV), 0.))) + uSunC * pow(max(dot(n, h), 0.), 40.) * 0.6 * step(0.5, fract(vId * 0.37));
  }
  // bright sparks get a four-point glint that twinkles
  float st = vBright * (exp(-abs(p.x) * 16.) * exp(-abs(p.y) * 2.2) + exp(-abs(p.y) * 16.) * exp(-abs(p.x) * 2.2)) * (0.6 + 0.4 * sin(uTime * 13. + vId * 7.3));
  gl_FragColor = vec4(col, vColor.a * (a + st * 0.7));
}`;

/** CPU-driven particle pool: bursts of sparkles / sand. `lit` = sun-lit sand grains, additive pools get star glints. */
export class ParticlePool {
  constructor(scene, count, additive, stretch = additive ? 0.07 : 0.2) {
    this.count = count; this.next = 0; this.t = 0; this.frame = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.size0 = new Float32Array(count);
    this.col = new Float32Array(count * 4);
    this.col0 = new Float32Array(count * 4);
    this.drag = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.gh = new Float32Array(count).fill(99);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aGH', new THREE.BufferAttribute(this.gh, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = {
      uScale: { value: 600 }, uStretch: { value: stretch }, uAspect: { value: 1 }, uStar: { value: additive ? 1 : 0 }, uLit: { value: additive ? 0 : 1 },
      uTime: { value: 0 }, uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunC: clothUniforms.uSunColor, uAmb: clothUniforms.uAmb,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1e4;
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, drag = 1.2, grav = 0, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = this.size[i] = size;
    this.col0[i * 4] = r; this.col0[i * 4 + 1] = g; this.col0[i * 4 + 2] = b; this.col0[i * 4 + 3] = a;
    this.drag[i] = drag; this.grav[i] = grav; this.grow[i] = grow;
    this.gh[i] = y - terrainHeight(x, z);
  }

  update(dt, camera, renderer) {
    this.t += dt; this.frame++;
    const ph = this.frame & 3;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.pos[i * 3 + 1] = -1e4; this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if ((i & 3) === ph) this.gh[i] = this.pos[i * 3 + 1] - terrainHeight(this.pos[i * 3], this.pos[i * 3 + 2]);
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = this.col0[i * 4]; this.col[i * 4 + 1] = this.col0[i * 4 + 1]; this.col[i * 4 + 2] = this.col0[i * 4 + 2];
      this.col[i * 4 + 3] = this.col0[i * 4 + 3] * fade;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * t);
    }
    const A = this.geo.attributes;
    A.position.needsUpdate = A.aSize.needsUpdate = A.aColor.needsUpdate = A.aVel.needsUpdate = A.aGH.needsUpdate = true;
    const u = this.uniforms, h = renderer.domElement.height;
    u.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    u.uAspect.value = renderer.domElement.width / h; u.uTime.value = this.t;
    u.uSunV.value.copy(clothUniforms.uSunDir.value).transformDirection(camera.matrixWorldInverse);
  }
}

// ------------------------------------------------------------ ambient dust / snow
const dustVert = /* glsl */`
attribute vec3 aSeed;
uniform vec3 uCam, uBox, uDrift;
uniform float uGround, uSize, uScale, uTime, uAmount;
varying float vA, vTw;
void main() {
  vec3 rel = mod(aSeed * uBox + vec3(uDrift.x, 0., uDrift.z) - uCam, uBox) - uBox * 0.5;
  float y = uGround + mod(aSeed.y * uBox.y + uDrift.y + sin(uTime * 0.5 + aSeed.x * 40.) * 0.4, uBox.y);
  vec3 world = vec3(uCam.x + rel.x, y, uCam.z + rel.z);
  world.x += sin(uTime * 0.8 + aSeed.z * 50.) * 0.25;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1. - smoothstep(0.30, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
  float keep = step(aSeed.x, uAmount);
  vA = edge * keep * (0.35 + 0.65 * fract(aSeed.y * 7.1));
  vTw = pow(max(0., sin(uTime * 2.2 + aSeed.x * 90. + aSeed.y * 31.)), 28.) * step(0.55, aSeed.z);   // a few grains / flakes catch the sun in turn
  vA *= smoothstep(0.3, 1.8, -mv.z);
  gl_PointSize = clamp(uSize * (0.5 + aSeed.z) * (1. + vTw * 1.6) * uScale / max(0.1, -mv.z), 1., 40.);
}`;
const dustFrag = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uOpacity;
varying float vA, vTw;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.;
  float a = smoothstep(1., 0.2, length(p));
  float st = vTw * (exp(-abs(p.x) * 12.) * exp(-abs(p.y) * 2.) + exp(-abs(p.y) * 12.) * exp(-abs(p.x) * 2.));
  gl_FragColor = vec4(uColor * (1. + vTw * 2.5), (a + st * 0.8) * vA * uOpacity * (1. + vTw * 1.5));
}`;

export class AmbientDust {
  constructor(scene, count = 3500) {
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(70, 12, 70) }, uDrift: { value: new THREE.Vector3() },
      uGround: { value: 0 }, uSize: { value: 0.06 }, uScale: { value: 600 }, uTime: { value: 0 }, uAmount: { value: 0.5 },
      uColor: { value: new THREE.Color(1, 0.85, 0.6) }, uOpacity: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.drift = new THREE.Vector3();
  }

  update(dt, time, camera, renderer, groundY, wind, fall, amount, color, size, opacity) {
    this.drift.x += wind.x * dt; this.drift.z += wind.z * dt; this.drift.y -= fall * dt;
    const u = this.uniforms;
    u.uCam.value.copy(camera.position); u.uDrift.value.copy(this.drift);
    u.uGround.value = groundY - 1.0; u.uTime.value = time; u.uAmount.value = amount;
    u.uColor.value.copy(color); u.uSize.value = size; u.uOpacity.value = opacity;
    u.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
