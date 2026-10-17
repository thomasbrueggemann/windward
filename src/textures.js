import * as THREE from 'three';
import { rng } from './noise.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Draw one of the traveler's glyphs (white strokes) centred in a cell. */
export function drawGlyph(g, kind, cx, cy, s) {
  g.save();
  g.translate(cx, cy);
  g.lineWidth = s * 0.07; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  const arc = (r, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke(); };
  switch (kind % 6) {
    case 0:
      arc(s * 0.36); arc(s * 0.16);
      g.beginPath(); g.arc(0, 0, s * 0.045, 0, 7); g.fill();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4); g.lineTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5); g.stroke(); }
      break;
    case 1:
      g.beginPath(); g.moveTo(0, -s * .42); g.lineTo(s * .3, 0); g.lineTo(0, s * .42); g.lineTo(-s * .3, 0); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(0, -s * .17); g.lineTo(s * .12, 0); g.lineTo(0, s * .17); g.lineTo(-s * .12, 0); g.closePath(); g.fill();
      break;
    case 2:
      g.beginPath(); g.moveTo(0, -s * .4); g.lineTo(s * .38, s * .3); g.lineTo(-s * .38, s * .3); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(0, -s * .1); g.lineTo(0, s * .3); g.stroke();
      break;
    case 3:
      g.beginPath();
      for (let i = 0; i <= 60; i++) { const a = i * 0.2, r = s * 0.04 + i * s * 0.0058; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      break;
    case 4:
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-s * .3, s * (.12 + i * .2)); g.lineTo(0, s * (-.1 + i * .2)); g.lineTo(s * .3, s * (.12 + i * .2)); g.stroke(); }
      break;
    default:
      arc(s * 0.38, Math.PI * 1.1, Math.PI * 1.9); arc(s * 0.38, Math.PI * 0.1, Math.PI * 0.9);
      g.beginPath(); g.ellipse(0, 0, s * .22, s * .11, 0, 0, 7); g.stroke();
      g.beginPath(); g.arc(0, 0, s * .05, 0, 7); g.fill();
  }
  g.restore();
}

/** Scarf mask: white glyphs + stitching on black. Tiles along V. */
export function makeScarfMask() {
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([7, 6]);
  for (const x of [11, W - 11]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.setLineDash([]);
  drawGlyph(g, 0, W / 2, 64, 78);
  drawGlyph(g, 1, W / 2, 192, 78);
  g.fillStyle = '#fff';
  for (const y of [8, 128, 248]) { g.beginPath(); g.arc(W / 2, y, 4, 0, 7); g.fill(); }
  const t = tex(c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** A single glowing glyph on transparent (collectibles, sing ring). */
export function makeGlyphSprite(kind) {
  const c = canvas(256, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.shadowColor = '#fff6d0'; g.shadowBlur = 18;
  drawGlyph(g, kind, 128, 128, 170);
  const t = tex(c); return t;
}

export function makeRingTexture() {
  const c = canvas(256, 256), g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,245,215,0.9)'); gr.addColorStop(0.82, 'rgba(255,240,200,0.55)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return tex(c);
}

export function makeSoftDot() {
  const c = canvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c);
}

/** Tileable plain-weave normal map (warp/weft threads with fibre grain): the robe's micro structure. */
export function makeWeaveNormal() {
  const S = 128, T = 8, c = canvas(S, S), g = c.getContext('2d');
  const r = rng(23), h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const over = (Math.floor(x / T) + Math.floor(y / T)) & 1;
    const warp = Math.sin((x % T + 0.5) / T * Math.PI), weft = Math.sin((y % T + 0.5) / T * Math.PI);
    h[y * S + x] = (over ? warp * (0.6 + 0.4 * weft) : weft * (0.6 + 0.4 * warp)) * 0.8 + (r() - 0.5) * 0.18;
  }
  const img = g.createImageData(S, S), k = 2.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x + S - 1) % S], dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
    const n = Math.hypot(dx * k, dy * k, 1), o = (y * S + x) * 4;
    img.data[o] = (-dx * k / n * 0.5 + 0.5) * 255; img.data[o + 1] = (dy * k / n * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / n * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** Robe: deep red cloth, gold geometric hem, a gold band down the front (u = 0 / 1 is the front).
 *  userData.mr holds a roughness(G)/metalness(B) map: gold embroidery is glossier and slightly metallic. */
export function makeRobeTexture(white = false) {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d');
  const mc = canvas(W, H), m = mc.getContext('2d'), GM = 'rgb(0,105,150)';
  m.fillStyle = 'rgb(0,205,0)'; m.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  if (white) { gr.addColorStop(0, '#fbf6ee'); gr.addColorStop(1, '#e2d9ca'); }
  else { gr.addColorStop(0, '#b8341a'); gr.addColorStop(0.5, '#9e2614'); gr.addColorStop(1, '#7a1a0c'); }
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // cloth weave noise + soft vertical folds
  const r = rng(11);
  for (let x = 0; x < W; x += 2) {
    const f = Math.sin(x / W * Math.PI * 2 * 9) * 0.5 + Math.sin(x / W * Math.PI * 2 * 23 + 1) * 0.3;
    g.fillStyle = f > 0 ? `rgba(255,220,180,${0.05 * f})` : `rgba(30,0,0,${-0.09 * f})`;
    g.fillRect(x, 0, 2, H);
  }
  g.globalAlpha = 0.06;
  for (let i = 0; i < 4000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * W, r() * H, 1 + r() * 8, 1); }
  g.globalAlpha = 1;
  const gold = white ? '#cdbd94' : '#e9b65a', goldDark = white ? '#9c8b64' : '#7d2e10';
  // gold hem band (canvas bottom == hem)
  g.fillStyle = gold; g.fillRect(0, H - 30, W, 30);
  m.fillStyle = GM; m.fillRect(0, H - 30, W, 30);
  g.fillStyle = goldDark;
  for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, H - 30); g.lineTo(x + 8, H - 9); g.lineTo(x + 16, H - 30); g.fill(); }
  g.fillRect(0, H - 34, W, 3);
  // front band: centred on u = 0, so it wraps across both edges of the canvas
  const band = (cx) => {
    const bw = 34;
    g.fillStyle = gold; g.fillRect(cx - bw / 2, 0, bw, H);
    m.fillStyle = GM; m.fillRect(cx - bw / 2, 0, bw, H);
    g.fillStyle = goldDark; g.fillRect(cx - bw / 2 + 3, 0, 2, H); g.fillRect(cx + bw / 2 - 5, 0, 2, H);
    g.strokeStyle = goldDark; g.lineWidth = 2.5;
    for (let y = 22; y < H - 40; y += 30) {
      g.beginPath(); g.moveTo(cx, y - 10); g.lineTo(cx + 9, y); g.lineTo(cx, y + 10); g.lineTo(cx - 9, y); g.closePath(); g.stroke();
      g.beginPath(); g.arc(cx, y, 2.5, 0, 7); g.fillStyle = goldDark; g.fill();
    }
  };
  band(0); band(W);
  // pale stitched glyph row at the waist
  g.fillStyle = white ? 'rgba(160,140,100,.5)' : 'rgba(255,214,150,.55)';
  m.fillStyle = GM;
  for (let x = 40; x < W - 40; x += 28) { g.beginPath(); g.arc(x, 150, 3, 0, 7); g.fill(); g.fillRect(x - 7, 162, 14, 2); m.fillRect(x - 7, 146, 14, 18); }
  // embroidered glyph medallions between the waist and the hem band
  g.strokeStyle = white ? 'rgba(170,150,105,.8)' : 'rgba(245,195,105,.85)'; g.lineWidth = 1.7;
  for (let x = 36; x < W - 20; x += 56) {
    const y = 206;
    g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x, y - 9); g.moveTo(x, y + 9); g.lineTo(x, y + 14); g.moveTo(x - 14, y); g.lineTo(x - 9, y); g.moveTo(x + 9, y); g.lineTo(x + 14, y); g.stroke();
    g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill();
    m.fillRect(x - 15, y - 15, 30, 30);
  }
  const t = tex(c); t.wrapS = THREE.RepeatWrapping;
  const mr = tex(mc, false); mr.wrapS = THREE.RepeatWrapping; t.userData.mr = mr;
  return t;
}

export function makeStoneBump() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const r = rng(5);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 3500; i++) { const v = (110 + r() * 60) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * S, r() * S, 1 + r() * 6, 1 + r() * 3); }
  g.strokeStyle = 'rgba(40,40,40,.45)'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++) { g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - .5) * 40; y += (r() - .2) * 30; g.lineTo(x, y); } g.stroke(); }
  const t = tex(c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}


/** Tileable RGBA noise for the stone shader: r = blotches, g = detail, b = crack cells (0 on the seams), a = grain. */
export function makeStoneNoise(S = 256) {
  const hash = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, per, s) => {
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const X0 = ((fx % per) + per) % per, Y0 = ((fy % per) + per) % per, X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
    const a = hash(X0, Y0, s), b = hash(X1, Y0, s), c = hash(X0, Y1, s), d = hash(X1, Y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, per, oct, s) => { let a = 1, n = 0, t = 0; for (let i = 0; i < oct; i++) { t += a * vn(x * (1 << i), y * (1 << i), per * (1 << i), s + i); n += a; a *= 0.5; } return t / n; };
  const cell = (x, y, per) => {
    const cx = Math.floor(x), cy = Math.floor(y); let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, wx = ((gx % per) + per) % per, wy = ((gy % per) + per) % per;
      const px = gx + hash(wx, wy, 91), py = gy + hash(wx, wy, 92), d = Math.hypot(px - x, py - y);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return d2 - d1;
  };
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S, k = (j * S + i) * 4;
    const wx = (vn(u * 8, v * 8, 8, 70) - 0.5) * 0.1 + (vn(u * 16, v * 16, 16, 72) - 0.5) * 0.04, wy = (vn(u * 8, v * 8, 8, 71) - 0.5) * 0.1 + (vn(u * 16, v * 16, 16, 73) - 0.5) * 0.04;   // warped seams
    data[k] = fbm(u * 4, v * 4, 4, 4, 1) * 255;
    data[k + 1] = fbm(u * 8, v * 8, 8, 5, 11) * 255;
    data[k + 2] = Math.min(1, cell((u + wx) * 7, (v + wy) * 7, 7) * 2.2) * 255;
    data[k + 3] = (vn(u * 64, v * 64, 64, 31) * 0.6 + vn(u * 128, v * 128, 128, 32) * 0.4) * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

/** Soft blob shadow. */
export function makeBlobShadow() {
  const c = canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}
