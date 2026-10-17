import * as THREE from 'three';

const vert = /* glsl */`
attribute float aSize; attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0., 220.);
  vColor = aColor;
}`;
const frag = /* glsl */`
precision highp float;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.;
  float a = smoothstep(1., 0., d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
}`;

/** CPU-driven particle pool: bursts of sparkles / sand. */
export class ParticlePool {
  constructor(scene, count, additive) {
    this.count = count; this.next = 0;
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 600 } };
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
  }

  update(dt, camera, renderer) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.pos[i * 3 + 1] = -1e4; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = this.col0[i * 4]; this.col[i * 4 + 1] = this.col0[i * 4 + 1]; this.col[i * 4 + 2] = this.col0[i * 4 + 2];
      this.col[i * 4 + 3] = this.col0[i * 4 + 3] * fade;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    const h = renderer.domElement.height;
    this.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}

// ------------------------------------------------------------ ambient dust / snow
const dustVert = /* glsl */`
attribute vec3 aSeed;
uniform vec3 uCam, uBox, uDrift;
uniform float uGround, uSize, uScale, uTime, uAmount;
varying float vA;
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
  gl_PointSize = clamp(uSize * (0.5 + aSeed.z) * uScale / max(0.1, -mv.z), 1., 40.);
}`;
const dustFrag = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.;
  float a = smoothstep(1., 0.2, d);
  gl_FragColor = vec4(uColor, a * vA * uOpacity);
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
