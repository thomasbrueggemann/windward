import * as THREE from 'three';
import { MOUNTAIN, summitPoint } from './heightfield.js';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */`
precision highp float;
uniform vec3 uTop, uHor, uSunDir, uSunColor, uGround;
uniform float uTime, uSunI, uDusk, uOvercast;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 1.7; a *= .5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 L = normalize(uSunDir);
  float sd = max(dot(d, L), 0.);
  // sky gradient, a bright haze band hugging the horizon, and a warmer side toward the sun
  float t = smoothstep(-0.02, 0.55, h);
  vec3 col = mix(uHor, uTop, pow(t, 0.55));
  float band = exp(-abs(h) * 18.);
  col += uHor * band * 0.22;
  float toward = 0.5 + 0.5 * dot(normalize(d.xz + 1e-4), normalize(L.xz + 1e-4));
  col = mix(col, col * vec3(1.06, 0.98, 0.9), toward * (1. - t) * 0.6);
  col = mix(col, uGround, smoothstep(0.0, -0.22, h));
  // sun: hard disc, soft corona, broad atmospheric glow (dimmed by overcast)
  float disc = smoothstep(0.99955, 0.99975, sd);
  float sunVis = 1. - 0.85 * uOvercast;
  col += uSunColor * (disc * 9. * uSunI * 0.35 * sunVis + pow(sd, 220.) * 1.2 * sunVis + pow(sd, 22.) * 0.34 + pow(sd, 5.) * 0.1)
         * (0.6 + 0.4 * smoothstep(0.6, 0., h));
  // clouds: long cirrus streaks high up, soft banks low on the horizon
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.16);
    float c = fbm(vec2(uv.x * 0.5, uv.y * 2.4) + vec2(uTime * 0.004, 0.));
    c = smoothstep(0.52 - 0.2 * uOvercast, 0.86, c) * smoothstep(0.0, 0.22, h) * (1. - smoothstep(0.55, 0.95, h));
    vec3 cloudCol = uHor * 1.08 + uSunColor * 0.35 * pow(sd, 3.);
    col = mix(col, cloudCol, c * (0.42 + 0.3 * uOvercast));
    vec2 uv2 = d.xz / (h + 0.05);
    float lowC = fbm(uv2 * 0.35 + vec2(uTime * 0.002, 7.3));
    lowC = smoothstep(0.48, 0.78, lowC) * exp(-h * 14.) * smoothstep(0.0, 0.015, h);
    vec3 lit = mix(uHor * 0.96, uHor * 1.2 + uSunColor * 0.25, pow(sd, 2.));
    col = mix(col, lit, lowC * 0.55);
  }
  // overcast whitens and flattens everything
  col = mix(col, mix(uHor, uTop, 0.35) * 1.03, uOvercast * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSky() {
  const u = {
    uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    uTime: { value: 0 }, uSunI: { value: 1 }, uDusk: { value: 0 }, uOvercast: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms: u };
}

// ---------------------------------------------------------------- crevice glow
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.12, 'rgba(255,244,214,0.75)');
  gr.addColorStop(0.4, 'rgba(255,214,150,0.22)');
  gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The light that splits the mountain's summit — visible from the very first step. */
export function makeSummitLight() {
  const s = summitPoint();
  const group = new THREE.Group();
  group.position.set(s.x, s.y, s.z);
  const tex = radialTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(3.2, 2.5, 1.5), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  glow.scale.set(260, 260, 1);
  group.add(glow);
  const glow2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.5, 1.4, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  glow2.scale.set(740, 740, 1);
  group.add(glow2);
  // beam of light rising from the cleft
  const bc = document.createElement('canvas'); bc.width = 64; bc.height = 256;
  const bg = bc.getContext('2d');
  const lg = bg.createLinearGradient(0, 256, 0, 0);
  lg.addColorStop(0, 'rgba(255,240,200,0.9)'); lg.addColorStop(0.5, 'rgba(255,230,170,0.25)'); lg.addColorStop(1, 'rgba(255,230,170,0)');
  bg.fillStyle = lg; bg.fillRect(0, 0, 64, 256);
  const hg = bg.createLinearGradient(0, 0, 64, 0);
  bg.globalCompositeOperation = 'destination-in';
  hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
  bg.fillStyle = hg; bg.fillRect(0, 0, 64, 256);
  const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace;
  const beamMat = new THREE.MeshBasicMaterial({ map: btex, color: new THREE.Color(2.2, 1.8, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(70, 900), beamMat);
  beam.position.y = 450;
  beam.userData.billboardY = true;
  group.add(beam);
  group.userData.update = (camera, intensity) => {
    // keep the beam facing the camera around the vertical axis
    const dx = camera.position.x - group.position.x, dz = camera.position.z - group.position.z;
    beam.rotation.y = Math.atan2(dx, dz);
    glow.material.opacity = glow2.material.opacity = beamMat.opacity = intensity;
  };
  return group;
}
