// Animates the skyline photo in its own texture space, one texel per pixel.
// The result gets mipmaps, so a window smaller than a screen pixel still dims its pixel
// by its true share instead of switching a block on and off.

uniform sampler2D uPhoto;
// R, G: window ID (16 bit), B: 1 = switchable window, 0.5 = lit facade that stays on.
uniform sampler2D uWindows;
uniform vec2 uSize;
uniform float uTime;

// Spire tips in the photo (u, v), found by eye on the cropped image.
const vec2 SPIRES[6] = vec2[6](
  vec2(0.0265, 0.5253),
  vec2(0.2795, 0.5480),
  vec2(0.3865, 0.5642),
  vec2(0.526, 0.5486),
  vec2(0.7605, 0.6012),
  vec2(0.8245, 0.5155)
);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sq(float x) {
  return x * x;
}

// Brightness of a light that now and then swells up softly and settles back.
// Each cycle of 15-45 s rolls whether a swell happens, when, how strong (+30-70%) and how long
// (3-8 s). The swell rises and falls along a squared sine, so it never snaps.
float glowSwell(vec2 key, float seed) {
  float period = 15.0 + seed * 30.0;
  float clock = uTime / period + seed * 10.0;
  float cycle = floor(clock);
  float phase = fract(clock);
  float happens = step(0.4, hash12(key + cycle * 1.31));
  float duration = (3.0 + 5.0 * hash12(key + cycle * 3.03)) / period;
  // The swell always ends inside its cycle, so the next cycle never starts mid-swell.
  float start = 0.03 + (0.94 - duration) * hash12(key + cycle * 2.17);
  float x = clamp((phase - start) / duration, 0.0, 1.0);
  float bump = sin(x * 3.14159);
  float amount = 0.3 + 0.4 * hash12(key + cycle * 4.7);
  return 1.0 + amount * bump * bump * happens;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec3 photo = texelFetch(uPhoto, texel, 0).rgb;
  vec4 window = texelFetch(uWindows, texel, 0);
  float id = floor(window.r * 255.0 + 0.5) * 256.0 + floor(window.g * 255.0 + 0.5);
  vec2 tile = (vec2(texel) + 0.5) / uSize;

  if (id > 0.0) {
    float seed = hash12(vec2(id, 3.7));
    float role = hash12(vec2(id, 11.1));
    // Every lit surface breathes a little.
    float level = 0.93 + 0.07 * sin(uTime * (0.3 + seed) + seed * 40.0);
    if (window.b > 0.75) {
      // A single window is smaller than a screen pixel, so most swells run on groups of
      // neighbours on one floor. Only the window pixels change, so a group never shows as a block.
      vec2 group = floor(vec2(texel) / vec2(22.0, 7.0));
      float groupSeed = hash12(group + 0.37);
      if (groupSeed < 0.35) {
        level *= glowSwell(group, groupSeed);
      } else if (role < 0.08) {
        level *= glowSwell(vec2(id, 7.0), seed);
      }
    }
    photo *= level;
  }

  // Red aviation lights on the spires, each on its own rhythm.
  for (int i = 0; i < 6; i++) {
    vec2 delta = (tile - SPIRES[i]) * uSize;
    float clock = fract(uTime * 0.45 + float(i) * 0.37);
    float blink = smoothstep(0.55, 0.6, clock) * (1.0 - smoothstep(0.85, 0.95, clock));
    photo += vec3(3.0, 0.15, 0.08) * exp(-dot(delta, delta) / 3.0) * blink;
  }

  // Traffic on the waterfront road: white headlights one way, red tail lights the other.
  float lane1 = exp(-sq((tile.y - 0.0156) / 0.0033));
  float lane2 = exp(-sq((tile.y - 0.0253) / 0.0033));
  float carA = tile.x * 260.0 - uTime * 0.9;
  float carB = tile.x * 260.0 + uTime * 0.7;
  float headlights = step(0.55, hash12(vec2(floor(carA), 1.0))) * exp(-sq((fract(carA) - 0.5) * 9.0));
  float tails = step(0.55, hash12(vec2(floor(carB), 2.0))) * exp(-sq((fract(carB) - 0.5) * 9.0));
  photo += vec3(1.6, 1.4, 1.1) * headlights * lane1 + vec3(1.4, 0.12, 0.06) * tails * lane2;

  gl_FragColor = vec4(photo, 1.0);
}
