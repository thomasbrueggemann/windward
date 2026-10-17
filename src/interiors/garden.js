// The Sleeping Garden: a cavern under the sand where cloth grows like flowers. Dark and hushed until someone sings;
// every flower the song reaches unfurls and glows, and when the whole garden is awake its heart opens and a small
// cloth creature comes out to travel with you.
import * as THREE from 'three';
import { Room, C, V, stoneMat, sandFloor, lightShaft, motes, makeAmbience, radialTex } from './common.js';
import { clothUniforms, clothFrag } from '../world/cloth.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range } from '../world/seed.js';

const R = 19;

const petalVert = /* glsl */`
attribute vec3 aP;      // x: petal angle, y: t along the petal (0 base .. 1 tip), z: s across (-1..1)
uniform float uBloom, uTime, uSeed, uLen, uWid, uGlow;
varying vec2 vUv; varying float vGlow; varying vec3 vN; varying vec3 vW;
void main() {
  float a = aP.x, t = aP.y, s = aP.z, open = uBloom;
  float phi0 = mix(0.1, 0.62, open), curl = mix(0.2, 1.05, open);
  float phi = phi0 + curl * t * t;
  float L = uLen * (0.55 + 0.45 * open) * t;
  float pm = phi0 + curl * t * t * 0.33;
  vec3 radial = vec3(cos(a), 0., sin(a)), side = vec3(-sin(a), 0., cos(a));
  float w = uWid * s * pow(sin(3.14159 * min(1., t * 0.85 + 0.15)), 0.7) * (0.4 + 0.6 * open);
  float fl = sin(uTime * 2.1 + a * 3. + t * 4. + uSeed) * 0.07 * t * (0.25 + open);
  vec3 p = radial * (L * sin(pm) + fl) + vec3(0., L * cos(pm) + fl * 0.6, 0.) + side * w;
  // breathing while asleep
  p *= 1. + 0.03 * sin(uTime * 0.8 + uSeed) * (1. - open);
  vec4 wp = modelMatrix * vec4(p, 1.);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * (radial * cos(phi) - vec3(0., sin(phi), 0.)));
  vUv = vec2(t, s * 0.5 + 0.5); vGlow = uGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

function petalGeometry(n, segT = 8) {
  const pos = [], ap = [], idx = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, base = pos.length / 3;
    for (let i = 0; i <= segT; i++) for (let j = 0; j <= 2; j++) { pos.push(0, 0, 0); ap.push(a, i / segT, j - 1); }
    for (let i = 0; i < segT; i++) for (let j = 0; j < 2; j++) {
      const q = base + i * 3 + j;
      idx.push(q, q + 3, q + 1, q + 1, q + 3, q + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return g;
}

export class Garden extends Room {
  constructor(door) {
    super(door, 'garden', 'The Sleeping Garden');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(0.12, 1, -0.08), sunC: C('#a8dcff'), sunI: 0.9, amb: C('#2c5070'), grd: C('#08121e'),
      floorSun: V(0.5, 0.45, 0.25), floorSunK: 0.45,
      fog: C('#071722'), fogD: 0.032, bg: C('#02070c'), exp: 1.15, bloom: 0.9, bloomThreshold: 0.95, rays: 0.5, raysColor: C('#9ad8ff'),
      lit: C('#163644'), hi: C('#2f6a7a'), shade: C('#040a16'), rim: C('#3f8aa5'), glit: C('#b8f0ff'), glitter: 0.8, rock: C('#14243a'), pools: true,
      sat: 1.06, contrast: 1.05, vignette: 0.55, vigColor: C('#000a14'), shadowTint: C('#000612'), highTint: C('#060302'), mood: 6, sand: C('#3a6a7a'),
    });
    this.bounds = { circle: R };
    this.ceiling = 8;
    this.camDist = 6.4;
    this.spawn = { x: 0, z: R - 3.6, heading: Math.PI };
    this.songs = [];

    this._buildCave();
    this._buildPlants();
    this.hintShown = false;
  }

  height(x, z) {
    const d = Math.hypot(x, z);
    let h = 0.45 * Math.sin(x * 0.31 + 1.2) * Math.cos(z * 0.27) + 0.2 * Math.sin(x * 0.9 - z * 0.6);
    h += 2.8 * smooth(13, R + 1, d);                     // the floor rises into the cavern wall
    h += 1.3 * Math.exp(-(d * d) / (2 * 2.6 * 2.6));     // the heart's mound
    h *= 1 - 0.85 * smooth(R - 6, R - 2.5, z) * (1 - smooth(3, 6, Math.abs(x)));   // a level path in from the door
    return h;
  }

  _buildCave() {
    const s = this.scene, r = this.rng;
    s.background = this.pal.bg;
    const rock = stoneMat(0x1c3048, 0x061020, 1.0, 3);
    this.rockMat = rock;
    // the vault: a squashed dome of rough rock
    const dome = new THREE.SphereGeometry(R + 3, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const p = dome.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = Math.sin(x * 0.4 + z * 0.3) * 0.9 + Math.sin(y * 0.8 + x * 0.2) * 0.6 + Math.sin(z * 0.9 - y * 0.4) * 0.5;
      const k = 1 + n * 0.035;
      p.setXYZ(i, x * k, y * 0.5 * k, z * k);
    }
    dome.computeVertexNormals();
    const domeM = new THREE.Mesh(dome, new THREE.MeshStandardMaterial({ color: 0x1a2c44, roughness: 1, side: THREE.BackSide, emissive: 0x040c18, emissiveIntensity: 1, bumpMap: rock.bumpMap, bumpScale: 3 }));
    domeM.position.y = -2.5;
    s.add(domeM);
    // a crack of moonlight high in the vault, falling on the heart
    const top = new THREE.Vector3(1.2, 8.6, -0.8), bottom = new THREE.Vector3(0, this.height(0, 0), 0);
    this.addShaft(lightShaft(top, bottom, 1.0, 2.6, C('#8ccfff').multiplyScalar(0.7), 0.9));
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.8, 3.2), fog: false }));
    crack.rotation.x = Math.PI / 2; crack.rotation.z = 0.4; crack.position.copy(top).add(new THREE.Vector3(0, -0.25, 0));
    s.add(crack);
    this.sun.position.set(1.2, 30, -0.8); this.sun.target.position.set(0, 0, 0);
    // the doorway wall
    this.box(9, 7, 2, rock, -5.6, -0.5, R - 0.4 + 1, 0, true);
    this.box(9, 7, 2, rock, 5.6, -0.5, R - 0.4 + 1, 0, true);
    this.box(2.4, 3.5, 2, rock, 0, 3.6, R - 0.4 + 1, 0, false);
    this.exitDoor(0, R - 1.6, { w: 2.2, h: 3.6, depth: 1.5, color: C('#ffe6c0'), frameMat: rock });
    // boulders around the rim
    for (let i = 0; i < 16; i++) {
      const a = range(r, 0, Math.PI * 2);
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.5) continue;   // keep the door clear
      const d = range(r, R - 2.5, R + 1), x = Math.cos(a) * d, z = Math.sin(a) * d, sc = range(r, 1.2, 2.6);
      const g = new THREE.IcosahedronGeometry(sc, 1);
      const m = new THREE.Mesh(g, rock); m.position.set(x, this.height(x, z) - 0.3, z); m.rotation.set(r() * 3, r() * 3, 0); m.scale.y = 0.7;
      s.add(m);
    }
    // the floor: dark sand glittering like wet stone
    this.addSand(sandFloor((x, z) => this.height(x, z), -R - 1, R + 1, -R - 1, R + 1, 0.5, (x, z) => Math.hypot(x, z) < R + 1.5));
    const u = this.sandFloors[0].userData.sandU;
    u.uPools.value[0].set(0, 0, 3.2, 1);
    u.uPoolColor.value.set(0.4, 0.75, 1.0);
    // threads hanging from the vault, each ending in a faint bead of light
    const lines = [], beads = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - 3), x = Math.cos(a) * d, z = Math.sin(a) * d;
      const yTop = (R + 3) * 0.5 * Math.sqrt(Math.max(0, 1 - (d / (R + 3)) ** 2)) - 2.5, len = range(r, 1, 4.5);
      lines.push(x, yTop, z, x, yTop - len, z);
      beads.push(x, yTop - len, z);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    s.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1e4a5e, transparent: true, opacity: 0.35 })));
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(beads, 3));
    s.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: new THREE.Color(0.6, 1.6, 2.0), size: 0.18, map: radialTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    // fireflies and the moss's glow
    this.flies = motes(260, { x0: -R, x1: R, y0: 0.3, y1: 6, z0: -R, z1: R }, { color: new THREE.Color(0.7, 1.7, 1.5), size: 0.07, speed: 0.25, seed: 11 });
    this.moss = motes(900, { x0: -R + 2, x1: R - 2, y0: 0, y1: 0.4, z0: -R + 2, z1: R - 2 }, { color: new THREE.Color(0.15, 0.55, 0.6), size: 0.05, speed: 0.05, seed: 12 });
    s.add(this.flies, this.moss);
  }

  _buildPlants() {
    const r = this.rng, s = this.scene;
    this.plants = [];
    const stalkMat = new THREE.MeshStandardMaterial({ color: 0x5a1a10, roughness: 0.8, emissive: 0x200604, emissiveIntensity: 1 });
    const gtex = radialTex();
    const make = (x, z, scale, heart = false) => {
      const gy = this.height(x, z), h = heart ? 2.2 : range(r, 1.1, 2.3) * scale;
      const lean = new THREE.Vector3(range(r, -0.3, 0.3), 0, range(r, -0.3, 0.3));
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(lean.x * 0.3, h * 0.5, lean.z * 0.3), new THREE.Vector3(lean.x, h, lean.z)]);
      const stalk = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, heart ? 0.12 : 0.05, 5), stalkMat);
      stalk.position.set(x, gy, z); s.add(stalk);
      const u = { ...clothUniforms, uBloom: { value: 0 }, uGlow: { value: 0 }, uSeed: { value: r() * 20 }, uLen: { value: (heart ? 1.9 : range(r, 1.0, 1.45)) * scale }, uWid: { value: (heart ? 0.55 : 0.34) * scale } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: petalVert, fragmentShader: clothFrag, side: THREE.DoubleSide });
      const bud = new THREE.Mesh(petalGeometry(heart ? 9 : 5 + ((r() * 3) | 0)), mat);
      bud.position.set(x + lean.x, gy + h, z + lean.z); bud.rotation.y = r() * 6;
      bud.frustumCulled = false;
      s.add(bud);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: heart ? new THREE.Color(2.4, 1.7, 0.9) : new THREE.Color(2.0, 1.2, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.position.copy(bud.position).add(new THREE.Vector3(0, 0.3 * scale, 0)); glow.scale.setScalar(heart ? 3.6 : 1.5 * scale);
      s.add(glow);
      const p = { x, z, y: bud.position.y, bud, u, glow, bloom: 0, awake: false, heart };
      this.colliders.push({ kind: 'circle', x, z, r: heart ? 0.5 : 0.25, top: gy + h, bottom: gy - 1 });
      return p;
    };
    const n = 9 + ((r() * 3) | 0);
    for (let i = 0, tries = 0; i < n && tries < 200; tries++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, 5, R - 4.5), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (z > R - 8 && Math.abs(x) < 4) continue;                                  // the way in stays open
      if (this.plants.some((q) => Math.hypot(q.x - x, q.z - z) < 3.6)) continue;
      this.plants.push(make(x, z, range(r, 0.85, 1.25)));
      i++;
    }
    this.heart = make(0, 0, 1.4, true);
    this.heartOpen = 0;
    if (this.door.done) { for (const p of this.plants) { p.bloom = 1; p.awake = true; } this.heartOpen = 1; this.heart.bloom = 1; this.complete = true; }
    for (const p of this.plants) this.pois.push({ x: p.x, y: p.y, z: p.z });
  }

  onEnter(ctx) {
    this.amb = makeAmbience(ctx.audio, [
      { noise: { type: 'lowpass', freq: 180, q: 0.6 }, gain: 0.06 },
      { drone: [45, 52, 57], gain: 0.016, cut: 500 },
      { drone: [69, 76], gain: 0.0, cut: 2400 },        // shimmer that rises as the garden wakes
    ]);
    this.dripT = 1;
    if (!this.complete) ctx.hint('garden', 'The cloth here is sleeping. <b>Sing</b> to wake it.', 7000);
  }

  onSong(pos, r, big) { this.songs.push({ x: pos.x, z: pos.z, r, big }); }

  update(dt, time, ctx) {
    this.tick(time);
    this.doorGlow(time);
    this.flies.userData.tick(time, ctx.camera, ctx.renderer);
    this.moss.userData.tick(time, ctx.camera, ctx.renderer);
    const songs = this.songs;
    let awake = 0;
    for (const p of this.plants) {
      if (!p.awake) {
        let reach = 0;
        for (const s of songs) { const d = Math.hypot(p.x - s.x, p.z - s.z); if (d < s.r + 1.5) reach = Math.max(reach, s.big ? 1 : 0.5); }
        if (reach) p.bloom = Math.min(1, p.bloom + dt * (reach >= 1 ? 2.5 : 0.9));
        else p.bloom = Math.max(0, p.bloom - dt * 0.08);          // a half-woken flower slowly falls back asleep
        if (p.bloom >= 1) {
          p.awake = true;
          if (this.amb) this.amb.bell(74 + [0, 3, 7, 10, 12, 15][(Math.random() * 6) | 0] - 12, 0.06, 4);
          for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28; ctx.fx.sparkles.emit(p.x, p.y + 0.4, p.z, Math.cos(a) * 1.6, 1 + Math.random() * 1.5, Math.sin(a) * 1.6, 1.8, 0.12, 2.6, 2.0, 1.0, 1, 1.2, 0, -0.3); }
        }
      }
      if (p.awake) awake++;
      const k = p.awake ? 1 : p.bloom;
      p.u.uBloom.value = THREE.MathUtils.smoothstep(k, 0, 1);
      p.u.uGlow.value = k * k * (0.8 + 0.2 * Math.sin(time * 2 + p.u.uSeed.value));
      p.glow.material.opacity = 0.1 * k + 0.3 * k * k;
      if (p.awake && Math.random() < dt * 0.8) ctx.fx.sparkles.emit(p.x + (Math.random() - .5) * 0.6, p.y + 0.3, p.z + (Math.random() - .5) * 0.6, 0, 0.35, 0, 3, 0.07, 2.4, 1.8, 0.9, 0.8, 0.3, 0, -0.1);
    }
    songs.length = 0;
    // the whole garden awake: the heart opens and something stirs inside it
    const all = awake === this.plants.length;
    if (this.amb) this.amb.set(2, 0.012 * awake / this.plants.length);
    const H = this.heart;
    if (all && !this.complete) {
      this.heartOpen = Math.min(1, this.heartOpen + dt / 3.5);
      if (this.heartOpen >= 1) {
        this.complete = true; this.door.done = true;
        ctx.reward.familiar(new THREE.Vector3(H.x, H.y + 0.8, H.z));
        for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28; ctx.fx.sparkles.emit(H.x, H.y + 0.6, H.z, Math.cos(a) * 3, 1 + Math.random() * 3, Math.sin(a) * 3, 2.2, 0.16, 3, 2.3, 1.2, 1, 1, 0, -0.3); }
      }
    }
    H.u.uBloom.value = THREE.MathUtils.smoothstep(this.heartOpen, 0, 1);
    H.u.uGlow.value = 0.25 + 0.75 * this.heartOpen + 0.15 * Math.sin(time * 1.5) * (all ? 1 : 0.3);
    H.glow.material.opacity = 0.15 + 0.15 * awake / this.plants.length + 0.35 * this.heartOpen;
    // the cave brightens as it wakes
    const wake = awake / this.plants.length;
    this.pal.exp = 1.0 + 0.2 * wake;
    this.pal.amb.setRGB(0.17 + 0.1 * wake, 0.31 + 0.08 * wake, 0.44);
    if (this.amb && (this.dripT -= dt) <= 0) { this.dripT = 1.2 + Math.random() * 3; this.amb.bell(86 + ((Math.random() * 5) | 0) * 2, 0.012, 1.4); }
  }

  auto(P) {
    if (this.complete) return null;
    let best = null, bd = 1e9;
    for (const p of this.plants) if (!p.awake) { const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z); if (d < bd) { bd = d; best = p; } }
    if (!best) return { x: 1.5, z: 2.5, stop: Math.hypot(P.pos.x - 1.5, P.pos.z - 2.5) < 1.5 };
    return bd < 3 ? { x: best.x, z: best.z, stop: true, sing: true } : { x: best.x, z: best.z, sing: bd < 6 };
  }
}
Garden.fadeColor = new THREE.Color(0.03, 0.08, 0.12);
