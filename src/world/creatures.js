import * as THREE from 'three';
import { rng } from '../noise.js';
import { terrainHeight, clamp } from './heightfield.js';
import { clothUniforms, clothFrag } from './cloth.js';

const flapVert = /* glsl */`
uniform float uTime, uPhase, uGlow, uFlap;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 p = position;
  float wing = abs(p.x);
  float tailT = clamp((-p.z - 1.2) / 3.0, 0., 1.);
  p.y += sin(uTime * uFlap + uPhase - p.z * 1.2) * wing * 0.55 * (1. - tailT);
  p.x += sin(uTime * 3.0 + uPhase - p.z * 2.2) * 0.28 * tailT;
  p.y += sin(uTime * 2.4 + uPhase - p.z * 1.7) * 0.25 * tailT;
  vec4 wp = modelMatrix * vec4(p, 1.);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix) * vec3(0., 1., 0.)); vUv = uv; vGlow = uGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** A manta-like diamond of cloth with a long ribbon tail, lying in the XZ plane, nose toward +Z. */
function flyerGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 10, 40);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2;                       // -1..1 across
    const v = p.getY(i);                           // -.5..+.5 along
    const zz = -4.2 + (v + 0.5) * 5.4;
    let hw;
    if (zz > -1.2) hw = 0.1 + 0.85 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(zz / 1.2), 1.7)), 0.8);
    else hw = 0.1 + 0.03 * Math.sin((zz + 1.2) * 3.0);
    p.setXYZ(i, u * hw, 0, zz);
  }
  g.computeVertexNormals();
  return g;
}
const FLYER_GEO = flyerGeometry();

/** Small, curious cloth creatures. They swoop around the traveler, recharge the scarf, and answer songs. */
export class Flyers {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.r = rng(909);
    this._v = new THREE.Vector3();
  }

  spawn(x, z, n) {
    const r = this.r;
    for (let k = 0; k < n; k++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...clothUniforms, uPhase: { value: r() * 20 }, uGlow: { value: 0.1 }, uFlap: { value: 2.2 + r() * 1.2 } },
        vertexShader: flapVert, fragmentShader: clothFrag, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(FLYER_GEO, mat);
      mesh.frustumCulled = false;
      const sx = x + (r() - .5) * 20, sz = z + (r() - .5) * 20;
      mesh.position.set(sx, terrainHeight(sx, sz) + 4 + r() * 3, sz);
      const scale = 0.8 + r() * 0.5;
      mesh.scale.setScalar(scale);
      this.scene.add(mesh);
      this.list.push({
        mesh, mat, vel: new THREE.Vector3(r() - .5, 0, r() - .5), home: new THREE.Vector3(x, 0, z), phase: r() * 10,
        orbitR: 4 + r() * 4, orbitSpeed: (0.4 + r() * 0.5) * (r() < 0.5 ? -1 : 1), orbitA: r() * 6.28, height: 2.2 + r() * 3.4,
        glow: 0.1, bank: 0, fwd: new THREE.Vector3(0, 0, 1),
      });
    }
  }

  update(dt, time, player, fx, ev) {
    const pp = player.pos;
    for (const f of this.list) {
      const m = f.mesh, p = m.position;
      const dx = pp.x - p.x, dz = pp.z - p.z;
      const dp = Math.hypot(dx, dz);
      if (dp > 260) { m.visible = false; continue; }
      m.visible = true;
      f.mat.uniforms.uTime = clothUniforms.uTime;
      const near = dp < 60;
      let tx, ty, tz;
      if (near) {
        f.orbitA += f.orbitSpeed * dt * (1 + player.sing * 1.5);
        const rad = f.orbitR * (1 - 0.3 * player.sing);
        tx = pp.x + Math.cos(f.orbitA) * rad; tz = pp.z + Math.sin(f.orbitA) * rad;
        ty = pp.y + f.height + Math.sin(time * 0.9 + f.phase) * 1.0;
      } else {
        const a = time * 0.12 + f.phase;
        tx = f.home.x + Math.cos(a) * 28; tz = f.home.z + Math.sin(a * 1.3) * 22;
        ty = terrainHeight(tx, tz) + 5 + Math.sin(time * 0.5 + f.phase) * 1.5;
      }
      ty = Math.max(ty, terrainHeight(p.x, p.z) + 1.6);
      // steer
      const k = near ? 2.4 : 0.6;
      f.vel.x += (tx - p.x) * k * dt; f.vel.y += (ty - p.y) * 1.8 * dt; f.vel.z += (tz - p.z) * k * dt;
      const sp = f.vel.length(), maxSp = near ? 13 : 5.5;
      if (sp > maxSp) f.vel.multiplyScalar(maxSp / sp);
      f.vel.multiplyScalar(Math.exp(-0.6 * dt));
      p.addScaledVector(f.vel, dt);
      // orientation along velocity, with banking
      if (Math.hypot(f.vel.x, f.vel.z) > 0.2) {
        this._v.set(f.vel.x, f.vel.y * 0.5, f.vel.z).normalize();
        f.fwd.lerp(this._v, 1 - Math.exp(-4 * dt)).normalize();
      }
      m.lookAt(p.x + f.fwd.x, p.y + f.fwd.y, p.z + f.fwd.z);
      const bankT = clamp(f.orbitSpeed * 0.9, -0.9, 0.9) * (near ? 1 : 0.3);
      f.bank += (bankT - f.bank) * (1 - Math.exp(-2 * dt));
      m.rotateZ(f.bank);
      // glow / interaction
      const d3 = Math.hypot(dp, p.y - pp.y - 1);
      let gT = 0.15 + (near ? 0.25 : 0);
      if (d3 < 7) {
        gT = 1;
        if (player.charge < 1 && !player.frozen) { player.charge = Math.min(1, player.charge + 1.6 * dt); ev.push({ type: 'recharge' }); }
      }
      if (player.sing > 0.4 && dp < 40) {
        gT = 1;
        if (Math.random() < 0.25) fx.sparkles.emit(p.x, p.y, p.z, Math.random() - .5, Math.random() - .5 + 0.5, Math.random() - .5, 1, 0.12, 3, 2.3, 1.2, 1, 1, 0, -0.4);
      }
      f.glow += (gT - f.glow) * (1 - Math.exp(-3 * dt));
      f.mat.uniforms.uGlow.value = f.glow;
    }
  }
}

// ---------------------------------------------------------------------------------- guardians
const beamVert = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const beamFrag = /* glsl */`
precision highp float;
uniform float uIntensity; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float side = pow(abs(dot(normalize(vN), V)), 1.2);
  float a = (0.12 + 0.88 * pow(vUv.y, 1.4)) * side * uIntensity * smoothstep(2., 14., length(cameraPosition - vW));
  gl_FragColor = vec4(uColor * a, a);
}`;

const N_SEG = 24, SPACING = 1.5;
const _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _rr = new THREE.Vector3(), _uu = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

/** Ancient stone-and-bronze serpents that hunt the scarf. They are blind to anyone sheltering under stone. */
export class Guardian {
  constructor(scene, ax, az, radius = 45) {
    this.scene = scene;
    this.anchor = new THREE.Vector3(ax, 0, az); this.radius = radius;
    this.phase = Math.random() * 6;
    this.state = 'patrol'; this.stateT = 0; this.alert = 0;
    this.pos = Array.from({ length: N_SEG }, (_, i) => new THREE.Vector3(ax + i * SPACING, terrainHeight(ax, az) + 14, az));
    this.vel = new THREE.Vector3(-1, 0, 0);
    this.beamDir = new THREE.Vector3(0, -1, 0.5).normalize();
    this.hitCool = 0;
    this.dist = 999;

    const geo = new THREE.OctahedronGeometry(1, 1);
    geo.scale(1.0, 0.2, 0.85);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, metalness: 0.7, roughness: 0.4, emissive: 0x6a2a08, emissiveIntensity: 0.55 });
    this.body = new THREE.InstancedMesh(geo, mat, N_SEG);
    this.body.frustumCulled = false;
    scene.add(this.body);

    this.head = new THREE.Group();
    const hg = new THREE.OctahedronGeometry(1, 1); hg.scale(1.3, 0.55, 1.9);
    this.head.add(new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0x7a5a38, metalness: 0.75, roughness: 0.35, emissive: 0x4a1a05, emissiveIntensity: 0.5 })));
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.0) });
    for (const sx of [-0.5, 0.5]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), this.lampMat);
      l.position.set(sx, -0.12, 1.5); this.head.add(l);
    }
    scene.add(this.head);

    const cg = new THREE.CylinderGeometry(0.3, 7.5, 30, 28, 1, true); cg.translate(0, -15, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0.5 }, uColor: { value: new THREE.Color(2.4, 1.8, 0.9) } },
      vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(cg, this.beamMat); this.beam.frustumCulled = false; this.beam.renderOrder = 3;
    scene.add(this.beam);
    this._target = new THREE.Vector3();
    this._toP = new THREE.Vector3();
    this._want = new THREE.Vector3();
  }

  update(dt, time, player, fx, ev) {
    const head = this.pos[0], pp = player.pos;
    const gy = terrainHeight(head.x, head.z);
    const toP = this._toP.set(pp.x - head.x, pp.y + 1.2 - head.y, pp.z - head.z);
    const dist = toP.length() || 1e-3;
    this.stateT += dt; this.hitCool = Math.max(0, this.hitCool - dt);
    this.dist = dist;

    // is the traveler inside the lamp's beam?
    const cosA = toP.dot(this.beamDir) / dist;
    const sheltered = player.isSheltered();
    const inBeam = !sheltered && dist < 40 && cosA > 0.8;

    const target = this._target;
    let speed = 7;
    if (this.state === 'patrol') {
      const a = time * 0.16 + this.phase;
      target.set(this.anchor.x + Math.cos(a) * this.radius, 0, this.anchor.z + Math.sin(a * 1.4) * this.radius * 0.7);
      target.y = terrainHeight(target.x, target.z) + 13 + Math.sin(time * 0.7 + this.phase) * 2.5;
      speed = 7;
      if (inBeam || (!sheltered && dist < 20)) this.alert += dt * 1.6; else this.alert = Math.max(0, this.alert - dt * 0.5);
      if (this.alert >= 1) { this.state = 'chase'; this.stateT = 0; ev.push({ type: 'guardian-alert' }); }
    } else if (this.state === 'chase') {
      target.set(pp.x, pp.y + 1.8, pp.z);
      speed = 11 + Math.min(6, this.stateT * 2);
      if (sheltered) {
        this.alert -= dt * 0.8;
        if (this.alert < 0.2 || this.stateT > 9) { this.state = 'retreat'; this.stateT = 0; }
      } else this.alert = 1;
      if (this.stateT > 12) { this.state = 'retreat'; this.stateT = 0; }
      if (dist < 3.4 && this.hitCool <= 0 && !sheltered) {
        this.hitCool = 3;
        ev.push({ type: 'guardian-hit', lost: player.tear(3) });
        this.state = 'retreat'; this.stateT = 0;
        const kb = _f.set(pp.x - head.x, 0, pp.z - head.z).normalize();
        player.vel.x += kb.x * 9; player.vel.z += kb.z * 9; if (!player.grounded) player.vel.y = 3;
        for (let i = 0; i < 40; i++) fx.sparkles.emit(pp.x, pp.y + 1.2, pp.z, (Math.random() - .5) * 6, Math.random() * 4, (Math.random() - .5) * 6, 1.4, 0.14, 3, 0.8, 0.3, 1, 1.2, 0.3, -0.5);
      }
    } else { // retreat
      target.set(this.anchor.x, terrainHeight(this.anchor.x, this.anchor.z) + 30, this.anchor.z);
      speed = 12; this.alert = 0;
      if (this.stateT > 6 && Math.hypot(head.x - this.anchor.x, head.z - this.anchor.z) < this.radius * 1.4) { this.state = 'patrol'; this.stateT = 0; }
      if (this.stateT > 14) { this.state = 'patrol'; this.stateT = 0; }
    }
    target.y = Math.max(target.y, gy + 5);

    // head steering
    const desired = target.sub(head);
    const dl = desired.length() || 1;
    desired.multiplyScalar(speed / dl);
    this.vel.lerp(desired, 1 - Math.exp(-(this.state === 'chase' ? 2.6 : 1.1) * dt));
    head.addScaledVector(this.vel, dt);
    if (head.y < gy + 3.5) head.y = gy + 3.5;

    // body follows (chain)
    for (let i = 1; i < N_SEG; i++) {
      const a = this.pos[i - 1], b = this.pos[i];
      _f.subVectors(b, a); const d = _f.length() || 1e-4;
      if (d > SPACING) b.addScaledVector(_f, -(d - SPACING) / d);
      b.y += Math.sin(time * 1.8 - i * 0.55 + this.phase) * dt * 1.2;
    }
    // draw
    for (let i = 0; i < N_SEG; i++) {
      const a = this.pos[Math.max(0, i - 1)], b = this.pos[Math.min(N_SEG - 1, i + 1)];
      _f.subVectors(a, b).normalize();
      _r.crossVectors(_up, _f); if (_r.lengthSq() < 1e-4) _r.set(1, 0, 0); _r.normalize();
      _u.crossVectors(_f, _r);
      const bank = Math.sin(time * 1.5 - i * 0.5) * 0.5;
      const cs = Math.cos(bank), sn = Math.sin(bank);
      _rr.copy(_r).multiplyScalar(cs).addScaledVector(_u, sn);
      _uu.copy(_u).multiplyScalar(cs).addScaledVector(_r, -sn);
      _m.makeBasis(_rr, _uu, _f);
      const f = i / (N_SEG - 1);
      const sc = 1.45 - 1.05 * f * f - 0.15 * Math.sin(i * 1.7);
      _s.set(sc, sc, sc * 1.1);
      _m.scale(_s); _m.setPosition(this.pos[i]);
      this.body.setMatrixAt(i, _m);
    }
    this.body.instanceMatrix.needsUpdate = true;

    // head & lamp beam
    this.head.position.copy(head);
    const hf = _f.copy(this.vel).normalize();
    if (this.vel.lengthSq() > 0.2) this.head.lookAt(head.x + hf.x, head.y + hf.y, head.z + hf.z);
    const sweep = Math.sin(time * 0.8 + this.phase);
    const want = this._want;
    if (this.state === 'chase') want.set(toP.x / dist, toP.y / dist, toP.z / dist);
    else want.set(hf.x + Math.cos(time * 0.8 + this.phase) * 0.3, -0.95 + sweep * 0.05, hf.z + sweep * 0.5);
    this.beamDir.lerp(want.normalize(), 1 - Math.exp(-3 * dt)).normalize();
    this.beam.position.copy(head);
    this.beam.quaternion.setFromUnitVectors(_down, this.beamDir);
    const alertK = this.state === 'chase' ? 1 : this.alert;
    this.beamMat.uniforms.uColor.value.setRGB(2.4 + 1.4 * alertK, 1.8 - 0.9 * alertK, 0.9 - 0.6 * alertK);
    this.beamMat.uniforms.uIntensity.value = 0.5 + 0.45 * alertK;
    this.lampMat.color.setRGB(3.2 + 1.6 * alertK, 2.2 - 1.1 * alertK, 1.0 - 0.6 * alertK);
  }
}
