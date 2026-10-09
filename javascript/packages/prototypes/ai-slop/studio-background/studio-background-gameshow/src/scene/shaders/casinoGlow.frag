// Glow sprites of the distant casino, drawn additively over the hall (see casinoGlow.vert).

uniform float uTime;
uniform float uLife;
uniform float uExposure;
uniform float uHazeDensity;

varying vec2 vCorner;
varying vec3 vColor;
varying vec3 vInfo;
varying float vDistance;
varying vec3 vCenter;

// @common

void main() {
  float kind = vInfo.x;
  float mode = vInfo.y;
  float seed = vInfo.z;
  float r2 = dot(vCorner, vCorner);
  float shape;
  if (kind < 0.5) {
    // Halo: a soft wide glow round a bright core.
    shape = exp(-r2 * 5.0) * 0.6 + exp(-r2 * 40.0);
    shape *= 1.0 - smoothstep(0.8, 1.0, r2);
  } else if (kind < 1.5) {
    // Shaft: bright under the lamp, fading to the floor and to the edges.
    float t = vCorner.y * 0.5 + 0.5;
    float edge = 1.0 - smoothstep(0.2, 1.0, abs(vCorner.x));
    float drift = 0.75 + 0.25 * noised(vec2(vCorner.x * 2.0 + seed * 10.0, t * 3.0 + uTime * 0.15 * uLife)).x;
    shape = edge * t * t * drift;
  } else if (kind < 2.5) {
    // Star glint on a crystal: two thin rays, flashing on its own rhythm.
    float rays = exp(-abs(vCorner.x) * 40.0) * exp(-vCorner.y * vCorner.y * 4.0)
      + exp(-abs(vCorner.y) * 40.0) * exp(-vCorner.x * vCorner.x * 4.0);
    float clock = fract(uTime * (0.15 + seed * 0.25) * uLife + seed * 9.0);
    float flash = smoothstep(0.0, 0.08, clock) * (1.0 - smoothstep(0.08, 0.3, clock));
    shape = (rays + exp(-r2 * 30.0)) * flash;
  } else {
    // Haze cloud: noise drifting slowly through a round soft sprite.
    vec2 q = vCorner * 1.5 + vec2(uTime * 0.02 * uLife + seed * 7.0, seed * 3.0);
    float density = noised(q).x * 0.6 + noised(q * 2.3 + 4.0).x * 0.4;
    shape = density * exp(-r2 * 2.5);
  }
  float strength = 1.0;
  if (mode > 1.5 && mode < 2.5) {
    strength = mix(1.0, 0.85 + 0.25 * noised(vec2(uTime * 6.0, seed * 50.0)).x, uLife);
  } else if (mode > 0.5 && mode < 1.5) {
    strength = 1.0 + uLife * 0.08 * sin(uTime * (0.5 + seed) + seed * 30.0);
  }
  float haze = exp(-vDistance * uHazeDensity * 0.6);
  vec3 color = vColor * shape * strength * haze * uExposure;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
