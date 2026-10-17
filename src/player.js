import * as THREE from 'three';
import { makeRobeTexture, makeScarfMask, makeBlobShadow } from './textures.js';
import { terrainHeight, terrainGradient, smooth, clamp, WIND } from './world/heightfield.js';

// ------------------------------------------------------------------ model
export function buildTraveler({ white = false } = {}) {
  const g = new THREE.Group();
  const robeTex = makeRobeTexture(white);
  const robeMat = new THREE.MeshStandardMaterial({ map: robeTex, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: robeTex, emissiveIntensity: white ? 0.35 : 0.22 });
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.001, 0), new THREE.Vector2(0.30, 0), new THREE.Vector2(0.47, 0.02), new THREE.Vector2(0.455, 0.1),
    new THREE.Vector2(0.40, 0.32), new THREE.Vector2(0.33, 0.56), new THREE.Vector2(0.275, 0.80), new THREE.Vector2(0.235, 0.98),
    new THREE.Vector2(0.20, 1.07), new THREE.Vector2(0.15, 1.13), new THREE.Vector2(0.001, 1.15),
  ]).getPoints(36);
  const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 36), robeMat);
  g.add(robe);

  // pale collar
  const collarMat = new THREE.MeshStandardMaterial({ color: white ? 0xfff7e8 : 0xf2d9a0, roughness: 0.7, side: THREE.DoubleSide, emissive: white ? 0x7a7060 : 0x3a2810, emissiveIntensity: 0.6 });
  const collar = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.34, 0.9), new THREE.Vector2(0.29, 0.99), new THREE.Vector2(0.235, 1.09), new THREE.Vector2(0.17, 1.16)], 28), collarMat);
  g.add(collar);

  // head: hood + dark face with two pale eyes
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 18), robeMat);
  hood.scale.set(0.92, 1.18, 1.0); hood.position.y = 1.31;
  g.add(hood);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.5 }));
  face.scale.set(0.82, 0.95, 0.5); face.position.set(0, 1.31, 0.135);
  g.add(face);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.7, 1.8) });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), eyeMat);
    eye.scale.set(0.9, 1.5, 1); eye.position.set(sx * 0.052, 1.325, 0.186); eye.rotation.y = sx * 0.28;
    g.add(eye);
  }
  // little pointed hood tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 16), robeMat);
  tip.position.set(0, 1.55, -0.015); tip.rotation.x = -0.25;
  g.add(tip);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
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
  base *= 0.92 + 0.16 * sin(vUv.y * 90. + vUv.x * 7.);
  base = mix(base, vec3(0.95, 0.62, 0.24), smoothstep(0.86, 0.94, edge));
  vec3 L = normalize(uSunDir);
  float diff = max(dot(N, L), 0.) * 0.6 + pow(max(dot(-N, L), 0.), 2.) * 0.5;
  vec3 col = base * (uAmb * 0.45 + uSunColor * (0.25 + diff));
  vec3 glyphLit = vec3(3.0, 2.4, 1.5) * (0.85 + 0.15 * sin(uTime * 3. + vIdx * 0.7));
  vec3 glyphDim = vec3(0.55, 0.22, 0.10);
  col += m * mix(glyphDim, glyphLit, lit);
  col += uFlash * vec3(1.5, 1.0, 0.6) * (0.5 + 0.5 * m);
  float dist = length(cameraPosition - vW);
  col = mix(col, uFog, 1. - exp(-pow(dist * uFogD, 2.)));
  gl_FragColor = vec4(col, 1.);
}`;

export class Scarf {
  constructor(scene, maxN = 30) {
    this.maxN = maxN; this.n = 10; this.seg = 0.30;
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
    this.sideSmooth = Array.from({ length: maxN }, () => new THREE.Vector3(1, 0, 0));
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

  update(dt, anchor, vel, flutter, time, back) {
    const n = this.n, L = this.seg, P = this.pts, Q = this.prev;
    P[0].copy(anchor); Q[0].copy(anchor);
    const speed = Math.hypot(vel.x, vel.z);
    const lift = Math.min(6, speed * speed * 0.035);
    const wx = WIND.x * 1.6, wz = WIND.z * 1.6;
    const dt2 = dt * dt;
    for (let i = 1; i < n; i++) {
      const p = P[i], q = Q[i];
      const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
      q.copy(p);
      const ph = time * 2.2 + i * 0.55;
      let fx = wx + Math.sin(ph) * 1.2 * flutter, fy = -3.2 + lift + Math.sin(ph * 1.3 + 1.1) * 1.2 * flutter, fz = wz + Math.cos(ph * 0.9) * 1.2 * flutter;
      // soft spring toward a pose streaming out behind the shoulders, so the scarf never hugs the robe
      if (back) {
        const K = 16 / (1 + i * 1.3);
        const rx = anchor.x + back.x * (0.35 + i * 0.2), ry = anchor.y - Math.min(0.18 + i * 0.05, 0.7), rz = anchor.z + back.z * (0.35 + i * 0.2);
        fx += (rx - p.x) * K; fy += (ry - p.y) * K; fz += (rz - p.z) * K;
      }
      p.x += vx + fx * dt2; p.y += vy + fy * dt2; p.z += vz + fz * dt2;
    }
    // distance constraints (a few passes, both directions for stiffness)
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const a = P[i - 1], b = P[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-5;
        const k = (d - L) / d;
        if (i === 1) { b.x -= dx * k; b.y -= dy * k; b.z -= dz * k; }
        else { a.x += dx * k * 0.5; a.y += dy * k * 0.5; a.z += dz * k * 0.5; b.x -= dx * k * 0.5; b.y -= dy * k * 0.5; b.z -= dz * k * 0.5; }
      }
      P[0].copy(anchor);
    }
    // light smoothing so the cloth curves instead of zig-zagging
    for (let i = 2; i < n - 1; i++) {
      const a = P[i - 1], b = P[i + 1], c = P[i];
      c.x += ((a.x + b.x) * 0.5 - c.x) * 0.3; c.y += ((a.y + b.y) * 0.5 - c.y) * 0.3; c.z += ((a.z + b.z) * 0.5 - c.z) * 0.3;
    }
    for (let i = 2; i < n; i++) {
      const gy = terrainHeight(P[i].x, P[i].z) + 0.06;
      if (P[i].y < gy) P[i].y = gy;
    }
    this._rebuild(time, flutter);
  }

  _rebuild(time, flutter) {
    const n = this.n, P = this.pts;
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array;
    const t = this.tmpA, s = this.tmpB, nn = this.tmpC, up = this.tmpD;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      t.subVectors(b, a); if (t.lengthSq() < 1e-8) t.set(0, 0, -1); t.normalize();
      up.set(0, 1, 0);
      s.crossVectors(t, up);
      if (s.lengthSq() < 0.02) s.set(1, 0, 0).cross(t);
      s.normalize();
      // twist for a fluttering ribbon
      const ang = Math.sin(time * 3.2 + i * 0.7) * (0.25 + 0.9 * flutter) + (i * 0.06);
      nn.crossVectors(s, t);
      const c = Math.cos(ang), sn = Math.sin(ang);
      const sx = s.x * c + nn.x * sn, sy = s.y * c + nn.y * sn, sz = s.z * c + nn.z * sn;
      const nx = nn.x * c - s.x * sn, ny = nn.y * c - s.y * sn, nz = nn.z * c - s.z * sn;
      const f = i / (n - 1);
      let w = 0.17 * (1 - 0.25 * f);
      if (i >= n - 2) w *= i === n - 1 ? 0.12 : 0.6;
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
const WALK = 6.4;
const SURF_MAX = 24;

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.model = buildTraveler();
    this.body = new THREE.Group();
    this.body.add(this.model);
    this.group.add(this.body);
    scene.add(this.group);

    this.scarf = new Scarf(scene);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.grounded = true;
    this.charge = 1;
    this.glyphs = 0;
    this.sing = 0;
    this.singing = false;
    this.flying = false;
    this.surfing = false;
    this.speed = 0;
    this.cold = 0;           // 0..1, slows the traveler in the snow
    this.stepDist = 0;
    this.leanX = 0; this.leanZ = 0; this.roll = 0;
    this.frozen = false;     // cutscenes
    this.scripted = false;   // position driven externally (ending)
    this.collapse = 0;       // 0..1, lying in the snow (ending)
    this.flash = 0;
    this.stunned = 0;
    this._anchor = new THREE.Vector3();
    this._back = new THREE.Vector3();
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
    this.group.position.copy(this.pos);
    this._updateAnchor();
    this.scarf.reset(this._anchor, new THREE.Vector3(0, 0, 1));
  }

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
    // neck, a little behind the shoulders
    a.set(this.pos.x - sy * 0.22, this.pos.y + 1.0 * Math.cos(this.leanX) * (1 - 0.78 * this.collapse), this.pos.z - cy * 0.22);
  }

  /** @param camYaw radians; camera sits behind the player at this yaw */
  update(dt, input, camYaw, time, env) {
    this.events.length = 0;
    const p = this.pos, v = this.vel;
    const inp = this.frozen ? { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false } : input;
    if (this.stunned > 0) { this.stunned -= dt; }
    const stun = this.stunned > 0 ? 0.25 : 1;

    if (!this.scripted) {
      // camera-relative wish direction
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      let wx = fx * inp.my + rx * inp.mx, wz = fz * inp.my + rz * inp.mx;
      const wl = Math.hypot(wx, wz);
      const wishAmt = Math.min(1, wl);
      if (wl > 1e-4) { wx /= wl; wz /= wl; }

      // terrain
      const g = terrainGradient(p.x, p.z);
      const gx = g.x, gz = g.z, s = Math.hypot(gx, gz);
      const surfAmt = smooth(0.27, 0.52, s);
      const coldMul = 1 - 0.45 * this.cold;
      let speedTarget = WALK * coldMul * stun;
      if (this.grounded && wl > 0) {
        const uphill = (wx * gx + wz * gz);                // >0 when heading uphill
        speedTarget *= clamp(1 - 1.05 * Math.max(0, uphill), 0.3, 1);
      }

      // jump & flight
      const wasGrounded = this.grounded;
      if (inp.jumpPressed && this.grounded && !this.frozen) { v.y = 6.2; this.grounded = false; this.events.push('jump'); }
      this.flying = false;
      if (!this.grounded) {
        if (inp.jump && !this.frozen && this.stunned <= 0) {
          if (this.charge > 0.001) {
            this.flying = true;
            v.y += (6.4 - v.y) * (1 - Math.exp(-3.2 * dt));
            const drain = 1 / (1.5 + 0.11 * this.scarf.n) * (1 + 0.35 * this.cold);
            this.charge = Math.max(0, this.charge - drain * dt);
          } else {
            v.y = Math.max(v.y - 16 * dt, -3.5);          // glide on an empty scarf
          }
        } else v.y -= 16 * dt;
        v.y = Math.max(v.y, -26);
      }

      // horizontal
      if (this.grounded) {
        if (surfAmt > 0) {
          const il = 1 / (s || 1);
          const acc = 27 * surfAmt;
          v.x += -gx * il * acc * dt; v.z += -gz * il * acc * dt;
        }
        const k = this.stunned > 0 ? 3 : (9 - 8.2 * surfAmt);
        const tx = wx * speedTarget * wishAmt, tz = wz * speedTarget * wishAmt;
        // when surfing keep momentum; only steer
        const kk = 1 - Math.exp(-k * dt);
        v.x += (tx - v.x) * kk; v.z += (tz - v.z) * kk;
      } else {
        const air = this.flying ? 8.2 : 6.8;
        const kk = 1 - Math.exp(-2.4 * dt);
        v.x += (wx * air * wishAmt * coldMul - v.x) * kk; v.z += (wz * air * wishAmt * coldMul - v.z) * kk;
      }
      const hs = Math.hypot(v.x, v.z);
      if (hs > SURF_MAX) { v.x *= SURF_MAX / hs; v.z *= SURF_MAX / hs; }
      this.speed = Math.min(hs, SURF_MAX);

      // integrate
      p.x += v.x * dt; p.z += v.z * dt; p.y += v.y * dt;
      this._collide();

      const gy = terrainHeight(p.x, p.z);
      if (this.grounded) {
        p.y = gy; v.y = 0;
      } else if (p.y <= gy && v.y <= 0) {
        const impact = -v.y;
        p.y = gy; v.y = 0; this.grounded = true;
        if (!wasGrounded && impact > 3) this.events.push({ type: 'land', impact });
      }
      this.surfing = this.grounded && surfAmt > 0.45 && this.speed > 8;

      // recharge
      if (this.grounded && !this.flying) this.charge = Math.min(1, this.charge + 0.28 * dt * (1 - 0.8 * this.cold));

    }

    // singing
    this.singing = !!inp.sing && !this.frozen;
    this.sing += ((this.singing ? 1 : 0) - this.sing) * (1 - Math.exp(-(this.singing ? 5 : 3) * dt));

    // facing
    if (this.speed > 0.6) {
      const target = Math.atan2(v.x, v.z);
      let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-9 * dt));
      this.roll += (clamp(d * -0.9, -0.5, 0.5) - this.roll) * (1 - Math.exp(-6 * dt));
    } else this.roll *= Math.exp(-6 * dt);

    // footsteps
    if (this.grounded && !this.surfing && this.speed > 1) {
      this.stepDist += this.speed * dt;
      if (this.stepDist > 1.15) { this.stepDist = 0; this.events.push('step'); }
    }

    // pose
    const targetLean = this.flying ? 0.42 : this.surfing ? -0.18 : clamp(this.speed / 18, 0, 0.18);
    this.leanX += (targetLean - this.leanX) * (1 - Math.exp(-6 * dt));
    this.group.position.copy(p);
    this.group.rotation.y = this.heading;
    this.body.rotation.x = this.leanX + (this.surfing ? 0.12 : 0);
    this.body.rotation.z = this.roll + 1.4 * this.collapse;   // topples onto one side
    const bob = this.grounded && !this.surfing ? Math.abs(Math.sin(time * 9)) * 0.03 * Math.min(1, this.speed / 5) : 0;
    this.body.position.y = bob + 0.3 * this.collapse;
    this.body.scale.setScalar(1 + this.sing * 0.035);

    // shadow
    const sh = this.shadow;
    const gy = terrainHeight(p.x, p.z);
    const up = Math.max(0, p.y - gy);
    sh.position.set(p.x + env.sunDir.x * -0.1, gy + 0.05, p.z + env.sunDir.z * -0.1);
    sh.rotation.x = -Math.PI / 2;
    const sc = 1.4 + up * 0.18;
    sh.scale.set(sc, sc * 1.1, 1);
    sh.material.opacity = 0.7 / (1 + up * 0.25);

    // scarf
    this._updateAnchor();
    const flutter = clamp(this.speed / 14 + (this.flying ? 0.7 : 0) + this.sing * 0.4, 0.15, 1.2);
    this._back.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.scarf.update(dt, this._anchor, v, flutter, time, this._back);
    this.scarf.uniforms.uCharge.value += (this.charge - this.scarf.uniforms.uCharge.value) * (1 - Math.exp(-8 * dt));
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
        if (d < m && d > 1e-4) { const k = m / d; p.x = c.x + dx * k; p.z = c.z + dz * k; this.vel.x *= 0.3; this.vel.z *= 0.3; }
      } else {
        // oriented box
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
        const hx = c.hx + r, hz = c.hz + r;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
          let nx = lx, nz = lz;
          if (px < pz) nx = Math.sign(lx || 1) * hx; else nz = Math.sign(lz || 1) * hz;
          p.x = c.x + nx * cs - nz * sn; p.z = c.z + nx * sn + nz * cs;
          this.vel.x *= 0.3; this.vel.z *= 0.3;
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
