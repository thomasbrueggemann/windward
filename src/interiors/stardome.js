// The Pocket of Stars: through the doorway, night. A disc of sand floats under a sky full of stars; a few glyph
// lights drift above it. Touch one and it rises to take its place in the sky; when all have risen they draw a
// constellation, and the symbol it forms comes down to weave itself into your scarf.
import * as THREE from 'three';
import { Room, C, V, stoneMat, sandFloor, motes, makeAmbience, radialTex } from './common.js';
import { makeGlyphSprite, makeRingTexture } from '../textures.js';
import { Updrafts } from '../world/updrafts.js';
import { smooth, clamp } from '../world/heightfield.js';
import { range } from '../world/seed.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const RD = 22, SKY_R = 260;

const skyVert = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`;
const skyFrag = /* glsl */`
precision highp float;
uniform float uTime, uRot;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vn3(p) * 0.65 + vn3(p * 2.3 + 3.7) * 0.35; }
// one layer of stars: a jittered grid on the sphere; brightness follows a steep power law, colour a stellar temperature ramp
vec3 stars(vec3 d, float scale, float thresh, float size, float gain, float bandK) {
  vec3 p = d * scale; vec3 i = floor(p), f = fract(p);
  float r = h3(i);
  float th = thresh - bandK;
  if (r < th) return vec3(0.);
  vec3 c = vec3(h3(i + 1.3), h3(i + 2.7), h3(i + 4.1)) * 0.7 + 0.15;
  float dd = length(f - c);
  float m = (r - th) / (1. - th);
  float tw = 0.6 + 0.4 * sin(uTime * (1.2 + 4. * h3(i + 7.)) + r * 40.) * sin(uTime * (0.7 + 2. * h3(i + 9.)) + r * 17.);
  float core = smoothstep(size, 0., dd) * tw * (0.25 + pow(m, 3.) * 3.2) * gain;
  float halo = smoothstep(size * 3.2, 0., dd) * pow(m, 5.) * 0.55 * gain;
  float t = h3(i + 11.);
  vec3 col = mix(vec3(0.62, 0.75, 1.15), vec3(1.15, 1.0, 0.85), smoothstep(0.2, 0.7, t));
  col = mix(col, vec3(1.25, 0.72, 0.5), smoothstep(0.82, 1., t));
  return col * (core + halo);
}
void main() {
  vec3 d = normalize(vDir);
  float c = cos(uRot), s = sin(uRot);
  d = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
  float h = d.y;
  vec3 col = mix(vec3(0.007, 0.011, 0.032), vec3(0.0008, 0.0012, 0.006), smoothstep(-0.1, 0.8, h));
  col += vec3(0.012, 0.01, 0.03) * exp(-abs(h) * 5.);                       // airglow at the horizon
  // the river of stars: a lit band with drifting dust lanes and a warm bulge
  vec3 band = normalize(vec3(0.5, 0.3, 0.8)), core = normalize(vec3(-0.3, 0.35, 0.89));
  float bd = dot(d, band);
  float b = exp(-pow(bd * 3.4, 2.));
  float lane = 0.;
  if (b > 0.012) {
    float cloud = fbm3(d * 5.), cloud2 = vn3(d * 12. + 4.);
    lane = smoothstep(0.42, 0.62, vn3(d * 7.5 + 11.) * 0.7 + vn3(d * 15. + 3.) * 0.3) * exp(-pow(bd * 6., 2.));
    float bulge = exp(-pow(acos(clamp(dot(d, core), -1., 1.)) * 1.9, 2.));
    vec3 mw = mix(vec3(0.05, 0.06, 0.14), vec3(0.16, 0.12, 0.13), bulge) * (0.45 + 0.9 * cloud);
    mw += vec3(0.11, 0.075, 0.05) * bulge * cloud2;
    col += mw * b * (1. - 0.8 * lane) * 0.95;
  }
  col += vec3(0.02, 0.008, 0.026) * exp(-pow(dot(d, normalize(vec3(-0.6, 0.4, 0.2))) * 2.5, 2.)) * 0.8;   // a faint nebula
  float bandK = b * 0.17 * (1. - lane);
  col += vec3(0.8, 0.85, 1.1) * step(0.95, h3(floor(d * 380.))) * (0.3 + 0.7 * h3(floor(d * 380.) + 5.)) * b * (1. - lane) * 0.22;   // the unresolved crowd of stars in the band
  vec3 st = vec3(0.);
  if (h > -0.3) st = stars(d, 70., 0.87, 0.06, 1.0, bandK) + stars(d, 140., 0.86, 0.07, 0.9, bandK) + stars(d, 36., 0.94, 0.09, 1.6, bandK * 0.5)
          + stars(d, 220., 0.88, 0.1, 0.9, bandK * 1.5) + stars(d, 300., 0.9, 0.11, 0.8, bandK * 1.5);
  col += st * smoothstep(-0.25, 0.05, h);
  gl_FragColor = vec4(col, 1.0);
}`;

/** A drifting stone shard: a faceted lump with one long axis. */
function shardGeo(sc, r) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(sc, 2)); g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const p = g.attributes.position, ph = r() * 9;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), q = 1 + 0.22 * Math.sin(x * 2.1 + ph) * Math.cos(z * 2.6 - y) + 0.1 * Math.sin(x * 6 + y * 5 + z * 4 + ph);
    p.setXYZ(i, x * q * 0.8, y * q * 1.35, z * q * 0.8);
  }
  g.computeVertexNormals();
  return g;
}

export class StarDome extends Room {
  constructor(door) {
    super(door, 'stardome', 'The Pocket of Stars');
    const r = this.rng, P = this.pal;
    Object.assign(P, {
      sunDir: V(-0.3, 0.8, -0.45), sunC: C('#bccbff'), sunI: 1.3, amb: C('#3c4c80'), grd: C('#14142a'),
      floorSun: V(-0.55, 0.32, -0.6), floorSunK: 0.55,
      fog: C('#0b1230'), fogD: 0.006, bg: C('#02030a'), exp: 0.95, bloom: 0.6, bloomThreshold: 1.1, rays: 0,
      lit: C('#34448a'), hi: C('#a4b4f4'), shade: C('#05071a'), rim: C('#5a68b0'), glit: C('#ffffff'), glitter: 2.0,
      sat: 1.08, contrast: 1.05, vignette: 0.45, vigColor: C('#02040e'), shadowTint: C('#00020c'), highTint: C('#000000'), mood: 8, sand: C('#6a78b0'), indoor: 0.4,
    });
    this.bounds = { circle: RD - 0.6 };
    this.camBounds = { circle: RD + 30 };
    this.ceiling = 60;
    this.camDist = 7.5; this.camPitch = 0.12;
    const dz = RD - 5;
    this.spawn = { x: 0, z: dz - 1.8, heading: Math.PI };

    this._buildSky();
    this._buildIsland(dz);
    this._buildLights();
    this.updrafts = new Updrafts(this.scene, [{ x: this.col.x, z: this.col.z, r: 2.6, h: 13, y: this.height(this.col.x, this.col.z) }]);
  }

  height(x, z) {
    const d = Math.hypot(x, z);
    let h = 0.5 * Math.sin(x * 0.22 + 0.7) * Math.cos(z * 0.19 - 0.4) + 0.25 * Math.sin(x * 0.6 + z * 0.4);
    h += 1.2 * smooth(RD - 7, RD, d) - 6 * smooth(RD + 0.5, RD + 4, d);        // a raised lip, then the edge of the world
    return h;
  }

  _buildSky() {
    this.skyU = { uTime: { value: 0 }, uRot: { value: 0 } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    sky.frustumCulled = false; sky.renderOrder = -1000;
    this.skyMesh = sky;
    this.scene.add(sky);
    this.scene.background = this.pal.bg;
  }

  _buildIsland(dz) {
    const s = this.scene, r = this.rng;
    this.addSand(sandFloor((x, z) => this.height(x, z), -RD - 4, RD + 4, -RD - 4, RD + 4, 0.5, (x, z) => Math.hypot(x, z) < RD + 3.5));
    // the underside: the disc is a floating island of sand and stone
    const under = new THREE.Mesh(new THREE.ConeGeometry(RD + 3.4, 26, 40, 4, true), stoneMat(0x3a3e68, 0x10143a, 1, 3, { tile: 0.1, strata: 0.5, ao: 0.5, aoH: 6, floorY: -14, bounce: C('#5a78d0').multiplyScalar(0.12), cracks: 0.9, bump: 0.07 }));
    const p = under.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + 0.08 * Math.sin(p.getY(i) * 0.9 + Math.atan2(p.getX(i), p.getZ(i)) * 5); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    under.geometry.computeVertexNormals();
    under.rotation.x = Math.PI; under.position.y = -13 - 2.6; under.material.side = THREE.DoubleSide;
    s.add(under);
    // shards of stone drifting around the island
    this.shards = [];
    const rock = stoneMat(0x4a4e78, 0x14183e, 1, 3, { tile: 0.3, strata: 0.9, ao: 0.75, aoH: 2, floorY: -20, bounce: C('#5a78d0').multiplyScalar(0.12), cracks: 0.8, bump: 0.08 });
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, d = range(r, RD + 8, RD + 40), y = range(r, -12, 18), sc = range(r, 0.8, 3.5);
      const m = new THREE.Mesh(shardGeo(sc, r), rock);
      m.position.set(Math.cos(a) * d, y, Math.sin(a) * d); m.rotation.set(r() * 3, r() * 3, r() * 3);
      s.add(m); this.shards.push({ m, a, d, y, sp: range(r, 0.01, 0.03) * (r() < 0.5 ? -1 : 1), ph: r() * 6 });
    }
    // the doorway home: a free-standing stone frame filled with daylight
    const frame = stoneMat(0x9a8ca0, 0x241a34, 0.7, 2.2, { tile: 0.3, strata: 0.6, ao: 0.6, aoH: 2, floorY: this.height(0, dz) - 0.2, block: [1.1, 0.8], bounce: C('#ffcf90').multiplyScalar(0.18) });
    const y0 = this.height(0, dz);
    this.exitDoor(0, dz, { w: 2.2, h: 3.8, depth: 0.6, color: C('#ffe0b4'), frameMat: frame, y: y0 - 0.1 });
    this.box(3.4, 4.6, 0.5, frame, 0, y0 - 0.4, dz + 1.15, 0, false);
    this.sun.position.copy(this.pal.sunDir).multiplyScalar(50);
    // star dust drifting over the sand
    this.dust = motes(500, { x0: -RD, x1: RD, y0: 0, y1: 9, z0: -RD, z1: RD }, { color: new THREE.Color(0.7, 0.8, 1.4), size: 0.05, speed: 0.1, seed: 31, rise: 0.15 });
    s.add(this.dust);
    // a breath of wind near the middle, to reach the highest lights
    const ca = r() * Math.PI * 2;
    this.col = { x: Math.cos(ca) * 4, z: Math.sin(ca) * 4 - 2 };
  }

  _buildLights() {
    const r = this.rng, s = this.scene;
    const ring = makeRingTexture();
    // the constellation: a figure in the sky ahead (a few stars around a centre high over the far side)
    const centre = new THREE.Vector3(range(r, -0.3, 0.3), 0.42, -1).normalize();
    const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(centre, up).normalize(), up2 = new THREE.Vector3().crossVectors(right, centre).normalize();
    const shapes = [
      [[0, 1], [0.7, 0.1], [0, -0.9], [-0.7, 0.1], [0, 0.15]],                  // diamond with a heart
      [[-0.8, -0.6], [0, 1], [0.8, -0.6], [0, -0.1], [-0.8, -0.6]],             // the mountain and its cleft
      [[-0.9, 0.2], [-0.3, 0.8], [0.4, 0.5], [0.9, -0.2], [0.2, -0.8]],         // a scarf in the wind
    ];
    const shape = shapes[(r() * shapes.length) | 0];
    this.starDirs = shape.map(([u, v]) => centre.clone().addScaledVector(right, u * 0.28).addScaledVector(up2, v * 0.28).normalize());
    this.centreDir = centre;
    const heights = [1.35, 2.1, 2.9, 4.6, 7.0];
    this.orbs = [];
    for (let i = 0; i < 5; i++) {
      let x, z;
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, d = i >= 3 ? range(r, 0, 3) : range(r, 6, RD - 5);
        x = (i >= 3 ? this.col.x : 0) + Math.cos(a) * d; z = (i >= 3 ? this.col.z : 0) + Math.sin(a) * d;
        if (Math.hypot(x, z - (RD - 5)) > 6 && !this.orbs.some((o) => Math.hypot(o.base.x - x, o.base.z - z) < 4)) break;
      }
      const y = this.height(x, z) + heights[i];
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlyphSprite(i), color: new THREE.Color(1.5, 1.8, 2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      spr.scale.set(1.2, 1.2, 1);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: new THREE.Color(0.35, 0.45, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      halo.scale.set(2.0, 2.0, 1);
      s.add(spr, halo);
      this.orbs.push({ base: new THREE.Vector3(x, y, z), spr, halo, state: this.door.done ? 'star' : 'float', t: 0, ph: r() * 6, from: new THREE.Vector3(), i });
    }
    // the stars they become, and the lines between them
    this.starSpr = this.starDirs.map((d) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: new THREE.Color(2.4, 2.6, 3.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
      sp.position.copy(d).multiplyScalar(SKY_R * 0.6); sp.scale.setScalar(9);
      s.add(sp); return sp;
    });
    const lp = []; for (let i = 0; i < 5; i++) { const a = this.starDirs[i], b = this.starDirs[(i + 1) % 5]; lp.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp.map((v) => v * SKY_R * 0.6), 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 1.4, 2.0), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.lines.frustumCulled = false;
    s.add(this.lines);
    this.formed = this.door.done ? 1 : 0;
    this.descend = null;
    if (this.door.done) this.complete = true;
    for (const o of this.orbs) this.pois.push(o.base);
  }

  onEnter(ctx) {
    this.amb = makeAmbience(ctx.audio, [
      { drone: [76, 83, 88], gain: 0.007, cut: 3000 },
      { drone: [40, 47], gain: 0.014, cut: 400 },
      { noise: { type: 'bandpass', freq: 5200, q: 0.8 }, gain: 0.008, lfo: { rate: 0.07, depth: 1200 } },
    ]);
    if (!this.complete) ctx.hint('stars', 'Lights drift over the sand. <b>Touch them</b> and they rise to the stars.', 7000);
  }

  update(dt, time, ctx) {
    this.tick(time);
    this.doorGlow(time);
    this.skyU.uTime.value = time; this.skyU.uRot.value = time * 0.004;
    this.skyMesh.position.copy(ctx.camera.position);
    this.updrafts.update(dt, time, ctx.camera, ctx.renderer, { pal: this.pal });
    this.dust.userData.tick(time, ctx.camera, ctx.renderer);
    for (const sh of this.shards) { sh.a += sh.sp * dt; sh.m.position.set(Math.cos(sh.a) * sh.d, sh.y + Math.sin(time * 0.3 + sh.ph) * 0.8, Math.sin(sh.a) * sh.d); sh.m.rotation.y += sh.sp * dt * 3; }
    const P = ctx.player, pp = P.pos;
    let risen = 0;
    for (const o of this.orbs) {
      const target = this.starDirs[o.i];
      if (o.state === 'float') {
        o.spr.position.set(o.base.x + Math.sin(time * 0.5 + o.ph) * 0.6, o.base.y + Math.sin(time * 0.9 + o.ph) * 0.25, o.base.z + Math.cos(time * 0.4 + o.ph) * 0.6);
        if (Math.hypot(pp.x - o.spr.position.x, pp.y + 1 - o.spr.position.y, pp.z - o.spr.position.z) < 1.7) {
          o.state = 'rise'; o.t = 0; o.from.copy(o.spr.position);
          P.flash = Math.max(P.flash, 0.6); P.charge = Math.min(1, P.charge + 0.5);
          if (this.amb) this.amb.bell(81 + [0, 2, 4, 7, 9][o.i], 0.07, 4);
          if (ctx.audio.recharge) ctx.audio.recharge();
          for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28; ctx.fx.sparkles.emit(o.from.x, o.from.y, o.from.z, Math.cos(a) * 2, Math.random() * 2, Math.sin(a) * 2, 1.4, 0.1, 2.0, 2.4, 3.2, 1, 1.2, 0, -0.2); }
        }
      } else if (o.state === 'rise') {
        o.t += dt / 3;
        const k = smooth(0, 1, o.t), end = target.clone().multiplyScalar(SKY_R * 0.6);
        o.spr.position.lerpVectors(o.from, end, k * k);
        o.spr.position.y += Math.sin(k * Math.PI) * 6;
        if (Math.random() < 0.6) ctx.fx.sparkles.emit(o.spr.position.x, o.spr.position.y, o.spr.position.z, 0, -0.3, 0, 1.2, 0.18 + k * 1.5, 1.8, 2.2, 3, 0.8, 0.5, 0, -0.1);
        if (o.t >= 1) { o.state = 'star'; if (this.amb) this.amb.bell(88 + [0, 2, 4, 7, 9][o.i], 0.04, 5); }
      }
      if (o.state === 'star') risen++;
      o.halo.position.copy(o.spr.position);
      const vis = o.state === 'float' ? 1 : o.state === 'rise' ? 1 - o.t : 0;
      o.spr.material.opacity = vis; o.halo.material.opacity = vis * (0.6 + 0.3 * Math.sin(time * 2 + o.ph));
      o.spr.visible = vis > 0.01; o.halo.visible = vis > 0.01;
      this.starSpr[o.i].material.opacity += ((o.state === 'star' ? 1 : 0) - this.starSpr[o.i].material.opacity) * Math.min(1, dt * 2);
    }
    // all risen: the constellation draws itself, flares, and its symbol comes down to you
    if (risen === 5) this.formed = Math.min(1, this.formed + dt / 2.5);
    this.lines.material.opacity = this.formed * (0.75 + 0.25 * Math.sin(time * 1.3));
    if (this.formed >= 1 && !this.complete && !this.descend) {
      this.descend = { t: 0, from: this.centreDir.clone().multiplyScalar(SKY_R * 0.5), spr: new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlyphSprite(this.door.index % 6), color: new THREE.Color(3, 3, 3.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })) };
      this.scene.add(this.descend.spr);
      if (this.amb) [76, 81, 88, 93].forEach((m, i) => setTimeout(() => this.amb && this.amb.bell(m, 0.06, 5), i * 220));
    }
    if (this.descend && !this.complete) {
      const D = this.descend; D.t += dt / 3.2;
      const k = smooth(0, 1, D.t), to = new THREE.Vector3(pp.x, pp.y + 2.2, pp.z);
      D.spr.position.lerpVectors(D.from, to, k);
      D.spr.scale.setScalar(30 * (1 - k) + 1.6);
      if (Math.random() < 0.8) ctx.fx.sparkles.emit(D.spr.position.x, D.spr.position.y, D.spr.position.z, (Math.random() - .5), (Math.random() - .5), (Math.random() - .5), 1.5, 0.3 * (1 - k) + 0.1, 2.4, 2.4, 3, 0.9, 0.5, 0, -0.1);
      if (D.t >= 1) {
        this.complete = true; this.door.done = true; D.spr.visible = false;
        ctx.reward.glyph(D.spr.position);
      }
    }
  }

  auto(P) {
    if (this.complete) return null;
    const left = this.orbs.filter((o) => o.state === 'float');
    if (!left.length) return { x: P.pos.x, z: P.pos.z, stop: true };
    let best = null, bd = 1e9;
    for (const o of left) { const d = Math.hypot(o.base.x - P.pos.x, o.base.z - P.pos.z) + (o.base.y - this.height(o.base.x, o.base.z)) * 4; if (d < bd) { bd = d; best = o; } }
    const o = best, dh = o.spr.position.y - (P.pos.y + 1), dd = Math.hypot(o.spr.position.x - P.pos.x, o.spr.position.z - P.pos.z);
    if (dh > 2.6) {
      // too high to jump: ride the breath of wind up, then drift across
      if (P.mode === 'soar' && dh > 0.5) return { x: this.col.x, z: this.col.z, stop: true };
      if (!P.grounded && dh < 1.0) return { x: o.spr.position.x, z: o.spr.position.z, glide: true };
      return { x: this.col.x, z: this.col.z };
    }
    return { x: o.spr.position.x, z: o.spr.position.z, jump: dd < 2.2 && dh > 0.6, slow: dd < 2 };
  }
}
StarDome.fadeColor = new THREE.Color(0.04, 0.05, 0.12);
