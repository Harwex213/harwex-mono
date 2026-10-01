// City backdrop seen through the arches.
// The city is infinitely far away, like a skybox: everything here depends on the view direction only,
// never on the camera position. A camera move or a dolly can never shift, grow or bend the city
// or its reflections.
//   - Above the waterline the picture is the city photo, with glowing windows.
//   - Below the waterline the water is procedural: it mirrors the city about the horizon,
//     through moving waves seen in perspective, with fresnel and glints.
// The night sky comes from the picture itself; above its top edge the picture is mirrored,
// so the sky gradient continues without a seam.

uniform sampler2D uMap;
uniform float uTime;
uniform float uHorizon;
uniform float uAngularWidth;
uniform float uAngularHeight;
uniform float uOffsetU;
uniform float uHorizonElevation;
uniform float uExposure;
uniform float uWindowGlow;
uniform vec3 uHazeColor;
uniform vec3 uWaterColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float mirrorRepeat(float x) {
  float t = mod(x, 2.0);
  return t < 1.0 ? t : 2.0 - t;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float lumaOf(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Image uv for a view direction given as (azimuth, elevation), both in radians.
vec2 imageUv(float azimuth, float elevation) {
  vec2 uv = vec2(azimuth / uAngularWidth + uOffsetU, uHorizon + elevation / uAngularHeight);
  float v = uv.y > 1.0 ? 2.0 - uv.y : uv.y;
  return vec2(mirrorRepeat(uv.x), clamp(v, uHorizon + 0.001, 0.999));
}

// City photo colour. The brightest windows are pushed above 1.0, so the studio bloom
// gives them the same glow as the bulbs on the wheel.
vec3 cityAt(vec2 uv) {
  vec3 c = texture(uMap, uv).rgb;
  float l = lumaOf(c);
  return c * (1.0 + uWindowGlow * smoothstep(0.35, 0.9, l));
}

// Soft light around the lit buildings, from the blurred mip levels of the photo.
vec3 windowHalo(vec2 uv) {
  vec2 texel = vec2(1.0 / 336.0, 1.0 / 190.0);
  vec3 near = textureLod(uMap, uv + vec2(texel.x, 0.0), 3.0).rgb;
  near += textureLod(uMap, uv - vec2(texel.x, 0.0), 3.0).rgb;
  near += textureLod(uMap, uv + vec2(0.0, texel.y), 3.0).rgb;
  near += textureLod(uMap, uv - vec2(0.0, texel.y), 3.0).rgb;
  near *= 0.25;
  vec3 far = textureLod(uMap, uv, 5.0).rgb;
  vec3 halo = max(near - 0.1, vec3(0.0)) * 1.4 + max(far - 0.05, vec3(0.0)) * 1.1;
  return halo * vec3(1.0, 0.82, 0.6);
}

// Slope of the water surface at a point of the water plane. Three long, slow swells,
// each with its own direction, length and speed.
vec2 waveSlope(vec2 p, float t) {
  vec2 slope = vec2(0.0);
  vec2 d1 = vec2(0.28, 0.96);
  vec2 d2 = vec2(-0.62, 0.78);
  vec2 d3 = vec2(0.86, 0.51);
  slope += d1 * cos(dot(p, d1) * 1.3 + t * 0.55) * 0.5;
  slope += d2 * cos(dot(p, d2) * 2.3 + t * 0.8) * 0.3;
  slope += d3 * cos(dot(p, d3) * 4.3 + t * 1.6) * 0.12;
  return slope;
}

void main() {
  vec3 rayDir = normalize(vWorldPos - cameraPosition);
  float azimuth = atan(rayDir.x, -rayDir.z);
  // Measured from the waterline, which sits a little below eye level so the night sky fills the arches.
  float elevation = asin(clamp(rayDir.y, -1.0, 1.0)) - uHorizonElevation;

  // ---- City above the waterline ----
  vec2 uv = imageUv(azimuth, max(elevation, 0.0));
  vec3 city = cityAt(uv);

  // Windows twinkle a little.
  vec2 cell = floor(uv * vec2(520.0, 300.0));
  float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + hash12(cell) * 2.0) + hash12(cell + 7.0) * 6.2831);
  city *= 1.0 + 0.2 * (twinkle - 0.5) * smoothstep(0.15, 0.6, lumaOf(city));
  city += windowHalo(uv) * 0.6;

  // ---- Water below the waterline ----
  // A ray that looks down by `dip` radians meets the water at a distance proportional to 1 / dip,
  // so the waves get smaller and denser towards the horizon, as in perspective.
  float dip = max(-elevation, 0.0015);
  float waterDistance = 1.0 / dip;
  vec2 waterPoint = vec2(azimuth * waterDistance, waterDistance) * 0.11;
  // Far waves are too dense to show; they fade into a calm mirror at the horizon.
  float waveFade = smoothstep(0.01, 0.14, dip);
  vec2 slope = waveSlope(waterPoint, uTime) * waveFade;

  // The water is the photo's own water: its reflections are real streaks, not a mirrored city.
  // The waves only move it gently: mostly up and down, a hair sideways, so the streaks stay vertical.
  float waterV = uHorizon - dip / uAngularHeight + slope.y * 0.004;
  // Below the bottom of the photo the water is folded back, so it continues without a seam.
  waterV = waterV < 0.0 ? -waterV : waterV;
  waterV = clamp(waterV, 0.001, uHorizon - 0.001);
  vec2 waterUv = vec2(mirrorRepeat(azimuth / uAngularWidth + uOffsetU + slope.x * 0.0008), waterV);
  vec3 water = texture(uMap, waterUv).rgb;
  // Lights on the water brighten and dim as the swell passes.
  water *= 1.0 + slope.y * 0.25;
  // Steep rays see more of the dark water and less reflection.
  float cosine = clamp(sin(dip), 0.0, 1.0);
  float fresnel = 0.35 + 0.65 * pow(1.0 - cosine, 5.0);
  water = mix(uWaterColor, water, fresnel);

  // Rare glints where a swell catches the light.
  float glintWave = sin(dot(waterPoint, vec2(7.1, 4.3)) + uTime * 1.6) * sin(dot(waterPoint, vec2(-5.7, 6.9)) - uTime * 1.3);
  float glint = pow(clamp(glintWave, 0.0, 1.0), 30.0) * waveFade;
  water += water * glint * 0.8;

  // ---- Blend, haze on the waterline ----
  float isWater = 1.0 - smoothstep(-0.0015, 0.0005, elevation);
  vec3 color = mix(city, water, isWater);
  float hazeOffset = elevation / 0.012;
  color += uHazeColor * exp(-hazeOffset * hazeOffset);

  gl_FragColor = vec4(color * uExposure, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
