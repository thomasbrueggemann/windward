// Enterable buildings along the route: one per chapter (desert ruin, temple of the sunken city, cave mouth in the
// depths, stone hut on the ascent), placed with the layout helpers so they never block the path, each opening onto a
// seeded "mini world" (see rooms in this folder).
import * as THREE from 'three';
import { rngFor, range, sign, shuffle } from '../world/seed.js';
import { PLAN, CORRIDOR, addSite, occupy, isFree, onPath } from '../world/layout.js';
import { terrainHeight, addPlaza, pathX, progressAt } from '../world/heightfield.js';
import { defaultUpdraftPositions } from '../world/updrafts.js';
import { radialTex, doorLightTex } from './common.js';

export const ROOM_KINDS = ['sandhall', 'garden', 'tower', 'stardome', 'memory'];
// which mini worlds each chapter's building may open onto
const AFFINITY = {
  desert: ['sandhall', 'memory', 'stardome'],
  city: ['sandhall', 'memory', 'tower'],
  depths: ['garden', 'stardome', 'memory'],
  ascent: ['tower', 'stardome', 'garden'],
};
const SPAN = { desert: [0.11, 0.26], city: [0.355, 0.495], depths: [0.565, 0.70], ascent: [0.80, 0.905] };
const SIDE = { desert: [13, 34], city: [17, 46], depths: [9, 22], ascent: [10, 26] };
const STYLE = { desert: 'ruin', city: 'temple', depths: 'cave', ascent: 'hut' };
// body half-sizes, doorway half-width/height and recess depth per style
const DIMS = {
  ruin: { hw: 3.4, hd: 3.0, H: 6.4, dw: 1.1, dh: 3.7, rd: 1.8 },
  temple: { hw: 5.4, hd: 4.4, H: 7.6, dw: 1.25, dh: 4.6, rd: 2.0 },
  cave: { hw: 4.6, hd: 4.0, H: 5.6, dw: 1.25, dh: 3.6, rd: 2.0 },
  hut: { hw: 1.7, hd: 1.3, H: 3.4, dw: 1.05, dh: 2.9, rd: 1.9, cyl: 3.3 },
};
// the light each doorway spills (and the colour the screen fades through)
export const DOOR_LIGHT = {
  ruin: new THREE.Color(1.0, 0.82, 0.55), temple: new THREE.Color(1.0, 0.72, 0.42),
  cave: new THREE.Color(0.3, 0.62, 0.75), hut: new THREE.Color(0.95, 0.93, 1.0),
};

/** Pick a distinct interior for each chapter's building, honouring the chapter's affinities. */
function assignKinds(r) {
  const out = {}, used = new Set();
  for (const ch of shuffle(r, Object.keys(AFFINITY))) {
    const opts = shuffle(r, AFFINITY[ch]).filter((k) => !used.has(k));
    const k = opts[0] ?? shuffle(r, ROOM_KINDS).find((q) => !used.has(q));
    out[ch] = k; used.add(k);
  }
  return out;
}

function findSpot(r, ch, R, avoid, roomy = true) {
  const [p0, p1] = SPAN[ch], [s0, s1] = SIDE[ch];
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 90; i++) {
    const p = range(r, p0, p1), side = sign(r) * range(r, Math.max(s0, R + CORRIDOR + 2.5), s1);
    const [x, z] = onPath(p, side);
    if (!isFree(x, z, R + 1.2)) continue;
    if (roomy && !isFree(x, z, R + 6, { corridor: false, pad: 0 })) continue;   // the flattened pad must not tilt older ruins
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + R + 3)) continue;
    // a calm patch of ground: small spread of heights around the footprint
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, h = terrainHeight(x + Math.cos(a) * (R + 2), z + Math.sin(a) * (R + 2));
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    // a clear approach from the path to the door
    const tz = z + 12, tx = pathX(tz), dx = tx - x, dz = tz - z, dl = Math.hypot(dx, dz);
    let clear = true;
    for (let t = R + 1; t < dl - 2; t += 2) {
      const qx = x + dx / dl * t, qz = z + dz / dl * t;
      if (!isFree(qx, qz, 0.9, { corridor: false, pad: 0.3 })) { clear = false; break; }
    }
    if (!clear) continue;
    const score = -(hi - lo) - Math.abs(side) * 0.05 + r() * 0.5;
    if (score > bestScore) { bestScore = score; best = { x, z, p, side }; }
  }
  return best;
}

/** Place the doors and build their exteriors (call right after Ruins, before the terrain is built: pads flatten it). */
export function placeDoors(ruins) {
  const r = rngFor('interiors');
  const kinds = assignKinds(r);
  // keep clear of the wind columns and banner posts that are placed later from the plan
  const avoid = [];
  try { for (const u of defaultUpdraftPositions()) avoid.push({ x: u.x, z: u.z, r: (u.r ?? 5) * 1.4 }); } catch (e) { /* no columns */ }
  for (const b of PLAN.banners) { const [x, z] = onPath(b.p); avoid.push({ x, z, r: b.span / 2 + 6 }); }
  const doors = [];
  for (const ch of ['desert', 'city', 'depths', 'ascent']) {
    const style = STYLE[ch], D = DIMS[style];
    const oz = D.cyl ? D.cyl + D.hd - 0.2 : 0, front = oz + D.hd;
    const R = (D.cyl ? D.cyl + D.hd : Math.hypot(D.hw, D.hd)) + 0.6;
    const spot = findSpot(r, ch, R, avoid) || findSpot(r, ch, R, avoid, false);
    if (!spot) continue;
    const { x, z } = spot;
    // face the oncoming traveler: the path a little behind (toward the start)
    const tz = z + 12, rot = Math.atan2(pathX(tz) - x, tz - z);
    const pad = addPlaza(x, z, R + 1.5, R + 9);
    const door = {
      index: doors.length, kind: kinds[ch], style, chapter: ch, x, z, y: pad.h, rot, ...D, R, oz, front,
      p: progressAt(z), done: false, room: null, near: 0, glowK: 0, visited: false,
      light: DOOR_LIGHT[style].clone(),
    };
    buildExterior(ruins, door, rngFor('door' + door.index));
    occupy(x, z, R);
    addSite('door', x, z, { y: pad.h, r: R, rot, kind: door.kind, style, index: door.index });
    avoid.push({ x, z, r: R + 4 });
    doors.push(door);
  }
  return doors;
}

// ------------------------------------------------------------------ geometry helpers in door space
function frame(door) {
  const cs = Math.cos(door.rot), sn = Math.sin(door.rot);
  const W = (lx, lz) => [door.x + lx * cs + lz * sn, door.z - lx * sn + lz * cs];
  return { cs, sn, W };
}

/** Door-local coordinates of a world point. */
export function toLocal(door, x, z) {
  const dx = x - door.x, dz = z - door.z, cs = Math.cos(door.rot), sn = Math.sin(door.rot);
  return [dx * cs - dz * sn, dx * sn + dz * cs];
}

/** World position `out` in front of the door (dist metres out from the threshold). */
export function doorFront(door, dist) {
  return frame(door).W(0, door.front + dist);
}

/** Is a body at (x, y, z) inside the doorway's threshold? */
export function inDoorway(door, x, y, z) {
  const [lx, lz] = toLocal(door, x, z);
  return Math.abs(lx) < door.dw - 0.15 && lz < door.front - 0.5 && lz > door.front - door.rd - 0.6 && y < door.y + door.dh;
}

function buildExterior(ruins, door, rr) {
  const { W } = frame(door);
  const y0 = door.y, rot = door.rot;
  const mat = door.style === 'cave' ? ruins.rock : ruins.stone;
  const dark = door.style === 'cave' ? ruins.rock : ruins.stoneDark;
  const place = (geo, m, lx, ly, lz, ry = 0, shadow = true) => {
    const [x, z] = W(lx, lz);
    const mesh = new THREE.Mesh(geo, m);
    return ruins._place(mesh, x, y0 + ly, z, rot + ry, shadow ? y0 : null);
  };
  const solidBox = (lx, lz, hx, hz, top) => { const [x, z] = W(lx, lz); ruins.colliders.push({ kind: 'box', x, z, hx, hz, rot: -rot, top: y0 + top }); };
  const boxGeo = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; };

  // ----- the body: two side blocks and a back block leave a recess for the doorway
  const { hw, hd, H, dw, dh, rd } = door;
  const oz = door.oz;                                         // the hut's doorway sits in a porch in front of it
  const sw = hw - dw;
  for (const s of [-1, 1]) {
    place(boxGeo(sw, H, hd * 2), mat, s * (dw + sw / 2), -0.4, oz);
    solidBox(s * (dw + sw / 2), oz, sw / 2, hd, H);
  }
  const bd = hd * 2 - rd;
  place(boxGeo(dw * 2, H, bd), dark, 0, -0.4, oz - hd + bd / 2);
  solidBox(0, oz - hd + bd / 2, dw, bd / 2, H);
  place(boxGeo(dw * 2 + 0.2, H - dh - 0.4, rd), mat, 0, dh, oz + hd - rd / 2);                 // lintel over the opening
  const trim = place(boxGeo(dw * 2 + 0.9, 0.35, 0.5), door.style === 'cave' ? ruins.rock : ruins.gold, 0, dh - 0.05, oz + hd + 0.05, 0, false);
  trim.castShadow = false;

  // ----- per style dressing
  if (door.style === 'ruin') {
    // ragged crown, a leaning slab and a drift of fallen blocks
    for (let i = 0; i < 4; i++) {
      const w = range(rr, 1.2, 2.6), h = range(rr, 0.5, 1.8);
      place(boxGeo(w, h, range(rr, 1.5, hd * 2)), i % 2 ? dark : mat, range(rr, -hw + w / 2, hw - w / 2), H - 0.4, range(rr, -hd * 0.5, hd * 0.5), range(rr, -0.15, 0.15));
    }
    for (let i = 0; i < 3; i++) {
      const s = range(rr, 0.7, 1.5), lx = sign(rr) * range(rr, hw + 1, hw + 4), lz = range(rr, -hd, hd + 3);
      const m = place(boxGeo(s * 1.6, s, s * 1.2), dark, lx, -0.3, lz, range(rr, 0, 3));
      m.rotation.z = range(rr, -0.3, 0.3); m.updateMatrixWorld(true);
      solidBox(lx, lz, s * 0.7, s * 0.7, s * 0.8);
    }
  } else if (door.style === 'temple') {
    // stepped roof, flanking columns, a gold finial and shallow steps up to the threshold
    let y = H - 0.4;
    for (const [w, d, h] of [[hw * 2 + 0.6, hd * 2 + 0.6, 0.8], [hw * 1.5, hd * 1.5, 1.2], [hw * 0.9, hd * 0.9, 1.4]]) { place(boxGeo(w, h, d), mat, 0, y, 0); y += h; }
    const fin = new THREE.ConeGeometry(0.9, 2.4, 4); fin.translate(0, 1.2, 0);
    place(fin, ruins.gold, 0, y, 0, Math.PI / 4);
    for (const s of [-1, 1]) {
      const cg = new THREE.CylinderGeometry(0.55, 0.65, dh + 1.6, 12); cg.translate(0, (dh + 1.6) / 2, 0);
      place(cg, mat, s * (dw + 1.0), -0.2, hd + 1.2);
      const cap = boxGeo(1.6, 0.5, 1.6); place(cap, mat, s * (dw + 1.0), dh + 1.4, hd + 1.2);
      const [cx, cz] = W(s * (dw + 1.0), hd + 1.2);
      ruins.colliders.push({ kind: 'circle', x: cx, z: cz, r: 0.75, top: y0 + dh + 2 });
    }
    const beam = boxGeo(dw * 2 + 3.2, 0.6, 1.2); place(beam, mat, 0, dh + 1.9, hd + 1.2);
    for (let i = 0; i < 3; i++) place(boxGeo(dw * 2 + 2.4 - i * 0.6, 0.2, 0.7), dark, 0, -0.16 + i * 0.09, hd + 3.0 - i * 0.7, 0, false);
  } else if (door.style === 'cave') {
    // a heap of canyon boulders swallowing the block, a ring of crystals glowing at the mouth
    const rockGeo = (s) => {
      const g = new THREE.IcosahedronGeometry(s, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3) * Math.cos(p.getZ(i) * 2.7); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
      g.computeVertexNormals(); return g;
    };
    for (let i = 0; i < 9; i++) {
      const s = range(rr, 1.8, 3.4), a = range(rr, -2.6, 2.6);
      const lx = Math.sin(a) * range(rr, 1.5, hw), lz = -Math.abs(Math.cos(a)) * range(rr, 0.5, hd) + 0.4;
      place(rockGeo(s), ruins.rock, lx, range(rr, H * 0.45, H * 0.95), lz, range(rr, 0, 6));
    }
    for (const s of [-1, 1]) {
      place(rockGeo(2.0), ruins.rock, s * (hw - 0.6), 1.2, hd - 0.6, range(rr, 0, 6));
    }
    const crystal = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.7, 2.2), fog: true });
    for (let i = 0; i < 7; i++) {
      const s = range(rr, 0.25, 0.6), g = new THREE.OctahedronGeometry(s, 0); g.scale(0.6, 2.2, 0.6);
      const t = (i / 6) * Math.PI;
      const m = place(g, crystal, Math.cos(t) * (dw + 0.5), Math.sin(t) * (dh * 0.7) + 0.3, hd + 0.35, 0, false);
      m.rotation.z = (Math.PI / 2 - t) * 0.6; m.updateMatrixWorld(true);
    }
  } else if (door.style === 'hut') {
    // round stone hut under a snow-capped cone; prayer flags strung from its peak
    const R = door.cyl;
    const cyl = new THREE.CylinderGeometry(R * 0.96, R, H, 18); cyl.translate(0, H / 2, 0);
    place(cyl, mat, 0, -0.4, 0);
    const [cx, cz] = W(0, 0);
    ruins.colliders.push({ kind: 'circle', x: cx, z: cz, r: R, top: y0 + H + 3 });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.9, emissive: 0x30384a, emissiveIntensity: 0.6 });
    const cone = new THREE.ConeGeometry(R + 0.8, 3.6, 18); cone.translate(0, 1.8, 0);
    place(cone, snow, 0, H - 0.4, 0);
    const rim = new THREE.TorusGeometry(R + 0.2, 0.22, 6, 24); rim.rotateX(Math.PI / 2);
    place(rim, ruins.gold, 0, H - 0.3, 0, 0, false);
    const pr = new THREE.ConeGeometry(dw + 0.9, 1.4, 4); pr.translate(0, 0.7, 0);
    place(pr, snow, 0, H - 0.4, oz, Math.PI / 4);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xb8341a, emissive: 0x5a1004, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 0.9 });
    for (let i = 0; i < 2; i++) {
      const a = (i ? 1 : -1) * 0.9 + Math.PI;
      for (let k = 1; k <= 5; k++) {
        const t = k / 6, fl = new THREE.PlaneGeometry(0.5, 0.7);
        const lx = Math.sin(a) * (R + 3) * t, lz = Math.cos(a) * (R + 3) * t;
        const m = place(fl, flagMat, lx, H + 3.0 - 3.6 * t - Math.sin(t * Math.PI) * 0.5, lz, a + Math.PI / 2, false);
        m.rotation.z = 0.1 * k; m.updateMatrixWorld(true);
      }
    }
  }

  // ----- the glow: light filling the recess, spilling onto the ground, and a halo seen from afar
  const col = door.light;
  const back = oz + hd - rd;
  const fill = place(new THREE.PlaneGeometry(dw * 2, dh), new THREE.MeshBasicMaterial({ map: doorLightTex(), color: col.clone().multiplyScalar(2), transparent: true, depthWrite: false, fog: false }), 0, dh / 2 - 0.35, back + 0.03, 0, false);
  const sg = new THREE.PlaneGeometry(dw * 3.2, 4.5); sg.rotateX(-Math.PI / 2);
  const spill = place(sg, new THREE.MeshBasicMaterial({ map: doorLightTex(), color: col.clone().multiplyScalar(0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 0, 0.12, oz + hd + 2.0, 0, false);
  spill.renderOrder = 2;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: col.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const [hx, hz] = W(0, oz + hd + 0.4);
  halo.position.set(hx, y0 + dh * 0.55, hz); halo.scale.set(dw * 6, dh * 2.2, 1);
  ruins.group.add(halo);
  door.fx = { fill, spill, halo, base: col.clone() };
}
