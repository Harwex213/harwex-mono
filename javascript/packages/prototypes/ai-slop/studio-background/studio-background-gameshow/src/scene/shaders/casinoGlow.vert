// Camera-facing glow sprites of the distant casino (casinoDistant.ts): halos round every lamp,
// light shafts under the chandeliers, star glints on the crystals and slow haze clouds.
// A sprite never gets smaller than a pixel or two on screen: a far bulb then reads as a soft point
// of light (bokeh) with the same total energy, instead of shimmering on and off.

// rgb: colour times strength, w: size.
attribute vec4 aGlow;
// x: kind, y: glow mode, z: seed, w: shaft length.
attribute vec4 aGlowInfo;
attribute vec2 aCorner;

uniform vec3 uCameraLocal;
uniform float uPixelAngle;

varying vec2 vCorner;
varying vec3 vColor;
varying vec3 vInfo;
varying float vDistance;
varying vec3 vCenter;

void main() {
  vec3 center = position;
  vec3 toCamera = uCameraLocal - center;
  float dist = length(toCamera);
  vec3 forward = toCamera / dist;
  vec3 side = cross(vec3(0.0, 1.0, 0.0), forward);
  side = length(side) > 1e-3 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  vec3 up = cross(forward, side);
  float kind = aGlowInfo.x;
  float size = aGlow.w;
  vec3 color = aGlow.rgb;
  vec3 p;
  if (kind > 0.5 && kind < 1.5) {
    // Shaft: wider at the bottom, hanging from the lamp.
    float t = aCorner.y * 0.5 + 0.5;
    float width = size * mix(1.0, 0.3, t);
    p = center + side * aCorner.x * width + vec3(0.0, (t - 1.0) * aGlowInfo.w, 0.0);
  } else {
    float minimum = dist * uPixelAngle * 2.5;
    float grown = max(size, minimum);
    color *= (size * size) / (grown * grown);
    // A haze cloud fades out before the camera reaches it.
    if (kind > 2.5) {
      color *= smoothstep(0.6 * size, 1.5 * size, dist);
    }
    p = center + (side * aCorner.x + up * aCorner.y) * grown;
    // Pull the sprite a little towards the camera, so the lamp's own wall does not cut it in half.
    p += forward * min(grown * 0.9, dist * 0.3);
  }
  vCorner = aCorner;
  vColor = color;
  vInfo = aGlowInfo.xyz;
  vDistance = dist;
  vCenter = center;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
