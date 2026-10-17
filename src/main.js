import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeSandUniforms, makeSandMaterial, Terrain, buildFarTerrain } from './world/terrain.js';
import { makeSky, makeSummitLight } from './world/sky.js';
import { samplePalette } from './world/palette.js';
import { terrainHeight, terrainGradient, progressAt, zAtProgress, pathX, summitPoint, WIND, clamp, smooth } from './world/heightfield.js';
import { Ruins } from './world/ruins.js';
import { Props } from './world/props.js';
import { clothUniforms } from './world/cloth.js';
import { Flyers, Guardian } from './world/creatures.js';
import { Player, buildTraveler } from './player.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { ParticlePool, AmbientDust } from './particles.js';
import { AudioEngine } from './audio.js';
import { drawMural } from './murals.js';
import { makeSoftDot } from './textures.js';

window.addEventListener('error', (e) => { $('err').textContent += (e.message || e) + '\n'; });
function $(id) { return document.getElementById(id); }
const q = new URLSearchParams(location.search);

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xf6c99b, 0.0005);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.4, 9000);

// lights for the standard-material objects (traveler, ruins, guardians)
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
const hemi = new THREE.HemisphereLight(0x9fb8e0, 0xc08850, 1.3);
scene.add(sunLight, sunLight.target, hemi);

// ------------------------------------------------------------------ world (ruins first: they flatten plazas the terrain must know about)
const ruins = new Ruins(scene);
const sandU = makeSandUniforms();
const nearMat = makeSandMaterial(sandU);
const farMat = makeSandMaterial(sandU, 0.4);
const terrain = new Terrain(scene, nearMat);
const far = buildFarTerrain(farMat);
scene.add(far);
const sky = makeSky();
scene.add(sky.mesh);
const summit = makeSummitLight();
scene.add(summit);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.7, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const sparkles = new ParticlePool(scene, 1400, true);
const dustPool = new ParticlePool(scene, 800, false);
const ambient = new AmbientDust(scene);
const fx = { sparkles, dust: dustPool };

const input = new Input(canvas);
const player = new Player(scene);
player.colliders = ruins.colliders;
player.shelters = ruins.shelters;
const cam = new ChaseCamera(camera);
const audio = new AudioEngine();

const env = { sunDir: new THREE.Vector3(), pal: null, progress: 0 };

const props = new Props(scene, ruins, fx);
const flyers = new Flyers(scene);
for (const [z, n] of [[-210, 3], [-330, 2], [-480, 3], [-620, 2], [-780, 2], [-900, 2], [-1130, 3], [-1260, 4], [-1400, 3], [-1650, 2], [-1850, 2]]) flyers.spawn(pathX(z), z, n);
const introBanner = props.banners.find((b) => Math.abs(b.center.z + 140) < 40);
const guardians = [0.402, 0.60, 0.675].map((p) => { const z = zAtProgress(p); return new Guardian(scene, pathX(z), z, 48); });

// ------------------------------------------------------------------ palette
function applyPalette(p) {
  const pal = samplePalette(p);
  env.pal = pal; env.sunDir.copy(pal.sun); env.progress = p;
  const u = sandU;
  u.uSunDir.value.copy(pal.sun);
  u.uSunColor.value.copy(pal.sunC).multiplyScalar(pal.sunI * 0.4);
  u.uLit.value.copy(pal.lit); u.uHi.value.copy(pal.hi); u.uShade.value.copy(pal.shade);
  u.uRim.value.copy(pal.rim); u.uGlit.value.copy(pal.glit); u.uFog.value.copy(pal.fog); u.uAmb.value.copy(pal.amb);
  u.uSnow.value = pal.snow; u.uCave.value = pal.cave; u.uGlitterGain.value = 1 - 0.7 * pal.cave;
  nearMat.uniforms.uFogD.value = pal.fogD;
  farMat.uniforms.uFogD.value = pal.fogD * farMat.userData.fogScale;
  const su = sky.uniforms;
  su.uTop.value.copy(pal.top); su.uHor.value.copy(pal.hor); su.uGround.value.copy(pal.fog);
  su.uSunDir.value.copy(pal.sun); su.uSunColor.value.copy(pal.sunC); su.uSunI.value = pal.sunI;
  renderer.toneMappingExposure = pal.exp;
  bloom.strength = pal.bloom;
  scene.fog.color.copy(pal.fog); scene.fog.density = pal.fogD;
  sunLight.color.copy(pal.sunC); sunLight.intensity = pal.sunI;
  sunLight.position.copy(pal.sun).multiplyScalar(100).add(player.pos);
  sunLight.target.position.copy(player.pos);
  hemi.color.copy(pal.amb); hemi.groundColor.copy(pal.grd);
  const s = player.scarf.uniforms;
  s.uSunDir.value.copy(pal.sun); s.uSunColor.value.copy(pal.sunC).multiplyScalar(pal.sunI * 0.35);
  s.uAmb.value.copy(pal.amb); s.uFog.value.copy(pal.fog); s.uFogD.value = pal.fogD;
  clothUniforms.uSunDir.value.copy(pal.sun); clothUniforms.uSunColor.value.copy(pal.sunC).multiplyScalar(pal.sunI * 0.35);
  clothUniforms.uAmb.value.copy(pal.amb); clothUniforms.uFog.value.copy(pal.fog); clothUniforms.uFogD.value = pal.fogD;
}

// ------------------------------------------------------------------ game state
const startProgress = parseFloat(q.get('p') ?? '0');
// begin on a gentle, sunlit slope looking toward the mountain
function findStart() {
  const L = samplePalette(0).sun.clone();
  let best = [0, 12], bestScore = -9;
  for (let z = 0; z <= 70; z += 5) for (let x = -70; x <= 70; x += 5) {
    const g = terrainGradient(x, z, 1.0);
    const n = new THREE.Vector3(-g.x, 1, -g.z).normalize();
    const score = n.dot(L) * 1.6 - Math.hypot(g.x, g.z) * 1.2 - Math.abs(x) * 0.002;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  return best;
}
const [fsx, fsz] = startProgress > 0 ? [0, 0] : findStart();
const sz = startProgress > 0 ? zAtProgress(startProgress) : fsz;
const sx = startProgress > 0 ? pathX(sz) : fsx;
player.teleport(sx, sz);
player.heading = Math.PI;
cam.yaw = 0;
terrain.prime(sx, sz, 3);
for (let i = 0; i < +(q.get('glyphs') ?? 0); i++) player.addGlyph();

const game = { state: 'title', time: 0, visionT: 0, visionIdx: 0, hints: {} };
window.__game = { player, cam, env, scene, camera, game, terrain, renderer, input, props, guardians, flyers, audio, ruins, summitPoint };

const SAND = new THREE.Color();
const tmp = new THREE.Vector3();
const flashEl = $('fade');

function showHint(key, html, ms = 7000) {
  if (game.hints[key]) return;
  game.hints[key] = true;
  const h = $('hint'); h.innerHTML = html; h.style.opacity = 1;
  clearTimeout(showHint.t); showHint.t = setTimeout(() => { h.style.opacity = 0; }, ms);
}

function processEvents(evs) {
  for (const e of evs) {
    switch (e.type) {
      case 'glyph': audio.glyph(e.n); break;
      case 'awaken': audio.awaken(); break;
      case 'recharge': audio.recharge(); break;
      case 'guardian-alert': audio.guardianAlert(); break;
      case 'guardian-hit':
        audio.guardianHit(); cam.shake = 1; game.hitFlash = 1;
        showHint('hit', 'Hide beneath stone. The guardians cannot see you there.', 6000);
        break;
      default:
    }
  }
}

function playerFx(dt, time) {
  const p = player.pos;
  for (const e of player.events) {
    const type = typeof e === 'string' ? e : e.type;
    if (type === 'step') {
      audio.step();
      for (let i = 0; i < 3; i++) dustPool.emit(p.x + (Math.random() - .5) * .3, p.y + 0.1, p.z + (Math.random() - .5) * .3,
        (Math.random() - .5) * .8, 0.4 + Math.random() * .6, (Math.random() - .5) * .8, 0.9, 0.35, SAND.r, SAND.g, SAND.b, 0.35, 2.5, -0.3, 1.2);
    } else if (type === 'jump') audio.jump();
    else if (type === 'land') {
      audio.land(e.impact);
      const n = Math.min(24, 6 + Math.floor(e.impact));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * Math.min(5, e.impact * 0.4);
        dustPool.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s, 1.4, 0.7, SAND.r, SAND.g, SAND.b, 0.5, 2.2, -0.4, 1.4);
      }
    }
  }
  // sand spray while surfing
  if (player.surfing) {
    const n = Math.floor(player.speed * 0.45);
    for (let i = 0; i < n; i++) {
      dustPool.emit(p.x + (Math.random() - .5) * .9, p.y + 0.15, p.z + (Math.random() - .5) * .9,
        -player.vel.x * 0.05 + (Math.random() - .5) * 1.5, 0.6 + Math.random() * 1.2, -player.vel.z * 0.05 + (Math.random() - .5) * 1.5,
        0.9 + Math.random() * 0.6, 0.45, SAND.r, SAND.g, SAND.b, 0.4, 2.4, -0.3, 1.6);
    }
  }
  // sparkles trailing from the glowing scarf
  if (player.flying && Math.random() < 0.7) {
    const a = player.scarf.pts[2 + ((Math.random() * (player.scarf.n - 2)) | 0)];
    sparkles.emit(a.x, a.y, a.z, (Math.random() - .5) * .4, 0.2 + Math.random() * 0.4, (Math.random() - .5) * .4, 0.8, 0.08, 3, 2.3, 1.2, 0.9, 1, 0, -0.3);
  }
  // singing: rings of light spill outward
  if (player.singing) {
    playerFx.ringT = (playerFx.ringT ?? 0) - dt;
    if (playerFx.ringT <= 0) {
      playerFx.ringT = 0.22;
      const r = 3.2 + 3 * player.sing;
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        sparkles.emit(p.x, p.y + 1.1, p.z, Math.cos(a) * r, 0.4, Math.sin(a) * r, 1.2, 0.12, 3, 2.4, 1.4, 0.9, 1.6, 0, -0.4);
      }
      sparkles.emit(p.x, p.y + 2.1, p.z, 0, 1.4, 0, 1.8, 0.5, 2.4, 1.8, 0.9, 0.55, 1.2, 0, 0.8);
    }
  }
}

// ------------------------------------------------------------------ visions at shrines
function startVision(i) {
  game.state = 'vision'; game.visionT = 0; game.visionIdx = i;
  player.frozen = true;
  $('vision').style.opacity = 1;
  audio.vision();
}
function updateVision(dt, anyKey) {
  game.visionT += dt;
  drawMural($('mural'), game.visionIdx, clamp((game.visionT - 2.2) / 8, 0, 1));
  if (game.visionT > 13 || (game.visionT > 5 && anyKey)) {
    $('vision').style.opacity = 0;
    game.state = 'playing'; player.frozen = false;
    player.addGlyph(); player.flash = 1; audio.glyph(player.glyphs);
    showHint('vision' + game.visionIdx, 'A new symbol has woven itself into your scarf.', 5000);
  }
}

// ------------------------------------------------------------------ the ending
const ending = { t: 0, figures: [], from: new THREE.Vector3(), phase: 0, collapse: 0 };
function startEnding() {
  game.state = 'ending'; ending.t = 0; ending.phase = 0;
  player.frozen = true; $('hint').style.opacity = 0;
  flashEl.style.transition = 'none'; flashEl.style.background = '#fff'; flashEl.style.opacity = 0;
  const white = buildTraveler({ white: true });
  for (let i = 0; i < 6; i++) {
    const m = white.clone(true);
    const a = (i / 6) * Math.PI * 2 + 0.4, R = 5.6;
    const x = player.pos.x + Math.cos(a) * R, z = player.pos.z + Math.sin(a) * R;
    m.position.set(x, terrainHeight(x, z), z);
    m.rotation.y = Math.atan2(player.pos.x - x, player.pos.z - z);
    m.scale.setScalar(0.001);
    scene.add(m);
    ending.figures.push(m);
  }
}
function updateEnding(dt, time) {
  ending.t += dt;
  const t = ending.t;
  player.cold = 1;
  const fig = ending.figures;
  if (t < 7) {
    // collapse into the snow
    ending.collapse = smooth(0.5, 5.5, t);
    player.charge = Math.max(0, player.charge - dt * 0.4);
    flashEl.style.opacity = 0.35 * smooth(0, 7, t);
    cam.pitch = 0.3; cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 8, height: 0.9, follow: 2 });
  } else if (t < 18) {
    // six white figures gather and revive the traveler
    const k = smooth(7, 11, t);
    fig.forEach((m, i) => { m.scale.setScalar(Math.max(0.001, k * 1.4 * (1 + 0.03 * Math.sin(time * 2 + i)))); m.position.y = terrainHeight(m.position.x, m.position.z) + k * 0.2 + Math.sin(time * 1.3 + i) * 0.05; });
    if (t > 11 && !ending.sang) { ending.sang = true; audio.ending(); }
    if (t > 12) { ending.collapse = 1 - smooth(12, 16, t); player.charge = Math.min(1, player.charge + dt * 0.4); }
    if (Math.random() < 0.5) {
      const m = fig[(Math.random() * 6) | 0];
      sparkles.emit(m.position.x, m.position.y + 1.4, m.position.z, (Math.random() - .5), 0.8, (Math.random() - .5), 1.4, 0.14, 3, 2.6, 1.8, 1, 1, 0, -0.3);
    }
    flashEl.style.opacity = 0.35 * (1 - smooth(10, 16, t));
    if (t > 15.5) player.flash = Math.max(player.flash, 0.6);
    cam.pitch = 0.28; cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 8, height: 1.2, follow: 2 });
  } else {
    // the traveler flies on, alone, toward the light at the summit
    if (!ending.flying) {
      ending.flying = true; ending.from.copy(player.pos); player.scripted = true; player.flying = true;
      fig.forEach((m) => { m.visible = false; });
      player.charge = 1;
    }
    const target = summitPoint();
    const u = clamp((t - 18) / 44, 0, 1);
    const e = u * u * (3 - 2 * u);
    const prev = tmp.copy(player.pos);
    player.pos.set(
      ending.from.x + (target.x - ending.from.x) * e + Math.sin(u * 9) * 6 * (1 - u),
      ending.from.y + (target.y - ending.from.y) * Math.pow(e, 0.8) + 4,
      ending.from.z + (target.z - ending.from.z) * e);
    const vx = (player.pos.x - prev.x) / dt, vy = (player.pos.y - prev.y) / dt, vz = (player.pos.z - prev.z) / dt;
    player.vel.set(vx, vy, vz); player.speed = Math.min(24, Math.hypot(vx, vz) + 6);
    player.heading = Math.atan2(vx, vz);
    ending.collapse = 0;
    cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 13, height: 1.8, follow: 3, fov: 60 });
    const w = smooth(0.45, 0.97, u);
    flashEl.style.opacity = w;
    audio.fadeOut(10);
    if (u >= 1 && game.state === 'ending') {
      game.state = 'end';
      const end = $('end'); end.style.opacity = 1; end.style.pointerEvents = 'auto';
    }
  }
  player.collapse = ending.collapse;
  player.update(dt, { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false }, cam.yaw, time, env);
  if (!player.scripted) player.pos.y = terrainHeight(player.pos.x, player.pos.z);
}

// ------------------------------------------------------------------ main loop
function frame(nowMs, doRender = true) {
  let dt = (nowMs - (frame.last ?? nowMs)) / 1000;
  if (!(dt > 0)) dt = 0.016;               // first frame / non-monotonic clocks
  dt = Math.min(dt, 0.05);
  frame.last = nowMs;
  game.time += dt;
  const time = game.time;
  const inp = input.poll();

  const prog = progressAt(player.pos.z);
  applyPalette(prog);
  SAND.copy(env.pal.lit).lerp(env.pal.hi, 0.4);
  clothUniforms.uTime.value = time;
  const evs = [];

  if (game.state === 'playing' || game.state === 'vision') {
    const frozen = game.state === 'vision';
    cam.update(dt, player, frozen ? { lookX: 0, lookY: 0 } : inp, time, {});
    player.cold = smooth(0.74, 0.95, prog);
    if (!frozen) cam.shake = Math.max(cam.shake, 0.25 * player.cold);
    player.update(dt, frozen ? { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false } : inp, cam.yaw, time, env);
    playerFx(dt, time);
    evs.push(...props.update(dt, time, player, env, fx));
    flyers.update(dt, time, player, fx, evs);
    let nearestG = 999;
    for (const g of guardians) { g.update(dt, time, player, fx, evs); nearestG = Math.min(nearestG, g.dist); }
    processEvents(evs);

    // shrines
    ruins.shrines.forEach((s, i) => {
      if (!s.seen && game.state === 'playing' && Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 5.5 && player.grounded) { s.seen = true; startVision(i); }
      s.glyph.rotation.y = Math.sin(time * 0.3) * 0.3;
      s.glyph.lookAt(camera.position.x, s.glyph.position.y, camera.position.z);
    });
    if (game.state === 'vision') updateVision(dt, inp.anyKey);

    // contextual hints
    const b0 = introBanner;
    if (b0 && !b0.awakened && Math.hypot(b0.center.x - player.pos.x, b0.center.z - player.pos.z) < 55) showHint('sing', 'Hold <b>E</b> or <b>right-click</b> to sing — the grey cloth will answer.', 9000);
    if (player.pos.z < -2035 && game.state === 'playing') startEnding();

    const speedN = clamp(player.speed / 20, 0, 1);
    audio.update(dt, {
      progress: prog, snow: env.pal.snow, speed: player.speed, surfing: player.surfing, flying: player.flying,
      singing: player.singing, sing: player.sing, guardian: clamp(1 - nearestG / 70, 0, 1),
      intensity: clamp(0.2 + 0.45 * speedN + (player.flying ? 0.2 : 0) + prog * 0.35, 0, 1),
    });
    // red flash when a guardian strikes
    if (game.hitFlash > 0 && game.state !== 'ending') {
      game.hitFlash = Math.max(0, game.hitFlash - dt * 1.8);
      flashEl.style.transition = 'none'; flashEl.style.background = '#c03010'; flashEl.style.opacity = 0.45 * game.hitFlash;
    }
  } else if (game.state === 'ending' || game.state === 'end') {
    if (game.state === 'ending') updateEnding(dt, time);
    else { cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 13, follow: 3 }); player.update(dt, { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false }, cam.yaw, time, env); if (inp.anyKey && time - game.endAt > 3) location.reload(); }
    flyers.update(dt, time, player, fx, evs);
    for (const g of guardians) g.update(dt, time, player, fx, evs);
    audio.update(dt, { progress: 1, snow: 1, speed: 0, surfing: false, flying: false, singing: false, sing: 0, guardian: 0, intensity: 1 });
    if (game.state === 'end' && !game.endAt) game.endAt = time;
  } else {
    // title screen: the traveler stands on the dune, camera slowly orbits
    cam.yaw = Math.sin(time * 0.1) * 0.35;
    cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 9 });
    player.update(dt, { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false }, cam.yaw, time, env);
    props.update(dt, time, player, env, fx);
    flyers.update(dt, time, player, fx, evs);
  }

  terrain.update(player.pos.x, player.pos.z, 4);
  ruins.update(env.sunDir, smooth(0.30, 0.42, prog) * (1 - smooth(0.52, 0.60, prog)) + smooth(0.99, 1.0, prog) * 0);

  sandU.uTime.value = time; sky.uniforms.uTime.value = time;
  sky.mesh.position.copy(camera.position);
  summit.userData.update(camera, 1);

  const pal = env.pal, snow = pal.snow;
  const wind = 4 + snow * 12;
  ambient.update(dt, time, camera, renderer, player.pos.y, { x: WIND.x * wind, z: WIND.z * wind }, snow * 2.5, clamp(pal.dust * 0.5, 0, 1) * (1 - 0.6 * pal.cave),
    snow > 0.5 ? new THREE.Color(1, 1, 1) : SAND, snow > 0.5 ? 0.12 : 0.07, 0.55);
  sparkles.update(dt, camera, renderer);
  dustPool.update(dt, camera, renderer);

  if (doRender) composer.render();
}
function loop(t) { frame(t); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// deterministic stepping (used for automated checks when the page is not being animated by the browser)
window.__advance = (sec, step = 1 / 30) => {
  const n = Math.max(1, Math.round(sec / step));
  let t = frame.last ?? performance.now();
  for (let i = 0; i < n; i++) { t += step * 1000; frame(t, i === n - 1); }
  frame.last = undefined;
};

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ title screen
const startBtn = $('start');
startBtn.disabled = false; startBtn.textContent = 'Begin';
function begin() {
  if (game.state !== 'title') return;
  if (!q.has('mute') && !q.has('auto')) audio.start();   // ?auto / ?mute = silent (testing)
  game.state = 'playing';
  const t = $('title'); t.style.opacity = 0; t.style.pointerEvents = 'none';
  setTimeout(() => { t.style.display = 'none'; }, 2400);
  showHint('controls', '<b>W A S D</b> walk &nbsp;·&nbsp; <b>drag</b> look &nbsp;·&nbsp; <b>space</b> hold to fly &nbsp;·&nbsp; <b>E</b> / <b>right-click</b> sing<br>Walk toward the mountain.', 14000);
}
startBtn.addEventListener('click', begin);
window.addEventListener('keydown', (e) => { if (game.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) begin(); });
if (q.has('auto')) begin();
