// Enterable buildings and the mini worlds inside them.
//
// Each door outside (doors.js) opens onto a pocket world built lazily on first entry in its own THREE.Scene. While
// the traveler is inside, main.js hands the whole frame to `Interiors.step()`: the render pass draws the room's
// scene, the room's floor replaces the terrain for everything that asks for the ground (setGroundOverride), the
// player and the companions who came along are carried into the room, and the room's own light, fog, grade and room
// tone are applied. Leaving fades out, carries everyone back and restores the world exactly as it was; nothing is
// saved while inside, so a saved journey always resumes outdoors.
import * as THREE from 'three';
import { setGroundOverride, terrainHeight, clamp, smooth } from '../world/heightfield.js';
import { placeDoors, doorFront, inDoorway, ROOM_KINDS, DOOR_LIGHT } from './doors.js';
import { flightFx } from '../flightfx.js';
import { clothUniforms } from '../world/cloth.js';
import { drawMural } from '../murals.js';
import { SandHall } from './sandhall.js';
import { Garden } from './garden.js';
import { Tower } from './tower.js';
import { StarDome } from './stardome.js';
import { Memory } from './memory.js';
import { Familiar } from './familiar.js';

const BUILD = { sandhall: SandHall, garden: Garden, tower: Tower, stardome: StarDome, memory: Memory };
const NO_INPUT = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false, dive: false, glide: false, glidePressed: false, lookX: 0, lookY: 0, anyKey: false };
const $ = (id) => document.getElementById(id);
const exp = (k, dt) => 1 - Math.exp(-k * dt);
const FADE_OUT = 0.85, FADE_IN = 1.1;

export class Interiors {
  /** Places the doors (call right after the ruins and before the terrain: the doors flatten their pads). */
  constructor(scene, ruins) {
    this.outScene = scene; this.ruins = ruins;
    this.doors = placeDoors(ruins);
    this.state = 'out';           // out | entering | inside | leaving
    this.fade = 0;
    this.door = null; this.room = null;
    this.followers = [];
    this.familiar = null;
    this.t = 0;
    this.vision = null;
    this.hintT = 0;
    this._cleanT = 0;
    this._fadeCol = new THREE.Color(1, 1, 1);
    this.envIn = { sunDir: new THREE.Vector3(0, 1, 0), pal: { snow: 0 }, updrafts: null, progress: 0 };
    this._clampCam = (pos) => { if (this.room) this.room.clampCam(pos); };
  }

  /** Wire up the game's systems (after they exist). */
  attach(o) {
    Object.assign(this, o);   // renderer, composer, camera, cam, player, group, fx, audio, grade, rays, bloom, showHint, game, env, flyers, query
    this.renderPass = this.composer.passes[0];
    const G = this.grade.uniforms;
    // the open world's post settings that are not re-applied every frame, restored exactly on the way out
    this._post = {
      contrast: G.uContrast.value, vignette: G.uVignette.value, vigColor: G.uVigColor.value.clone(), shadowTint: G.uShadowTint.value.clone(),
      highTint: G.uHighTint.value.clone(), grain: G.uGrain.value, fadeColor: G.uFadeColor.value.clone(),
      bloomRadius: this.bloom.radius, bloomThreshold: this.bloom.threshold, raysThreshold: this.rays.uniforms.uThreshold.value,
    };
    const q = this.query;
    this.auto = q && q.has('auto');
    this.autoRooms = q && q.has('rooms');
    this.forceRoom = q && q.get('room');
  }

  get inside() { return this.state === 'inside' || this.state === 'leaving'; }

  // =================================================================== outdoors
  /** Called every playing frame outdoors: door glow, entering, the cloth creature that follows you. */
  updateOutside(dt, time) {
    const P = this.player, game = this.game;
    if (this.forceRoom && game.state === 'playing') { const f = this.forceRoom; this.forceRoom = null; this.enter(/^\d+$/.test(f) ? +f : f, { instant: true }); }
    for (const d of this.doors) {
      const dist = Math.hypot(P.pos.x - d.x, P.pos.z - d.z);
      d.near += ((dist < 14 ? 1 : 0) - d.near) * exp(2, dt);
      const fx = d.fx, k = (d.done ? 0.55 : 1) * (0.85 + 0.15 * Math.sin(time * 1.3 + d.index)) * (1 + 0.35 * d.near);
      fx.fill.material.color.copy(d.light).multiplyScalar(1.5 * k);
      fx.spill.material.color.copy(d.light).multiplyScalar(0.5 * k);
      fx.halo.material.opacity = clamp(0.25 + 0.75 * smooth(500, 60, dist), 0, 1) * (d.done ? 0.5 : 0.9) * (0.9 + 0.1 * Math.sin(time * 1.3));
      // motes drifting out of the doorway
      if (dist < 40 && Math.random() < dt * 5) {
        const [x, z] = doorFront(d, -0.3), a = Math.random() - 0.5;
        const c = d.light;
        this.fx.sparkles.emit(x + a * d.dw, d.y + 0.4 + Math.random() * d.dh * 0.8, z, Math.sin(d.rot) * 0.5, 0.15, Math.cos(d.rot) * 0.5, 2.6, 0.08, c.r * 2.5, c.g * 2.5, c.b * 2.5, 0.8, 0.4, -0.05, -0.2);
      }
      if (dist < 26 && !d.visited && game.hints.controls) this.showHint('door', 'A doorway glows softly. <b>Step inside.</b>', 6000);
      // walking into the doorway
      if (d.cooldown) { if (dist > d.R + 4) d.cooldown = false; continue; }
      if (this.state === 'out' && game.state === 'playing' && !P.frozen && inDoorway(d, P.pos.x, P.pos.y, P.pos.z)) this._beginEnter(d);
    }
    if (this.state === 'entering') {
      this.fade = Math.min(1, this.fade + dt / FADE_OUT);
    } else if (this.state === 'out' && this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt / FADE_IN);
      if (this.fade <= 0) this.grade.uniforms.uFadeColor.value.copy(this._post.fadeColor);
    }
    if (this.familiar) this.familiar.update(dt, time, P, this.fx);
    // rooms left far behind are let go (they rebuild identically if ever entered again)
    if ((this._cleanT -= dt) <= 0) {
      this._cleanT = 2;
      for (const d of this.doors) if (d.room && d.room !== this.room && P.pos.z < d.z - 420) { d.room.dispose(); d.room = null; }
    }
  }

  /** Fade value for the grade pass (main.js maxes it with the storm's whiteout). */
  get fadeAmount() { return this.fade; }

  _beginEnter(d) {
    this.state = 'entering'; this.door = d;
    d.visited = true;
    this._fadeCol.copy(this._roomFadeColor(d));
    this.grade.uniforms.uFadeColor.value.copy(this._fadeCol);
    if (this.audio.awaken) this.audio.recharge();
  }

  _roomFadeColor(d) {
    const B = BUILD[d.kind];
    return (B && B.fadeColor) || d.light.clone().lerp(new THREE.Color(1, 1, 1), 0.5);
  }

  /**
   * Debug / tests: enter door `i` (index), or the door holding interior `kind`; a kind no door holds this world is
   * opened through a temporary doorway right where the traveler stands.
   */
  enter(which = 0, { instant = false } = {}) {
    if (this.inside) return false;
    let d = typeof which === 'number' ? this.doors[which] : this.doors.find((q) => q.kind === which);
    if (!d && typeof which === 'string' && BUILD[which]) {
      const P = this.player;
      d = this._tempDoor || (this._tempDoor = { index: 90, style: 'ruin', chapter: 'desert', dw: 1.1, dh: 3.6, R: 4, fx: null, done: false, light: DOOR_LIGHT.ruin.clone(), temp: true });
      if (d.kind !== which) { if (d.room) d.room.dispose(); d.room = null; d.done = false; d.kind = which; }
      d.x = P.pos.x; d.z = P.pos.z; d.y = P.pos.y; d.rot = P.heading + Math.PI; d.front = -2.5;
    }
    if (!d) return false;
    this._beginEnter(d);
    if (instant) this.fade = 1;
    return true;
  }

  // =================================================================== the frame while inside
  /** Runs the frame instead of main.js while the traveler is (or is about to be) inside. Returns true if it did. */
  step(dt, time, inp, doRender) {
    if (this.state === 'entering' && this.fade >= 1) this._swapIn();
    if (!this.inside) return false;
    this._frame(dt, time, inp);
    if (this.state === 'out') return true;      // just carried back out: the world resumes next frame
    if (doRender) this.composer.render();
    return true;
  }

  _swapIn() {
    const d = this.door, P = this.player, cam = this.cam;
    if (!d.room) {
      d.room = new BUILD[d.kind](d);
      try { this.renderer.compile(d.room.scene, this.camera); } catch (e) { /* compiled on first draw instead */ }
    }
    const room = this.room = d.room;
    this.saved = { colliders: P.colliders, shelters: P.shelters, camColliders: cam.colliders, baseDist: cam.baseDist, pitch: cam.pitch, x: P.pos.x, z: P.pos.z };
    // who comes along: travelers walking with you, close by
    this.followers = this.group.members.filter((c) => c.state === 'travel' && c.visible && c.dist < 45);
    setGroundOverride((x, z) => room.height(x, z, room.probeY));
    P.colliders = room.colliders; P.shelters = []; P.ledges = room.ledges; cam.colliders = room.colliders;
    P.push.set(0, 0, 0); P.cold = 0;
    room.probeY = 1.5;
    P.heading = room.spawn.heading;
    P.teleport(room.spawn.x, room.spawn.z);
    this._carry(room.scene);
    cam.snap(P); cam.pitch = room.camPitch; cam.baseDist = room.camDist; cam.lift = 0; cam.ready = false; cam.idle = 0;
    this.renderPass.scene = room.scene;
    this.followers.forEach((c, k) => {
      c._inT = 0.9 + k * 0.55;         // they step through the doorway after you, one by one
      c.p.setVisible(false); c.p.colliders = room.colliders; c.p.ledges = room.ledges; c.p.push.set(0, 0, 0);
      c.behindT = 0; c.curiousT = 0;
    });
    if (this.familiar) this.familiar.arrive(P);
    this.state = 'inside'; this.t = 0; this.fade = 1;
    room.onEnter(this._ctx());
    this._title(room.name);
  }

  _swapOut() {
    const d = this.door, room = this.room, P = this.player, cam = this.cam;
    room.onExit();
    setGroundOverride(null);
    this._carry(this.outScene);
    this.renderPass.scene = this.outScene;
    P.colliders = this.saved.colliders; P.shelters = this.saved.shelters; P.ledges = false; cam.colliders = this.saved.camColliders;
    cam.baseDist = this.saved.baseDist;
    // step back out into the world, facing away from the doorway
    let x, z, heading;
    if (d.temp) { x = this.saved.x; z = this.saved.z; heading = d.rot + Math.PI; }
    else { [x, z] = doorFront(d, 2.6); heading = d.rot; }
    P.heading = heading; P.teleport(x, z); P.vel.set(0, 0, 0);
    cam.snap(P); cam.pitch = 0.2; cam.ready = false; cam.lift = 0;
    // the travelers who came in come out with you, fanned out behind, and greet the open air
    const sh = Math.sin(heading), ch = Math.cos(heading);
    this.followers.forEach((c, k) => {
      const side = k % 2 ? -1 : 1, row = 1 + Math.floor(k / 2);
      c.p.colliders = this.ruins.colliders; c.p.ledges = false;
      c.p.heading = heading;
      c.p.teleport(x - sh * 1.4 * row + ch * side * 1.8, z - ch * 1.4 * row - sh * side * 1.8);
      c.p.setVisible(true); c.state = 'travel'; c._inT = 0; c.behindT = 0; c.sit = 0; c.applySit();
      c.hear(0.5 + k * 0.35, false, 0);
    });
    if (this.familiar) this.familiar.arrive(P);
    this._restorePost();
    if (!d.temp) d.cooldown = true;
    this.followers = [];
    this.state = 'out'; this.fade = 1; this.room = null;
    if (this.vision) this._endVision(true);
    this.grade.uniforms.uFadeColor.value.copy(this._fadeCol);
  }

  /** Move the traveler, the companions who came along, particles and light threads into `scene`. */
  _carry(scene) {
    const P = this.player, objs = [P.group, P.scarf.mesh, P.shadow, this.fx.sparkles.points, this.fx.dust.points, this.group.threads.mesh, ...this.group.glows];
    for (const c of this.followers) objs.push(c.p.group, c.p.scarf.mesh, c.p.shadow);
    if (this.familiar) objs.push(this.familiar.mesh);
    for (const o of objs) scene.add(o);
  }

  _restorePost() {
    const G = this.grade.uniforms, S = this._post;
    G.uContrast.value = S.contrast; G.uVignette.value = S.vignette; G.uVigColor.value.copy(S.vigColor);
    G.uShadowTint.value.copy(S.shadowTint); G.uHighTint.value.copy(S.highTint); G.uGrain.value = S.grain;
    this.bloom.radius = S.bloomRadius; this.bloom.threshold = S.bloomThreshold; this.rays.uniforms.uThreshold.value = S.raysThreshold;
  }

  _title(name) {
    const el = $('chapter');
    if (!el || !name) return;
    el.innerHTML = `<span>~</span>${name}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  _ctx() {
    const self = this;
    return this.__ctx || (this.__ctx = {
      get player() { return self.player; }, get followers() { return self.followers; }, get fx() { return self.fx; },
      get audio() { return self.audio; }, get camera() { return self.camera; }, get renderer() { return self.renderer; },
      get cam() { return self.cam; }, hint: (k, h, ms) => self.showHint(k, h, ms),
      reward: {
        glyph: (from) => self._rewardGlyph(from),
        charge: (from) => self._rewardCharge(from),
        vision: (idx, then) => self._startVision(idx, then),
        familiar: (from) => self._rewardFamiliar(from),
      },
    });
  }

  _frame(dt, time, inp) {
    const room = this.room, P = this.player, cam = this.cam, fx = this.fx;
    this.t += dt;
    if (this.state === 'inside') this.fade = Math.max(0, this.fade - dt / FADE_IN);
    else if (this.state === 'leaving') {
      this.fade = Math.min(1, this.fade + dt / FADE_OUT);
      if (this.fade >= 1) { this._swapOut(); return; }
    }
    // ----- input: a few steps in through the doorway, then the player's (or the autopilot's)
    let use = inp, look = inp;
    if (this.vision) { use = NO_INPUT; look = NO_INPUT; }
    else if (this.t < 0.8) { use = { ...NO_INPUT, my: 0.55 }; look = NO_INPUT; }
    else if (this.state === 'leaving') { use = { ...NO_INPUT, my: 0.4 }; look = NO_INPUT; }
    else if (this.auto) use = this._autoInside(inp, dt);
    // ----- camera and traveler, on the room's ground
    room.probeY = P.pos.y + 0.6;
    cam.update(dt, P, look, time, { dist: room.camDist, height: room.camHeight, noLift: true, clamp: this._clampCam });
    if (inp.zoom) cam.baseDist = clamp(cam.baseDist + inp.zoom * 0.6, 4, 11);
    P.cold = 0; P.push.set(0, 0, 0);
    P.lookTarget = room.lookTarget(P);
    room.probeY = P.pos.y + 0.6;
    P.update(dt, use, cam.yaw, time, this.envIn);
    room.clampBody(P);
    this._playerFx(dt);
    flightFx(P, fx, this.audio, cam, dt);
    this._followersStep(dt, time);
    if (this.familiar) this.familiar.update(dt, time, P, fx);
    // ----- the room itself (interactions, rewards)
    const ctx = this._ctx();
    room.update(dt, time, ctx);
    if (this.vision) this._visionStep(dt, inp);
    // ----- the way out
    if (this.state === 'inside' && this.t > 1.4 && !this.vision && room.inExit(P.pos)) this._beginLeave();
    // ----- light, sound, post
    this._applyPalette(time);
    this.group._visuals(dt, time, P, this.followers.filter((c) => c.visible));
    fx.sparkles.update(dt, this.camera, this.renderer);
    fx.dust.update(dt, this.camera, this.renderer);
    this.audio.update(dt, {
      progress: this.env.progress, snow: 0, speed: P.speed, surfing: P.surfing, flying: P.flying, singing: P.singing, sing: P.sing, guardian: 0,
      dive: P.diveK, glide: P.glideK, soar: P.soarK, airSpeed: Math.hypot(P.speed, P.vel.y), intensity: clamp(0.25 + 0.3 * Math.min(1, P.speed / 20) + (room.complete ? 0.2 : 0), 0, 1),
      mood: room.pal.mood, indoor: room.pal.indoor,
    });
  }

  _beginLeave() {
    this.state = 'leaving';
    this._fadeCol.copy(this.door.light).lerp(new THREE.Color(1, 1, 1), 0.55);
    if (this.audio.recharge) this.audio.recharge();
  }

  // ----------------------------------------------------------------- effects for the traveler indoors
  _playerFx(dt) {
    const P = this.player, A = this.audio, pal = this.room.pal, c = pal.sand, D = this.fx.dust;
    for (const e of P.events) {
      if (e.type === 'step' && !e.slide) {
        A.step();
        for (let i = 0; i < 2; i++) D.emit(e.x + (Math.random() - .5) * .2, terrainHeight(e.x, e.z) + 0.08, e.z + (Math.random() - .5) * .2, (Math.random() - .5) * .8, 0.4 + Math.random() * .5, (Math.random() - .5) * .8, 0.9, 0.3, c.r, c.g, c.b, 0.3, 2.5, -0.3, 1.2);
      } else if (e.type === 'jump') A.jump();
      else if (e.type === 'land') {
        A.land(e.impact);
        for (let i = 0; i < Math.min(18, 5 + e.impact); i++) { const a = Math.random() * 6.28, s = 1 + Math.random() * 3; D.emit(P.pos.x, P.pos.y + 0.1, P.pos.z, Math.cos(a) * s, 0.5 + Math.random(), Math.sin(a) * s, 1.2, 0.6, c.r, c.g, c.b, 0.45, 2.2, -0.4, 1.4); }
      }
    }
    if (P.surfing) for (let i = 0; i < Math.floor(P.speed * 0.3); i++) D.emit(P.pos.x + (Math.random() - .5) * .9, P.pos.y + 0.15, P.pos.z + (Math.random() - .5) * .9, -P.vel.x * 0.05 + (Math.random() - .5) * 1.5, 0.6 + Math.random(), -P.vel.z * 0.05 + (Math.random() - .5) * 1.5, 0.9, 0.45, c.r, c.g, c.b, 0.4, 2.4, -0.3, 1.6);
    if (P.flying && Math.random() < 0.7) { const a = P.scarf.pts[2 + ((Math.random() * (P.scarf.n - 2)) | 0)]; this.fx.sparkles.emit(a.x, a.y, a.z, (Math.random() - .5) * .4, 0.3, (Math.random() - .5) * .4, 0.8, 0.08, 3, 2.3, 1.2, 0.9, 1, 0, -0.3); }
    this._rings(P, dt);
    // a song: the room hears it (cloth blooms, stars answer); a long one released carries further
    if (P.singing) { this._singHold = (this._singHold || 0) + dt; this.room.onSong(P.pos, 4 + 4 * P.sing, false, this._ctx()); }
    else {
      if ((this._singHold || 0) > 0.9) this._shout(P.pos);
      this._singHold = 0;
    }
  }

  _rings(who, dt) {
    if (!who.singing || !who.group.visible) return;
    who._ringT = (who._ringT ?? 0) - dt;
    if (who._ringT > 0) return;
    who._ringT = 0.22;
    const p = who.pos, r = 3.2 + 3 * who.sing, S = this.fx.sparkles;
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; S.emit(p.x, p.y + 1.1, p.z, Math.cos(a) * r, 0.4, Math.sin(a) * r, 1.2, 0.12, 3, 2.4, 1.4, 0.9, 1.6, 0, -0.4); }
  }

  _shout(p) {
    this.audio.shout();
    const S = this.fx.sparkles;
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; S.emit(p.x, p.y + 1.0, p.z, Math.cos(a) * 11, 0.9, Math.sin(a) * 11, 1.5, 0.22, 3, 2.6, 1.6, 1, 1.1, 0, -0.3); }
    this.room.onSong(p, 16, true, this._ctx());
    this.cam.shake = Math.max(this.cam.shake, 0.2);
  }

  // ----------------------------------------------------------------- the companions who came along
  _followersStep(dt, time) {
    const P = this.player, room = this.room, list = this.followers;
    const ctx = { player: P, env: this.envIn, camera: this.camera, frozen: !!this.vision, time, snow: 0, blizzard: 0, curiousPoints: room.pois };
    const back = P.heading + Math.PI;
    let near = 0;
    list.forEach((c, k) => {
      if (c._inT > 0) {
        c._inT -= dt;
        if (c._inT > 0) return;
        c.p.heading = room.spawn.heading; room.probeY = 1.5;
        c.p.teleport(room.spawn.x, room.spawn.z); c.p.setVisible(true);
      }
      // a loose knot behind and beside the traveler
      const n = list.length, a = back + (n === 1 ? 0.7 * c.side : -0.9 + 1.8 * k / Math.max(1, n - 1));
      const d = 2.6 + 0.6 * (k % 2) + (P.speed > 3 ? 0.8 : 0);
      c.slot.set(P.pos.x + Math.sin(a) * d, 0, P.pos.z + Math.cos(a) * d);
      if (room.followerSlot) room.followerSlot(c, P, c.slot);
      const st = c.steer.set(0, 0, 0);
      for (const o of [P, ...list.map((q) => q.p)]) {
        if (o === c.p || !o.group.visible) continue;
        const ox = c.pos.x - o.pos.x, oz = c.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od < 2.2 && od > 1e-3) { const w = (2.2 - od) / 2.2 * (o === P ? 1.8 : 1.3); st.x += ox / od * w; st.z += oz / od * w; }
      }
      room.probeY = c.pos.y + 0.6;
      c.p.cold = 0;
      const evs = c.update(dt, ctx);
      room.clampBody(c.p);
      // whoever is far below (a tower climbed alone) waits at the foot, no wandering off into the walls
      if (c.state !== 'travel') c.state = 'travel';
      for (const e of evs) if (e.type === 'chirp') this._chirp(c, e);
      this._rings(c.p, dt);
      if (c.dist < 7) near++;
    });
    if (near && P.charge < 1) P.charge = Math.min(1, P.charge + (0.35 + 0.55 * near) * dt);
  }

  _chirp(c, e) {
    const v = new THREE.Vector3().copy(c.pos).project(this.camera);
    this.audio.chirp(clamp(v.x, -1, 1) * (v.z < 1 ? 1 : -1), e.dist, e.big);
    this.room.onSong(c.pos, e.big ? 12 : 5, e.big, this._ctx());
    if (e.dist < 14) {
      const P = this.player;
      P.charge = Math.min(1, P.charge + (e.big ? 0.8 : 0.35)); P.flash = Math.max(P.flash, 0.5);
      for (let i = 0; i < 14; i++) { const t = Math.random(); this.fx.sparkles.emit(c.pos.x + (P.pos.x - c.pos.x) * t, c.pos.y + 1.2 + Math.sin(t * Math.PI) * 1.5, c.pos.z + (P.pos.z - c.pos.z) * t, (Math.random() - .5) * .5, 0.6, (Math.random() - .5) * .5, 1.0, 0.13, 3, 2.4, 1.4, 1, 1.2, 0, -0.3); }
    }
  }

  // ----------------------------------------------------------------- rewards
  _stream(from, n = 40) {
    const P = this.player;
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this.fx.sparkles.emit(from.x + (P.pos.x - from.x) * t, from.y + (P.pos.y + 1.2 - from.y) * t + Math.sin(t * Math.PI) * 1.2, from.z + (P.pos.z - from.z) * t,
        (Math.random() - .5) * .6, 0.5, (Math.random() - .5) * .6, 1.4, 0.16, 3, 2.5, 1.5, 1, 1.0, 0, -0.3);
    }
  }
  _rewardGlyph(from) {
    const P = this.player;
    this._stream(from);
    P.addGlyph(); P.flash = 1;
    this.audio.glyph(P.glyphs);
    this.showHint('room-glyph-' + this.door.index, 'A new symbol has woven itself into your scarf.', 5000);
  }
  _rewardCharge(from) {
    const P = this.player;
    if (from) this._stream(from, 30);
    P.charge = 1; P.flash = 1;
    this.audio.awaken();
  }
  _rewardFamiliar(from) {
    if (!this.familiar) {
      this.familiar = new Familiar(this.room.scene, from);
      this.familiar.mesh.userData.familiar = true;
    }
    this.audio.chorus(2);
    this.showHint('familiar', 'A small cloth creature has chosen to travel with you. <b>Sing</b>, and it will fill your scarf.', 8000);
  }

  _startVision(idx, then) {
    this.vision = { t: 0, idx, then };
    $('vision').style.opacity = 1;
    this.audio.vision();
  }
  _visionStep(dt, inp) {
    const v = this.vision;
    v.t += dt;
    drawMural($('mural'), v.idx, clamp((v.t - 2.2) / 8, 0, 1));
    const any = inp.anyKey || (this.auto && v.t > 6);
    if (v.t > 13 || (v.t > 5 && any)) this._endVision(false);
  }
  _endVision(silent) {
    const v = this.vision; this.vision = null;
    $('vision').style.opacity = 0;
    if (!silent && v.then) v.then();
  }

  // ----------------------------------------------------------------- the room's light on everything carried inside
  _applyPalette() {
    const p = this.room.pal, room = this.room, P = this.player;
    this.envIn.sunDir.copy(p.sunDir); this.envIn.updrafts = room.updrafts; this.envIn.progress = this.env.progress;
    room.sun.color.copy(p.sunC); room.sun.intensity = p.sunI;
    room.hemi.color.copy(p.amb); room.hemi.groundColor.copy(p.grd);
    room.scene.fog.color.copy(p.fog); room.scene.fog.density = p.fogD;
    this.renderer.toneMappingExposure = p.exp;
    this.bloom.strength = p.bloom; this.bloom.radius = p.bloomRadius; this.bloom.threshold = p.bloomThreshold;
    const sc = [P.scarf.uniforms, ...this.followers.map((c) => c.p.scarf.uniforms)];
    for (const s of sc) {
      s.uSunDir.value.copy(p.sunDir); s.uSunColor.value.copy(p.sunC).multiplyScalar(p.sunI * 0.35);
      s.uAmb.value.copy(p.amb); s.uFog.value.copy(p.fog); s.uFogD.value = p.fogD;
    }
    const cu = clothUniforms;
    cu.uSunDir.value.copy(p.sunDir); cu.uSunColor.value.copy(p.sunC).multiplyScalar(p.sunI * 0.35);
    cu.uAmb.value.copy(p.amb); cu.uFog.value.copy(p.fog); cu.uFogD.value = p.fogD;
    // post: god rays toward the room's light, its own grade, and the fade
    const cam = this.camera, R = this.rays.uniforms, G = this.grade.uniforms;
    const fwd = this._fwd || (this._fwd = new THREE.Vector3()), ndc = this._ndc || (this._ndc = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const facing = fwd.dot(p.sunDir);
    ndc.copy(p.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
    R.uSun.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    R.uStrength.value = facing > 0 ? p.rays * smooth(0.05, 0.55, facing) * 0.4 : 0;
    R.uColor.value.copy(p.raysColor); R.uAspect.value = cam.aspect; R.uThreshold.value = p.raysThreshold;
    G.uTime.value = this.game.time; G.uSat.value = p.sat; G.uContrast.value = p.contrast; G.uVignette.value = p.vignette;
    G.uVigColor.value.copy(p.vigColor); G.uShadowTint.value.copy(p.shadowTint); G.uHighTint.value.copy(p.highTint); G.uGrain.value = p.grain;
    G.uFade.value = this.fade;
    G.uFadeColor.value.copy(this.state === 'leaving' ? this._fadeCol : this._roomFadeColor(this.door));
  }

  // ----------------------------------------------------------------- ?auto: explore the room, take its gift, walk out
  _autoInside(inp, dt) {
    const P = this.player, room = this.room, cam = this.cam;
    const out = { ...NO_INPUT };
    let goal = room.auto(P, this._ctx());
    if (!goal) {
      // head for the nearest way out
      let best = null, bd = 1e9;
      for (const e of room.exits) { const d = Math.hypot(e.x - P.pos.x, e.z - P.pos.z) + Math.abs((e.y0 ?? 0) - P.pos.y) * 2; if (d < bd) { bd = d; best = e; } }
      if (best) goal = { x: best.x, z: best.z + (best.hz < best.hx ? 0.3 : 0), dive: P.pos.y - (best.y0 ?? 0) > 8 };
      else return out;
    }
    const wx = goal.x - P.pos.x, wz = goal.z - P.pos.z, wl = Math.hypot(wx, wz) || 1;
    const amt = goal.stop ? 0 : clamp(wl / 1.5, goal.slow ? 0.25 : 0.4, 1);
    const yaw = cam.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    out.my = (wx * fx + wz * fz) / wl * amt; out.mx = (wx * rx + wz * rz) / wl * amt;
    if (wl > 1.5) { const want = Math.atan2(-wx, -wz); cam.yaw += Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw)) * exp(1.5, dt); }
    out.sing = !!goal.sing; out.glide = !!goal.glide; out.dive = !!goal.dive;
    out.jump = !!goal.jump; out.jumpPressed = !!goal.jump && P.grounded;
    // unstick
    const A = this._autoS || (this._autoS = { last: new THREE.Vector3(), stuck: 0, hop: 0 });
    const moved = Math.hypot(P.pos.x - A.last.x, P.pos.z - A.last.z); A.last.copy(P.pos);
    if (amt > 0.5 && moved < 0.8 * dt) A.stuck += dt; else A.stuck = Math.max(0, A.stuck - dt);
    if (A.stuck > 0.7) { A.stuck = 0; A.hop = 0.6; }
    if (A.hop > 0) { A.hop -= dt; out.jump = true; out.jumpPressed = P.grounded; }
    out.anyKey = !!this.vision && this.vision.t > 6;
    return out;
  }

  // ----------------------------------------------------------------- outdoors ?auto&rooms: detour into doors on the way
  /** A point for the outdoor autopilot to walk to (into an unvisited doorway nearby), or null. */
  autoTarget(pp) {
    if (!this.autoRooms || this.state !== 'out') return null;
    for (const d of this.doors) {
      if (d.visited || d.cooldown) continue;
      const dz = pp.z - d.z;
      if (dz > 70 || dz < -25) continue;
      const [fx, fz] = doorFront(d, 2.5), [ix, iz] = doorFront(d, -1.2);
      const atFront = Math.hypot(pp.x - fx, pp.z - fz) < 1.6 || this._autoDoor === d;
      if (atFront) this._autoDoor = d;
      return atFront ? { x: ix, z: iz } : { x: fx, z: fz };
    }
    this._autoDoor = null;
    return null;
  }

  // ----------------------------------------------------------------- save / resume (saves only ever happen outdoors)
  save() { return { done: this.doors.filter((d) => d.done).map((d) => d.index), familiar: !!this.familiar }; }
  restore(o) {
    if (!o || typeof o !== 'object') return;
    for (const i of o.done || []) { const d = this.doors[i]; if (d) { d.done = true; d.visited = true; } }
    if (o.familiar && !this.familiar) { this.familiar = new Familiar(this.outScene, this.player.pos.clone().add(new THREE.Vector3(0, 2.5, 0))); this.familiar.arrive(this.player); }
  }

  /** For tests / saves: where the traveler stands in the open world (the doorway while inside). */
  outsidePos() {
    if (!this.inside || !this.door) return this.player.pos;
    const [x, z] = this.door.temp ? [this.saved.x, this.saved.z] : doorFront(this.door, 2.6);
    return new THREE.Vector3(x, 0, z);
  }

  /** State for debugging. */
  info() {
    return {
      state: this.state, fade: +this.fade.toFixed(2), room: this.room && this.room.kind, followers: this.followers.map((c) => c.index),
      doors: this.doors.map((d) => ({ i: d.index, kind: d.kind, style: d.style, chapter: d.chapter, x: +d.x.toFixed(1), z: +d.z.toFixed(1), p: +d.p.toFixed(3), done: d.done, built: !!d.room })),
      familiar: !!this.familiar,
    };
  }
}

export { ROOM_KINDS };
