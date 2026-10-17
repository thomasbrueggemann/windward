import { terrainHeight } from './world/heightfield.js';

/**
 * Particles, camera nudges and one-shot sounds for the flight modes (glide, dive, swoop, soar, ribbon boost).
 * Kept out of main.js so the game loop only needs one call per traveler.
 */
export function flightFx(who, fx, audio, cam, dt, { listener = true } = {}) {
  const p = who.pos, v = who.vel, sp = fx.sparkles, dust = fx.dust;
  for (const e of who.events) {
    switch (e.type) {
      case 'flap': if (listener && audio.flap) audio.flap(e.soft); break;
      case 'swoop': {
        if (listener) { if (audio.swoop) audio.swoop(e.boost / 12); cam.shake = Math.max(cam.shake, 0.18); }
        // a ring of sand thrown up where the pull-out skims the ground
        const gy = terrainHeight(p.x, p.z);
        if (p.y - gy < 8) {
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
            dust.emit(p.x, gy + 0.2, p.z, Math.cos(a) * s + v.x * 0.3, 0.8 + Math.random() * 2, Math.sin(a) * s + v.z * 0.3, 1.6, 0.8, 1, 0.85, 0.65, 0.45, 2, -0.3, 1.6);
          }
        }
        break;
      }
      case 'ribbon': {
        if (listener && audio.ribbon) audio.ribbon();
        // a thread of light from the creature to the traveler
        for (let i = 0; i < 24; i++) {
          const t = Math.random();
          sp.emit(e.x + (p.x - e.x) * t, e.y + (p.y + 1 - e.y) * t, e.z + (p.z - e.z) * t, (Math.random() - .5) * .6, 0.4, (Math.random() - .5) * .6, 1.0, 0.14, 3, 2.4, 1.4, 1, 1.2, 0, -0.3);
        }
        break;
      }
      case 'liftoff': case 'soar':
        if (listener && e.type === 'liftoff' && audio.liftoff) audio.liftoff();
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          sp.emit(p.x + Math.cos(a) * 1.2, p.y + 0.4, p.z + Math.sin(a) * 1.2, -Math.sin(a) * 2, 2 + Math.random() * 2, Math.cos(a) * 2, 1.2, 0.12, 3, 2.3, 1.2, 0.9, 1, 0, -0.3);
        }
        break;
      default:
    }
  }
  // ribbon boost: a bright trail streaming from the scarf
  if (who.boostT > 0) {
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      const a = who.scarf.pts[1 + ((Math.random() * (who.scarf.n - 1)) | 0)];
      sp.emit(a.x, a.y, a.z, (Math.random() - .5) * .3, (Math.random() - .5) * .3, (Math.random() - .5) * .3, 0.9, 0.13 * who.boostT + 0.04, 3, 2.2, 1.1, 1, 2, 0, -0.5);
    }
  }
  // dive: wind streaks rushing past the traveler
  if (who.diveK > 0.3) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const n = Math.floor(dt * speed * 3 * who.diveK + Math.random());
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - .5) * 3, oy = (Math.random() - .2) * 2.5, oz = (Math.random() - .5) * 3;
      dust.emit(p.x + ox + v.x * 0.15, p.y + 1 + oy + v.y * 0.15, p.z + oz + v.z * 0.15, -v.x * 0.15, -v.y * 0.15, -v.z * 0.15, 0.35, 0.1, 1, 0.97, 0.9, 0.35, 0.5, 0, 3);
    }
  }
  // glide: a faint wake of sand-gold motes from the spread sleeves
  if ((who.glideK > 0.5 || who.soarK > 0.5) && Math.random() < dt * 14) {
    const sh = Math.sin(who.heading), ch = Math.cos(who.heading), side = Math.random() < 0.5 ? -1 : 1;
    const wx = p.x + ch * side * 0.7 - sh * 0.3, wz = p.z - sh * side * 0.7 - ch * 0.3;
    sp.emit(wx, p.y + 0.9, wz, -v.x * 0.1, -0.2, -v.z * 0.1, 1.2, 0.07, 2.6, 1.9, 1.0, 0.7, 0.8, 0, -0.2);
  }
}
