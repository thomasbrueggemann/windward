import * as THREE from 'three';
import { terrainHeight, clamp } from './world/heightfield.js';

/** Third-person camera that drifts behind the traveler, with manual orbit. */
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
    this.target = new THREE.Vector3();
    this.ready = false;
  }

  snap(player) {
    this.yaw = player.heading + Math.PI;
    this.ready = false;
  }

  update(dt, player, look, time, extra = {}) {
    const lx = look.lookX, ly = look.lookY;
    if (lx || ly) { this.idle = 0; } else this.idle += dt;
    this.yaw -= lx * 0.0036;
    this.pitch = clamp(this.pitch + ly * 0.0030, -0.15, 1.25);

    const speed = player.speed;
    if (!extra.noFollow && this.idle > 1.2 && speed > 1.2) {
      const target = player.heading + Math.PI;
      let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-0.8 * Math.min(1, speed / 6) * dt));
    }
    if (this.idle > 2.0) {
      const rp = this.restPitch + (player.flying ? 0.12 : 0) + (player.surfing ? -0.04 : 0);
      this.pitch += (rp - this.pitch) * (1 - Math.exp(-0.7 * dt));
    }

    const wantDist = (extra.dist ?? 8) + Math.min(5, speed * 0.16) + (player.flying ? 2.2 : 0);
    this.dist += (wantDist - this.dist) * (1 - Math.exp(-2 * dt));

    const pp = extra.focus || player.pos;
    this.target.set(pp.x, pp.y + (extra.height ?? 1.5), pp.z);
    const cp = Math.cos(this.pitch);
    const want = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist);
    if (!this.ready) { this.pos.copy(want); this.ready = true; }
    const k = 1 - Math.exp(-(extra.follow ?? 7) * dt);
    this.pos.x += (want.x - this.pos.x) * k;
    this.pos.z += (want.z - this.pos.z) * k;
    this.pos.y += (want.y - this.pos.y) * (1 - Math.exp(-5 * dt));
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
    cam.lookAt(this.look);

    const wantFov = (extra.fov ?? 58) + Math.min(14, speed * 0.45) + (player.flying ? 3 : 0);
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
