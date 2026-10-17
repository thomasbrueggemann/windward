import * as THREE from 'three';
import { Player } from './player.js';
import { pathX, progressAt, terrainHeight, clamp } from './world/heightfield.js';

const APPEAR_AT = 0.085;      // progress where the other traveler is first seen, waiting on a dune ahead
const LOST_AT = 0.925;        // the blizzard separates the two travelers here
const _v = new THREE.Vector3(), _look = new THREE.Vector3();

/**
 * Another traveler. Driven by the same controller as the player (so it walks, surfs and flies the same way),
 * steered by a small state machine: waits for you, walks a little ahead toward the mountain, answers your song,
 * shares the charge of its scarf when close, and is lost to you in the snow.
 */
export class Companion {
  constructor(scene, colliders, shelters) {
    this.p = new Player(scene, { scarfBase: new THREE.Color(0.55, 0.085, 0.05) });
    this.p.colliders = colliders;
    this.p.shelters = shelters;
    for (let i = 0; i < 4; i++) this.p.addGlyph();
    this.p.setVisible(false);
    this.state = 'hidden';
    this.inp = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false };
    this.side = 1;
    this.waitT = 0; this.stuckT = 0; this.flyHold = 0; this.singHold = 0;
    this.replyT = -1; this.replyBig = false; this.callT = 8;
    this.lastPlayerSing = false; this.playerSingT = 0;
    this.met = false;
    this.events = [];
    this.lastPos = new THREE.Vector3();
  }

  get pos() { return this.p.pos; }
  get visible() { return this.p.group.visible; }

  _appear(player) {
    // stand on the highest nearby crest so the silhouette reads against the sky
    let x = 0, z = 0, best = -1e9;
    for (let dz = -85; dz <= -55; dz += 5) for (let dx = -26; dx <= 26; dx += 4) {
      const zz = player.pos.z + dz, xx = pathX(zz) + dx;
      const h = terrainHeight(xx, zz) - Math.abs(dx) * 0.08;
      if (h > best) { best = h; x = xx; z = zz; }
    }
    this.p.heading = Math.atan2(player.pos.x - x, player.pos.z - z);
    this.p.teleport(x, z);
    this.p.setVisible(true);
    this.state = 'waiting';
  }

  /** Puts the companion just out of view behind/beside the player (used when it falls hopelessly behind). */
  _catchUp(player, camera) {
    for (let k = 0; k < 8; k++) {
      const a = player.heading + Math.PI + (Math.random() - 0.5) * 2.2;
      const r = 22 + Math.random() * 10;
      const x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
      _v.set(x, player.pos.y + 1, z).project(camera);
      if (Math.abs(_v.x) > 1.1 || _v.z > 1) { this.p.heading = player.heading; this.p.teleport(x, z); return; }
    }
  }

  update(dt, time, player, env, camera, frozen) {
    const ev = this.events; ev.length = 0;
    const prog = progressAt(player.pos.z);
    if (this.state === 'hidden') {
      if (prog >= APPEAR_AT && prog < LOST_AT - 0.05) this._appear(player);
      else return ev;
    }
    if (this.state === 'gone') return ev;

    const c = this.p, cp = c.pos, pp = player.pos;
    const dx = pp.x - cp.x, dz = pp.z - cp.z, d = Math.hypot(dx, dz);
    const inp = this.inp;
    inp.mx = inp.my = 0; inp.jumpPressed = false; inp.jump = false; inp.sing = false;

    // ----- hearing the player sing: answer after a short, human-feeling delay
    if (player.singing && !this.lastPlayerSing) { this.playerSingT = 0; if (d < 45 && this.replyT < 0) { this.replyT = 0.35 + Math.random() * 0.5; this.replyBig = false; } }
    if (player.singing) this.playerSingT += dt;
    if (!player.singing && this.lastPlayerSing && this.playerSingT > 0.8 && d < 45) { this.replyT = 0.4 + Math.random() * 0.3; this.replyBig = true; }
    this.lastPlayerSing = player.singing;
    if (this.replyT >= 0) {
      this.replyT -= dt;
      if (this.replyT < 0) {
        this.singHold = this.replyBig ? 1.2 : 0.45;
        ev.push({ type: 'chirp', big: this.replyBig, dist: d });
        if (!this.met) { this.met = true; ev.push({ type: 'met' }); }
      }
    }
    // the companion also calls out now and then, especially when it is waiting for you
    this.callT -= dt;
    if (this.callT <= 0) {
      this.callT = (this.state === 'waiting' ? 5 : 14) + Math.random() * 10;
      if (d < 90 && !frozen) { this.singHold = 0.45; ev.push({ type: 'chirp', big: false, dist: d }); }
    }
    if (this.singHold > 0) { this.singHold -= dt; inp.sing = true; }

    // ----- movement
    if (this.state === 'waiting') {
      // stand on the dune, facing the player, until they come close
      if (d < 18 || (this.met && d < 40)) { this.state = 'travel'; ev.push({ type: 'join' }); }
    } else if (this.state === 'travel' || this.state === 'lost') {
      // aim a few metres ahead of the player, toward the mountain, offset to one side
      const aheadZ = pp.z - 40;
      let gx = pathX(aheadZ) - pp.x, gz = aheadZ - pp.z;
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      const idle = player.speed < 0.6 && player.grounded;
      if (idle) this.waitT += dt; else this.waitT = 0;
      let lead = idle ? (this.waitT > 2 ? 3.2 : 5) : 6 + Math.min(6, player.speed * 0.6);
      let lat = this.side * (idle ? 2.6 : 3.5);
      if (this.state === 'lost') { lead = -25; lat = this.side * 6; }
      const tx = pp.x + gx * lead - gz * lat, tz = pp.z + gz * lead + gx * lat;
      const ex = tx - cp.x, ez = tz - cp.z, ed = Math.hypot(ex, ez);
      let amt = clamp((ed - 0.8) / 4, 0, 1);
      if (this.state === 'lost') amt *= 0.35;
      // keep pace: walk faster than the player only when well behind
      if (ed > 1e-3 && amt > 0) {
        const wx = ex / ed, wz = ez / ed;
        inp.mx = wx * amt; inp.my = -wz * amt;     // camYaw = 0 => forward is -z
      }
      // follow the player into the air: jump and fly while they do (and the scarf allows)
      if (player.flying && d < 35 && c.charge > 0.05) this.flyHold = 0.4;
      if (this.flyHold > 0) {
        this.flyHold -= dt;
        if (c.grounded) inp.jumpPressed = true;
        inp.jump = true;
      }
      // stuck against stone or a steep face: hop over it
      const moved = Math.hypot(cp.x - this.lastPos.x, cp.z - this.lastPos.z);
      if (amt > 0.6 && moved < 1.2 * dt) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8) { inp.jumpPressed = true; inp.jump = true; this.flyHold = 0.6; this.stuckT = 0; this.side = -this.side; }
      // fell hopelessly behind (player surfed or flew away): reappear just out of sight
      if (this.state === 'travel' && d > 75) this._catchUp(player, camera);
      if (this.state === 'travel' && prog > LOST_AT) { this.state = 'lost'; ev.push({ type: 'lost' }); }
      if (this.state === 'lost' && d > 38) { this.state = 'gone'; c.setVisible(false); return ev; }
    }
    this.lastPos.copy(cp);

    // ----- sharing warmth: close together, both scarves recharge
    if (d < 6 && this.state !== 'waiting') {
      if (player.charge < 1 && !player.frozen) { player.charge = Math.min(1, player.charge + 0.9 * dt); ev.push({ type: 'share' }); }
      c.charge = Math.min(1, c.charge + 0.9 * dt);
    }

    // look at the player when near
    c.lookTarget = d < 22 ? _look.set(pp.x, pp.y + 1.4, pp.z) : null;
    c.cold = player.cold;
    c.frozen = !!frozen;
    c.update(dt, inp, 0, time, env);
    return ev;
  }
}
