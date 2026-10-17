import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Screen-space light shafts: march from each pixel toward the sun's screen position and gather the brightest
 * (sky) pixels, so dunes, columns and arches cut visible rays out of the haze. Runs on the linear HDR buffer.
 */
export function makeGodRaysPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uStrength: { value: 0 },
      uColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uThreshold: { value: 1.25 },
      uAspect: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2 uSun; uniform float uStrength, uThreshold, uAspect; uniform vec3 uColor;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        if (uStrength <= 0.001) { gl_FragColor = base; return; }
        const int N = 36;
        vec2 delta = (uSun - vUv) / float(N) * 0.92;
        vec2 uv = vUv + delta * hash(vUv * 731.7);       // jitter hides banding
        float decay = 1.0, acc = 0.0;
        for (int i = 0; i < N; i++) {
          uv += delta;
          vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          acc += smoothstep(uThreshold, uThreshold * 2.2, l) * decay;
          decay *= 0.955;
        }
        acc /= float(N);
        // fade with distance from the sun on screen
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        float fall = 1.0 / (1.0 + dot(d, d) * 2.5);
        gl_FragColor = vec4(base.rgb + uColor * acc * uStrength * fall * 2.6, base.a);
      }`,
  });
}

/** Display-space grade: saturation, gentle S-curve, warm/cool split toning, vignette and film grain. */
export function makeGradePass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uSat: { value: 1.12 },
      uContrast: { value: 1.06 },
      uVignette: { value: 0.32 },
      uVigColor: { value: new THREE.Color(0.42, 0.24, 0.16) },
      uShadowTint: { value: new THREE.Color(0.0, 0.0, 0.03) },
      uHighTint: { value: new THREE.Color(0.02, 0.01, -0.01) },
      uGrain: { value: 0.025 },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float uTime, uSat, uContrast, uVignette, uGrain, uFade;
      uniform vec3 uVigColor, uShadowTint, uHighTint, uFadeColor;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
        c += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighTint * smoothstep(0.5, 1.0, l);
        vec2 q = vUv - 0.5;
        float v = smoothstep(0.85, 0.2, length(q * vec2(1.0, 0.82)));
        c *= mix(vec3(1.0), mix(uVigColor, vec3(1.0), v), uVignette);
        c += (hash(vUv * 1000.0 + fract(uTime * 7.31)) - 0.5) * uGrain;
        c = mix(c, uFadeColor, uFade);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
