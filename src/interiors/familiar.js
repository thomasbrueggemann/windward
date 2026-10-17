// A little cloth creature, woken in the sleeping garden, that follows the traveler for the rest of the journey:
// it circles close, trails behind in flight, and when the traveler sings it presses in and fills the scarf.
import * as THREE from 'three';
import { clothUniforms, clothFrag } from '../world/cloth.js';
import { terrainHeight, clamp } from '../world/heightfield.js';

const vert = /* glsl */`
uniform float uTime, uGlow, uFlap;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 p = position;
  float wing = abs(p.x);
  float tailT = clamp((-p.z - 0.7) / 2.2, 0., 1.);
  p.y += sin(uTime * uFlap - p.z * 1.4) * wing * 0.6 * (1. - tailT);
  p.x += sin(uTime * 3.4 - p.z * 2.6) * 0.22 * tailT;
  p.y += sin(uTime * 2.6 - p.z * 2.0) * 0.2 * tailT;
  vec4 wp = modelMatrix * vec4(p, 1.);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix) * vec3(0., 1., 0.)); vUv = uv; vGlow = uGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

function geometry() {
  const g = new THREE.PlaneGeometry(1, 1, 8, 30), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i), z = -3.0 + (v + 0.5) * 3.8;
    const hw = z > -0.7 ? 0.08 + 0.62 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / 0.75), 1.6)), 0.8) : 0.07 + 0.02 * Math.sin((z + 0.7) * 3);
    p.setXYZ(i, u * hw, 0, z);
  }
  g.computeVertexNormals();
  return g;
}

export class Familiar {
  constructor(scene, from) {
    this.u = { uTime: clothUniforms.uTime, uGlow: { value: 1 }, uFlap: { value: 3.2 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: { ...clothUniforms, ...this.u }, vertexShader: vert, fragmentShader: clothFrag, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(0.7);
    this.mesh.position.copy(from);
    scene.add(this.mesh);
    this.vel = new THREE.Vector3(0, 2, 0);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.a = Math.random() * 6.28; this.bank = 0; this.glow = 1;
    this._t = new THREE.Vector3(); this._v = new THREE.Vector3();
  }

  /** Re-appear beside the traveler (after walking through a doorway). */
  arrive(P) {
    this.mesh.position.set(P.pos.x - Math.sin(P.heading) * 2, P.pos.y + 2.4, P.pos.z - Math.cos(P.heading) * 2);
    this.vel.set(0, 1, 0);
  }

  update(dt, time, P, fx) {
    const m = this.mesh, p = m.position, pp = P.pos;
    const sing = P.sing;
    this.a += dt * (0.9 + 1.4 * sing);
    const flying = !P.grounded;
    const rad = flying ? 1.6 : 2.8 - 1.6 * sing;
    const t = this._t;
    if (flying) t.set(pp.x - P.vel.x * 0.25 + Math.cos(this.a) * rad, pp.y + 1.6 + Math.sin(time * 2) * 0.4, pp.z - P.vel.z * 0.25 + Math.sin(this.a) * rad);
    else t.set(pp.x + Math.cos(this.a) * rad, pp.y + 2.0 - 0.7 * sing + Math.sin(time * 1.3) * 0.35, pp.z + Math.sin(this.a) * rad);
    t.y = Math.max(t.y, terrainHeight(t.x, t.z) + 0.8);
    const d = p.distanceTo(t);
    if (d > 40) { p.copy(t); this.vel.set(0, 0, 0); }
    const k = 3.2 + d * 0.15;
    this.vel.x += (t.x - p.x) * k * dt; this.vel.y += (t.y - p.y) * k * dt; this.vel.z += (t.z - p.z) * k * dt;
    this.vel.multiplyScalar(Math.exp(-1.6 * dt));
    const sp = this.vel.length(), max = 10 + P.speed;
    if (sp > max) this.vel.multiplyScalar(max / sp);
    p.addScaledVector(this.vel, dt);
    p.y = Math.max(p.y, terrainHeight(p.x, p.z) + 0.5);
    if (Math.hypot(this.vel.x, this.vel.z) > 0.2) {
      this._v.set(this.vel.x, this.vel.y * 0.5, this.vel.z).normalize();
      this.fwd.lerp(this._v, 1 - Math.exp(-5 * dt)).normalize();
    }
    m.lookAt(p.x + this.fwd.x, p.y + this.fwd.y, p.z + this.fwd.z);
    this.bank += (clamp(-0.9, -0.9, 0.9) * (0.4 + sing) - this.bank) * (1 - Math.exp(-2 * dt));
    m.rotateZ(this.bank);
    // singing together: it glows and fills the scarf
    this.glow += ((0.35 + 0.65 * sing) - this.glow) * (1 - Math.exp(-3 * dt));
    this.u.uGlow.value = this.glow;
    this.u.uFlap.value = 3.2 + 2.5 * sing;
    if (sing > 0.3 && Math.hypot(p.x - pp.x, p.z - pp.z) < 4) {
      P.charge = Math.min(1, P.charge + 0.3 * sing * dt);
      if (Math.random() < dt * 10) {
        const u = Math.random();
        fx.sparkles.emit(p.x + (pp.x - p.x) * u, p.y + (pp.y + 1.2 - p.y) * u, p.z + (pp.z - p.z) * u, 0, 0.3, 0, 0.8, 0.09, 3, 2.3, 1.2, 0.9, 1, 0, -0.2);
      }
    }
  }
}
