import * as THREE from 'three';
import { rngFor, range } from './world/seed.js';
import { Companion } from './companion.js';
import { pathX, progressAt, zAtProgress, terrainHeight, trenchAmount, clamp, smooth } from './world/heightfield.js';
import { makeSoftDot } from './textures.js';

/**
 * The fellowship: up to four other travelers met along the way, each with its own scarf and temperament.
 * "Together we're stronger": travelers close to you refill your scarf faster (scales with how many), a song
 * answered by the group carries much further, huddling blunts the mountain wind and cold, and a song sung together
 * in the snow parts the blizzard for a while (the thaw). Light threads link travelers who walk close together.
 */

// scarf tone / length / temperament per traveler (one per chapter)
export const COMPANION_DEFS = [
  { scarf: [0.55, 0.085, 0.05], glyphs: 4, personality: { pace: 0.5, chatty: 0.6, wander: 0.4, curiosity: 0.5 } },
  { scarf: [0.50, 0.05, 0.13], glyphs: 7, personality: { pace: 2.0, chatty: 0.35, wander: 0.75, curiosity: 0.95 } },   // eager, roams ahead
  { scarf: [0.66, 0.24, 0.04], glyphs: 2, personality: { pace: -1.6, chatty: 0.95, wander: 0.3, curiosity: 0.3 } },    // short scarf, lags, sings a lot
  { scarf: [0.42, 0.11, 0.07], glyphs: 9, personality: { pace: 0.8, chatty: 0.2, wander: 0.15, curiosity: 0.6 } },     // long scarf, quiet and steady
];
const _ar = rngFor('companions');
const APPEAR_PROGRESS = [0.085, 0.345, 0.545, 0.795].map((p) => p + range(_ar, -0.012, 0.012));   // a little different every world

/**
 * Where the travelers wait to be met: a high, clear spot (a crest, or beside a ruin) near each chapter's progress.
 * Takes the world so a procedural world can supply its own spots instead (Group option `spots`).
 */
export function companionSpots(ruins, progress = APPEAR_PROGRESS) {
  const cols = ruins ? ruins.colliders : [];
  return progress.map((p) => {
    const z0 = zAtProgress(p);
    let best = -1e9, bx = pathX(z0), bz = z0;
    for (let dz = -18; dz <= 18; dz += 4) for (let dx = -28; dx <= 28; dx += 4) {
      const z = z0 + dz, x = pathX(z) + dx;
      let clear = true, nearRuin = 0;
      for (const c of cols) {
        const r = c.r ?? Math.max(c.hx, c.hz), d = Math.hypot(c.x - x, c.z - z);
        if (d < r + 1.6) { clear = false; break; }
        if (d < r + 9) nearRuin = 1;
      }
      if (!clear) continue;
      const trench = trenchAmount(x, z);
      const s = terrainHeight(x, z) - Math.abs(dx) * (0.08 + 0.3 * trench) + nearRuin * 3;
      if (s > best) { best = s; bx = x; bz = z; }
    }
    return { p, x: bx, z: bz };
  });
}

// ------------------------------------------------------------------ light threads between travelers walking close together
const SEG = 12, MAXP = 10;
const threadVert = /* glsl */`
attribute vec3 aTan; attribute float aSide, aU, aAlpha;
uniform float uWidth;
varying float vSide, vU, vA;
void main() {
  vec3 V = normalize(cameraPosition - position);
  vec3 o = normalize(cross(aTan, V) + 1e-5) * uWidth * aSide * (0.7 + aAlpha);
  vSide = aSide; vU = aU; vA = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position + o, 1.);
}`;
const threadFrag = /* glsl */`
uniform vec3 uColor; uniform float uTime;
varying float vSide, vU, vA;
void main() {
  float e = 1. - vSide * vSide; e *= e;
  float pulse = 0.55 + 0.45 * sin(vU * 19. - uTime * 4.5);
  gl_FragColor = vec4(uColor * (0.7 + 0.6 * pulse), e * vA);
}`;
class Threads {
  constructor(scene) {
    const nv = MAXP * (SEG + 1) * 2;
    this.pos = new Float32Array(nv * 3); this.tan = new Float32Array(nv * 3); this.alpha = new Float32Array(nv);
    const side = new Float32Array(nv), u = new Float32Array(nv), ind = [];
    for (let p = 0; p < MAXP; p++) for (let s = 0; s <= SEG; s++) {
      const i = (p * (SEG + 1) + s) * 2;
      side[i] = -1; side[i + 1] = 1; u[i] = u[i + 1] = s / SEG;
      if (s < SEG) ind.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTan', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setIndex(ind);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.uniforms = { uWidth: { value: 0.035 }, uColor: { value: new THREE.Color(1.6, 1.1, 0.55) }, uTime: { value: 0 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: threadVert, fragmentShader: threadFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.n = 0;
  }
  begin(time) { this.n = 0; this.uniforms.uTime.value = time; }
  add(a, b, strength, time, phase) {
    if (this.n >= MAXP || strength < 0.01) return;
    const P = this.pos, T = this.tan, A = this.alpha;
    const ax = a.x, ay = a.y + 1.12, az = a.z, bx = b.x, by = b.y + 1.12, bz = b.z;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const sag = 0.05 * len;
    let px = 0, py = 0, pz = 0;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, arc = Math.sin(Math.PI * t);
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = ay + (by - ay) * t + arc * (-sag + 0.18 * Math.sin(time * 1.7 + phase + t * 5));
      const i = (this.n * (SEG + 1) + s) * 2;
      for (const k of [i, i + 1]) { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; A[k] = strength * (0.25 + 0.75 * Math.sqrt(arc)); }
      if (s > 0) {
        const tx = x - px, ty = y - py, tz = z - pz;
        for (const k of [i, i + 1, i - 2, i - 1]) { T[k * 3] = tx; T[k * 3 + 1] = ty; T[k * 3 + 2] = tz; }
      }
      px = x; py = y; pz = z;
    }
    this.n++;
  }
  end() {
    this.geo.setDrawRange(0, this.n * SEG * 6);
    this.mesh.visible = this.n > 0;
    if (this.n) for (const k of ['position', 'aTan', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

const NO_INPUT = { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false };
const _v = new THREE.Vector3();
const exp = (k, dt) => 1 - Math.exp(-k * dt);

export class Group {
  /** opts: { ruins, props, spots: [{p, x, z}] | (ruins) => spots } */
  constructor(scene, { ruins, props, spots } = {}) {
    this.ruins = ruins; this.props = props;
    this.members = COMPANION_DEFS.map((d, i) => new Companion(scene, ruins.colliders, ruins.shelters, {
      index: i, scarfBase: new THREE.Color(...d.scarf), glyphs: d.glyphs, personality: d.personality,
    }));
    this.setSpots(spots ?? companionSpots);
    this.events = [];
    this.near = 0;            // companions within sharing distance of the player
    this.chorusN = 0;         // companions within earshot (they sing along)
    this.warmth = 0;          // smoothed 0..1, visuals
    this.thaw = 0; this.thawT = 0; this.thawCool = 0;
    this.blizzard = 0; this.snow = 0; this.huddle = 0;
    this.idleT = 0;
    this.groupVel = new THREE.Vector3();
    this.curiousPoints = []; this._curiousT = 0;
    this.threads = new Threads(scene);
    const dot = makeSoftDot();
    const glowMat = () => new THREE.SpriteMaterial({ map: dot, color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.glows = Array.from({ length: this.members.length + 1 }, () => { const s = new THREE.Sprite(glowMat()); s.visible = false; scene.add(s); return s; });
    this.thawGlow = new THREE.Sprite(glowMat()); this.thawGlow.material.color.set(0xffd8a0); this.thawGlow.visible = false; scene.add(this.thawGlow);
    this.ending = null;
    this._pairPhase = 0;
  }

  /** Waiting spots: an array, or a function of the world (so procedural worlds can feed them in later). */
  setSpots(spots) {
    const list = typeof spots === 'function' ? spots(this.ruins) : spots;
    this.members.forEach((c, i) => { c.spot = list[i] || null; });
  }

  get travellers() { return this.members.filter((c) => c.state === 'travel'); }
  /** Bodies that physics (wind) should act on. */
  bodies() { return this.members.filter((c) => c.visible).map((c) => c.p); }
  scarfUniforms() { return this.members.map((c) => c.p.scarf.uniforms); }
  metCount() { return this.members.filter((c) => c.met).length; }

  // ---------------------------------------------------------------- benefits (read by main.js)
  /** Cold felt by the player: huddling and the thaw blunt it. */
  coldMul() { return clamp(1 - 0.4 * clamp(this.near / 3, 0, 1) - 0.7 * this.thaw, 0.2, 1); }
  /** Wind push felt by `who` (the player or a companion's Player): fewer gusts reach a traveler in a huddle. */
  windMul(who) {
    let n = 0;
    const list = [this._player, ...this.members.map((c) => (c.state === 'travel' ? c.p : null))];
    for (const o of list) if (o && o !== who && o.group.visible && Math.hypot(o.pos.x - who.pos.x, o.pos.z - who.pos.z) < 5) n++;
    return (1 / (1 + 0.45 * n)) * (1 - this.thaw);
  }
  /** Radius a released song wakes cloth and glyph-banners within: every voice joining in carries it further. */
  songRadius(base) { return base * (1 + 0.4 * this.chorusN); }
  /** The player released a long song. Sung together in the snow, it parts the blizzard for a while. */
  onShout() {
    if (this.chorusN > 0 && this.snow > 0.3 && this.thawT <= 0 && this.thawCool <= 0) {
      // the voices need a while to gather again afterwards
      this.thawT = 5 + 2.5 * this.chorusN;
      this.thawCool = this.thawT + 20;
      this.events.push({ type: 'thaw', n: this.chorusN });
      for (const c of this.travellers) c.p.charge = 1;
      if (this._player) this._player.charge = 1;
    }
  }
  nearestVisible(p, range) {
    let best = null, bd = range;
    for (const c of this.members) {
      if (!c.visible) continue;
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, player, env, camera, frozen) {
    const ev = this.events; ev.length = 0;
    this._player = player;
    const pp = player.pos, prog = progressAt(pp.z);
    this.snow = smooth(0.76, 0.86, prog);
    this.blizzard = smooth(0.89, 0.93, prog);
    this.huddle = smooth(0.8, 0.9, prog);
    this.thawT = Math.max(0, this.thawT - dt); this.thawCool = Math.max(0, (this.thawCool || 0) - dt);
    this.thaw = smooth(0, 2.5, this.thawT);

    // ----- appear at their spots ahead; missed if walked past without meeting
    for (const c of this.members) {
      if (!c.spot) continue;
      const ahead = pp.z - c.spot.z;                         // > 0 while the spot is still ahead
      if (c.state === 'hidden' && !c.met && ahead < 170 && ahead > -30) c.appear(c.spot, pathX(c.spot.z + 30), c.spot.z + 30);
      else if (c.state === 'waiting' && ahead < -160) c.hide('missed');
    }
    // the points of interest curious travelers drift toward (refreshed now and then)
    if ((this._curiousT -= dt) <= 0) {
      this._curiousT = 1;
      const pts = this.curiousPoints; pts.length = 0;
      for (const g of this.props.glyphs) if (!g.taken && Math.abs(g.base.z - pp.z) < 60) pts.push({ x: g.base.x, y: g.base.y, z: g.base.z });
      for (const s of this.ruins.shrines) if (!s.seen && Math.abs(s.z - pp.z) < 60) pts.push({ x: s.x, y: s.y + 4, z: s.z });
    }

    const trav = this.travellers;
    const N = trav.length;
    // ----- formation: slots in an arc ahead of the player along the route
    const aheadZ = pp.z - 40;
    let gx = pathX(aheadZ) - pp.x, gz = aheadZ - pp.z;
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    const idle = player.speed < 0.6 && player.grounded;
    this.idleT = idle ? this.idleT + dt : 0;
    let narrow = trenchAmount(pp.x, pp.z) * 0.5, cn = 0;
    for (const c of this.ruins.colliders) if (Math.abs(c.z - pp.z) < 9 && Math.abs(c.x - pp.x) < 9) cn++;
    narrow = clamp(Math.max(narrow, (cn - 1) / 5), 0, 1);
    const hud = this.huddle;
    // group velocity, for alignment
    const gv = this.groupVel.set(player.vel.x, 0, player.vel.z);
    for (const c of trav) gv.x += c.p.vel.x, gv.z += c.p.vel.z;
    gv.multiplyScalar(1 / (N + 1));
    const gvl = Math.hypot(gv.x, gv.z);
    for (let k = 0; k < N; k++) {
      const c = trav[k], pr = c.pers;
      const wob = Math.sin(time * 0.11 + c.index * 2.1) * pr.wander, wob2 = Math.sin(time * 0.07 + c.index * 4.3);
      let lead = (idle ? (this.idleT > 2 ? 3.0 : 4.2) : 5.5 + Math.min(5, player.speed * 0.5)) + pr.pace * (idle ? 0.3 : 1) + wob * 3;
      const spread = 0.95 * (1 - 0.8 * narrow);
      let ang = N === 1 ? 0.5 * c.side : spread * (2 * k / (N - 1) - 1);
      lead += narrow * k * 2.6;                                  // narrow passages: fall into a file
      // the storm: a tight huddle around the player
      lead += (2.0 + 0.5 * (k % 2) - lead) * hud;
      ang += ((N === 1 ? 1.1 * c.side : 1.35 * (2 * k / Math.max(1, N - 1) - 1)) - ang) * hud;
      const lat = wob2 * pr.wander * 3 * (1 - hud) * (1 - narrow);
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const dx = gx * cs - gz * sn, dz = gx * sn + gz * cs;
      c.slot.set(pp.x + dx * lead - dz * lat, 0, pp.z + dz * lead + dx * lat);
      // separation (no overlaps) + a little alignment with the group's heading
      const st = c.steer.set(0, 0, 0);
      const sepR = 2.4 - 0.6 * hud;
      for (const o of [player, ...trav.map((t) => t.p)]) {
        if (o === c.p) continue;
        const ox = c.pos.x - o.pos.x, oz = c.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od < sepR && od > 1e-3) { const w = (sepR - od) / sepR * (o === player ? 1.8 : 1.3); st.x += ox / od * w; st.z += oz / od * w; }
      }
      if (gvl > 1) { st.x += gv.x / gvl * 0.2 * clamp(gvl / 5, 0, 1); st.z += gv.z / gvl * 0.2 * clamp(gvl / 5, 0, 1); }
    }

    // ----- update each traveler; far and off-screen ones tick at a lower rate
    const ctx = { player, env, camera, frozen, time, snow: this.snow, blizzard: this.blizzard, curiousPoints: this.curiousPoints };
    for (const c of this.members) {
      if (c.state === 'hidden' || c.state === 'missed' || c.state === 'ending') continue;
      const d = Math.hypot(pp.x - c.pos.x, pp.z - c.pos.z);
      const sitting = c.state !== 'travel';
      // a traveler resting far behind fades out of the simulation until you come back for it
      if (sitting && d > 230) { if (c.visible) c.p.setVisible(false); c.dist = d; continue; }
      if (!c.visible) c.p.setVisible(true);
      _v.set(c.pos.x, c.pos.y + 1, c.pos.z).project(camera);
      const inView = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
      const interval = sitting && d > 80 ? 4 : (d > 45 && !inView ? 2 : 1);
      c.lodAcc += dt;
      if (++c.lodN < interval) continue;
      const step = Math.min(c.lodAcc, 0.05);
      c.lodAcc = 0; c.lodN = 0;
      // cold: the player's cold, eased by the same huddle
      c.p.cold = player.cold;
      const cev = c.update(step, ctx);
      for (const e of cev) {
        ev.push(e);
        if (e.type === 'chirp') {
          // the others answer in a chain (each link less likely)
          if (e.depth < 2) for (const o of this.members) {
            if (o === c || !o.visible || o.state === 'hidden' || o.state === 'missed') continue;
            if (Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 45 && Math.random() < (e.depth === 0 ? 0.8 : 0.4)) o.hear(0.45 + Math.random() * 0.5 + o.index * 0.08, false, e.depth + 1);
          }
          c.pulse = 1;
        }
      }
    }

    // ----- together we're stronger: scarves refill faster with every traveler close by
    let near = 0, chorus = 0;
    for (const c of trav) {
      const d = c.dist;
      if (d < 7) near++;
      if (d < 32) chorus++;
      // each companion is refilled by everyone near it (the player included)
      let n = d < 7 ? 1 : 0;
      for (const o of trav) if (o !== c && Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 7) n++;
      if (n) c.p.charge = Math.min(1, c.p.charge + (0.35 + 0.55 * n) * dt);
    }
    this.near = near; this.chorusN = chorus;
    if (near > 0 && !player.frozen && player.charge < 1) {
      player.charge = Math.min(1, player.charge + (0.35 + 0.55 * near) * dt);
      ev.push({ type: 'share', n: near });
    }
    const wantWarm = Math.min(1, clamp(near / 3, 0, 1) * (0.5 + 0.5 * this.snow) + this.thaw * 0.5);
    this.warmth += (wantWarm - this.warmth) * exp(1.5, dt);
    this._visuals(dt, time, player, trav);
    return ev;
  }

  _visuals(dt, time, player, list) {
    const th = this.threads;
    th.begin(time);
    list = list.filter((c) => c.visible);
    const who = [player, ...list.map((c) => c.p)];
    const pulses = [player.sing, ...list.map((c) => { c.pulse = Math.max(0, (c.pulse || 0) - dt * 1.5); return Math.max(c.pulse, c.chorus); })];
    for (let i = 0; i < who.length; i++) for (let j = i + 1; j < who.length; j++) {
      const a = who[i].pos, b = who[j].pos;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 11) continue;
      const s = smooth(11, 4, d) * (0.25 + 0.35 * this.warmth + 0.45 * Math.max(pulses[i], pulses[j]) + 0.25 * this.thaw) * (1 - 0.35 * this.snow);
      th.add(a, b, Math.min(1.2, s), time, i * 1.7 + j * 2.9);
    }
    th.end();
    // warmth glow around each traveler of the huddle
    this.glows.forEach((g, i) => {
      const w = who[i] ? this.warmth : 0;
      g.visible = w > 0.02;
      if (!g.visible) return;
      const p = who[i].pos;
      g.position.set(p.x, p.y + 1.0, p.z);
      const s = 2.2 + 1.2 * w + 0.25 * Math.sin(time * 2 + i);
      g.scale.set(s, s, 1);
      g.material.opacity = 0.13 * w * (1 - 0.4 * this.snow);
    });
    const tg = this.thawGlow;
    tg.visible = this.thaw > 0.01;
    if (tg.visible) {
      tg.position.set(player.pos.x, player.pos.y + 3, player.pos.z);
      const s = 18 + 30 * this.thaw;
      tg.scale.set(s, s, 1); tg.material.opacity = 0.1 * this.thaw;
    }
  }

  // ---------------------------------------------------------------- the ending
  /** At the summit: travelers with you lie down in the snow beside you; those you lost come back through the storm. */
  startEnding(player, camYaw) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const met = this.members.filter((c) => c.met);
    this.ending = { huddled: 0, rejoined: 0, flying: false };
    met.forEach((c, k) => {
      const a = met.length === 1 ? 0.9 : -1.5 + 3 * k / (met.length - 1);
      const cs = Math.cos(a), sn = Math.sin(a);
      const dx = fx * cs - fz * sn, dz = fx * sn + fz * cs;
      c.endSpot = new THREE.Vector3(player.pos.x + dx * 2.0, 0, player.pos.z + dz * 2.0);
      c.endMode = c.state === 'travel' && c.dist < 45 ? 'huddle' : 'rejoin';
      c.p.heading = Math.atan2(player.pos.x - c.endSpot.x, player.pos.z - c.endSpot.z);
      if (c.endMode === 'huddle') { c.p.teleport(c.endSpot.x, c.endSpot.z); c.p.setVisible(true); this.ending.huddled++; }
      else {
        // out of the snow, from down the slope
        const r = 13;
        c.p.teleport(c.endSpot.x + dx * 2 - fx * r + (k - 1) * 4, c.endSpot.z + dz * 2 - fz * r);
        c.p.setVisible(false); this.ending.rejoined++;
      }
      c.sit = 0; c.state = 'ending'; c.p.frozen = false; c.p.cold = 1;
    });
    for (const c of this.members) if (!c.met && c.state !== 'hidden') c.hide('missed');
  }

  /** t: seconds into the ending; collapse: the player's collapse 0..1. Called after the player is updated. */
  updateEnding(dt, time, t, player, env, collapse) {
    const E = this.ending; if (!E) return;
    const list = this.members.filter((c) => c.state === 'ending');
    // the threads between them brighten as they are revived together
    this.warmth += (smooth(9, 14, t) - this.warmth) * exp(1.5, dt);
    this._visuals(dt, time, player, list);
    if (t < 18) {
      for (const c of list) {
        const cp = c.p;
        if (c.endMode === 'huddle') {
          c.sit = 0;
          c.groundPose(dt, time, env, collapse, t > 11.5 && t < 16);
        } else {
          if (t < 6.5) continue;
          if (!cp.group.visible) cp.setVisible(true);
          // walks in through the snow, then kneels beside you and sings along
          const ex = c.endSpot.x - cp.pos.x, ez = c.endSpot.z - cp.pos.z, ed = Math.hypot(ex, ez);
          const amt = clamp((ed - 0.4) / 2, 0, 1);
          const arrived = ed < 0.9;
          c.sit += ((arrived ? 0.8 : 0) - c.sit) * exp(2, dt);
          cp.collapse = 0; cp.speedMul = 1.7;
          cp.lookTarget = _v.set(player.pos.x, player.pos.y + 0.6, player.pos.z);
          cp.update(dt, arrived ? { ...NO_INPUT, sing: t > 11.5 && t < 16 } : { mx: ex / (ed || 1) * amt, my: -ez / (ed || 1) * amt, jump: false, jumpPressed: false, sing: false }, 0, time, env);
          c.applySit();
        }
      }
      return;
    }
    // ----- the flight: everyone rises with you toward the light, in a loose skein behind and beside you
    if (!E.flying) {
      E.flying = true;
      list.forEach((c, k) => {
        const side = k % 2 ? -1 : 1, row = Math.floor(k / 2);
        c.flyOff = new THREE.Vector3(side * (2.4 + 1.8 * row), 0.4 * row + side * 0.4, -1.0 - 1.8 * row);
        c.sit = 0; c.applySit();
        c.p.setVisible(true); c.p.collapse = 0; c.p.scripted = true; c.p.grounded = false; c.p.charge = 1;
      });
    }
    const sh = Math.sin(player.heading), ch = Math.cos(player.heading);
    list.forEach((c, k) => {
      const cp = c.p, o = c.flyOff;
      const wob = Math.sin(time * 0.9 + k * 1.9);
      const tx = player.pos.x + ch * o.x + sh * o.z + wob * 0.6;
      const ty = player.pos.y + o.y + Math.sin(time * 1.3 + k) * 0.5;
      const tz = player.pos.z - sh * o.x + ch * o.z;
      const prevX = cp.pos.x, prevY = cp.pos.y, prevZ = cp.pos.z;
      // carried along with the player, easing into its place in the skein
      const kk = exp(1.6, dt);
      cp.pos.x += player.vel.x * dt; cp.pos.y += player.vel.y * dt; cp.pos.z += player.vel.z * dt;
      cp.pos.x += (tx - cp.pos.x) * kk; cp.pos.y += (ty - cp.pos.y) * kk; cp.pos.z += (tz - cp.pos.z) * kk;
      cp.pos.y = Math.max(cp.pos.y, terrainHeight(cp.pos.x, cp.pos.z) + 1);
      const id = 1 / Math.max(dt, 1e-3);
      cp.vel.set((cp.pos.x - prevX) * id, (cp.pos.y - prevY) * id, (cp.pos.z - prevZ) * id);
      cp.speed = Math.min(24, Math.hypot(cp.vel.x, cp.vel.z) + 6);
      cp.heading = player.heading;
      cp.flying = true; cp.grounded = false; cp.charge = 1;
      cp.update(dt, NO_INPUT, 0, time, env);
    });
  }

  endSummary() { return this.ending ? { huddled: this.ending.huddled, rejoined: this.ending.rejoined } : { huddled: 0, rejoined: 0 }; }
  /** Members taking part in the finale (for sparkles etc). */
  endingMembers() { return this.members.filter((c) => c.state === 'ending' && c.visible); }

  // ---------------------------------------------------------------- save / resume
  save() { return this.members.map((c) => (c.met ? 1 : 0)); }
  /** Resuming at z: travelers met earlier (whose spot lies behind) walk with you again from the start. */
  restore(saved, player) {
    if (!Array.isArray(saved)) return;
    let k = 0;
    this.members.forEach((c, i) => {
      if (saved[i] && c.spot && c.spot.z > player.pos.z - 10) c.appearBeside(player, k++);
    });
  }
}
