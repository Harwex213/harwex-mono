// Casino emitters (casinoShading.ts). `vFx.x` is the kind, `vFx.y` a phase in 0..1 for each emitter:
// 0 steady glow, 1 candle flame (flicker), 2 crystal (twinkle and rare star glints),
// 3 slot screen (the reels picture, its colour cycling, now and then a flash), 4 bar shelves (the bar photo),
// 5 night window (deep blue glass, a little lighter at the top).
// Everything depends on `uTime` only, so `?t=` freezes it.

uniform float uTime;
uniform sampler2D uScreen;
uniform sampler2D uBar;

varying vec3 vColor;
varying vec2 vFx;
varying vec2 vUv;
varying float vDistance;

float glowHash(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

float glowNoise(float x) {
  float i = floor(x);
  float t = fract(x);
  float s = t * t * (3.0 - 2.0 * t);
  return mix(glowHash(i), glowHash(i + 1.0), s);
}

// Rotates a colour about the grey axis.
vec3 hueShift(vec3 c, float angle) {
  const vec3 k = vec3(0.57735);
  float cosA = cos(angle);
  return c * cosA + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cosA);
}

void main() {
  float kind = vFx.x;
  float phase = vFx.y;
  // Both pictures are read for every fragment: texture reads stay out of branches.
  vec3 screen = texture2D(uScreen, vUv).rgb;
  vec3 bar = texture2D(uBar, vUv).rgb;
  vec3 color = vColor;

  if (kind > 0.5 && kind < 1.5) {
    float flicker = 0.78 + 0.22 * glowNoise(uTime * 7.0 + phase * 91.0) * glowNoise(uTime * 2.3 + phase * 37.0 + 5.0);
    color *= flicker / 0.9;
  } else if (kind > 1.5 && kind < 2.5) {
    float rate = 1.2 + phase * 2.6;
    float twinkle = 0.62 + 0.38 * sin(uTime * rate + phase * 61.0);
    float glint = smoothstep(0.97, 1.0, sin(uTime * rate * 0.31 + phase * 113.0)) * step(0.75, fract(phase * 7.31));
    color = color * twinkle + vec3(1.0, 0.93, 0.82) * glint * 3.0;
  } else if (kind > 2.5 && kind < 3.5) {
    vec3 cycled = hueShift(screen * vColor, sin(uTime * 0.6 + phase * 6.28) * 1.4 + phase * 3.0);
    float flash = smoothstep(0.93, 1.0, sin(uTime * (0.4 + phase * 0.5) + phase * 40.0));
    color = max(cycled, vec3(0.0)) * (1.0 + 1.2 * flash);
  } else if (kind > 3.5 && kind < 4.5) {
    float shimmer = 0.92 + 0.08 * glowNoise(uTime * 1.5 + vUv.x * 12.0);
    color = bar * vColor * shimmer;
  } else if (kind > 4.5) {
    float star = step(0.995, glowHash(floor(vUv.x * 60.0) * 7.0 + floor(vUv.y * 90.0) * 131.0));
    color = vColor * mix(0.6, 1.2, vUv.y) + vec3(0.5, 0.55, 0.7) * star * 0.25;
  }

  // A light warm depth haze far away: it never reaches the near hall.
  float haze = (1.0 - exp(-max(vDistance - 55.0, 0.0) * 0.012)) * 0.35;
  color = mix(color, vec3(0.10, 0.06, 0.03), haze);
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
