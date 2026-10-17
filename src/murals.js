// Procedural cave-painting "visions" shown at each shrine. Pure canvas line-art, revealed element by element.
// The composition of each vision varies with the world seed.
import { rngFor } from './world/seed.js';

const spread = (r, n, a, b) => Array.from({ length: n }, (_, i) => a + (b - a) * (i + 0.25 + r() * 0.5) / n);
const INK = '#6d2f12';
const GOLD = '#e3a23a';
const RED = '#b8321a';

function figure(g, x, y, s, scarf = true, col = RED) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = col; g.strokeStyle = INK; g.lineWidth = 2 / s;
  g.beginPath(); g.moveTo(-14, 0); g.lineTo(-8, -42); g.lineTo(8, -42); g.lineTo(14, 0); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(0, -52, 8, 11, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.ellipse(0, -51, 4.5, 6, 0, 0, 7); g.fill();
  if (scarf) {
    g.strokeStyle = GOLD; g.lineWidth = 3 / s; g.beginPath(); g.moveTo(-6, -40);
    g.bezierCurveTo(-30, -44, -34, -30, -58, -38); g.stroke();
  }
  g.restore();
}
function sun(g, x, y, r, rays = 16, col = GOLD) {
  g.save(); g.translate(x, y); g.strokeStyle = INK; g.fillStyle = col; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.stroke();
  for (let i = 0; i < rays; i++) { const a = i / rays * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25); g.lineTo(Math.cos(a) * r * (i % 2 ? 1.7 : 2.1), Math.sin(a) * r * (i % 2 ? 1.7 : 2.1)); g.stroke(); }
  g.restore();
}
function mountain(g, x, y, w, h) {
  g.save(); g.strokeStyle = INK; g.fillStyle = '#9d6a45'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x - w * 0.08, y - h); g.lineTo(x, y - h * 0.9); g.lineTo(x + w * 0.08, y - h); g.lineTo(x + w / 2, y); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = GOLD; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y - h * 0.9); g.lineTo(x, y - h * 1.35); g.stroke();
  g.restore();
}
function cloth(g, x, y, len, amp, col = RED, w = 7) {
  g.save(); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
  for (let i = 0; i <= 40; i++) { const t = i / 40; const px = x + t * len, py = y + Math.sin(t * 9) * amp * (0.3 + t); i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.stroke(); g.strokeStyle = GOLD; g.lineWidth = 1.5; g.setLineDash([6, 8]); g.stroke(); g.restore();
}
function tower(g, x, y, w, h) {
  g.save(); g.fillStyle = '#c28a55'; g.strokeStyle = INK; g.lineWidth = 2.5;
  let cy = y, cw = w;
  for (let i = 0; i < 3; i++) { const ch = h * [0.5, 0.3, 0.2][i]; g.fillRect(x - cw / 2, cy - ch, cw, ch); g.strokeRect(x - cw / 2, cy - ch, cw, ch); cy -= ch; cw *= 0.72; }
  g.beginPath(); g.moveTo(x - cw / 2, cy); g.lineTo(x, cy - w * 0.4); g.lineTo(x + cw / 2, cy); g.closePath(); g.fillStyle = GOLD; g.fill(); g.stroke();
  g.restore();
}
function spikes(g, x, y, r, n, col = INK) {
  g.save(); g.strokeStyle = col; g.lineWidth = 3;
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + 0.3; g.beginPath(); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r * 2.4, y + Math.sin(a) * r * 2.4); g.stroke(); }
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = '#2a1008'; g.fill(); g.stroke(); g.restore();
}
function ground(g, W, y) {
  g.save(); g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.06, y);
  for (let i = 0; i <= 40; i++) g.lineTo(W * 0.06 + (W * 0.88) * i / 40, y + Math.sin(i * 0.6) * 6); g.stroke(); g.restore();
}

const MURALS = [
  // 1: a procession of travelers toward the mountain
  (g, W, H, r) => [
    () => sun(g, W * (0.4 + r() * 0.2), H * 0.2, H * (0.06 + r() * 0.02), 12 + 4 * ((r() * 3) | 0)),
    () => mountain(g, W * 0.5, H * 0.62, W * (0.3 + r() * 0.1), H * (0.3 + r() * 0.08)),
    () => ground(g, W, H * 0.66),
    ...[...spread(r, 2 + ((r() * 3) | 0), 0.1, 0.38), ...spread(r, 2 + ((r() * 3) | 0), 0.62, 0.9)].map((u, i) => () => figure(g, W * u, H * 0.8 + (i % 2) * 8, 1.35 + (i % 3) * 0.1)),
    () => cloth(g, W * 0.1, H * 0.46, W * 0.3, 18),
    () => cloth(g, W * 0.6, H * 0.5, W * 0.3, 18),
  ],
  // 2: a thriving city, cloth powering everything
  (g, W, H, r) => [
    () => sun(g, W * (0.35 + r() * 0.3), H * 0.16, H * 0.06, 24),
    ...spread(r, 4 + ((r() * 3) | 0), 0.1, 0.9).map((u, i) => { const w = 50 + r() * 28, h = 130 + r() * 120; return () => tower(g, W * u, H * 0.7, w, h); }),
    () => ground(g, W, H * 0.72),
    () => cloth(g, W * 0.12, H * 0.38, W * 0.76, 26, RED, 9),
    () => cloth(g, W * 0.1, H * 0.46, W * 0.8, -22, RED, 7),
    ...[0.22, 0.4, 0.58, 0.78].map((u) => () => figure(g, W * u, H * 0.86, 1.3)),
  ],
  // 3: war and ruin
  (g, W, H, r) => [
    () => spikes(g, W * (0.4 + r() * 0.2), H * 0.2, H * 0.055, 16 + ((r() * 8) | 0)),
    ...spread(r, 3 + ((r() * 3) | 0), 0.12, 0.88).map((u) => { const a = (r() - 0.5) * 0.5, h = 110 + r() * 50; return () => { g.save(); g.translate(W * u, H * 0.7); g.rotate(a); tower(g, 0, 0, 52, h); g.restore(); }; }),
    () => ground(g, W, H * 0.72),
    () => { g.save(); g.strokeStyle = INK; g.lineWidth = 4; for (let i = 0; i < 12; i++) { const x = W * (0.12 + i * 0.07); g.beginPath(); g.moveTo(x, H * 0.36 + (i % 3) * 20); g.lineTo(x + 24, H * 0.6 + (i % 4) * 14); g.stroke(); } g.restore(); },
    ...[0.3, 0.5, 0.7].map((u, i) => () => { g.save(); g.translate(W * u, H * 0.88); g.rotate(i === 1 ? 1.4 : -0.3); figure(g, 0, 0, 1.2, false, '#7a3a28'); g.restore(); }),
    () => cloth(g, W * 0.2, H * 0.52, W * 0.6, 12, '#7a7a7a', 6),
  ],
  // 4: one traveler, the long climb
  (g, W, H, r) => [
    () => mountain(g, W * 0.62, H * 0.82, W * (0.5 + r() * 0.1), H * (0.56 + r() * 0.1)),
    () => sun(g, W * (0.12 + r() * 0.12), H * 0.2, H * 0.05, 12),
    () => ground(g, W, H * 0.86),
    ...spread(r, 2 + ((r() * 4) | 0), 0.06, 0.36).map((u) => () => figure(g, W * u, H * 0.93, 1.0, false, '#c9a89a')),
    () => figure(g, W * 0.46, H * 0.9, 1.6),
    () => { g.save(); g.strokeStyle = GOLD; g.lineWidth = 4; g.setLineDash([2, 12]); g.beginPath(); g.moveTo(W * 0.5, H * 0.82); g.bezierCurveTo(W * 0.56, H * 0.6, W * 0.7, H * 0.5, W * 0.62, H * 0.3); g.stroke(); g.restore(); },
  ],
];

export function drawMural(canvas, index, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const scale = Math.min(W / 1280, H / 720) * 1.15;
  // frame
  g.save();
  g.translate(W / 2, H / 2); g.scale(scale, scale); g.translate(-640, -360);
  const w = 1280, h = 720;
  g.strokeStyle = INK; g.lineWidth = 3; g.globalAlpha = 0.5;
  g.strokeRect(140, 70, w - 280, h - 140); g.strokeRect(152, 82, w - 304, h - 164);
  g.globalAlpha = 1;
  g.beginPath(); g.rect(152, 82, w - 304, h - 164); g.clip();
  g.translate(152, 82);
  const items = MURALS[index % MURALS.length](g, w - 304, h - 164, rngFor('mural' + index));
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.min(1, t * (n + 2) - i));
    if (a <= 0) continue;
    g.globalAlpha = a;
    g.save(); g.translate(0, (1 - a) * 14); items[i](); g.restore();
  }
  g.restore();
}
