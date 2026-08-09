import { MAX_DISCS } from "../state/fog";

/**
 * GLSL of the cloud layer: one full-screen quad, sky gradient plus a domain-
 * warped FBM cloud field.
 *
 * WebGL 1 / GLSL ES 1.00 on purpose — the layer is pure decoration and must
 * come up on every machine that can run the prototype at all. The octave count
 * is a uniform, so the loop runs to a constant bound and breaks early.
 *
 * The same field does the weather over the fog of war and the bank at the edge
 * of the world. Neither is a separate layer or an overlay: both only push the
 * coverage threshold of the one cloud field, so the thick parts drift, warp and
 * catch the light exactly as the thin parts do, and there is no seam where one
 * becomes the other.
 */

const VERTEX_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `
precision highp float;

#define MAX_DISCS ${MAX_DISCS}

/** Viewport in CSS pixels, so the layer lines up with the 2D canvas above it. */
uniform vec2 u_resolution;
uniform float u_pixelRatio;
/** Seconds since the layer started, paused while the tab is hidden. */
uniform float u_time;
/** Camera as (x, y, scale). */
uniform vec3 u_camera;
uniform float u_parallax;
uniform float u_drift;
uniform float u_noiseScale;
uniform float u_octaves;
uniform float u_coverage;
uniform float u_softness;
uniform float u_warp;
uniform float u_clouds;
uniform vec3 u_skyTop;
uniform vec3 u_skyMid;
uniform vec3 u_skyBottom;
uniform float u_skyMidStop;
uniform vec3 u_light;
uniform vec3 u_warmTone;
uniform vec3 u_shadow;
/**
 * The known world, as up to eight discs in world space: (centre x, centre y,
 * radius). Inside them the sky is ordinary sky; outside them the cloud closes
 * over, which is what makes an unexplored island read as weather rather than as
 * a hole in the map.
 */
uniform vec3 u_fogDiscs[MAX_DISCS];
uniform float u_fogDiscCount;
/** Width of the soft edge of a disc, in world units. */
uniform float u_fogSoft;
/** How far the cloud thickens over the unknown. Zero switches the fog off. */
uniform float u_fogDensity;
/** World radii the bank at the edge of the map builds up between. */
uniform float u_edgeInner;
uniform float u_edgeOuter;
uniform float u_edgeDensity;

const int MAX_OCTAVES = 8;

/** Clouds are stretched along the horizon, so the noise is squashed vertically. */
const float FLATTEN = 1.45;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/** Value noise with a smoothstep interpolant, so no octave shows a grid. */
float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  vec2 point = p;
  for (int i = 0; i < MAX_OCTAVES; i++) {
    if (float(i) >= u_octaves) {
      break;
    }
    sum += amp * valueNoise(point);
    norm += amp;
    // The offset per octave keeps the lattices of the octaves out of phase.
    point = point * 2.03 + vec2(37.13, 17.71);
    amp *= 0.5;
  }
  return sum / max(norm, 0.0001);
}

/**
 * How thickly the weather closes over this point, 0…1.
 *
 * Two reasons for it to close: the point is outside every disc the player has
 * explored, or it is past the rim of the playable world. Both are measured in
 * world units on the true world position of the fragment, so the mask is nailed
 * to the map while the clouds themselves drift across it.
 */
float overcastAt(vec2 world) {
  float known = 0.0;
  for (int i = 0; i < MAX_DISCS; i++) {
    if (float(i) >= u_fogDiscCount) {
      break;
    }
    vec3 disc = u_fogDiscs[i];
    float reach = length(world - disc.xy);
    known = max(known, 1.0 - smoothstep(disc.z - u_fogSoft, disc.z + u_fogSoft, reach));
  }
  float unknown = (1.0 - known) * u_fogDensity;
  float edge = smoothstep(u_edgeInner, u_edgeOuter, length(world)) * u_edgeDensity;
  return clamp(max(unknown, edge), 0.0, 1.0);
}

vec3 skyAt(float t) {
  if (t < u_skyMidStop) {
    return mix(u_skyTop, u_skyMid, t / max(u_skyMidStop, 0.0001));
  }
  return mix(u_skyMid, u_skyBottom, (t - u_skyMidStop) / max(1.0 - u_skyMidStop, 0.0001));
}

void main() {
  // CSS pixels with y pointing down, to match the 2D canvas above this one.
  float ratio = max(u_pixelRatio, 0.0001);
  vec2 frag = vec2(gl_FragCoord.x / ratio, u_resolution.y - gl_FragCoord.y / ratio);
  vec3 colour = skyAt(frag.y / max(u_resolution.y, 1.0));

  if (u_clouds > 0.5) {
    // The world point this pixel sits on — the exact inverse of the transform
    // the 2D map above is drawn with, so an island and the weather over it agree
    // about where they are.
    vec2 world = (frag - 0.5 * u_resolution) / max(u_camera.z, 0.0001) + u_camera.xy;
    float overcast = overcastAt(world);

    // Clouds keep growing with the zoom, but slower than the island does.
    float zoom = 0.55 + u_camera.z * 0.45;
    // The island shifts by camera * scale, the clouds by a fraction of that.
    vec2 shift = u_camera.xy * u_camera.z * u_parallax;
    vec2 p = (frag - 0.5 * u_resolution + shift) / (u_resolution.y * zoom) * u_noiseScale;
    p.y *= FLATTEN;
    float t = u_time * u_drift;
    // The whole field slides sideways while the warp keeps reshaping it, so the
    // clouds travel instead of only boiling in place.
    p.x += t * 0.7;

    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t, 0.0)));
    vec2 r = vec2(
      fbm(p + u_warp * q + vec2(1.7, 9.2) + vec2(0.17 * t, 0.0)),
      fbm(p + u_warp * q + vec2(8.3, 2.8) - vec2(0.0, 0.11 * t))
    );
    vec2 warped = p + u_warp * r;
    float d = fbm(warped);
    // Thick weather is the same field with its threshold pushed down: every clump
    // grows until the gaps between them close, so the bank is made of the clouds
    // that were already there rather than laid over them.
    float coverage = u_coverage * (1.0 - overcast);
    float density = smoothstep(coverage - u_softness, coverage + u_softness, d);

    // A second sample from higher up: where the cloud thins out above us we are
    // near the sunlit top, where it thickens we are in the shaded belly.
    float above = fbm(warped - vec2(0.0, 0.3));
    float lit = clamp((d - above) * 4.5 + 0.45, 0.0, 1.0);
    vec3 cloud = mix(u_shadow, u_light, lit);
    cloud = mix(cloud, u_warmTone, 0.4 * smoothstep(0.3, 0.85, d));
    colour = mix(colour, cloud, density);

    // The last of the sky only closes at the very back of the bank. Held to the
    // top of the range on purpose: any earlier and the mask stops reading as
    // cloud and starts reading as a wash of paint over the map.
    float seal = smoothstep(0.72, 1.0, overcast);
    colour = mix(colour, cloud, seal * 0.9);
  }

  gl_FragColor = vec4(colour, 1.0);
}
`;

export { FRAGMENT_SOURCE, VERTEX_SOURCE };
