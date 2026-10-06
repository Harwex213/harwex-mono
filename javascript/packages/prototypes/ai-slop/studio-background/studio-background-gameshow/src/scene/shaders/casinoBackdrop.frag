// Casino backdrop: one photo projected onto a room shell and a few cut-out cards
// (casinoBackdrop.ts, scripts/build-casino-backdrop.py). SHELL draws the room from the plate
// (the photo with the cards' subjects filled in); a card draws the photo inside its own coverage.
// The life on top of the photo is all keyed by baked masks in photo space, so it stays on its
// object under parallax: crystal glints, lamp and sconce flicker with a breathing warm halo,
// slot screens that cycle colour and flash, curtains that ripple, and slow haze with soft shafts.
// Everything is a function of uTime: a frozen time gives a frozen frame.

// The photo (cards) or the plate (shell); sRGB, decoded to linear by the GPU.
uniform sampler2D uPhoto;
// Coverage masks: a card takes dot(cutA, uChannelA) + dot(cutB, uChannelB).
uniform sampler2D uCutA;
// R: columns and chandeliers, G: curtains.
uniform sampler2D uCutB;
// R: crystal sparkle, G: lamps, B: slot screens.
uniform sampler2D uFx;
uniform vec3 uChannelA;
uniform vec3 uChannelB;
uniform vec2 uMapSize;
uniform float uTime;
uniform float uExposure;
// Defocus radius in texels of the 2x photo.
uniform float uDefocus;
uniform float uHaze;
uniform float uLife;
uniform vec3 uHazeColor;
uniform vec3 uVoidColor;
// Distance from the projector (backdrop metres) where the haze starts and where it is full.
uniform vec2 uHazeRange;

varying vec4 vProjected;

// @common

// A small hexagon of taps: the backdrop reads slightly out of focus, behind the set.
vec3 defocused(vec2 uv) {
  vec2 r = uDefocus / uMapSize;
  vec3 sum = texture2D(uPhoto, uv).rgb * 2.0;
  sum += texture2D(uPhoto, uv + vec2(r.x, 0.0)).rgb;
  sum += texture2D(uPhoto, uv - vec2(r.x, 0.0)).rgb;
  sum += texture2D(uPhoto, uv + vec2(0.5 * r.x, 0.866 * r.y)).rgb;
  sum += texture2D(uPhoto, uv - vec2(0.5 * r.x, 0.866 * r.y)).rgb;
  sum += texture2D(uPhoto, uv + vec2(0.5 * r.x, -0.866 * r.y)).rgb;
  sum += texture2D(uPhoto, uv - vec2(0.5 * r.x, -0.866 * r.y)).rgb;
  return sum / 8.0;
}

// Rotates a colour around the grey axis.
vec3 hueShift(vec3 c, float angle) {
  const vec3 k = vec3(0.57735);
  float ca = cos(angle);
  return c * ca + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - ca);
}

// Candle-like flicker around 1.0, different for every patch of the photo.
float flicker(vec2 uv) {
  float h = hash12(floor(uv * vec2(46.0, 26.0)));
  float f = 0.05 * sin(uTime * (6.3 + h * 5.0) + h * 20.0);
  f += 0.035 * sin(uTime * (13.1 + h * 7.0) + h * 7.0);
  f += 0.08 * (noised(vec2(uTime * 2.2 + h * 31.0, h * 9.0)).x - 0.5);
  return 1.0 + f;
}

// Short bright glints on single crystals.
float glint(vec2 uv) {
  vec2 cell = floor(uv * uMapSize / 2.0);
  float h = hash12(cell);
  float wave = max(sin(uTime * (0.7 + h * 2.2) + h * 40.0), 0.0);
  float w2 = wave * wave;
  float w4 = w2 * w2;
  return w4 * w4 * w2 * step(0.55, hash12(cell + 11.0));
}

vec3 slotScreens(vec3 color, vec2 uv) {
  // One machine every ~27 photo pixels.
  float machine = floor(uv.x * 650.0 / 27.0);
  float row = floor((1.0 - uv.y) * 365.0 / 6.0);
  vec3 cycled = max(hueShift(color, uTime * 0.7 + machine * 1.7), vec3(0.0));
  // Reels: rows light up one after another, now and then the whole screen flashes.
  float chase = 0.75 + 0.25 * step(0.5, fract(uTime * 1.6 - row * 0.37 + machine * 0.21));
  float flash = smoothstep(0.88, 1.0, fract(uTime * 0.21 + machine * 0.37));
  return cycled * chase * (1.0 + 1.4 * flash);
}

void main() {
  vec2 uv = vProjected.xy / vProjected.w * 0.5 + 0.5;
  // Outside the photo the room fades into darkness instead of smearing the edge pixels.
  float inside = smoothstep(0.0, 0.03, uv.x) * smoothstep(0.0, 0.03, 1.0 - uv.x);
  inside *= smoothstep(0.0, 0.05, 1.0 - uv.y) * smoothstep(-0.01, 0.0, uv.y);
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  vec4 cutA = texture2D(uCutA, uv);
  vec4 cutB = texture2D(uCutB, uv);
#ifdef SHELL
  // Curtains ripple: a slow sideways wave of a texel or two, only on the fabric.
  float wave = sin(uv.y * 38.0 + uTime * 0.8 + sin(uv.x * 60.0) * 1.5);
  uv.x += cutB.g * 0.0016 * wave * uLife;
  float alpha = 1.0;
#else
  float alpha = clamp(dot(cutA.rgb, uChannelA) + dot(cutB.rgb, uChannelB), 0.0, 1.0);
  if (alpha < 0.004) {
    discard;
  }
#endif

  vec3 color = defocused(uv);
  vec3 fx = texture2D(uFx, uv).rgb;
#ifdef SHELL
  // Under a card the plate holds filled-in room, not the subject: no glints or flicker there.
  float covered = max(max(cutA.r, cutA.g), max(cutA.b, cutB.r));
  fx.rg *= 1.0 - covered;
#endif
  // Blurred lamp mask from a coarse mip: the halo around every light.
  float halo = texture2D(uFx, uv, 4.0).g;

  // Slot machines first, so the lamps and haze sit on top of their light.
  color = mix(color, slotScreens(color, uv), fx.b * uLife);

  // Lamps: each one flickers on its own; the warm halo breathes slowly over the whole room.
  color *= 1.0 + fx.g * (flicker(uv) - 1.0) * 2.0 * uLife;
  float breathe = 0.6 * sin(uTime * 0.31) + 0.4 * sin(uTime * 0.19 + 1.7);
  color += vec3(1.0, 0.6, 0.28) * halo * (0.16 + 0.05 * breathe) * uLife;
  color *= 1.0 + 0.035 * breathe * uLife;

  // Crystal: a gentle shimmer and rare bright glints.
  float h = hash12(floor(uv * uMapSize / 2.0));
  color *= 1.0 + fx.r * 0.3 * sin(uTime * 2.1 + h * 30.0) * uLife;
  color += fx.r * glint(uv) * vec3(1.0, 0.93, 0.82) * 0.9 * uLife;

  // Haze grows with distance and drifts; soft shafts fall from the upper right.
  float depth = vProjected.w;
  float far = smoothstep(uHazeRange.x, uHazeRange.y, depth);
  vec2 hp = uv * vec2(4.0, 2.4) + vec2(uTime * 0.012, -uTime * 0.005);
  float mist = 0.6 * noised(hp).x + 0.4 * noised(hp * 2.1 + 3.0).x;
  vec2 fromSource = uv - vec2(0.8, 1.3);
  float angle = atan(fromSource.x, -fromSource.y);
  float band = noised(vec2(angle * 9.0 + uTime * 0.02, uTime * 0.04)).x;
  float shafts = smoothstep(0.5, 0.9, band) * (1.0 - smoothstep(0.3, 1.5, length(fromSource)));
  color = mix(color, uHazeColor, far * 0.3 * uHaze);
  color += uHazeColor * (mist * 0.25 * (0.3 + far) + shafts * 0.35) * uHaze * uLife;

  color *= uExposure;
#ifdef SHELL
  color = mix(uVoidColor, color, inside);
#else
  // A card fades out at the photo edge and lets the room behind it take over.
  alpha *= inside;
#endif
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
