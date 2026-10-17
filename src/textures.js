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

/** Robe: deep red cloth, gold geometric hem, a gold band down the front (u = 0 / 1 is the front). */
export function makeRobeTexture(white = false) {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d');
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
  g.fillStyle = goldDark;
  for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, H - 30); g.lineTo(x + 8, H - 9); g.lineTo(x + 16, H - 30); g.fill(); }
  g.fillRect(0, H - 34, W, 3);
  // front band: centred on u = 0, so it wraps across both edges of the canvas
  const band = (cx) => {
    const bw = 34;
    g.fillStyle = gold; g.fillRect(cx - bw / 2, 0, bw, H);
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
  for (let x = 40; x < W - 40; x += 28) { g.beginPath(); g.arc(x, 150, 3, 0, 7); g.fill(); g.fillRect(x - 7, 162, 14, 2); }
  const t = tex(c); t.wrapS = THREE.RepeatWrapping; return t;
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

/** Soft blob shadow. */
export function makeBlobShadow() {
  const c = canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}
