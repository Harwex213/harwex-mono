// Casino panorama (casinoPanorama.ts): one photo of a casino hall on a far cylinder sector.
// The photo is looked up by the view direction from a fixed centre, like the city (city.frag), so it never
// stretches from any viewpoint. The effect mask marks what lives:
// R = crystal of the chandeliers (twinkle and star glints), G = warm lamps and candles (flicker),
// B = slot machine screens (colour cycling and flashes).
// Haze drifts slowly through the hall, faint shafts fall from the chandeliers, and a soft blur reads as distance.

uniform sampler2D uPhoto;
uniform sampler2D uFx;
uniform vec2 uSize;
uniform vec3 uCenter;
uniform float uAzimuthLeft;
uniform float uRadiansPerPixel;
uniform float uHorizon;
uniform float uTime;
uniform float uExposure;
uniform vec3 uHazeColor;

varying vec3 vWorld;

// @common

// A soft roll-off keeps the photo under the bloom threshold; only the glints go past it.
vec3 photoGrade(vec3 c) {
  c *= uExposure;
  return c / (1.0 + c * 0.45);
}

// Rotates a colour about the grey axis.
vec3 hueShift(vec3 c, float angle) {
  const vec3 k = vec3(0.57735);
  float cosA = cos(angle);
  return c * cosA + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cosA);
}

vec3 hall(vec2 st, vec2 gradX, vec2 gradY) {
  vec2 uv = clamp(st, vec2(0.0), vec2(1.0));
  // A little softer than the screen pixel, and a wider blur mixed in: the hall reads as far away.
  vec3 photo = textureGrad(uPhoto, uv, gradX * 1.4, gradY * 1.4).rgb;
  vec3 blurred = textureGrad(uPhoto, uv, gradX * 5.0, gradY * 5.0).rgb;
  photo = mix(photo, blurred, 0.2);
  vec3 fx = textureGrad(uFx, uv, gradX, gradY).rgb;
  vec2 pixel = uv * uSize;

  // Candles and lamps flicker, each cell on its own rhythm.
  vec2 lampCell = floor(pixel / 6.0);
  float flame = 0.86 + 0.14 * noised(vec2(uTime * 2.3 + hash12(lampCell) * 40.0, hash12(lampCell + 3.0) * 9.0)).x;
  photo *= mix(1.0, flame, fx.g);

  // Slot screens: the colour cycles slowly, and now and then a screen flashes bright.
  vec2 screenCell = floor(pixel / vec2(5.0, 7.0));
  float phase = hash12(screenCell) * 6.28;
  vec3 cycled = hueShift(photo, sin(uTime * 0.7 + phase) * 1.2);
  float flash = smoothstep(0.92, 1.0, sin(uTime * (0.5 + hash12(screenCell + 9.0)) + phase));
  photo = mix(photo, cycled * (1.0 + 0.8 * flash), fx.b);

  // Crystal: facets twinkle, and a few throw a short star glint.
  vec2 crystalCell = floor(pixel / 2.0);
  float rate = 1.5 + hash12(crystalCell) * 3.0;
  float twinkle = 0.6 + 0.4 * sin(uTime * rate + hash12(crystalCell + 7.0) * 6.28);
  float sparkle = smoothstep(0.985, 1.0, sin(uTime * rate * 0.37 + hash12(crystalCell + 2.0) * 6.28)) * step(0.7, hash12(crystalCell + 5.0));
  vec3 color = photoGrade(photo * mix(1.0, twinkle, fx.r));
  color += vec3(1.0, 0.92, 0.8) * sparkle * fx.r * 1.6;
  return color;
}

void main() {
  vec3 d = vWorld - uCenter;
  float azimuth = atan(d.z, d.x);
  float elevation = atan(d.y, length(d.xz));
  vec2 span = uRadiansPerPixel * uSize;
  vec2 st = vec2((azimuth - uAzimuthLeft) / span.x, uHorizon + elevation / span.y);
  vec2 gradX = dFdx(st);
  vec2 gradY = dFdy(st);
  // Past a side end of the photo the hall runs on as its mirror image, dimmer: an edge row stretched sideways
  // would show as streaks.
  float side = max(max(-st.x, st.x - 1.0), 0.0);
  vec2 mirrored = vec2(st.x < 0.0 ? -st.x : (st.x > 1.0 ? 2.0 - st.x : st.x), st.y);
  vec3 color = hall(mirrored, gradX, gradY) * mix(1.0, 0.45, smoothstep(0.0, 0.06, side));

  // Up into the ceiling and down below the gallery the hall fades into darkness.
  float outside = max(st.y - 1.0, 0.0) * span.y * 0.7 + max(-st.y, 0.0) * span.y + max(side - 0.3, 0.0) * span.x;
  color *= exp(-outside * 9.0);

  // Haze: it thickens towards the floor line under the horizon (the seam behind the balustrade) and drifts slowly.
  vec2 hazeCoord = vec2(azimuth * 6.0 + uTime * 0.02, elevation * 9.0 - uTime * 0.008);
  float drift = noised(hazeCoord).x * 0.6 + noised(hazeCoord * 2.3 + 4.0).x * 0.4;
  float low = smoothstep(-0.02, -0.16, elevation);
  float band = exp(-abs(elevation - 0.03) * 9.0);
  color = mix(color, uHazeColor, clamp(low * 0.85 + band * drift * 0.25, 0.0, 0.92));

  // Faint shafts fall from high up, slanted a little, each breathing slowly.
  float shaftCoord = azimuth * 22.0 + elevation * 3.0;
  float shaft = smoothstep(0.55, 1.0, noised(vec2(shaftCoord, uTime * 0.05)).x) * smoothstep(0.0, 0.25, elevation) * smoothstep(0.5, 0.2, elevation);
  color += vec3(0.05, 0.035, 0.02) * shaft;

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
