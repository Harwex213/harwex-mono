// Distant city panorama painted on a huge cylinder far behind the arches.
// At 400 m the camera's few meters of swing and dolly barely change the city, as in reality.
// Everything is resolved per view direction from the cylinder center, so nothing turns
// with the camera. One photo holds the city and its sky (scripts/build-skyline.py): the city
// lights live (see cityLights.frag); the sky slowly billows in place, away from the towers.
// The water below the shoreline is a separate mesh with its own shader (water.frag).

// Animated photo from the city lights pass.
uniform sampler2D uLive;
// White where the photo shows sky.
uniform sampler2D uSkyMask;
uniform vec2 uMapSize;
uniform float uTime;
uniform vec3 uCenter;
uniform float uPeriod;
uniform float uShore;
uniform float uSkylineHeight;
uniform float uExposure;
uniform vec3 uHazeColor;

varying vec3 vWorld;

// @common

// Searchlights sweeping the sky from two points of the skyline.
float searchlights(vec2 tile) {
  float light = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 origin = vec2(i == 0 ? 0.2 : 0.68, 0.29);
    float angle = 0.35 * sin(uTime * (0.21 + float(i) * 0.07) + float(i) * 2.0);
    vec2 dir = vec2(sin(angle), cos(angle));
    // The tile is wide: measure in square pixels so the beam keeps its width.
    // The horizontal distance wraps around the tile, so a beam crossing a tile seam stays whole.
    vec2 delta = vec2(fract(tile.x - origin.x + 0.5) - 0.5, tile.y - origin.y);
    vec2 rel = delta * uMapSize / uMapSize.y;
    float along = dot(rel, dir);
    float across = abs(rel.x * dir.y - rel.y * dir.x);
    // Behind the origin the beam is off. Clamp first: 0 * exp(+huge) would be NaN.
    float ahead = max(along, 0.0);
    light += step(0.0, along) * exp(-across / (0.012 + ahead * 0.05)) * exp(-ahead * 1.4);
  }
  return light;
}

// Keeps the photo's own look: full colour, a gentle roll-off on the brightest lights.
vec3 photoGrade(vec3 c) {
  c *= uExposure;
  return c / (1.0 + c * 0.3);
}

vec3 cityColor(vec2 st, vec2 gradX, vec2 gradY) {
  // Above the photo the sky continues as its mirror: the top rows hold only stars.
  float v = st.y <= 1.0 ? st.y : 2.0 - st.y;
  vec2 base = vec2(st.x, clamp(v, 0.0, 1.0));

  // The sky billows in place: a slow, bounded warp of a few texels. It acts only well inside the
  // sky (blurred mask) and above the rooftops, so the towers and their glow never move.
  float skyInside = smoothstep(0.85, 1.0, textureGrad(uSkyMask, base, gradX * 24.0, gradY * 24.0).r);
  float warpWeight = skyInside * smoothstep(0.42, 0.6, v);
  vec2 p = base * vec2(5.0, 3.0);
  vec2 warp = vec2(noised(p + vec2(uTime * 0.018, 3.1)).x, noised(p + vec2(17.0, -uTime * 0.014)).x) - 0.5;
  vec2 uv = base + warp * vec2(14.0, 8.0) / uMapSize * warpWeight;
  vec3 photo = textureGrad(uLive, uv, gradX, gradY).rgb;

  // Stars: points brighter than their blurred surroundings, each on its own rhythm.
  float skyMask = textureGrad(uSkyMask, base, gradX, gradY).r;
  vec3 blurred = textureGrad(uLive, uv, gradX * 6.0, gradY * 6.0).rgb;
  float star = smoothstep(0.02, 0.08, lumaOf(photo) - lumaOf(blurred)) * skyMask * smoothstep(0.5, 0.7, v);
  vec2 cell = floor(uv * uMapSize / 2.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + hash12(cell) * 2.5) + hash12(cell + 5.0) * 6.28);
  photo = mix(photo, blurred + (photo - blurred) * twinkle, star);

  vec3 color = photoGrade(photo) * (st.y <= 1.0 ? 1.0 : 0.85);
  // The beams use the true height, not the mirrored one: above the photo they keep going up.
  color += vec3(0.05, 0.065, 0.1) * searchlights(vec2(fract(st.x), st.y)) * (st.y <= 1.0 ? skyMask : 1.0);

  // Waterfront lights glow into the air; each stretch breathes on its own.
  vec3 halo = max(textureGrad(uLive, base, gradX * 16.0, gradY * 16.0).rgb - 0.06, 0.0);
  float breathe = 0.65 + 0.35 * noised(vec2(st.x * 25.0, uTime * 0.07)).x;
  return color + photoGrade(halo) * 0.5 * breathe * (1.0 - smoothstep(0.0, 0.2, v));
}

void main() {
  vec3 d = vWorld - uCenter;
  float azimuth = atan(d.x, -d.z);
  float elevation = atan(d.y, length(d.xz));
  vec2 st = vec2(azimuth / uPeriod, max(elevation - uShore, 0.0) / uSkylineHeight);
  vec3 color = cityColor(st, dFdx(st), dFdy(st));
  color = mix(color, uHazeColor, 0.1);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
