import * as THREE from 'three';
import { rng } from '../noise.js';
import { addPlaza, terrainHeight, pathX, zAtProgress, PATH_LEN, trenchCenter } from './heightfield.js';
import { makeStoneBump, makeGlyphSprite } from '../textures.js';

const HDR_AMBER = new THREE.Color(3.4, 1.9, 0.7);

/** Ruined city, shrines, buried monoliths and the canyon's rock bridges. */
export class Ruins {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];
    this.shelters = [];
    this.shrines = [];
    this.posts = [];            // banner post pairs
    this.casters = [];
    this.windowMats = [];
    const bump = makeStoneBump(); bump.repeat.set(2, 2);
    this.stone = new THREE.MeshStandardMaterial({ color: 0xd9b98c, roughness: 0.96, metalness: 0, bumpMap: bump, bumpScale: 2.2, emissive: 0x4a2a14, emissiveIntensity: 0.55 });
    this.stoneDark = new THREE.MeshStandardMaterial({ color: 0xb08a62, roughness: 0.96, bumpMap: bump, bumpScale: 2.0, emissive: 0x3a2010, emissiveIntensity: 0.55 });
    this.gold = new THREE.MeshStandardMaterial({ color: 0xe8b860, roughness: 0.5, metalness: 0.5, emissive: 0x6a3a08, emissiveIntensity: 0.8 });
    this.rock = new THREE.MeshStandardMaterial({ color: 0x24364a, roughness: 1, bumpMap: bump, bumpScale: 3, emissive: 0x06101c, emissiveIntensity: 1 });
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x30101a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
    this._tmp = new THREE.Matrix4();
    this._S = new THREE.Matrix4();
    this._lastSun = new THREE.Vector3(9, 9, 9);
    this.glyphTex = makeGlyphSprite(0);

    const r = this.r = rng(77);
    this.build();
  }

  // ------------------------------------------------------------ helpers
  _place(mesh, x, y, z, rotY = 0, shadowY = null) {
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
    mesh.updateMatrixWorld(true);
    if (shadowY !== null) {
      const sh = new THREE.Mesh(mesh.geometry, this.shadowMat);
      sh.matrixAutoUpdate = false; sh.frustumCulled = false; sh.renderOrder = 2;
      this.scene.add(sh);
      this.casters.push({ mesh, sh, y0: shadowY });
    }
    return mesh;
  }
  _box(w, h, d, mat = this.stone) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); return m; }

  _column(x, z, y0, h, broken = false) {
    const H = broken ? h * (0.35 + this.r() * 0.35) : h;
    const base = this._box(2.6, 0.7, 2.6); base.geometry.translate(0, 0.35, 0);
    this._place(base, x, y0 - 0.2, z, 0, y0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.02, H, 14), this.stone);
    shaft.geometry.translate(0, H / 2, 0);
    this._place(shaft, x, y0 + 0.4, z, 0, y0);
    if (!broken) {
      const cap = this._box(2.5, 0.8, 2.5); cap.geometry.translate(0, 0.4, 0);
      this._place(cap, x, y0 + 0.4 + H, z, 0.2, y0);
    } else {
      // a fallen drum lying in the sand beside the stump
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 12), this.stone);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(x + 2.6 + this.r() * 2, y0 + 0.7, z + (this.r() - .5) * 4);
      this.group.add(drum);
    }
    this.colliders.push({ kind: 'circle', x, z, r: 1.15, top: y0 + H + 1 });
  }

  _wall(x, z, y0, len, h, rot) {
    const w = this._box(len, h, 1.4, this.stoneDark); w.geometry.translate(0, h / 2, 0);
    this._place(w, x, y0 - 0.2, z, rot, y0);
    // ragged top
    const n = 3;
    for (let i = 0; i < n; i++) {
      const sh = h * (0.2 + this.r() * 0.35), sw = len / n * 0.6;
      const b = this._box(sw, sh, 1.2, this.stoneDark); b.geometry.translate(0, sh / 2, 0);
      const off = (i - (n - 1) / 2) * (len / n);
      this._place(b, x + Math.cos(rot) * off, y0 - 0.2 + h, z - Math.sin(rot) * off, rot, y0);
    }
    this.colliders.push({ kind: 'box', x, z, hx: len / 2, hz: 0.7, rot: -rot, top: y0 + h });
  }

  _tower(x, z, y0, rot, h) {
    const parts = [[7.2, h * 0.52, 7.2], [5.4, h * 0.3, 5.4], [3.8, h * 0.18, 3.8]];
    let y = y0 - 0.3;
    parts.forEach(([w, hh, d], i) => {
      const b = this._box(w, hh, d); b.geometry.translate(0, hh / 2, 0);
      this._place(b, x, y, z, rot, y0);
      // glowing windows (dusk lights)
      const wm = new THREE.MeshBasicMaterial({ color: HDR_AMBER.clone().multiplyScalar(0.0) });
      this.windowMats.push(wm);
      for (const sgn of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), wm);
        win.position.set(sgn * w * 0.18, hh * 0.55, d / 2 + 0.03);
        b.add(win);
        const win2 = win.clone(); win2.position.set(w / 2 + 0.03, hh * 0.55, sgn * d * 0.18); win2.rotation.y = Math.PI / 2; b.add(win2);
      }
      y += hh;
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 3.4, 4), this.gold); roof.geometry.translate(0, 1.7, 0);
    this._place(roof, x, y, z, rot + Math.PI / 4, y0);
    this.colliders.push({ kind: 'box', x, z, hx: 3.7, hz: 3.7, rot: -rot, top: y0 + h });
  }

  _arch(x, z, y0, rot, s = 1) {
    const sh = new THREE.Shape();
    const W = 8 * s, H = 17 * s, w = 4.2 * s, hh = 11 * s;
    sh.moveTo(-W, 0); sh.lineTo(-W, H - W); sh.absarc(0, H - W, W, Math.PI, 0, true); sh.lineTo(W, 0); sh.lineTo(w, 0);
    sh.lineTo(w, hh - w); sh.absarc(0, hh - w, w, 0, Math.PI, false); sh.lineTo(-w, 0); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.6 * s, bevelEnabled: false, curveSegments: 18 });
    geo.translate(0, 0, -1.3 * s);
    const m = new THREE.Mesh(geo, this.stone);
    this._place(m, x, y0 - 0.2, z, rot, y0);
    for (const sgn of [-1, 1]) {
      const lx = sgn * (W + w) / 2;
      this.colliders.push({ kind: 'box', x: x + Math.cos(rot) * lx, z: z - Math.sin(rot) * lx, hx: (W - w) / 2, hz: 1.4 * s, rot: -rot, top: y0 + H });
    }
  }

  _hall(x, z, y0, rot) {
    // roofed colonnade — shelter from the guardians
    const roof = this._box(26, 1.6, 18); roof.geometry.translate(0, 0.8, 0);
    this._place(roof, x, y0 + 11.5, z, rot, y0);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [lx, lz] of [[-10, -6], [-10, 6], [10, -6], [10, 6], [0, -6], [0, 6]]) {
      this._column(x + cs * lx + sn * lz, z - sn * lx + cs * lz, y0, 11.4, false);
    }
    this.shelters.push({ x, z, r: 13, y: y0 + 11 });
  }

  _ziggurat(x, z, y0, rot) {
    let y = y0 - 0.3;
    [[34, 3.2], [27, 3.2], [20, 3.2], [13, 3.2]].forEach(([w, h], i) => {
      const b = this._box(w, h, w * 0.85, i % 2 ? this.stoneDark : this.stone); b.geometry.translate(0, h / 2, 0);
      this._place(b, x, y, z, rot, y0);
      y += h;
    });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), new THREE.MeshBasicMaterial({ color: 0x1a0a08 }));
    door.position.set(0, 4, 34 * 0.85 / 2 + 0.05);
    this.group.add(door);
    door.position.set(x + Math.sin(rot) * 14.5, y0 + 4, z + Math.cos(rot) * 14.5); door.rotation.y = rot;
    this.colliders.push({ kind: 'box', x, z, hx: 17, hz: 14.5, rot: -rot, top: y0 + 12.8 });
  }

  _postPair(cx, cz, y0, spanDir, span, h = 17) {
    const rot = Math.atan2(spanDir.x, spanDir.z);
    const out = [];
    for (const sgn of [-1, 1]) {
      const px = cx + spanDir.x * span / 2 * sgn, pz = cz + spanDir.z * span / 2 * sgn;
      const y = terrainHeight(px, pz);
      const p = this._box(1.5, h, 1.5); p.geometry.translate(0, h / 2, 0);
      this._place(p, px, y - 0.4, pz, rot, y);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 4), this.gold); cap.geometry.translate(0, 1.3, 0);
      this._place(cap, px, y - 0.4 + h, pz, rot + Math.PI / 4, y);
      this.colliders.push({ kind: 'circle', x: px, z: pz, r: 1.1, top: y + h });
      out.push(new THREE.Vector3(px, y + h - 2.5, pz));
    }
    this.posts.push({ a: out[0], b: out[1] });
    return out;
  }

  _shrine(x, z) {
    const pl = addPlaza(x, z, 12, 34);
    const y0 = pl.h;
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8.6, 1.0, 8), this.stone); plat.geometry.translate(0, 0.5, 0);
    this._place(plat, x, y0 - 0.2, z, 0.2, y0);
    const step = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.2, 1.0, 8), this.stoneDark); step.geometry.translate(0, 0.5, 0);
    this._place(step, x, y0 + 0.8, z, 0.2, y0);
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.9, 11, 4), this.stone); ob.geometry.translate(0, 5.5, 0);
    this._place(ob, x, y0 + 1.7, z, 0.8, y0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 4), this.gold); tip.geometry.translate(0, 1.1, 0);
    this._place(tip, x, y0 + 12.7, z, 0.8, y0);
    // glowing glyph panel
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: this.glyphTex, color: new THREE.Color(3.4, 2.6, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    glyph.position.set(x, y0 + 7, z); this.group.add(glyph);
    // soft beacon
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,200,120,.35)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(2.2, 1.6, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    beacon.scale.set(34, 34, 1); beacon.position.set(x, y0 + 13.4, z); this.group.add(beacon);
    this.colliders.push({ kind: 'circle', x, z, r: 2.2, top: y0 + 13 });
    this.shrines.push({ x, y: y0, z, glyph, beacon, seen: false });
  }

  _rockBridge(x, z, y, w, d, t, rot = 0) {
    // a natural arch: thin at the crown, swelling into the canyon walls
    const hw = w / 2, sh = new THREE.Shape();
    const top = (u) => t / 2 + 5 * (1 - u * u) + Math.sin(u * 9) * 1.2;
    const bot = (u) => -t / 2 - 26 * Math.pow(Math.abs(u), 2.4);
    sh.moveTo(-hw, bot(-1));
    for (let i = -20; i <= 20; i++) { const u = i / 20; sh.lineTo(u * hw, top(u)); }
    for (let i = 20; i >= -20; i--) { const u = i / 20; sh.lineTo(u * hw, bot(u)); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: d, steps: 4, bevelEnabled: true, bevelSize: 1.6, bevelThickness: 2.2, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -d / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const n = Math.sin(px * 0.31 + pz * 0.9) + Math.sin(py * 0.7 + px * 0.13) * 0.8 + Math.sin(pz * 1.7 + py * 0.4);
      p.setXYZ(i, px + n * 0.45, py + n * 0.55, pz + n * 0.5);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.rock);
    this._place(m, x, y, z, rot);
    this.shelters.push({ x, z, hx: 44, hz: d / 2 + 2, y: y - t / 2 + 2 });
    for (let i = 0; i < 5; i++) {
      const hs = 4 + this.r() * 9;
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.1 + this.r() * 1.5, hs, 6), this.rock);
      c.rotation.x = Math.PI; c.position.set(x + (this.r() - .5) * w * 0.5, y - t / 2 - hs / 2 + 1.5, z + (this.r() - .5) * d * 0.6);
      this.group.add(c);
    }
  }

  // ------------------------------------------------------------ layout
  build() {
    const r = this.r;
    const centre = (p) => { const z = zAtProgress(p); return [pathX(z), z]; };

    // ----- shrines at the end of each chapter
    for (const p of [0.289, 0.489, 0.783]) { const [x, z] = centre(p); this._shrine(x + (p > 0.7 ? 6 : 10), z); }

    // ----- the ruined city: three plazas
    const plazaDefs = [
      { p: 0.340, kind: 'gate' }, { p: 0.402, kind: 'colonnade' }, { p: 0.462, kind: 'temple' },
    ];
    plazaDefs.forEach((d) => {
      const [x, z] = centre(d.p);
      const pl = addPlaza(x, z, 50, 80);
      const y0 = pl.h;
      const L = (lx, lz) => [x + lx, z + lz];
      if (d.kind === 'gate') {
        this._arch(x, z + 28, y0, 0.0, 1.2);
        this._tower(x - 26, z + 18, y0, 0.2, 30);
        this._tower(x + 28, z - 6, y0, -0.1, 24);
        for (let i = 0; i < 6; i++) this._column(x - 12 + (i % 2) * 24, z - 4 - Math.floor(i / 2) * 16, y0, 13, i === 3);
        this._wall(x + 14, z + 28, y0, 16, 6, 0.1);
        this._wall(x - 30, z - 22, y0, 20, 8, 1.4);
        this._postPair(x, z - 38, y0, new THREE.Vector3(1, 0, 0), 24);
      } else if (d.kind === 'colonnade') {
        for (let i = 0; i < 6; i++) for (const sx of [-13, 13]) this._column(x + sx, z + 40 - i * 15, y0, 14, i === 2 && sx > 0 || i === 5 && sx < 0);
        this._hall(x - 40, z - 4, y0, 0.15);
        this._tower(x + 36, z + 14, y0, -0.3, 34);
        this._wall(x + 30, z - 30, y0, 24, 7, 0.6);
        this._postPair(x, z + 48, y0, new THREE.Vector3(1, 0, 0), 28);
        this._postPair(x, z - 50, y0, new THREE.Vector3(1, 0, 0), 22);
      } else {
        this._ziggurat(x - 6, z - 30, y0, 0.0);
        for (let i = 0; i < 4; i++) this._column(x - 24 + i * 16, z + 6, y0, 12, i === 1);
        this._hall(x + 38, z + 18, y0, -0.2);
        this._tower(x - 40, z + 22, y0, 0.3, 28);
        this._arch(x + 2, z + 40, y0, 0.05, 1.0);
        this._wall(x + 36, z - 24, y0, 18, 6, 1.2);
      }
    });

    // ----- monoliths half-buried in the dunes (scale + landmarks)
    const mono = (x, z, kind) => {
      const y = terrainHeight(x, z);
      const h = 5 + r() * 9;
      let m;
      if (kind === 0) { m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, h, 10), this.stone); m.geometry.translate(0, h / 2, 0); }
      else if (kind === 1) { m = this._box(2 + r() * 2, h, 1.2); m.geometry.translate(0, h / 2, 0); }
      else { m = this._box(6 + r() * 4, 1.4, 3 + r() * 2); m.geometry.translate(0, 0.7, 0); }
      m.rotation.set((r() - .5) * 0.3, r() * 6.28, (r() - .5) * 0.35);
      m.position.set(x, y - 1.6 - r() * 2, z);
      this.group.add(m);
      this.colliders.push({ kind: 'circle', x, z, r: kind === 2 ? 2.8 : 1.1, top: y + (kind === 2 ? 0 : h * 0.7) });
    };
    const monoZs = [];
    for (let z = -40; z > -610; z -= 22 + r() * 40) monoZs.push(z);
    for (let z = -1620; z > -2030; z -= 30 + r() * 50) monoZs.push(z);
    for (const z of monoZs) {
      const side = r() < 0.5 ? -1 : 1;
      mono(pathX(z) + side * (14 + r() * 70), z + (r() - .5) * 10, (r() * 3) | 0);
    }
    // the first landmark: a standing gateway right ahead of the spawn point
    {
      const z = -52, x = pathX(z) - 2, y = terrainHeight(x, z);
      const lintel = this._box(14, 2.2, 2.4); lintel.geometry.translate(0, 1.1, 0);
      this._place(lintel, x, y + 10.5, z, 0.12);
      for (const sx of [-6, 6]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 14, 12), this.stone); col.geometry.translate(0, 7, 0);
        const px = x + sx * Math.cos(0.12), pz = z - sx * Math.sin(0.12);
        this._place(col, px, terrainHeight(px, pz) - 2.2, pz, 0);
        this.colliders.push({ kind: 'circle', x: px, z: pz, r: 1.3, top: 40 });
      }
    }

    // ----- the depths: natural bridges spanning the canyon, leaving gaps for shafts of light
    for (let z = zAtProgress(0.535), i = 0; z > zAtProgress(0.735); z -= 52 + r() * 22, i++) {
      if (i % 3 === 2) continue;
      const cx = this._canyonCentre(z);
      this._rockBridge(cx + (r() - .5) * 10, z, -11 - r() * 5, 150, 15 + r() * 14, 7 + r() * 4, (r() - .5) * 0.15);
    }
  }

  _canyonCentre(z) { return trenchCenter(z); }

  // ------------------------------------------------------------ per-frame
  update(sunDir, dusk) {
    // planar shadows (only when the sun moved)
    if (this._lastSun.distanceToSquared(sunDir) > 1e-6) {
      this._lastSun.copy(sunDir);
      // clamp the shadow elevation so low suns don't smear shadows across the whole plain
      const lx = sunDir.x, ly = Math.max(0.32, sunDir.y), lz = sunDir.z;
      for (const c of this.casters) {
        const y0 = c.y0 + 0.07;
        this._S.set(
          1, -lx / ly, 0, y0 * lx / ly,
          0, 0, 0, y0,
          0, -lz / ly, 1, y0 * lz / ly,
          0, 0, 0, 1);
        c.sh.matrix.copy(this._S).multiply(c.mesh.matrixWorld);
        c.sh.matrixWorldNeedsUpdate = true;
      }
    }
    // window lights come on toward dusk
    const k = THREE.MathUtils.smoothstep(dusk, 0.0, 1.0);
    for (const m of this.windowMats) m.color.copy(HDR_AMBER).multiplyScalar(k);
  }
}
