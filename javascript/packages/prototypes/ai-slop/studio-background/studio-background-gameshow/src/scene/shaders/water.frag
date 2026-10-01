// Water below the skyline: the photo of the river, moved by a slow, uneven wave field.
//
// The mesh is a band of its own in front of the city cylinder. Its top edge overlaps the bottom
// rows of the skyline by a few texels and fades out over 1.5 pixels, so the shoreline is a
// geometric edge: no branch, no dark edge row, no seam.
//
// Night reflections on a river shimmer in a typical way: wave crests are wide horizontal bands
// that travel towards the viewer. Each band shifts the vertical light streaks sideways a little,
// so the streaks break into wiggling dashes. The shader builds exactly that:
// - crests live in perspective coordinates, so they are large near the camera and thin out
//   towards the shore;
// - wind patches drift over the surface: rough water next to almost flat water;
// - every region runs its waves on its own clock, so the surface never moves in lockstep.

uniform sampler2D uWater;
uniform float uTime;
uniform vec3 uCenter;
uniform float uWaterPeriod;
uniform float uWaterHeight;
// Elevation of the band's top edge: the shoreline plus the overlap.
uniform float uTop;
uniform float uShore;
uniform float uEyeHeight;
uniform float uExposure;
uniform vec3 uHazeColor;
// Camera position of the wide shot: the waves are anchored relative to it.
uniform vec3 uOrigin;

const float WAVE_PLANE_SCALE = 0.25;

varying vec3 vWorld;

// @common

// Wave crests at perspective coordinates q. Returns (sideways shift, vertical shift, crest light),
// each roughly in -1..1.
vec3 crests(vec2 q, vec2 footprint) {
  // Wind patches: strength 0.25-1.3, drifting slowly across.
  float gust = noised(q * vec2(0.035, 0.06) + vec2(uTime * 0.02, -uTime * 0.012)).x;
  float wind = mix(0.25, 1.3, smoothstep(0.2, 0.8, gust));
  // Local clock: neighbouring regions run up to 10 s apart.
  float t = uTime + noised(q * vec2(0.03, 0.05) + 7.0).x * 10.0;

  vec3 result = vec3(0.0);
  // Three crest layers: wide slow swell bands, medium chop, fine ripples.
  // (frequency across, frequency along, speed towards the viewer, weight)
  vec4 layers[3] = vec4[3](vec4(0.07, 0.22, 0.9, 1.0), vec4(0.16, 0.5, 1.4, 0.48), vec4(0.4, 1.1, 2.2, 0.15));
  for (int i = 0; i < 3; i++) {
    vec4 layer = layers[i];
    // Skip a layer once one crest gets thinner than about two pixels.
    float cover = max(layer.x * footprint.x, layer.y * footprint.y);
    float keep = 1.0 - smoothstep(0.25, 0.5, cover);
    // Crests lean a little, and each layer leans its own way.
    vec2 p = vec2(q.x * layer.x + q.y * layer.y * 0.15 * float(i - 1), q.y * layer.y + t * layer.z);
    vec3 n = noised(p + float(i) * 13.7);
    float crest = n.x * 2.0 - 1.0;
    // Sideways shift follows the crest; the vertical shift follows its slope.
    result += vec3(crest, n.z * 0.5, crest) * layer.w * keep;
  }
  return result * wind;
}

void main() {
  vec3 d = vWorld - uCenter;
  float azimuth = atan(d.x, -d.z);
  float elevation = atan(d.y, length(d.xz));
  float pixel = fwidth(elevation);

  // Distance to the water under this pixel; the shoreline caps it.
  float depression = max(-elevation, -uShore);
  float range = uEyeHeight / tan(depression);

  // Plate coordinates: v = 1 is the plate's top row at the band's top edge.
  float k = (uTop - elevation) / uWaterHeight;
  vec2 st = vec2(azimuth / uWaterPeriod, 1.0 - k);
  vec2 gradX = dFdx(st);
  vec2 gradY = dFdy(st);

  // Road perspective for the waves. They are anchored to a water plane, like the surface of a
  // road, so a camera moving forward makes them stream towards it and spread out sideways from
  // the vanishing point, while the horizon stays put. The real water is 50-600 m away and the
  // dolly is only a few meters, so the waves live on a virtual plane WAVE_PLANE_SCALE times
  // closer; otherwise the motion would stay under a pixel. The reflections are not anchored:
  // on real water they stay vertical on screen whatever the camera does.
  vec2 travel = vec2(cameraPosition.x - uOrigin.x, uOrigin.z - cameraPosition.z);
  float planeDepth = range * WAVE_PLANE_SCALE;
  vec2 anchored = vec2(tan(clamp(azimuth, -1.3, 1.3)) * planeDepth + travel.x, max(planeDepth + travel.y, 0.5));
  float anchoredRange = anchored.y / WAVE_PLANE_SCALE;
  // Perspective wave coordinates: across about a degree per unit near the camera,
  // along one unit per ~7% of distance. With the camera at its start they match the view.
  vec2 q = vec2(atan(anchored.x, anchored.y) * 60.0 * sqrt(anchoredRange / 30.0), log(anchoredRange) * 15.0);
  vec2 footprint = abs(dFdx(q)) + abs(dFdy(q));

  vec3 wave = crests(q, footprint);
  // Sideways shifts belong to the near water only. Far out one crest spans dozens of pixels,
  // so a sideways shift there moves a whole row of reflections at once and draws a sawtooth.
  // Real far water does not do that: its light paths stay straight and only glitter.
  float sideways = min(pow(80.0 / range, 1.5), 1.0);
  float along = clamp(110.0 / range, 0.2, 1.0) * mix(0.45, 1.0, smoothstep(0.0, 0.15, k));
  vec2 offset = vec2(wave.x * 0.005 * sideways, wave.y * 0.012 * along);
  // Crest light keeps the far water alive.
  float shimmer = clamp(110.0 / range, 0.6, 1.0);

  vec2 uv = st + offset;
  // A shift past the plate's top edge folds back into the water instead of clamping to one row.
  uv.y = uv.y > 1.0 ? 2.0 - uv.y : uv.y;
  // Below the plate the water continues as its mirror.
  uv.y = abs(uv.y);
  // A slightly soft lookup rounds off the edges of the broken light dashes.
  vec3 water = textureGrad(uWater, uv, gradX * 1.8, gradY * 1.8).rgb;

  // Crests turned to the city catch more light; troughs go darker.
  float bright = lumaOf(water);
  water *= 1.0 + wave.z * 0.2 * shimmer;
  // Fine glitter: small fast crests that only change brightness, never shift the image.
  // It gives the water its busy, living look from afar without sharp teeth on the reflections.
  float fineKeep = 1.0 - smoothstep(0.45, 0.9, max(0.9 * footprint.x, 2.4 * footprint.y));
  float fineClock = uTime * 3.2 + noised(q * 0.05 + 3.0).x * 6.0;
  float fine = noised(vec2(q.x * 0.9 + q.y * 0.3, q.y * 2.4 + fineClock)).x
    + 0.5 * noised(vec2(q.x * 1.7 - q.y * 0.4, q.y * 4.1 + fineClock * 1.3) + 9.0).x;
  water *= 1.0 + (fine / 1.5 - 0.5) * 0.9 * fineKeep;
  // Crest bands: wide bands of light that run along the light paths towards the viewer.
  // They are large enough to survive on the far water, so the surface reads as moving from afar.
  float bandKeep = 1.0 - smoothstep(0.35, 0.7, 0.9 * footprint.y);
  float band = noised(vec2(q.x * 0.22, q.y * 0.9 + uTime * 1.8 + noised(q * 0.04 + 5.0).x * 8.0)).x;
  water *= 1.0 + (band - 0.5) * 0.55 * bandKeep;

  // Light paths glow softly, each stretch on its own slow breath.
  vec3 halo = max(textureGrad(uWater, uv, gradX * 18.0, gradY * 18.0).rgb - 0.08, 0.0);
  float breathe = 0.6 + 0.4 * noised(vec2(st.x * 30.0, q.y * 0.05 - uTime * 0.06)).x;
  vec3 color = grade(water) + grade(halo) * 0.5 * breathe;

  // Rare glints where a crest top meets a bright light path.
  vec2 glintCell = floor(q * vec2(0.8, 1.2));
  float seed = hash12(glintCell);
  float glint = smoothstep(0.93, 1.0, sin(uTime * (1.6 + seed * 2.0) + seed * 50.0) * 0.5 + 0.5);
  glint *= smoothstep(0.15, 0.7, wave.z + band - 0.5) * smoothstep(0.2, 0.5, bright) * (1.0 - smoothstep(0.6, 1.4, max(0.8 * footprint.x, 1.2 * footprint.y)));
  color += grade(water) * glint * 1.2;

  // Near water reflects less of the city; the far water fades into haze.
  color *= mix(1.0, 0.7, smoothstep(0.3, 1.2, k));
  color = mix(color, uHazeColor * 1.6, smoothstep(80.0, 600.0, range) * 0.25);
  color = mix(color, uHazeColor, 0.1);

  // The top edge fades out over 1.5 pixels onto the city behind it.
  float alpha = 1.0 - smoothstep(uTop - 1.5 * pixel, uTop, elevation);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
