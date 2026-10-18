import * as THREE from 'three';
import { Player } from './player.js';
import { terrainHeight, clamp } from './world/heightfield.js';

const NO_INPUT = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false };
const exp = (k, dt) => 1 - Math.exp(-k * dt);
const _look = new THREE.Vector3(), _v = new THREE.Vector3();

/**
 * Another traveler. Driven by the same controller as the player (so it walks, surfs and flies the same way) and
 * steered by a small state machine; the Group (group.js) decides where in the formation it should be.
 *
 *   hidden  → not yet reached (no cost)
 *   waiting → sitting on a crest / beside a ruin, calling now and then; stands up and joins when you come close and sing
 *   travel  → walks with the group
 *   resting → left far behind for too long: sits down and waits to be fetched (approach and sing)
 *   missed  → you walked past without meeting it
 *   ending  → scripted by the Group during the finale
 *
 * personality: pace (m ahead/behind its slot), chatty 0..1 (how often it calls), wander 0..1 (how far it strays
 * from its slot), curiosity 0..1 (how readily it goes to look at glyphs and shrines).
 */
export class Companion {
  constructor(scene, colliders, shelters, { index = 0, scarfBase, glyphs = 4, personality = {} } = {}) {
    this.index = index;
    this.color = scarfBase.clone();
    this.p = new Player(scene, { scarfBase });
    this.p.colliders = colliders;
    this.p.shelters = shelters;
    for (let i = 0; i < glyphs; i++) this.p.addGlyph();
    // the neck wrap takes the scarf's tone
    this.p.body.traverse((o) => {
      if (o.isMesh && o.geometry.type === 'TorusGeometry') {
        o.material = o.material.clone();
        o.material.color.copy(scarfBase).multiplyScalar(1.3);
        o.material.emissive.copy(scarfBase).multiplyScalar(0.25);
      }
    });
    this.p.setVisible(false);
    this.pers = { pace: 0, chatty: 0.5, wander: 0.4, curiosity: 0.5, ...personality };
    this.state = 'hidden';
    this.spot = null;
    this.met = false;
    this.inp = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false, dive: false, glide: false, glidePressed: false };
    this.side = index % 2 ? -1 : 1;
    this.stuckT = 0; this.flyHold = 0; this.singHold = 0;
    this.replyT = -1; this.replyBig = false; this.replyDepth = 0;
    this.callT = 3 + Math.random() * 6;
    this.lastPlayerSing = false; this.playerSingT = 0;
    this.behindT = 0; this.lastCatchUp = -1e9;
    this.curiousT = 0; this.curiousCheck = 2 + Math.random() * 3; this.curious = new THREE.Vector3();
    this.sit = 0;                 // 0..1 sitting pose
    this.dist = 1e9;              // to the player (updated each tick)
    this.lodAcc = 0; this.lodN = 0;
    this.events = [];
    this.lastPos = new THREE.Vector3();
    this.slot = new THREE.Vector3();
    this.steer = new THREE.Vector3();   // separation + alignment from the group (xz)
    this.chorus = 0;              // 0..1 how much it is singing along right now (for the warmth visuals)
    // its own timing, so the group never moves as one: how late it reacts to the player, how loosely it holds its
    // place, how willing it is to take off, and a fixed offset from the even formation
    const rr = Math.random;
    this.react = 0.25 + rr() * 0.9;
    this.slotK = 0.6 + rr() * 1.2;
    this.flyChance = 0.5 + rr() * 0.45;
    this.angJ = (rr() - 0.5) * 0.45; this.leadJ = (rr() - 0.5) * 3; this.latJ = (rr() - 0.5) * 2.5;
    this.wf1 = 0.07 + rr() * 0.09; this.wf2 = 0.05 + rr() * 0.07; this.ph = rr() * 10;
    this.slotS = new THREE.Vector3(); this.slotInit = false;
    this.flyDelay = -1; this.pFlying = false; this.pGlideT = 0;
  }

  get pos() { return this.p.pos; }
  get visible() { return this.p.group.visible; }
  get travelling() { return this.state === 'travel'; }

  /** Puts the traveler at its waiting spot, sitting and looking back down the route. */
  appear(spot, faceX, faceZ) {
    this.spot = spot;
    this.p.heading = Math.atan2(faceX - spot.x, faceZ - spot.z);
    this.p.teleport(spot.x, spot.z);
    this.p.setVisible(true);
    this.state = 'waiting';
    this.sit = 1;
  }

  /** Joins the group directly next to the player (resuming a saved journey with this traveler). */
  appearBeside(player, k) {
    const a = player.heading + Math.PI * 0.75 * (k % 2 ? -1 : 1) + k * 0.2;
    this.p.heading = player.heading;
    this.p.teleport(player.pos.x + Math.sin(a) * (3 + k), player.pos.z + Math.cos(a) * (3 + k));
    this.p.setVisible(true);
    this.state = 'travel'; this.met = true; this.sit = 0;
  }

  hide(state) { this.state = state; this.p.setVisible(false); }

  /** Something it heard (the player's song, another traveler's chirp): answer after a short, human-feeling delay. */
  hear(delay, big, depth) {
    if (this.replyT >= 0 && !big) return;
    this.replyT = delay; this.replyBig = big; this.replyDepth = depth;
  }

  /** Reappears just out of view behind the player (used rarely: only when it fell hopelessly behind a fast flight). */
  catchUp(player, camera, time) {
    for (let k = 0; k < 10; k++) {
      const a = player.heading + Math.PI + (Math.random() - 0.5) * 2.2;
      const r = 24 + Math.random() * 10;
      const x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
      _v.set(x, terrainHeight(x, z) + 1, z).project(camera);
      if (Math.abs(_v.x) > 1.15 || _v.z > 1) { this.p.heading = player.heading; this.p.teleport(x, z); this.lastCatchUp = time; return true; }
    }
    return false;
  }

  /**
   * One AI + physics tick. ctx: { player, env, camera, frozen, time, snow, blizzard, curiousPoints, groupVel }
   * The Group has filled this.slot (where it wants to be) and this.steer (separation/alignment) beforehand.
   */
  update(dt, ctx) {
    const ev = this.events; ev.length = 0;
    const { player, env, frozen, time } = ctx;
    const c = this.p, cp = c.pos, pp = player.pos;
    const d = Math.hypot(pp.x - cp.x, pp.z - cp.z);
    this.dist = d;
    const inp = this.inp;
    inp.mx = inp.my = 0; inp.jumpPressed = false; inp.jump = false; inp.sing = false;
    const st = this.state;
    const sitting = st === 'waiting' || st === 'resting';
    inp.dive = false; inp.glidePressed = false;
    // mirror the player's flight: spread the robe while they glide or soar
    this.pGlideT = (player.mode === 'glide' || player.mode === 'soar') ? this.pGlideT + dt : 0;
    inp.glide = !c.grounded && (this.pGlideT > this.react || (c.charge < 0.05 && c.vel.y < 0));

    // ----- hearing the player sing
    const hearR = sitting ? 60 : 45;
    if (player.singing && !this.lastPlayerSing) { this.playerSingT = 0; if (d < hearR) this.hear(0.3 + this.index * 0.22 + Math.random() * 0.4, false, 0); }
    if (player.singing) this.playerSingT += dt;
    // a long held song is answered with a long call
    if (!player.singing && this.lastPlayerSing && this.playerSingT > 0.8 && d < hearR) this.hear(0.35 + this.index * 0.25 + Math.random() * 0.25, true, 0);
    this.lastPlayerSing = player.singing;
    if (this.replyT >= 0) {
      this.replyT -= dt;
      if (this.replyT < 0) {
        this.singHold = this.replyBig ? 1.2 : 0.45;
        ev.push({ type: 'chirp', who: this, big: this.replyBig, dist: d, depth: this.replyDepth });
        // being answered while you sing near it: it notices you
        if (sitting && d < 40 && this.replyDepth === 0) this._wake(ev);
      }
    }
    // it calls out now and then: chatty travelers more, and much more when waiting or left behind
    this.callT -= dt;
    if (this.callT <= 0) {
      const base = sitting ? 4 + 5 * (1 - this.pers.chatty) : 9 + 16 * (1 - this.pers.chatty);
      this.callT = base + Math.random() * base * 0.8;
      if (d < 110 && !frozen) { this.singHold = 0.45; ev.push({ type: 'chirp', who: this, big: false, dist: d, depth: 0 }); }
    }
    if (this.singHold > 0) { this.singHold -= dt; inp.sing = true; }
    this.chorus += ((this.singHold > 0 ? 1 : 0) - this.chorus) * exp(this.singHold > 0 ? 6 : 1.5, dt);

    // ----- states
    let amt = 0;
    if (sitting) {
      // sits until you come close; stands up as you approach
      const near = d < (st === 'waiting' ? 30 : 22);
      this.sit += ((near ? 0 : 1) - this.sit) * exp(near ? 2.5 : 0.8, dt);
      if (d < 9) this._wake(ev);
    } else if (st === 'travel') {
      this.sit += (0 - this.sit) * exp(3, dt);
      // ...curiosity: drift over to a glyph or shrine for a few seconds
      // its place in the formation is followed loosely and late, so turns ripple through the group
      const ss = this.slotS;
      if (!this.slotInit || ss.distanceToSquared(this.slot) > 400) { ss.copy(this.slot); this.slotInit = true; }
      ss.x += (this.slot.x - ss.x) * exp(this.slotK, dt); ss.z += (this.slot.z - ss.z) * exp(this.slotK, dt);
      let tx = ss.x, tz = ss.z;
      if (this.curiousT > 0) {
        this.curiousT -= dt;
        tx = this.curious.x; tz = this.curious.z;
        if (d > 24 || Math.hypot(tx - cp.x, tz - cp.z) < 1.6) this.curiousT = Math.min(this.curiousT, 0.8);
      } else if ((this.curiousCheck -= dt) <= 0) {
        this.curiousCheck = 3 + Math.random() * 4;
        if (Math.random() < this.pers.curiosity * 0.6 && ctx.snow < 0.5) {
          for (const q of ctx.curiousPoints) {
            const qd = Math.hypot(q.x - cp.x, q.z - cp.z);
            if (qd < 24 && qd > 3 && Math.hypot(q.x - pp.x, q.z - pp.z) < 28) {
              const a = Math.random() * Math.PI * 2;
              this.curious.set(q.x + Math.cos(a) * 1.8, q.y, q.z + Math.sin(a) * 1.8);
              this.curiousT = 3 + Math.random() * 3; this.curiousLook = q;
              break;
            }
          }
        }
      }
      const ex = tx - cp.x, ez = tz - cp.z, ed = Math.hypot(ex, ez);
      amt = clamp((ed - 0.6) / 3.5, 0, 1);
      let wx = ed > 1e-3 ? ex / ed * amt : 0, wz = ed > 1e-3 ? ez / ed * amt : 0;
      wx += this.steer.x; wz += this.steer.z;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      inp.mx = wx; inp.my = -wz;                 // camYaw = 0 => forward is -z
      amt = Math.min(1, wl);
      // follow the player into the air while they fly (and the scarf allows)
      // (not all at once: each decides for itself, a moment later, and some stay on the ground)
      if (player.flying && !this.pFlying) this.flyDelay = (d > 18 || Math.random() < this.flyChance) ? this.react + Math.random() * 0.5 : -1;
      this.pFlying = player.flying;
      if (this.flyDelay >= 0 && (this.flyDelay -= dt) < 0) this.flyHold = 0.5 + Math.random() * 0.6;
      if (player.flying && this.flyHold > 0 && d < 40 && c.charge > 0.05 && Math.random() > dt * 0.6) this.flyHold = Math.max(this.flyHold, 0.3);
      // fly to catch up when far behind and the scarf is full
      if (d > 30 && c.charge > 0.6 && c.grounded && Math.random() < dt * 0.5) this.flyHold = 0.9;
      if (this.flyHold > 0) {
        this.flyHold -= dt;
        if (c.grounded) inp.jumpPressed = true;
        inp.jump = true;
      }
      // stuck against stone or a steep face: hop over it
      const moved = Math.hypot(cp.x - this.lastPos.x, cp.z - this.lastPos.z);
      if (amt > 0.6 && moved < 1.2 * dt) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8) { inp.jumpPressed = true; inp.jump = true; this.flyHold = 0.6; this.stuckT = 0; this.side = -this.side; }
      // hurry when left behind (but in the storm the whole group trudges)
      c.speedMul = 1 + clamp((ed - 6) / 14, 0, 0.75) * (1 - 0.5 * ctx.blizzard);

      // ----- falling behind: a rare catch-up when the player flew/surfed far away; otherwise it sits down to wait
      const farR = ctx.blizzard > 0.5 ? 26 : 44;
      if (d > farR) this.behindT += dt; else this.behindT = Math.max(0, this.behindT - dt * 2);
      if (d > 85 && ctx.blizzard < 0.2 && time - this.lastCatchUp > 60 && (player.flying || player.surfing || player.speed > 9)) {
        if (this.catchUp(player, ctx.camera, time)) this.behindT = 0;
      }
      if (this.behindT > (ctx.blizzard > 0.5 ? 6 : 12)) {
        this.state = 'resting'; this.behindT = 0; this.callT = 2;
        ev.push({ type: 'left', who: this, storm: ctx.blizzard > 0.5 });
      }
    }
    this.lastPos.copy(cp);

    // look at the player when near, or at what it is curious about
    if (this.curiousT > 0 && this.curiousLook) c.lookTarget = _look.set(this.curiousLook.x, this.curiousLook.y, this.curiousLook.z);
    else c.lookTarget = d < 24 ? _look.set(pp.x, pp.y + 1.4, pp.z) : null;
    c.frozen = !!frozen;
    // a seated traveler turns to face whoever comes near
    if (sitting && d < 40) c.heading += Math.atan2(Math.sin(Math.atan2(pp.x - cp.x, pp.z - cp.z) - c.heading), Math.cos(Math.atan2(pp.x - cp.x, pp.z - cp.z) - c.heading)) * exp(1.5, dt);
    c.update(dt, frozen ? NO_INPUT : inp, 0, time, env);
    this.applySit();
    return ev;
  }

  _wake(ev) {
    if (this.state === 'waiting' || this.state === 'resting') {
      const first = !this.met;
      ev.push({ type: this.state === 'waiting' ? 'join' : 'rejoin', who: this, first });
      this.state = 'travel'; this.met = true; this.behindT = 0;
    }
  }

  /** Kneeling in the sand: lower the body over folded legs (applied after the controller has posed the rig). */
  applySit() {
    const s = this.sit, c = this.p;
    c.scarf.mesh.position.y = 0;
    if (s < 0.01) return;
    c.body.position.y -= 0.32 * s;
    c.body.rotation.x += 0.18 * s;
    const legs = s < 0.35;
    for (const leg of c.rig.legs) leg.thigh.visible = leg.shin.visible = leg.foot.visible = legs && c.collapse < 0.6;
    c.scarf.mesh.position.y = -0.3 * s;
  }

  /** Ending: settle a scripted pose (lying/kneeling in the snow) on the ground. */
  groundPose(dt, time, env, collapse, sing = false, t = 99) {
    const c = this.p;
    // each traveler sinks and rises at its own pace, a little after or before the player
    const c0 = this.colDelay * 0.2, c1 = Math.min(1, c0 + 0.25 + 0.35 / this.colK);
    const k = clamp((collapse - c0) / (c1 - c0), 0, 1);
    c.collapse = k * k * (3 - 2 * k);
    c.update(dt, sing ? { ...NO_INPUT, sing: true } : NO_INPUT, 0, time, env);
    c.pos.y = terrainHeight(c.pos.x, c.pos.z);
    c.group.position.y = c.pos.y;
    this.applySit();
  }
}

