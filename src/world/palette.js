import * as THREE from 'three';
import { clamp } from './heightfield.js';

// Colour script of the pilgrimage: golden desert -> amber ruins -> blue depths -> pale snow -> white.
const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

const KEYS = [
  { p: 0.00, top: C('#3f84c4'), hor: C('#ffd9a2'), fog: C('#f6c99b'), fogD: 0.00046, lit: C('#ffb44a'), hi: C('#fff0b8'), shade: C('#5a1208'),
    rim: C('#ffe6b8'), sunC: C('#fff1d6'), sunI: 3.2, sun: V(-0.72, 0.22, -0.55), snow: 0, glit: C('#fff4d8'), amb: C('#7fa4d6'), grd: C('#c88a52'), cave: 0, dust: 0.5, exp: 0.85, bloom: 0.28, rays: 0.35 },
  { p: 0.20, top: C('#4a86bd'), hor: C('#ffcf90'), fog: C('#f4bd8a'), fogD: 0.00050, lit: C('#ffa63d'), hi: C('#ffe7a8'), shade: C('#68180f'),
    rim: C('#ffdca4'), sunC: C('#ffe8c0'), sunI: 3.0, sun: V(-0.55, 0.30, -0.78), snow: 0, glit: C('#ffeccc'), amb: C('#7a9fcf'), grd: C('#c07a46'), cave: 0, dust: 0.55, exp: 1.0, bloom: 0.38, rays: 0.45 },
  { p: 0.33, top: C('#5a6aa6'), hor: C('#ff9d56'), fog: C('#ec9560'), fogD: 0.00058, lit: C('#ff8a32'), hi: C('#ffd18a'), shade: C('#561029'),
    rim: C('#ffc88c'), sunC: C('#ffc890'), sunI: 3.0, sun: V(-0.30, 0.16, -0.94), snow: 0, glit: C('#ffd8a8'), amb: C('#8878b8'), grd: C('#b05a3c'), cave: 0, dust: 0.65, exp: 1.0, bloom: 0.45, rays: 0.8 },
  { p: 0.45, top: C('#48437f'), hor: C('#ff7f4a'), fog: C('#d9704f'), fogD: 0.00066, lit: C('#ff7430'), hi: C('#ffc07a'), shade: C('#400b2c'),
    rim: C('#ffb27c'), sunC: C('#ffae78'), sunI: 2.8, sun: V(-0.18, 0.09, -0.97), snow: 0, glit: C('#ffc89a'), amb: C('#7a5ea8'), grd: C('#9a4838'), cave: 0, dust: 0.7, exp: 1.0, bloom: 0.5, rays: 1.0 },
  { p: 0.52, top: C('#1f2c5c'), hor: C('#c06a7a'), fog: C('#6f4f78'), fogD: 0.0012, lit: C('#d98a78'), hi: C('#ffcfa0'), shade: C('#1b1440'),
    rim: C('#d8a0b0'), sunC: C('#ffc8a0'), sunI: 2.4, sun: V(-0.1, 0.5, -0.5), snow: 0, glit: C('#ffd2b8'), amb: C('#5a62a8'), grd: C('#503e68'), cave: 0.5, dust: 0.6, exp: 0.95, bloom: 0.55, rays: 0.6 },
  { p: 0.58, top: C('#050d1f'), hor: C('#1a4a70'), fog: C('#0f2f4e'), fogD: 0.0030, lit: C('#1f5878'), hi: C('#4fa0bf'), shade: C('#040a24'),
    rim: C('#4f9ab5'), sunC: C('#ffd696'), sunI: 3.6, sun: V(-0.22, 0.92, -0.25), snow: 0, glit: C('#b8ecff'), amb: C('#2c5c9c'), grd: C('#1a3c5c'), cave: 1, dust: 0.85, exp: 1.05, bloom: 0.7, rays: 0.5 },
  { p: 0.68, top: C('#040a1a'), hor: C('#174468'), fog: C('#0d2a48'), fogD: 0.0034, lit: C('#1c5272'), hi: C('#4a98b8'), shade: C('#030920'),
    rim: C('#4a94b0'), sunC: C('#ffd090'), sunI: 3.6, sun: V(0.2, 0.9, -0.3), snow: 0, glit: C('#a8e4ff'), amb: C('#2a5898'), grd: C('#183858'), cave: 1, dust: 0.9, exp: 1.05, bloom: 0.75, rays: 0.5 },
  { p: 0.76, top: C('#2a4f86'), hor: C('#a6c3d8'), fog: C('#8aa8c4'), fogD: 0.0007, lit: C('#cfe0f0'), hi: C('#ffffff'), shade: C('#3d5690'),
    rim: C('#e8f2ff'), sunC: C('#fff1dc'), sunI: 2.4, sun: V(-0.4, 0.34, -0.85), snow: 0.7, glit: C('#ffffff'), amb: C('#8aa8d8'), grd: C('#9ab0c8'), cave: 0.2, dust: 1.0, exp: 0.9, bloom: 0.5, rays: 0.7 },
  { p: 0.86, top: C('#4a6a98'), hor: C('#cfdeea'), fog: C('#b9c9da'), fogD: 0.0009, lit: C('#dce7f3'), hi: C('#ffffff'), shade: C('#4a62a0'),
    rim: C('#ffffff'), sunC: C('#fff6ea'), sunI: 2.0, sun: V(-0.55, 0.22, -0.8), snow: 1, glit: C('#ffffff'), amb: C('#a8bce0'), grd: C('#b8c8dc'), cave: 0, dust: 1.2, exp: 0.86, bloom: 0.6, rays: 0.5 },
  { p: 1.00, top: C('#b8c8dc'), hor: C('#e8eef6'), fog: C('#e2e9f2'), fogD: 0.0030, lit: C('#f4f8fd'), hi: C('#ffffff'), shade: C('#8fa2c4'),
    rim: C('#ffffff'), sunC: C('#ffffff'), sunI: 1.6, sun: V(-0.4, 0.3, -0.85), snow: 1, glit: C('#ffffff'), amb: C('#c4d2e8'), grd: C('#d0dbea'), cave: 0, dust: 1.4, exp: 1.0, bloom: 0.7, rays: 0.3 },
];

const COLOR_FIELDS = ['top', 'hor', 'fog', 'lit', 'hi', 'shade', 'rim', 'sunC', 'glit', 'amb', 'grd'];
const NUM_FIELDS = ['fogD', 'sunI', 'snow', 'cave', 'dust', 'exp', 'bloom', 'rays'];

/** Reusable palette state; `samplePalette` fills it in-place. */
export const palette = (() => {
  const o = { sun: new THREE.Vector3() };
  for (const f of COLOR_FIELDS) o[f] = new THREE.Color();
  for (const f of NUM_FIELDS) o[f] = 0;
  return o;
})();

export function samplePalette(p) {
  p = clamp(p, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = clamp((p - a.p) / (b.p - a.p), 0, 1);
  t = t * t * (3 - 2 * t);
  for (const f of COLOR_FIELDS) palette[f].copy(a[f]).lerp(b[f], t);
  for (const f of NUM_FIELDS) palette[f] = a[f] + (b[f] - a[f]) * t;
  palette.sun.copy(a.sun).lerp(b.sun, t).normalize();
  return palette;
}
