import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeSandUniforms, makeSandMaterial, Terrain, buildFarTerrain } from './world/terrain.js';
import { makeSky, makeSummitLight } from './world/sky.js';
import { samplePalette, blendParadise } from './world/palette.js';
import { terrainHeight, terrainGradient, progressAt, zAtProgress, pathX, summitPoint, WIND, PATH_LEN, clamp, smooth } from './world/heightfield.js';
import { SEED } from './world/seed.js';
import { PLAN, SITES, onPath } from './world/layout.js';
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
import { makeGodRaysPass, makeGradePass } from './post.js';
import { Companion } from './companion.js';

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
const farMat = makeSandMaterial(sandU, 0.7);
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
const rays = makeGodRaysPass();
composer.addPass(rays);
composer.addPass(new OutputPass());
const grade = makeGradePass();
composer.addPass(grade);
const _sunNdc = new THREE.Vector3(), _camFwd = new THREE.Vector3();
function updatePost(time) {
  const pal = env.pal;
  camera.getWorldDirection(_camFwd);
  const facing = _camFwd.dot(pal.sun);
  _sunNdc.copy(pal.sun).multiplyScalar(1000).add(camera.position).project(camera);
  rays.uniforms.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
  rays.uniforms.uStrength.value = facing > 0 ? pal.rays * smooth(0.05, 0.55, facing) * 0.4 : 0;
  rays.uniforms.uColor.value.copy(pal.sunC);
  rays.uniforms.uAspect.value = camera.aspect;
  grade.uniforms.uTime.value = time;
  grade.uniforms.uSat.value = 1.1 + 0.08 * (1 - pal.snow);
  grade.uniforms.uFade.value = game.whiteout * 0.35;
}

const sparkles = new ParticlePool(scene, 1400, true);
const dustPool = new ParticlePool(scene, 1800, false);
const ambient = new AmbientDust(scene);
const fx = { sparkles, dust: dustPool };

const input = new Input(canvas);
const player = new Player(scene);
player.colliders = ruins.colliders;
player.shelters = ruins.shelters;
const cam = new ChaseCamera(camera);
cam.colliders = ruins.colliders;
const audio = new AudioEngine();

const env = { sunDir: new THREE.Vector3(), pal: null, progress: 0 };

const props = new Props(scene, ruins, fx);
props._camPos = camera.position;
const flyers = new Flyers(scene);
for (const f of PLAN.flyers) flyers.spawn(...onPath(f.p, f.side), f.n);
const introBanner = props.intro;
const guardians = PLAN.guardians.map((p) => new Guardian(scene, ...onPath(p), 48));
const companion = new Companion(scene, ruins.colliders, ruins.shelters);

// ------------------------------------------------------------------ palette
const ROCK_DESERT = new THREE.Color('#5a4a42'), ROCK_CAVE = new THREE.Color('#14243a'), ROCK_SNOW = new THREE.Color('#4a5670');
function applyPalette(p) {
  samplePalette(p);
  const pal = blendParadise(game.paradise || 0);
  env.pal = pal; env.sunDir.copy(pal.sun); env.progress = p;
  const u = sandU;
  u.uSunDir.value.copy(pal.sun);
  u.uSunColor.value.copy(pal.sunC).multiplyScalar(pal.sunI * 0.4);
  u.uLit.value.copy(pal.lit); u.uHi.value.copy(pal.hi); u.uShade.value.copy(pal.shade);
  u.uRim.value.copy(pal.rim); u.uGlit.value.copy(pal.glit); u.uFog.value.copy(pal.fog); u.uAmb.value.copy(pal.amb);
  u.uSnow.value = pal.snow; u.uCave.value = pal.cave; u.uGlitterGain.value = 1 - 0.88 * pal.cave;
  u.uRock.value.copy(ROCK_DESERT).lerp(ROCK_CAVE, pal.cave).lerp(ROCK_SNOW, pal.snow * (1 - pal.cave));
  nearMat.uniforms.uFogD.value = pal.fogD;
  farMat.uniforms.uFogD.value = pal.fogD * farMat.userData.fogScale;
  const su = sky.uniforms;
  su.uTop.value.copy(pal.top); su.uHor.value.copy(pal.hor); su.uGround.value.copy(pal.fog);
  su.uSunDir.value.copy(pal.sun); su.uSunColor.value.copy(pal.sunC); su.uSunI.value = pal.sunI; su.uOvercast.value = (smooth(0.8, 1.0, p) * 0.9 + pal.snow * 0.25) * (1 - (game.paradise || 0));
  renderer.toneMappingExposure = pal.exp;
  bloom.strength = pal.bloom;
  scene.fog.color.copy(pal.fog); scene.fog.density = pal.fogD;
  sunLight.color.copy(pal.sunC); sunLight.intensity = pal.sunI;
  sunLight.position.copy(pal.sun).multiplyScalar(100).add(player.pos);
  sunLight.target.position.copy(player.pos);
  hemi.color.copy(pal.amb); hemi.groundColor.copy(pal.grd);
  for (const s of [player.scarf.uniforms, companion.p.scarf.uniforms]) {
    s.uSunDir.value.copy(pal.sun); s.uSunColor.value.copy(pal.sunC).multiplyScalar(pal.sunI * 0.35);
    s.uAmb.value.copy(pal.amb); s.uFog.value.copy(pal.fog); s.uFogD.value = pal.fogD;
  }
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
player.heading = Math.PI;
player.teleport(sx, sz);
cam.yaw = 0;
terrain.prime(sx, sz, 3);
for (let i = 0; i < +(q.get('glyphs') ?? 0); i++) player.addGlyph();

const game = { state: 'title', time: 0, visionT: 0, visionIdx: 0, hints: {}, singHold: 0, chapter: -1, gust: 0, gustT: 14, gustDir: new THREE.Vector3(), whiteout: 0 };

// ------------------------------------------------------------------ settings (persisted per browser)
const settings = { sens: 1, invertY: false, volume: 0.85, calm: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('journey-settings') || '{}')); } catch (e) { /* storage unavailable */ }
function applySettings() {
  cam.sens = settings.sens; cam.invertY = settings.invertY; cam.calm = settings.calm; audio.setVolume && audio.setVolume(settings.volume);
  try { localStorage.setItem('journey-settings', JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
}
applySettings();
window.__THREE = THREE;
window.__game = { seed: SEED, sites: SITES, plan: PLAN, hf: { terrainHeight, terrainGradient, pathX }, companion, player, cam, env, scene, camera, game, terrain, renderer, input, props, guardians, flyers, audio, ruins, summitPoint };

const SAND = new THREE.Color();
const tmp = new THREE.Vector3();
const flashEl = $('fade');

const hintQueue = [];
let hintBusy = false;
function showHint(key, html, ms = 7000) {
  if (game.hints[key]) return;
  game.hints[key] = true;
  hintQueue.push([html, ms]);
  if (!hintBusy) nextHint();
}
function nextHint() {
  const h = $('hint');
  const item = hintQueue.shift();
  if (!item) { hintBusy = false; return; }
  hintBusy = true;
  h.innerHTML = item[0]; h.style.opacity = 1;
  setTimeout(() => { h.style.opacity = 0; setTimeout(nextHint, 1600); }, item[1]);
}

// ------------------------------------------------------------------ chapter titles
const CHAPTERS = [
  { p: 0.0, n: 'I', name: 'The Dunes' },
  { p: 0.30, n: 'II', name: 'The Sunken City' },
  { p: 0.515, n: 'III', name: 'The Depths' },
  { p: 0.745, n: 'IV', name: 'The Ascent' },
];
function updateChapter(prog) {
  let idx = -1;
  for (let i = 0; i < CHAPTERS.length; i++) if (prog >= CHAPTERS[i].p) idx = i;
  if (idx > game.chapter) {
    game.chapter = idx;
    const c = CHAPTERS[idx], el = $('chapter');
    el.innerHTML = `<span>${c.n}</span>${c.name}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    audio.chapter();
    if (idx > 0) saveProgress({ chapter: idx, glyphs: player.glyphs, met: companion.met });
  }
}

// ------------------------------------------------------------------ progress (per browser): resume at the last chapter reached
const SAVE_KEY = 'journey-progress';
function saveProgress(o) { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...o, seed: SEED })); } catch (e) { /* storage unavailable */ } }
function loadProgress() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }
function clearProgress() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ } }

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
    if (type === 'step' && e.slide) continue;
    if (type === 'step') {
      audio.step();
      for (let i = 0; i < 3; i++) dustPool.emit(e.x + (Math.random() - .5) * .2, terrainHeight(e.x, e.z) + 0.08, e.z + (Math.random() - .5) * .2,
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
  singRings(player, dt);
  // a held song released bursts outward in one big ring that carries much further
  if (player.singing) game.singHold += dt;
  else {
    if (game.singHold > 0.9) shout(player.pos);
    game.singHold = 0;
  }
}

function singRings(who, dt, big = false) {
  if (!who.singing || !who.group.visible) return;
  const p = who.pos;
  who._ringT = (who._ringT ?? 0) - dt;
  if (who._ringT > 0) return;
  who._ringT = 0.22;
  const r = 3.2 + 3 * who.sing;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    sparkles.emit(p.x, p.y + 1.1, p.z, Math.cos(a) * r, 0.4, Math.sin(a) * r, 1.2, 0.12, 3, 2.4, 1.4, 0.9, 1.6, 0, -0.4);
  }
  sparkles.emit(p.x, p.y + 2.1, p.z, 0, 1.4, 0, 1.8, 0.5, 2.4, 1.8, 0.9, 0.55, 1.2, 0, 0.8);
}

function shout(p) {
  audio.shout();
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2;
    sparkles.emit(p.x, p.y + 1.0, p.z, Math.cos(a) * 11, 0.9, Math.sin(a) * 11, 1.5, 0.22, 3, 2.6, 1.6, 1, 1.1, 0, -0.3);
    sparkles.emit(p.x, p.y + 1.6, p.z, Math.cos(a) * 6, 2.2, Math.sin(a) * 6, 1.3, 0.14, 2.6, 2.0, 1.2, 0.8, 1.4, 0, -0.2);
  }
  props.wake(p, 48, fx);
  cam.shake = Math.max(cam.shake, 0.25);
}

// ------------------------------------------------------------------ the other traveler
const _pan = new THREE.Vector3();
function companionEvents(evs) {
  const c = companion.p;
  for (const e of evs) {
    if (e.type === 'chirp') {
      _pan.copy(c.pos).project(camera);
      audio.chirp(clamp(_pan.x, -1, 1) * (_pan.z < 1 ? 1 : -1), e.dist, e.big);
      if (e.big) shoutFrom(c);
      // a chirp answered close by fills the listener's scarf
      if (e.dist < 14 && !player.frozen) {
        player.charge = Math.min(1, player.charge + (e.big ? 0.8 : 0.35));
        player.flash = Math.max(player.flash, 0.5);
        for (let i = 0; i < 18; i++) {
          const t = Math.random();
          sparkles.emit(c.pos.x + (player.pos.x - c.pos.x) * t, c.pos.y + 1.2 + Math.sin(t * Math.PI) * 1.5, c.pos.z + (player.pos.z - c.pos.z) * t,
            (Math.random() - .5) * .5, 0.6, (Math.random() - .5) * .5, 1.0, 0.13, 3, 2.4, 1.4, 1, 1.2, 0, -0.3);
        }
        audio.recharge();
      }
    } else if (e.type === 'met') {
      showHint('met', 'Another traveler. Walk together — singing close by fills each other\'s scarves.', 8000);
    } else if (e.type === 'join') {
      showHint('companion', 'You are not alone. <b>Sing</b> to call to them.', 7000);
    } else if (e.type === 'share') {
      if (Math.random() < 0.12) {
        const a = player.scarf.pts[1 + ((Math.random() * (player.scarf.n - 1)) | 0)];
        sparkles.emit(a.x, a.y, a.z, 0, 0.5, 0, 0.8, 0.09, 3, 2.3, 1.2, 1, 1, 0, -0.4);
      }
    }
  }
}
function shoutFrom(who) {
  const p = who.pos;
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2;
    sparkles.emit(p.x, p.y + 1.0, p.z, Math.cos(a) * 9, 0.8, Math.sin(a) * 9, 1.4, 0.18, 3, 2.5, 1.5, 1, 1.1, 0, -0.3);
  }
}

// ------------------------------------------------------------------ mountain wind: gusts that push the traveler back down the slope
function updateGusts(dt, prog) {
  const cold = smooth(0.78, 0.9, prog);
  if (cold <= 0 || game.state !== 'playing') { game.gust = Math.max(0, game.gust - dt); player.push.set(0, 0, 0); companion.p.push.set(0, 0, 0); return 0; }
  game.gustT -= dt;
  if (game.gustT <= 0 && game.gust <= 0) {
    game.gust = 3.4;
    game.gustT = 9 + Math.random() * 7 - cold * 3;
    audio.gust(0.6 + cold * 0.6);
    showHint('gust', 'The wind is fierce here. Shelter behind the standing stones.', 7000);
  }
  if (game.gust > 0) {
    game.gust -= dt;
    const k = Math.sin(clamp(1 - game.gust / 3.4, 0, 1) * Math.PI) * cold;   // swell and fade
    // the wind pours down from the summit
    const dx = -WIND.x, dz = -WIND.z;
    for (const who of [player, companion.p]) {
      if (!who.group.visible || who.frozen || windShelter(who.pos, dx, dz)) { who.push.set(0, 0, 0); continue; }
      who.push.set(dx * 7.5 * k, 0, dz * 7.5 * k);
      if (!who.grounded) who.vel.y -= 5 * k * dt;
    }
    cam.shake = Math.max(cam.shake, 0.4 * k);
    return k;
  }
  player.push.set(0, 0, 0); companion.p.push.set(0, 0, 0);
  return 0;
}
/** Is there stone just upwind (toward the summit) of this point? */
function windShelter(p, dx, dz) {
  for (const c of ruins.colliders) {
    if (p.y > c.top + 0.5) continue;
    const ox = c.x - p.x, oz = c.z - p.z;
    const along = -(ox * dx + oz * dz);              // positive when the stone is upwind
    if (along < 0 || along > 6) continue;
    const lat = Math.abs(ox * dz - oz * dx);
    if (lat < (c.r ?? Math.max(c.hx, c.hz)) + 0.9) return true;
  }
  return false;
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
  companion.p.setVisible(false); companion.state = 'gone';
  flashEl.style.transition = 'none'; flashEl.style.background = '#fff'; flashEl.style.opacity = 0;
  for (let i = 0; i < 6; i++) {
    const m = buildTraveler({ white: true });
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
    const song = smooth(11, 12.5, t) * (1 - smooth(16.5, 18, t));
    fig.forEach((m, i) => {
      // they drift down out of the snow, hover, and lean over the fallen traveler; their robes billow as they sing
      const arrive = smooth(7 + i * 0.35, 10.5 + i * 0.35, t);
      m.scale.setScalar(Math.max(0.001, 1.4 * arrive));
      m.position.y = terrainHeight(m.position.x, m.position.z) + (1 - arrive) * 7 + 0.25 * arrive + Math.sin(time * 1.3 + i) * 0.08 + song * 0.35;
      const rig = m.userData.rig;
      rig.body.rotation.x = 0.22 * arrive - song * 0.12;
      rig.head.rotation.x = 0.35 * arrive - song * 0.4;
      rig.tipPivot.rotation.x = -0.15 - Math.sin(time * 1.7 + i) * 0.08;
      const sw = rig.sway;
      sw.uTime.value = time + i * 3;
      sw.uFlutter.value = 0.5 + 0.8 * (1 - arrive) + song * 0.9;
      sw.uFlare.value = (1 - arrive) * 0.8 + song * 0.7;
    });
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
    // stay well clear of the slope so the summit stays in view
    player.pos.y = Math.max(player.pos.y, terrainHeight(player.pos.x, player.pos.z) + 6 + 26 * Math.sin(Math.min(1, u * 1.15) * Math.PI));
    const vx = (player.pos.x - prev.x) / dt, vy = (player.pos.y - prev.y) / dt, vz = (player.pos.z - prev.z) / dt;
    player.vel.set(vx, vy, vz); player.speed = Math.min(24, Math.hypot(vx, vz) + 6);
    player.heading = Math.atan2(vx, vz);
    ending.collapse = 0;
    // break through the storm into clear, golden air
    game.paradise = smooth(0.02, 0.3, u);
    cam.pitch += (-0.02 - cam.pitch) * (1 - Math.exp(-1.5 * dt)); cam.idle = 3;
    const wantYaw = Math.atan2(-(target.x - player.pos.x), -(target.z - player.pos.z));
    cam.yaw += Math.atan2(Math.sin(wantYaw - cam.yaw), Math.cos(wantYaw - cam.yaw)) * (1 - Math.exp(-1.2 * dt));
    ending.look = ending.look || new THREE.Vector3();
    // ease the gaze from the traveler up to the light in the cleft
    const toS = tmp.set(target.x, target.y, target.z).sub(player.pos);
    ending.look.copy(player.pos).addScaledVector(toS.normalize(), 30);
    cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 11, height: 1.8, follow: 3, fov: 62, noFollow: true, noLift: true, lookAt: ending.look, lookK: smooth(0.0, 0.25, u) * 0.75 });
    if (Math.random() < 0.9) {
      const a = player.scarf.pts[2 + ((Math.random() * (player.scarf.n - 2)) | 0)];
      sparkles.emit(a.x, a.y, a.z, (Math.random() - .5) * .6, 0.3, (Math.random() - .5) * .6, 1.2, 0.1, 3, 2.4, 1.4, 1, 1, 0, -0.2);
    }
    const w = smooth(0.62, 0.98, u);
    flashEl.style.opacity = w;
    audio.fadeOut(10);
    if (u >= 1 && game.state === 'ending') {
      game.state = 'end';
      clearProgress();
      const end = $('end'); end.style.opacity = 1; end.style.pointerEvents = 'auto';
      const found = props.glyphs.filter((g) => g.taken).length;
      $('endStats').textContent = `symbols found  ${found} / ${props.glyphs.length}` + (companion.met ? '  ·  you travelled with a companion' : '');
    }
  }
  player.collapse = ending.collapse;
  player.update(dt, { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false }, cam.yaw, time, env);
  if (!player.scripted) player.pos.y = terrainHeight(player.pos.x, player.pos.z);
}

// ------------------------------------------------------------------ where the traveler's hood turns
const _lt = new THREE.Vector3();
function pickLookTarget() {
  const p = player.pos;
  let best = 1e9, found = false;
  const consider = (x, y, z, range, weight = 1) => {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < range && d * weight < best) { best = d * weight; _lt.set(x, y, z); found = true; }
  };
  if (companion.visible) consider(companion.pos.x, companion.pos.y + 1.4, companion.pos.z, 20, 0.7);
  for (const g of props.glyphs) if (!g.taken) consider(g.spr.position.x, g.spr.position.y, g.spr.position.z, 24);
  for (const s of ruins.shrines) if (!s.seen) consider(s.x, s.y + 7, s.z, 40, 1.2);
  return found ? _lt : null;
}

// ------------------------------------------------------------------ wind tearing plumes of sand (or snow) off the dune crests
function sandStreams(dt, pal) {
  if (game.state === 'title' || pal.cave > 0.5) return;
  const n = Math.round(dt * (1500 + 1500 * pal.snow + 3000 * game.whiteout));
  const cx = camera.position.x, cz = camera.position.z;
  camera.getWorldDirection(_camFwd);
  const col = _plumeCol.copy(pal.hi).lerp(pal.sunC, 0.3).multiplyScalar(1.15);
  const ws = 4.5 + 6 * pal.snow + 10 * game.whiteout;
  for (let i = 0; i < n; i++) {
    const r = 6 + Math.random() * 70, a = (Math.random() - 0.5) * 1.6 + Math.atan2(_camFwd.x, _camFwd.z);
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const h = terrainHeight(x, z);
    // a crest: a local high point along the wind
    const up = terrainHeight(x - WIND.x * 2.5, z - WIND.z * 2.5), lee = terrainHeight(x + WIND.x * 2.5, z + WIND.z * 2.5);
    if (h <= up || h < (up + lee) / 2 + 0.15) continue;
    dustPool.emit(x, h + 0.1, z, WIND.x * ws * (0.7 + Math.random() * 0.6), 0.3 + Math.random() * 0.7, WIND.z * ws * (0.7 + Math.random() * 0.6),
      1.8 + Math.random() * 1.8, (0.5 + Math.random() * 0.6) * (1 - 0.6 * pal.snow), col.r, col.g, col.b, 0.3 - 0.12 * pal.snow, 0.25, 0.15, 3.5 - 2 * pal.snow);
  }
}
const _plumeCol = new THREE.Color();

// ------------------------------------------------------------------ main loop
function frame(nowMs, doRender = true) {
  let dt = (nowMs - (frame.last ?? nowMs)) / 1000;
  if (!(dt > 0)) dt = 0.016;               // first frame / non-monotonic clocks
  dt = Math.min(dt, 0.05);
  frame.last = nowMs;
  const inp = input.poll();
  if (inp.pausePressed && (game.state === 'playing' || game.state === 'paused')) togglePause();
  if (game.state === 'paused') { if (doRender) composer.render(); return; }
  game.time += dt;
  const time = game.time;

  const prog = progressAt(player.pos.z);
  applyPalette(prog);
  SAND.copy(env.pal.lit).lerp(env.pal.hi, 0.4);
  clothUniforms.uTime.value = time;
  const evs = [];

  if (game.state === 'playing' || game.state === 'vision') {
    const frozen = game.state === 'vision';
    cam.update(dt, player, frozen ? { lookX: 0, lookY: 0 } : inp, time, {});
    player.cold = smooth(0.74, 0.95, prog);
    if (!frozen) cam.shake = Math.max(cam.shake, 0.12 * player.cold);
    if (inp.zoom) cam.baseDist = clamp(cam.baseDist + inp.zoom * 0.6, 5, 13);
    player.lookTarget = pickLookTarget();
    player.update(dt, frozen ? { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false } : inp, cam.yaw, time, env);
    playerFx(dt, time);
    companionEvents(companion.update(dt, time, player, env, camera, frozen));
    singRings(companion.p, dt);
    if (companion.visible) for (const e of companion.p.events) if (e.type === 'step' && companion.p.grounded) props.addFootprint(e);
    game.whiteout = updateGusts(dt, prog);
    updateChapter(prog);
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
    if (b0 && !b0.awakened && Math.hypot(b0.center.x - player.pos.x, b0.center.z - player.pos.z) < 55) showHint('sing', input.isTouch ? 'Hold <b>SING</b> — the grey cloth will answer.' : 'Hold <b>E</b> or <b>right-click</b> to sing — the grey cloth will answer.', 9000);
    if (player.pos.z < 10 - PATH_LEN && game.state === 'playing') startEnding();

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
    cam.yaw = 0.45 + Math.sin(time * 0.07) * 0.25;
    cam.pitch = 0.04;
    cam.update(dt, player, { lookX: 0, lookY: 0 }, time, { dist: 7.5, height: 1.5, noFollow: true });
    player.update(dt, { mx: 0, my: 0, jump: false, jumpPressed: false, sing: false }, cam.yaw, time, env);
    props.update(dt, time, player, env, fx);
    flyers.update(dt, time, player, fx, evs);
  }

  terrain.update(player.pos.x, player.pos.z, 4);
  ruins.update(env.sunDir, smooth(0.30, 0.42, prog) * (1 - smooth(0.52, 0.60, prog)) + smooth(0.99, 1.0, prog) * 0);

  sandU.uTime.value = time; sky.uniforms.uTime.value = time;
  // light pools under the nearest shafts in the depths
  if (env.pal.cave > 0.01) {
    const near = props.shafts.map((sh) => [Math.hypot(sh.x - player.pos.x, sh.z - player.pos.z), sh]).sort((a, b) => a[0] - b[0]);
    sandU.uPools.value.forEach((v, i) => { const sh = near[i] && near[i][1]; if (sh) v.set(sh.x, sh.z, sh.r * 0.9, 1); else v.set(0, 0, 1, 0); });
  }
  sky.mesh.position.copy(camera.position);
  summit.userData.update(camera, 1);

  const pal = env.pal, snow = pal.snow;
  const wind = 4 + snow * 12 + game.whiteout * 26;
  ambient.update(dt, time, camera, renderer, player.pos.y, { x: WIND.x * wind, z: WIND.z * wind }, snow * 2.5, clamp(pal.dust * 0.5, 0, 1) * (1 - 0.75 * pal.cave),
    snow > 0.5 ? new THREE.Color(1, 1, 1) : SAND, snow > 0.5 ? 0.12 : 0.07, 0.55);
  sandStreams(dt, pal);
  sparkles.update(dt, camera, renderer);
  dustPool.update(dt, camera, renderer);

  updatePost(time);
  if (doRender) composer.render();
}
// adaptive resolution: drop the render scale when frames run long, recover it once there is headroom again
const MAX_DPR = Math.min(window.devicePixelRatio, 1.75);
const quality = { dpr: MAX_DPR, acc: 0, n: 0, last: 0, stable: 0 };
function adaptResolution(t) {
  const ft = t - (quality.last || t); quality.last = t;
  if (ft <= 0 || ft > 100 || document.hidden || game.state === 'paused') return;   // ignore stalls and background tabs
  quality.acc += ft; quality.n++;
  if (quality.acc < 1500) return;
  const avg = quality.acc / quality.n; quality.acc = 0; quality.n = 0;
  let next = quality.dpr;
  if (avg > 21 && quality.dpr > 0.7) { next = Math.max(0.7, quality.dpr - 0.15); quality.stable = 0; }
  else if (avg < 17.6 && quality.dpr < MAX_DPR && ++quality.stable >= 4) { next = Math.min(MAX_DPR, quality.dpr + 0.1); quality.stable = 0; }
  if (next !== quality.dpr) {
    quality.dpr = next;
    renderer.setPixelRatio(next); composer.setPixelRatio(next);
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
  }
}
window.__quality = quality;
window.__adapt = adaptResolution;
function loop(t) { adaptResolution(t); frame(t); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// deterministic stepping (used for automated checks when the page is not being animated by the browser)
window.__advance = (sec, step = 1 / 30) => {
  const n = Math.max(1, Math.round(sec / step));
  let t = frame.last ?? performance.now();
  for (let i = 0; i < n; i++) { t += step * 1000; frame(t, i === n - 1); }
  frame.last = undefined;
};

// debug: jump the traveler somewhere and frame it ({p, dx, yaw, pitch, dist}); used for visual checks
window.__view = ({ p = null, dx = 0, yaw = null, pitch = null, dist = null, t = 1.5 } = {}) => {
  for (const id of ['title', 'hint']) $(id).style.display = 'none';
  if (p !== null) { const z = zAtProgress(p); player.teleport(pathX(z) + dx, z); terrain.prime(player.pos.x, z, 3); }
  if (dist !== null) cam.baseDist = dist;
  if (yaw !== null) { cam.yaw = yaw; cam.idle = -1e9; }
  if (pitch !== null) cam.pitch = pitch;
  cam.ready = false;
  __advance(t);
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
  input.allowLock = true;
  document.body.classList.add('playing');
  const ctl = input.isTouch
    ? '<b>left thumb</b> walk &nbsp;·&nbsp; <b>right thumb</b> look<br><b>FLY</b> jump, hold to fly &nbsp;·&nbsp; <b>SING</b> call out<br>Walk toward the light on the mountain.'
    : '<b>W A S D</b> walk &nbsp;·&nbsp; <b>mouse</b> look &nbsp;·&nbsp; <b>space</b> jump, hold to fly &nbsp;·&nbsp; <b>E</b> / <b>right-click</b> sing<br>Walk toward the light on the mountain.';
  setTimeout(() => showHint('controls', ctl, 12000), 4200);
}

// ------------------------------------------------------------------ pause menu
function togglePause(force) {
  const now = performance.now();
  if (now - (togglePause.t ?? 0) < 300) return;      // Esc both releases pointer lock and arrives as a key press
  togglePause.t = now;
  const pause = force ?? game.state !== 'paused';
  const el = $('pause');
  if (pause && game.state === 'playing') {
    game.state = 'paused'; el.classList.add('show'); audio.duck && audio.duck(true);
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (!pause && game.state === 'paused') {
    game.state = 'playing'; el.classList.remove('show'); audio.duck && audio.duck(false);
    frame.last = undefined;
  }
}
$('resume').addEventListener('click', () => togglePause(false));
const sensEl = $('sens'), invEl = $('invert'), volEl = $('volume'), calmEl = $('calm');
sensEl.value = settings.sens; invEl.checked = settings.invertY; volEl.value = settings.volume; calmEl.checked = settings.calm;
calmEl.addEventListener('change', () => { settings.calm = calmEl.checked; applySettings(); });
sensEl.addEventListener('input', () => { settings.sens = +sensEl.value; applySettings(); });
invEl.addEventListener('change', () => { settings.invertY = invEl.checked; applySettings(); });
volEl.addEventListener('input', () => { settings.volume = +volEl.value; applySettings(); });
// losing pointer lock mid-game (Esc) opens the menu
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game.state === 'playing' && input.lockedOnce) togglePause(true); });
// a journey left unfinished can be resumed from the start of the chapter it reached (in the world it was begun in)
let saved = q.has('p') || q.has('auto') ? null : loadProgress();
if (saved && saved.seed !== undefined && saved.seed !== SEED) saved = null;
$('worldSeed').textContent = `World ${SEED}`;
startBtn.addEventListener('click', () => {
  if (game.state !== 'title') return;
  if (loadProgress()) clearProgress();
  // this world was rebuilt from the save: a new journey needs a fresh one
  if (saved && saved.seed === SEED && !q.has('seed')) { try { sessionStorage.setItem('journey-begin', '1'); } catch (e) { /* storage unavailable */ } location.reload(); return; }
  begin();
});
if (saved && CHAPTERS[saved.chapter]) {
  const cont = $('continue');
  cont.style.display = '';
  cont.innerHTML = `Continue <span>${CHAPTERS[saved.chapter].n} · ${CHAPTERS[saved.chapter].name}</span>`;
  startBtn.textContent = 'New journey';
  cont.addEventListener('click', () => {
    if (game.state !== 'title') return;
    const z = zAtProgress(CHAPTERS[saved.chapter].p + 0.004);
    player.heading = Math.PI;
    player.teleport(pathX(z), z);
    terrain.prime(player.pos.x, z, 3);
    while (player.glyphs < (saved.glyphs | 0)) player.addGlyph();
    // shrines already passed have been seen; the companion is met again on the way
    for (const sh of ruins.shrines) if (sh.z > z) sh.seen = true;
    cam.yaw = 0; cam.ready = false;
    game.chapter = saved.chapter - 1;
    begin();
  });
}
window.addEventListener('keydown', (e) => { if (game.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) begin(); });
if (q.has('auto')) begin();
else if ((() => { try { const b = sessionStorage.getItem('journey-begin'); sessionStorage.removeItem('journey-begin'); return b; } catch (e) { return null; } })()) {
  begin();   // straight in after "New journey" reloaded a fresh world; sound starts with the first input
  const wake = () => { if (!q.has('mute')) audio.start(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
}
