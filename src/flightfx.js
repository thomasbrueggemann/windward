import * as THREE from 'three';
import { terrainHeight } from './world/heightfield.js';

/**
 * Particles, camera nudges and one-shot sounds for the flight modes (glide, dive, swoop, soar, ribbon boost).
 * Kept out of main.js so the game loop only needs one call per traveler.
 */
export function flightFx(who, fx, audio, cam, dt, { listener = true } = {}) {
  const p = who.pos, v = who.vel, sp = fx.sparkles, dust = fx.dust;
  for (const e of who.events) {
    switch (e.type) {
      case 'flap': if (listener && audio.flap) audio.flap(e.soft); break;
      case 'swoop': {
        if (listener) { if (audio.swoop) audio.swoop(e.boost / 12); cam.shake = Math.max(cam.shake, 0.18); }
        // a ring of sand thrown up where the pull-out skims the ground
        const gy = terrainHeight(p.x, p.z);
        if (p.y - gy < 8) {
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
            dust.emit(p.x, gy + 0.2, p.z, Math.cos(a) * s + v.x * 0.3, 0.8 + Math.random() * 2, Math.sin(a) * s + v.z * 0.3, 1.6, 0.8, 1, 0.85, 0.65, 0.45, 2, -0.3, 1.6);
          }
        }
        break;
      }
      case 'ribbon': {
        if (listener && audio.ribbon) audio.ribbon();
        // a thread of light from the creature to the traveler
        for (let i = 0; i < 24; i++) {
          const t = Math.random();
          sp.emit(e.x + (p.x - e.x) * t, e.y + (p.y + 1 - e.y) * t, e.z + (p.z - e.z) * t, (Math.random() - .5) * .6, 0.4, (Math.random() - .5) * .6, 1.0, 0.14, 3, 2.4, 1.4, 1, 1.2, 0, -0.3);
        }
        break;
      }
      case 'liftoff': case 'soar':
        if (listener && e.type === 'liftoff' && audio.liftoff) audio.liftoff();
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          sp.emit(p.x + Math.cos(a) * 1.2, p.y + 0.4, p.z + Math.sin(a) * 1.2, -Math.sin(a) * 2, 2 + Math.random() * 2, Math.cos(a) * 2, 1.2, 0.12, 3, 2.3, 1.2, 0.9, 1, 0, -0.3);
        }
        break;
      default:
    }
  }
  // ribbon boost: a bright trail streaming from the scarf
  if (who.boostT > 0) {
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      const a = who.scarf.pts[1 + ((Math.random() * (who.scarf.n - 1)) | 0)];
      sp.emit(a.x, a.y, a.z, (Math.random() - .5) * .3, (Math.random() - .5) * .3, (Math.random() - .5) * .3, 0.9, 0.13 * who.boostT + 0.04, 3, 2.2, 1.1, 1, 2, 0, -0.5);
    }
  }
  // dive: wind streaks rushing past the traveler
  if (who.diveK > 0.3) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const n = Math.floor(dt * speed * 3 * who.diveK + Math.random());
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - .5) * 3, oy = (Math.random() - .2) * 2.5, oz = (Math.random() - .5) * 3;
      dust.emit(p.x + ox + v.x * 0.15, p.y + 1 + oy + v.y * 0.15, p.z + oz + v.z * 0.15, -v.x * 0.15, -v.y * 0.15, -v.z * 0.15, 0.35, 0.1, 1, 0.97, 0.9, 0.35, 0.5, 0, 3);
    }
  }
  // glide: a faint wake of sand-gold motes from the spread sleeves
  if ((who.glideK > 0.5 || who.soarK > 0.5) && Math.random() < dt * 14) {
    const sh = Math.sin(who.heading), ch = Math.cos(who.heading), side = Math.random() < 0.5 ? -1 : 1;
    const wx = p.x + ch * side * 0.7 - sh * 0.3, wz = p.z - sh * side * 0.7 - ch * 0.3;
    sp.emit(wx, p.y + 0.9, wz, -v.x * 0.1, -0.2, -v.z * 0.1, 1.2, 0.07, 2.6, 1.9, 1.0, 0.7, 0.8, 0, -0.2);
  }
}

// ------------------------------------------------------------ sing rings: expanding rings of light with glyph ticks
const ringFrag = /* glsl */`
precision highp float;
uniform float uAge, uAmp; uniform vec3 uColor;
varying vec2 vP;
void main() {
  float r = length(vP), ang = atan(vP.y, vP.x);
  float w = 0.05 + 0.05 * uAge;
  float ring = exp(-pow((r - 0.9) / w, 2.));
  float ticks = 0.55 + 0.45 * step(0.5, fract(ang * 3.8197 + uAge * 0.6));
  float halo = smoothstep(0.9, 0.55, r) * smoothstep(0.3, 0.9, r) * 0.25 + exp(-pow((r - 0.9) / 0.2, 2.)) * 0.2;
  float inner = exp(-pow((r - 0.74) / 0.012, 2.)) * 0.5 * step(0.5, fract(ang * 5.093));
  float a = (ring * ticks + halo + inner) * uAmp * pow(1. - uAge, 1.6) * smoothstep(1.02, 0.95, r);
  gl_FragColor = vec4(uColor * a, a);
}`;
export class SingRings {
  constructor(scene, n = 8) {
    const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
    this.list = Array.from({ length: n }, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAge: { value: 1 }, uAmp: { value: 1 }, uColor: { value: new THREE.Color(2.4, 1.8, 0.9) } },
        vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: ringFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat); m.visible = false; m.frustumCulled = false; m.renderOrder = 4; scene.add(m);
      return { m, mat, age: 1, life: 1, R: 5 };
    });
    this.i = 0;
  }
  spawn(x, y, z, R = 5, life = 1.1, amp = 0.8) {
    const r = this.list[this.i]; this.i = (this.i + 1) % this.list.length;
    r.m.position.set(x, y, z); r.age = 0; r.life = life; r.R = R; r.m.visible = true; r.mat.uniforms.uAmp.value = amp;
  }
  update(dt) {
    for (const r of this.list) {
      if (!r.m.visible) continue;
      r.age += dt / r.life;
      if (r.age >= 1) { r.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - r.age, 2.2);
      r.m.scale.setScalar(0.4 + r.R * e);
      r.mat.uniforms.uAge.value = r.age;
    }
  }
}
