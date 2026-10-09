// Solid parts of the distant casino (casinoDistant.ts).
// Diffuse light is baked per vertex. This stage adds what depends on the view and on time:
// - glints of the chandeliers in gold and in the marble floor (true mirror directions, so they slide
//   across the surfaces as the camera moves, like in a real room);
// - the sheen of the velvet curtains at grazing angles;
// - crystal facets that flash as the view direction changes;
// - the slot screens (spinning reels), the chasing bulbs on the toppers, flickering candles;
// - distance haze.

uniform float uTime;
uniform float uLife;
uniform float uExposure;
uniform vec3 uCameraLocal;
uniform vec3 uHazeColor;
uniform float uHazeDensity;
// Chandeliers: xyz position, w strength.
uniform vec4 uGlints[GLINT_COUNT];

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vLit;
varying vec4 vEmit;
varying vec2 vUv;
varying vec2 vInfo;

// @common

// Sum of the chandelier glints along the mirror direction `r`; `sharpness` sets the highlight size.
float glints(vec3 r, float sharpness) {
  float sum = 0.0;
  for (int i = 0; i < GLINT_COUNT; i++) {
    vec3 l = normalize(uGlints[i].xyz - vLocal);
    sum += uGlints[i].w * exp((dot(r, l) - 1.0) * sharpness);
  }
  return sum;
}

// Patterned carpet (burgundy with a gold lattice), a marble centre aisle and a marble border.
vec3 floorPattern(vec3 lit, vec2 xz, vec3 r, out float marble) {
  float aisle = 1.0 - step(3.2, abs(xz.x));
  float crossAisle = 1.0 - step(2.0, abs(xz.y + 50.0));
  float border = step(22.6, abs(xz.x));
  marble = max(max(aisle, crossAisle), border);

  // Carpet: lattice of diamonds with a medallion in each, faded out where it would alias.
  vec2 q = xz / 0.9;
  vec2 cell = fract(q) - 0.5;
  float diamond = abs(cell.x) + abs(cell.y);
  float lattice = 1.0 - smoothstep(0.03, 0.07, abs(diamond - 0.46));
  float medallion = 1.0 - smoothstep(0.08, 0.13, abs(length(cell) - 0.16));
  float detail = clamp(1.0 - length(fwidth(q)) * 2.5, 0.0, 1.0);
  float gold = max(lattice, medallion * 0.8) * detail + 0.12 * (1.0 - detail);
  vec3 carpet = mix(lit * vec3(0.95, 0.12, 0.15), lit * vec3(1.1, 0.75, 0.3), gold * 0.8);

  // Marble: large black and cream slabs with a soft vein noise.
  vec2 m = xz / 1.2;
  float checker = mod(floor(m.x) + floor(m.y), 2.0);
  float veins = noised(xz * 1.7).x * 0.25 + noised(xz * 6.0).x * 0.1;
  float slabDetail = clamp(1.0 - length(fwidth(m)) * 2.0, 0.0, 1.0);
  float tone = mix(0.45, mix(0.18, 0.8, checker), slabDetail) * (0.85 + veins);
  vec3 stone = lit * vec3(1.15, 1.1, 1.0) * tone;
  return mix(carpet, stone, marble);
}

// Reels: three columns of symbols that spin, then stop one by one. Now and then a win flashes the frame.
vec3 slotScreen(vec2 uv, float seed) {
  float period = 6.0 + seed * 6.0;
  float clock = uTime + seed * 37.0;
  float cycle = floor(clock / period);
  float phase = clock - cycle * period;
  float column = floor(uv.x * 3.0);
  float stop = 1.0 + column * 0.45;
  float spin = phase < stop ? phase * 9.0 : 0.0;
  float row = uv.y * 3.0 + spin;
  vec2 symbolCell = vec2(column, floor(row) + cycle * 3.0);
  float h = hash12(symbolCell + seed * 91.0);
  vec3 symbol = h < 0.25 ? vec3(1.0, 0.12, 0.08) : h < 0.5 ? vec3(1.0, 0.75, 0.1) : h < 0.75 ? vec3(0.2, 0.9, 0.35) : vec3(0.5, 0.3, 1.0);
  vec2 local = vec2(fract(uv.x * 3.0), fract(row)) - 0.5;
  float shape = 1.0 - smoothstep(0.22, 0.3, length(local));
  float blur = phase < stop ? 0.5 : 0.0;
  vec3 back = mix(vec3(0.05, 0.03, 0.2), vec3(0.25, 0.08, 0.35), uv.y);
  vec3 color = mix(back, symbol, mix(shape, 0.35, blur));
  // Columns of dark separators.
  color *= 0.55 + 0.45 * smoothstep(0.0, 0.04, abs(fract(uv.x * 3.0) - 0.5) - 0.44 + 0.04);
  // At a distance the reels blend into their average colour.
  float detail = clamp(1.0 - length(fwidth(uv)) * 4.0, 0.0, 1.0);
  color = mix(vec3(0.35, 0.2, 0.45), color, detail);
  float win = step(0.7, hash12(vec2(cycle, seed * 13.0))) * step(stop + 0.6, phase) * step(phase, stop + 2.8);
  float flash = win * (0.5 + 0.5 * sin(phase * 18.0));
  float frame = 1.0 - step(0.06, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return color * (1.0 + flash * 0.8) + vec3(1.0, 0.8, 0.3) * frame * (0.3 + flash * 2.0);
}

vec3 emission(vec3 emit, float mode, float seed, vec3 view) {
  if (mode < 0.5) {
    return vec3(0.0);
  }
  float life = uLife;
  if (mode < 1.5) {
    // Steady, breathing a little.
    return emit * (1.0 + life * 0.06 * sin(uTime * (0.4 + seed) + seed * 40.0));
  }
  if (mode < 2.5) {
    // Candle bulbs: a quick shimmer over a slow wander.
    float flicker = 0.85 + 0.1 * noised(vec2(uTime * 7.0, seed * 50.0)).x + 0.1 * sin(uTime * 1.3 + seed * 20.0);
    return emit * mix(1.0, flicker, life);
  }
  if (mode < 3.5) {
    // Crystal: a facet flashes when the view direction meets its angle; time turns the facets slowly too.
    float facet = sin(dot(view, vec3(31.0, 47.0, 23.0) * (1.0 + seed)) + uTime * (0.6 + seed) * life + seed * 60.0);
    float flash = smoothstep(0.93, 1.0, facet);
    return emit * (0.35 + 6.0 * flash);
  }
  if (mode < 4.5) {
    return emit * slotScreen(vUv, seed);
  }
  if (mode < 5.5) {
    // Chasing bulbs along the topper.
    float chase = step(0.5, fract(vUv.x * 7.0 - uTime * 1.8 * life + seed * 3.0));
    float detail = clamp(1.0 - fwidth(vUv.x * 7.0) * 1.5, 0.0, 1.0);
    return emit * mix(0.75, 0.45 + 0.9 * chase, detail);
  }
  if (mode < 6.5) {
    // Sheer curtain lit from behind: soft vertical folds.
    float folds = 0.8 + 0.2 * sin(vUv.x * 60.0 + sin(vUv.y * 3.0) * 2.0);
    return emit * folds * (0.9 + 0.1 * vUv.y);
  }
  if (mode > 7.5) {
    // Old oil painting under a picture light: a warm sky, a dark land, a few soft shapes.
    float horizon = 0.38 + 0.08 * noised(vec2(vUv.x * 4.0 + seed * 20.0, seed)).x;
    vec3 sky = mix(vec3(0.9, 0.6, 0.3), vec3(0.35, 0.3, 0.4), vUv.y);
    vec3 land = vec3(0.18, 0.13, 0.07) * (0.7 + 0.6 * noised(vUv * vec2(9.0, 5.0) + seed * 30.0).x);
    vec3 picture = mix(land, sky, smoothstep(horizon - 0.03, horizon + 0.03, vUv.y));
    // The picture light falls off down the canvas.
    return emit * picture * (0.5 + 0.6 * vUv.y);
  }
  // Art Deco sunburst: gilded rays from the bottom centre that shimmer outwards.
  vec2 d = vUv - vec2(0.5, 0.0);
  float angle = atan(d.x, max(d.y, 1e-3));
  float rays = smoothstep(0.2, 0.8, abs(sin(angle * 14.0)));
  float rings = 0.75 + 0.25 * sin(length(d) * 40.0 - uTime * 1.2 * life);
  float fade = 1.0 - smoothstep(0.35, 0.55, length(d * vec2(1.0, 2.0)));
  return emit * mix(0.25, 1.0, rays * rings) * (0.4 + 0.6 * fade);
}

void main() {
  vec3 toCamera = uCameraLocal - vLocal;
  float dist = length(toCamera);
  vec3 view = toCamera / dist;
  vec3 n = normalize(vNormal);
  vec3 r = reflect(-view, n);
  float surface = vInfo.x;
  vec3 color = vLit;

  if (surface > 0.5 && surface < 1.5) {
    float marble = 0.0;
    color = floorPattern(vLit, vLocal.xz, r, marble);
    color += vec3(1.0, 0.75, 0.45) * glints(r, 900.0) * marble * 0.35;
  } else if (surface < 2.5 && surface > 1.5) {
    // Gold: a broad sheen and sharp chandelier glints.
    float facing = max(dot(n, view), 0.0);
    color *= 0.8 + 0.4 * (1.0 - facing);
    color += vec3(1.0, 0.72, 0.32) * glints(r, 120.0) * 0.35;
  } else if (surface < 3.5 && surface > 2.5) {
    float grazing = 1.0 - max(dot(n, view), 0.0);
    color *= 0.7 + 1.1 * grazing * grazing;
  } else if (surface < 4.5 && surface > 3.5) {
    color *= 0.9 + 0.2 * noised(vLocal.xz * 20.0).x;
  } else if (surface > 4.5) {
    color += vec3(1.0, 0.8, 0.6) * glints(r, 300.0) * 0.06;
  }

  color += emission(vEmit.rgb, vEmit.w, vInfo.y, view);

  float haze = 1.0 - exp(-dist * uHazeDensity);
  // The air under the ceiling holds more of the warm glow.
  vec3 hazeColor = uHazeColor * (0.8 + 0.5 * smoothstep(2.0, 16.0, vLocal.y));
  color = mix(color, hazeColor, haze);
  gl_FragColor = vec4(color * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
