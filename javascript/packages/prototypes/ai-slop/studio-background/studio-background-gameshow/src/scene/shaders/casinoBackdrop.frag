// Casino backdrop: one picture projected onto a room box and a few cut-out cards
// (casinoBackdrop.ts, scripts/build-casino-backdrop.py). SHELL draws the room from the plate
// (the picture with the cards' subjects filled in); a card draws the picture inside its own coverage.
// The life on top of the picture is keyed by baked masks in picture space, so it stays on its
// object under parallax: crystal glints and twinkling floor reflections, lamps that shimmer under a
// breathing warm halo, slot screens that cycle colour and flash, light rippling over the velvet
// curtains, and slow haze with soft shafts.
// Four texture reads per fragment: the picture, the cut, the fx mask and a coarse mip of it.
// Everything is a function of uTime: a frozen time gives a frozen frame.

// The picture (cards) or the plate (shell); sRGB, decoded to linear by the GPU.
uniform sampler2D uPhoto;
// Card coverage: a card takes dot(cut, uChannel).
uniform sampler2D uCut;
// R: sparkle (crystal, floor reflections), G: lamps, B: slot screens.
uniform sampler2D uFx;
uniform vec3 uChannel;
uniform vec2 uMapSize;
uniform float uTime;
uniform float uExposure;
// Mip bias of the picture: 0 is sharp.
uniform float uDefocus;
uniform float uHaze;
uniform float uLife;
uniform vec3 uHazeColor;
uniform vec3 uVoidColor;
// Distance from the projector (picture metres) where the haze starts and where it is full.
uniform vec2 uHazeRange;

varying vec4 vProjected;

// @common

// Rotates a colour around the grey axis.
vec3 hueShift(vec3 c, float angle) {
  const vec3 k = vec3(0.57735);
  float ca = cos(angle);
  return c * ca + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - ca);
}

// Electric lamps: a faint shimmer around 1.0, different for every patch of the picture.
float shimmer(vec2 uv) {
  float h = hash12(floor(uv * vec2(64.0, 40.0)));
  float f = 0.03 * sin(uTime * (3.1 + h * 4.0) + h * 20.0);
  f += 0.05 * (noised(vec2(uTime * 1.3 + h * 31.0, h * 9.0)).x - 0.5);
  return 1.0 + f;
}

// Short bright glints on single crystals.
float glint(vec2 uv) {
  vec2 cell = floor(uv * uMapSize / 2.0);
  float h = hash12(cell);
  float wave = max(sin(uTime * (0.7 + h * 2.2) + h * 40.0), 0.0);
  float w2 = wave * wave;
  float w4 = w2 * w2;
  return w4 * w4 * w2 * step(0.6, hash12(cell + 11.0));
}

vec3 slotScreens(vec3 color, vec2 uv) {
  // One machine every ~22 picture pixels.
  float machine = floor(uv.x * uMapSize.x / 22.0);
  float row = floor((1.0 - uv.y) * uMapSize.y / 5.0);
  vec3 cycled = max(hueShift(color, uTime * 0.6 + machine * 1.7), vec3(0.0));
  // Reels: rows light up one after another, now and then the whole screen flashes.
  float chase = 0.8 + 0.2 * step(0.5, fract(uTime * 1.4 - row * 0.37 + machine * 0.21));
  float flash = smoothstep(0.9, 1.0, fract(uTime * 0.17 + machine * 0.37));
  return cycled * chase * (1.0 + 1.6 * flash);
}

void main() {
  float w = max(vProjected.w, 0.001);
  vec2 uv = vProjected.xy / w;
  // Outside the picture the room fades into darkness instead of smearing the edge pixels.
  float inside = smoothstep(0.0, 0.02, uv.x) * smoothstep(0.0, 0.02, 1.0 - uv.x);
  inside *= smoothstep(0.0, 0.03, 1.0 - uv.y) * smoothstep(0.0, 0.01, uv.y);
  inside *= step(0.0, vProjected.w);
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  vec3 cut = texture2D(uCut, uv).rgb;
#ifdef SHELL
  float alpha = 1.0;
#else
  float alpha = clamp(dot(cut, uChannel), 0.0, 1.0);
  if (alpha < 0.004) {
    discard;
  }
#endif

  vec3 color = texture2D(uPhoto, uv, uDefocus).rgb;
  vec3 fx = texture2D(uFx, uv).rgb;
#ifdef SHELL
  // Under a card the plate holds filled-in room, not the subject: no glints or lamps there.
  float covered = max(max(cut.r, cut.g), cut.b);
  fx.rg *= 1.0 - covered;
#endif
  // Blurred lamp mask from a coarse mip: the halo around every light.
  float halo = texture2D(uFx, uv, 4.0).g;

  // Slot machines first, so the lamps and haze sit on top of their light.
  color = mix(color, slotScreens(color, uv), fx.b * uLife);

  // Lamps shimmer; the warm halo breathes slowly over the whole room.
  color *= 1.0 + fx.g * (shimmer(uv) - 1.0) * 2.0 * uLife;
  float breathe = 0.6 * sin(uTime * 0.31) + 0.4 * sin(uTime * 0.19 + 1.7);
  color += vec3(1.0, 0.62, 0.3) * halo * (0.12 + 0.04 * breathe * uLife);
  color *= 1.0 + 0.03 * breathe * uLife;

  // Crystal and its reflections: a gentle shimmer and rare bright glints.
  float h = hash12(floor(uv * uMapSize / 2.0));
  color *= 1.0 + fx.r * 0.25 * sin(uTime * 2.1 + h * 30.0) * uLife;
  color += fx.r * glint(uv) * vec3(1.0, 0.93, 0.82) * 1.2 * uLife;

#ifdef SHELL
  // Velvet: a slow band of light travels across the folds, as if a draught moved the curtains.
  // Deep red only: gold has much more green in it than velvet.
  float tint = max(color.g, color.b) / max(color.r, 0.001);
  float velvet = smoothstep(0.3, 0.12, tint) * smoothstep(0.01, 0.04, color.r);
  float ripple = sin(uv.x * 260.0 - uTime * 0.9 + sin(uv.y * 7.0 + uTime * 0.37) * 2.5);
  color *= 1.0 + velvet * 0.3 * ripple * uLife;
#endif

  // Haze grows with distance and drifts; soft shafts fall from the high windows.
  float far = smoothstep(uHazeRange.x, uHazeRange.y, w);
  vec2 hp = uv * vec2(4.0, 2.4) + vec2(uTime * 0.012, -uTime * 0.005);
  float mist = 0.6 * noised(hp).x + 0.4 * noised(hp * 2.1 + 3.0).x;
  vec2 fromSource = uv - vec2(0.5, 1.25);
  float angle = atan(fromSource.x, -fromSource.y);
  float band = noised(vec2(angle * 11.0 + uTime * 0.02, uTime * 0.04)).x;
  float shafts = smoothstep(0.55, 0.9, band) * (1.0 - smoothstep(0.3, 1.2, length(fromSource)));
  color = mix(color, uHazeColor, far * 0.2 * uHaze);
  color += uHazeColor * (mist * 0.2 * (0.3 + far) + shafts * 0.3) * uHaze * uLife;

  color *= uExposure;
#ifdef SHELL
  color = mix(uVoidColor, color, inside);
#else
  // A card fades out at the picture edge and lets the room behind it take over.
  alpha *= inside;
#endif
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
