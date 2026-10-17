import * as THREE from 'three';
import { rngFor } from './seed.js';
import { terrainHeight, clamp } from './heightfield.js';
import { clothUniforms, clothFrag } from './cloth.js';
import { makeSoftDot } from '../textures.js';

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
    this.r = rngFor('flyers');
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
        orbitR: 9 + r() * 6, orbitSpeed: (0.3 + r() * 0.35) * (r() < 0.5 ? -1 : 1), orbitA: r() * 6.28, height: 5 + r() * 4,
        glow: 0.1, bank: 0, fwd: new THREE.Vector3(0, 0, 1),
      });
    }
  }

  update(dt, time, player, fx, ev) {
    const pp = player.pos;
    // only the two closest flyers escort the traveler; the rest keep to their own patch of sky, so the view stays clear
    const esc = this._esc || (this._esc = new Set());
    esc.clear();
    let a = null, b = null, da = 60, db = 60;
    for (const f of this.list) {
      const d = Math.hypot(pp.x - f.mesh.position.x, pp.z - f.mesh.position.z) * (f.escort ? 0.8 : 1);   // hysteresis
      if (d < da) { b = a; db = da; a = f; da = d; } else if (d < db) { b = f; db = d; }
    }
    if (a) esc.add(a); if (b) esc.add(b);
    // escorts circle a point ahead of the traveler, out of the camera's line of sight
    const off = 7 * (1 - player.sing), ox = pp.x + Math.sin(player.heading) * off, oz = pp.z + Math.cos(player.heading) * off;
    for (const f of this.list) {
      f.escort = esc.has(f);
      const m = f.mesh, p = m.position;
      const dx = pp.x - p.x, dz = pp.z - p.z;
      const dp = Math.hypot(dx, dz);
      if (dp > 260) { m.visible = false; continue; }
      m.visible = true;
      f.mat.uniforms.uTime = clothUniforms.uTime;
      const near = f.escort;
      let tx, ty, tz;
      if (near) {
        // singing calls them in close enough to touch (and recharge the scarf)
        f.orbitA += f.orbitSpeed * dt * (1 + player.sing * 1.5);
        const rad = f.orbitR * (1 - 0.55 * player.sing);
        tx = ox + Math.cos(f.orbitA) * rad; tz = oz + Math.sin(f.orbitA) * rad;
        ty = pp.y + f.height * (1 - 0.6 * player.sing) + Math.sin(time * 0.9 + f.phase) * 1.0;
      } else {
        const a = time * 0.12 + f.phase;
        tx = f.home.x + Math.cos(a) * 28; tz = f.home.z + Math.sin(a * 1.3) * 22;
        ty = terrainHeight(tx, tz) + 9 + Math.sin(time * 0.5 + f.phase) * 2;
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
      if (d3 < 8) {
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
uniform float uIntensity, uTime; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float cs = abs(dot(normalize(vN), V));
  float side = pow(cs, 1.2);
  float ang = vUv.x * 6.2832, y = vUv.y;
  // volumetric look: slow drifting striations of lit haze, a hot thin core along the axis and glittering dust motes
  float st = 0.68 + 0.32 * sin(ang * 9. + y * 4. - uTime * 0.7) * sin(ang * 4. - y * 7. + uTime * 0.5);
  float core = pow(cs, 5.) * 0.6;
  vec2 mc = vec2(floor(vUv.x * 70.), floor(y * 26. + uTime * 1.3));
  float mote = step(0.965, h21(mc)) * (0.5 + 0.5 * sin(uTime * 4. + h21(mc + 3.) * 20.)) * smoothstep(0., 0.5, y);
  float a = (0.12 + 0.88 * pow(y, 1.4)) * (side * st + core + mote * 0.8) * uIntensity * smoothstep(2., 14., length(cameraPosition - vW));
  gl_FragColor = vec4(uColor * a, a);
}`;

/** Weathered bronze-and-stone for the guardians: 3D noise pitting, verdigris, rain streaks, bump and cracks glowing with ember light. */
function guardianMaterial(params, alertU) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35, ...params });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAlert = alertU;
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vLP;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `varying vec3 vLP; uniform float uAlert;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
void main() {`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float nLo = vn3(vLP * 1.3 + 3.), nMid = vn3(vLP * 3.6), nHi = vn3(vLP * 11.);
float hgt = nMid * 0.75 + nHi * 0.25;
float stoneK = smoothstep(0.42, 0.62, nLo);
diffuseColor.rgb = mix(vec3(0.52, 0.37, 0.19), vec3(0.4, 0.34, 0.27), stoneK) * (1.0 + 0.35 * hgt);
float verd = smoothstep(0.58, 0.8, nMid * 0.7 + nLo * 0.4) * (1. - stoneK);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.34, 0.28) * (0.8 + 0.4 * nHi), verd * 0.7);
diffuseColor.rgb *= 1. - 0.35 * smoothstep(0.3, 0.9, vn3(vec3(vLP.x * 5., vLP.y * 0.6, vLP.z * 5.)));
float crackN = abs(vn3(vLP * 3.6 + 11.) - 0.5), crack = (1. - smoothstep(0.0, 0.016, crackN)) * smoothstep(0.35, 0.7, nLo + 0.3 * nMid);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.35 + 0.5 * stoneK + 0.35 * hgt + 0.2 * verd, 0.2, 1.);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.55, 0.05, stoneK) * (1. - verd);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec3 r1 = cross(q1, normal), r0 = cross(normal, q0);
  float det = dot(q0, r1), dh0 = dFdx(hgt), dh1 = dFdy(hgt);
  normal = normalize(abs(det) * normal - sign(det) * (dh0 * r1 + dh1 * r0) * 0.16 * faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * crack * (0.5 + 1.8 * uAlert);');
  };
  return mat;
}

const N_SEG = 24, SPACING = 1.5;
const _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _rr = new THREE.Vector3(), _uu = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

/** Shared tuning (the difficulty setting scales it): alert gain, chase speed, beam cone (cos), scarf tear, near-sense radius. */
export const GUARDIAN_TUNING = { alert: 1, chase: 1, cos: 0.93, tear: 2, near: 13 };
const BEAM_LEN = 30;

/**
 * Ancient stone-and-bronze serpents that hunt the scarf. They are blind to anyone sheltering under stone.
 * opts: route [{x, z}] (patrols it back and forth instead of circling its anchor), sweep (how far the lamp swings
 * side to side while patrolling), pack (shared array: a guardian that spots you calls the others to search),
 * height (patrol height). `asleep` guardians lie in the sand with their lamp out.
 */
export class Guardian {
  constructor(scene, ax, az, radius = 45, opts = {}) {
    this.scene = scene;
    this.anchor = new THREE.Vector3(ax, 0, az); this.radius = radius;
    this.route = opts.route || null; this.routeI = 0; this.routeDir = 1;
    this.sweep = opts.sweep ?? 0.5; this.patrolH = opts.height ?? 13; this.patrolSpeed = opts.speed ?? 7;
    this.pack = opts.pack || null; if (this.pack) this.pack.push(this);
    this.asleep = false;
    this.lastSeen = new THREE.Vector3(ax, 0, az);
    this.spot = new THREE.Vector4();       // where the lamp lights the ground: x, z, radius, alert (for the sand shader)
    this.phase = Math.random() * 6;
    this.state = 'patrol'; this.stateT = 0; this.alert = 0;
    this.pos = Array.from({ length: N_SEG }, (_, i) => new THREE.Vector3(ax + i * SPACING, terrainHeight(ax, az) + 14, az));
    this.vel = new THREE.Vector3(-1, 0, 0);
    this.beamDir = new THREE.Vector3(0, -1, 0.5).normalize();
    this.hitCool = 0;
    this.dist = 999;

    const geo = new THREE.OctahedronGeometry(1, 1);
    geo.scale(1.0, 0.2, 0.85);
    this.alertU = { value: 0 };
    const mat = guardianMaterial({ color: 0xffffff, emissive: 0x6a2a08, emissiveIntensity: 0.22 }, this.alertU);
    this.body = new THREE.InstancedMesh(geo, mat, N_SEG);
    this.body.frustumCulled = false;
    scene.add(this.body);

    this.head = new THREE.Group();
    const hg = new THREE.OctahedronGeometry(1, 1); hg.scale(1.3, 0.55, 1.9);
    this.head.add(new THREE.Mesh(hg, guardianMaterial({ color: 0xcfc0a8, emissive: 0x4a1a05, emissiveIntensity: 0.2 }, this.alertU)));
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.0) });
    this.haloMat = new THREE.SpriteMaterial({ map: makeSoftDot(), color: new THREE.Color(2.4, 1.3, 0.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (const sx of [-0.5, 0.5]) {
      // an ominous lamp-eye: hot slit core inside a deep socket, with a bloom halo
      const sock = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), new THREE.MeshBasicMaterial({ color: 0x080302 }));
      sock.position.set(sx, -0.1, 1.42); sock.scale.set(1, 0.8, 0.7); this.head.add(sock);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), this.lampMat);
      l.position.set(sx, -0.12, 1.55); l.scale.set(0.7, 1.15, 0.7); this.head.add(l);
      const h = new THREE.Sprite(this.haloMat); h.scale.set(1.6, 1.6, 1); h.position.set(sx, -0.12, 1.65); this.head.add(h);
    }
    scene.add(this.head);

    // the visible cone matches the cone it sees with, so the light on the sand is exactly where not to stand
    const tan = Math.tan(Math.acos(GUARDIAN_TUNING.cos));
    const cg = new THREE.CylinderGeometry(0.3, BEAM_LEN * tan, BEAM_LEN, 28, 1, true); cg.translate(0, -BEAM_LEN / 2, 0);
    this._cosBuilt = GUARDIAN_TUNING.cos;
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0.5 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(2.4, 1.8, 0.9) } },
      vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(cg, this.beamMat); this.beam.frustumCulled = false; this.beam.renderOrder = 3;
    scene.add(this.beam);
    this._target = new THREE.Vector3();
    this._toP = new THREE.Vector3();
    this._want = new THREE.Vector3();
  }

  /** Called by the pack: someone saw the traveler at `p`; come and look. */
  alarm(p) {
    if (this.asleep || this.state === 'chase') return;
    this.lastSeen.copy(p); this.state = 'search'; this.stateT = 0; this.alert = Math.max(this.alert, 0.5);
  }

  setAsleep(on) {
    if (on === this.asleep) return;
    this.asleep = on;
    if (on) { this.state = 'patrol'; this.alert = 0; }
  }

  _rebuildBeam() {
    const tan = Math.tan(Math.acos(GUARDIAN_TUNING.cos));
    this.beam.geometry.dispose();
    const cg = new THREE.CylinderGeometry(0.3, BEAM_LEN * tan, BEAM_LEN, 28, 1, true); cg.translate(0, -BEAM_LEN / 2, 0);
    this.beam.geometry = cg; this._cosBuilt = GUARDIAN_TUNING.cos;
  }

  update(dt, time, player, fx, ev) {
    const T = GUARDIAN_TUNING;
    if (this._cosBuilt !== T.cos) this._rebuildBeam();
    const head = this.pos[0], pp = player.pos;
    // far away and quietly patrolling: nothing to see, skip the work
    const far = Math.hypot(pp.x - this.anchor.x, pp.z - this.anchor.z) > 320 && this.state === 'patrol';
    this.body.visible = this.head.visible = this.beam.visible = !far;
    this.spot.w = 0;
    if (far) { this.dist = 999; return; }
    const gy = terrainHeight(head.x, head.z);
    const toP = this._toP.set(pp.x - head.x, pp.y + 1.2 - head.y, pp.z - head.z);
    const dist = toP.length() || 1e-3;
    this.stateT += dt; this.hitCool = Math.max(0, this.hitCool - dt);
    this.dist = this.asleep ? 999 : dist;

    // is the traveler inside the lamp's beam?
    const cosA = toP.dot(this.beamDir) / dist;
    const sheltered = player.isSheltered();
    const inBeam = !this.asleep && !sheltered && dist < BEAM_LEN + 10 && cosA > T.cos;
    const near = !this.asleep && !sheltered && dist < T.near;

    const target = this._target;
    let speed = this.patrolSpeed;
    if (this.asleep) {
      // coiled in the sand, lamp dark
      target.set(this.anchor.x, terrainHeight(this.anchor.x, this.anchor.z) + 2.2, this.anchor.z);
      speed = 3;
    } else if (this.state === 'patrol' || this.state === 'search') {
      if (this.state === 'search') {
        // circle where the traveler was last seen, lamp sweeping round
        const a = this.stateT * 0.9 + this.phase;
        target.set(this.lastSeen.x + Math.cos(a) * 9, 0, this.lastSeen.z + Math.sin(a) * 9);
        target.y = terrainHeight(target.x, target.z) + this.patrolH * 0.8;
        speed = 9 * T.chase;
        if (this.stateT > 7) { this.state = 'patrol'; this.stateT = 0; }
      } else if (this.route) {
        const wp = this.route[this.routeI];
        target.set(wp.x, 0, wp.z);
        if (Math.hypot(head.x - wp.x, head.z - wp.z) < 6) {
          if (this.routeI + this.routeDir < 0 || this.routeI + this.routeDir >= this.route.length) this.routeDir = -this.routeDir;
          this.routeI += this.routeDir;
        }
        target.y = terrainHeight(target.x, target.z) + this.patrolH + Math.sin(time * 0.7 + this.phase) * 1.5;
      } else {
        const a = time * 0.16 + this.phase;
        target.set(this.anchor.x + Math.cos(a) * this.radius, 0, this.anchor.z + Math.sin(a * 1.4) * this.radius * 0.7);
        target.y = terrainHeight(target.x, target.z) + this.patrolH + Math.sin(time * 0.7 + this.phase) * 2.5;
      }
      if (inBeam || near) this.alert += dt * 1.6 * T.alert * (inBeam ? 1 : 0.6) * (this.state === 'search' ? 1.6 : 1);
      else this.alert = Math.max(0, this.alert - dt * 0.5);
      if (this.alert >= 1) {
        this.state = 'chase'; this.stateT = 0; ev.push({ type: 'guardian-alert' });
        // the others come to look
        if (this.pack) for (const o of this.pack) if (o !== this && Math.hypot(o.pos[0].x - pp.x, o.pos[0].z - pp.z) < 110) o.alarm(pp);
      }
    } else if (this.state === 'chase') {
      target.set(pp.x, pp.y + 1.8, pp.z);
      speed = (11 + Math.min(6, this.stateT * 2)) * T.chase;
      if (sheltered) {
        this.alert -= dt * 0.8;
        if (this.alert < 0.2 || this.stateT > 9) { this.state = 'search'; this.stateT = 0; this.lastSeen.copy(pp); }
      } else { this.alert = 1; this.lastSeen.copy(pp); }
      if (this.stateT > 12) { this.state = 'retreat'; this.stateT = 0; }
      if (dist < 3.4 && this.hitCool <= 0 && !sheltered) {
        this.hitCool = 3;
        ev.push({ type: 'guardian-hit', lost: player.tear(T.tear) });
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
    target.y = Math.max(target.y, gy + (this.asleep ? 1.5 : 5));

    // head steering
    const desired = target.sub(head);
    const dl = desired.length() || 1;
    desired.multiplyScalar(speed / dl);
    this.vel.lerp(desired, 1 - Math.exp(-(this.state === 'chase' ? 2.6 : 1.1) * dt));
    head.addScaledVector(this.vel, dt);
    if (head.y < gy + (this.asleep ? 1.2 : 3.5)) head.y = gy + (this.asleep ? 1.2 : 3.5);

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
    else if (this.state === 'search') {
      // the lamp swings round in a wide circle
      const a = time * 2.1 + this.phase;
      want.set(Math.cos(a) * 0.75, -0.8, Math.sin(a) * 0.75);
    } else {
      // forward and down, swinging side to side across its path
      const sx = -hf.z, sz = hf.x, sl = Math.hypot(sx, sz) || 1;
      want.set(hf.x * 0.35 + sx / sl * sweep * this.sweep, -0.9, hf.z * 0.35 + sz / sl * sweep * this.sweep);
    }
    if (this.asleep) want.set(hf.x, -0.3, hf.z);
    this.beamDir.lerp(want.normalize(), 1 - Math.exp(-3 * dt)).normalize();
    this.beam.position.copy(head);
    this.beam.quaternion.setFromUnitVectors(_down, this.beamDir);
    const alertK = this.state === 'chase' ? 1 : this.state === 'search' ? Math.max(0.45, this.alert) : this.alert;
    const on = this.asleep ? 0 : 1;
    this.beam.visible = on > 0;
    this.beamMat.uniforms.uColor.value.setRGB(2.4 + 1.4 * alertK, 1.8 - 0.9 * alertK, 0.9 - 0.6 * alertK);
    this.beamMat.uniforms.uIntensity.value = 0.5 + 0.45 * alertK;
    const lamp = 0.15 + 0.85 * on;
    this.lampMat.color.setRGB((3.2 + 1.6 * alertK) * lamp, (2.2 - 1.1 * alertK) * lamp, (1.0 - 0.6 * alertK) * lamp);
    this.haloMat.color.setRGB((2.4 + 1.2 * alertK) * lamp, (1.3 - 0.7 * alertK) * lamp, (0.5 - 0.35 * alertK) * lamp);
    this.alertU.value = alertK;
    this.beamMat.uniforms.uTime.value = time;
    // where the cone meets the sand: a few refinement steps along the beam
    if (on && this.beamDir.y < -0.15) {
      let t = (head.y - gy) / -this.beamDir.y;
      for (let k = 0; k < 3; k++) {
        const x = head.x + this.beamDir.x * t, z = head.z + this.beamDir.z * t;
        t = Math.max(0, (head.y - terrainHeight(x, z)) / -this.beamDir.y);
      }
      if (t < BEAM_LEN + 10) {
        const tan = Math.tan(Math.acos(T.cos));
        this.spot.set(head.x + this.beamDir.x * t, head.z + this.beamDir.z * t, Math.max(1.5, t * tan / Math.max(0.35, -this.beamDir.y)), 0.65 + 0.6 * alertK);
      }
    }
  }
}
