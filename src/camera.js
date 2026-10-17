import * as THREE from 'three';
import { terrainHeight, clamp } from './world/heightfield.js';

const exp = (k, dt) => 1 - Math.exp(-k * dt);

/** Third-person camera that drifts behind the traveler, with manual orbit, terrain avoidance and look-ahead. */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; this.pitch = 0.2; this.dist = 8;
    this.idle = 0;
    this.pos = new THREE.Vector3(0, 5, 8);
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fov = 58;
    this.restPitch = 0.2;
    this.baseDist = 8;
    this.sens = 1;
    this.invertY = false;
    this.target = new THREE.Vector3();
    this.ahead = new THREE.Vector3();
    this.focusY = 0;
    this.lift = 0;              // extra pitch pushed in by terrain occlusion
    this.ready = false;
    this._want = new THREE.Vector3();
    this.colliders = null;
    this.clip = 8;
  }

  /** Distance along the ray from `o` at which it first enters a collider (or `max`). */
  _blocked(o, ux, uy, uz, max) {
    const R = 0.55;
    const near = this._near || (this._near = []);
    near.length = 0;
    for (const c of this.colliders) {
      const ext = c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
      if (Math.hypot(c.x - o.x, c.z - o.z) < max + ext + 2) near.push(c);
    }
    if (!near.length) return max;
    for (let t = 0.8; t <= max; t += 0.4) {
      const x = o.x + ux * t, y = o.y + uy * t, z = o.z + uz * t;
      for (const c of near) {
        if (y > c.top + 0.4 || y < (c.bottom ?? -1e9)) continue;
        const dx = x - c.x, dz = z - c.z;
        if (c.kind === 'circle') { if (dx * dx + dz * dz < (c.r + R) ** 2) return Math.max(2.4, t - 0.5); }
        else {
          const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
          const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
          if (Math.abs(lx) < c.hx + R && Math.abs(lz) < c.hz + R) return Math.max(2.4, t - 0.5);
        }
      }
    }
    return max;
  }

  snap(player) {
    this.yaw = player.heading + Math.PI;
    this.ready = false;
  }

  update(dt, player, look, time, extra = {}) {
    const lx = look.lookX || 0, ly = (look.lookY || 0) * (this.invertY ? -1 : 1);
    if (lx || ly) { this.idle = 0; } else this.idle += dt;
    // manual orbit is applied 1:1 so every pixel of mouse travel counts
    this.yaw -= lx * 0.0034 * this.sens;
    this.pitch = clamp(this.pitch + ly * 0.0028 * this.sens, -0.2, 1.2);

    const speed = player.speed;
    if (!extra.noFollow && this.idle > 1.0 && speed > 1.2) {
      const target = player.heading + Math.PI;
      let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      // don't swing round when the traveler walks toward the camera
      const facingCam = Math.abs(d) > 2.4 ? 0.15 : 1;
      this.yaw += d * exp(0.9 * Math.min(1, speed / 6) * facingCam, dt);
    }
    if (this.idle > 2.0) {
      const rp = this.restPitch + (player.flying ? 0.14 : 0) + (player.surfing ? -0.05 : 0);
      this.pitch += (rp - this.pitch) * exp(0.7, dt);
    }

    const wantDist = (extra.dist ?? this.baseDist) + Math.min(4.5, speed * 0.15) + (player.flying ? 2.4 : 0);
    this.dist += (wantDist - this.dist) * exp(2, dt);

    // focus point: the traveler, led slightly in the direction of travel; vertical motion is softened so jumps
    // don't yank the horizon
    const pp = extra.focus || player.pos;
    const v = player.vel;
    this.ahead.x += (v.x * 0.22 - this.ahead.x) * exp(2.5, dt);
    this.ahead.z += (v.z * 0.22 - this.ahead.z) * exp(2.5, dt);
    if (!this.ready) this.focusY = pp.y;
    const yRate = player.grounded ? 9 : player.flying ? 3.5 : 2.2;
    this.focusY += (pp.y - this.focusY) * exp(yRate, dt);
    if (Math.abs(pp.y - this.focusY) > 6) this.focusY = pp.y - Math.sign(pp.y - this.focusY) * 6;
    this.target.set(pp.x + this.ahead.x, this.focusY + (extra.height ?? 1.5), pp.z + this.ahead.z);

    // terrain occlusion: if a dune would hide the traveler, raise the camera over it
    const pitch = this.pitch;
    const cp = Math.cos(pitch);
    const dx = Math.sin(this.yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(this.yaw) * cp;
    let need = 0;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6 * this.dist;
      const x = this.target.x + dx * t, y = this.target.y + dy * t, z = this.target.z + dz * t;
      const clear = terrainHeight(x, z) + 0.8 - y;
      if (clear > 0) need = Math.max(need, Math.atan2(clear, t) + 0.02);
    }
    need = extra.noLift ? 0 : Math.min(0.9, need);
    this.lift += (need - this.lift) * exp(need > this.lift ? 5 : 1.0, dt);

    const p2 = this.pitch + this.lift, c2 = Math.cos(p2);
    // stone between the traveler and the camera: pull in so columns and walls never fill the view
    const ux = Math.sin(this.yaw) * c2, uy = Math.sin(p2), uz = Math.cos(this.yaw) * c2;
    const block = this.colliders ? this._blocked(this.target, ux, uy, uz, this.dist) : this.dist;
    this.clip += ((block < this.dist ? block : this.dist) - this.clip) * (block < this.clip ? 1 : exp(3, dt));
    const cd = Math.min(this.dist, this.clip);
    const want = this._want.set(this.target.x + ux * cd, this.target.y + uy * cd, this.target.z + uz * cd);
    if (!this.ready) { this.pos.copy(want); this.ready = true; }
    const k = exp(extra.follow ?? 8, dt);
    this.pos.x += (want.x - this.pos.x) * k;
    this.pos.z += (want.z - this.pos.z) * k;
    this.pos.y += (want.y - this.pos.y) * exp(6, dt);
    const minY = terrainHeight(this.pos.x, this.pos.z) + 1.0;
    if (this.pos.y < minY) this.pos.y = minY;

    this.shake = Math.max(0, this.shake - dt * 1.6);
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.35;
      cam.position.x += Math.sin(time * 61) * s; cam.position.y += Math.sin(time * 53 + 1) * s;
    }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.look.set(this.target.x + fx * 3.0, this.target.y + 0.5 - Math.sin(this.pitch) * 1.2, this.target.z + fz * 3.0);
    if (extra.lookAt) this.look.lerp(extra.lookAt, extra.lookK ?? 0.5);
    cam.lookAt(this.look);
    // a slight roll into fast carves
    if (player.surfing || player.flying) cam.rotateZ(clamp(-player.turnRate * 0.04, -0.06, 0.06) * Math.min(1, speed / 12));

    let wantFov = (extra.fov ?? 58) + Math.min(14, speed * 0.45) + (player.flying ? 3 : 0);
    // portrait screens: widen the vertical FOV so at least ~56 degrees stay visible horizontally
    const asp = cam.aspect;
    if (asp < 1.35) {
      const hNeed = THREE.MathUtils.degToRad(56);
      const vForH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hNeed / 2) / asp));
      wantFov = Math.max(wantFov, Math.min(100, vForH));
    }
    this.fov += (wantFov - this.fov) * exp(3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
