// The gold studio's room: the plate, the TV set into its glass, and the TV's light on polished gold and marble.

import { NOISE } from "../../core/glsl";
import { calibration } from "./plate";

const LAMP_COUNT = calibration.lamps.length;

// Final frame: the studio plate, the video wall inside the glass, and the wall's light in the room.
const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform sampler2D uContent;
uniform sampler2D uMasks;
uniform float uLevels;
uniform mat3 uToScreen;
uniform vec4 uCover;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uRect;
uniform vec2 uNotch;
uniform float uMirrorY;
uniform float uFloorY;
uniform float uHorizon;
uniform vec2 uVanish;
uniform vec4 uLamps[${LAMP_COUNT}];
uniform float uLampBases[${LAMP_COUNT}];
// Seconds since the lightning sequence started, -1 outside the power surge that opens it.
uniform float uSurge;
// Mains power: 1 at rest, lower while the bolts draw it down.
uniform float uPower;
uniform vec4 uFlash;
uniform float uImageAspect;
uniform float uScreenAspect;
uniform float uDebug;

out vec4 outColor;

${NOISE}

vec2 toScreen(vec2 p) {
  vec3 h = uToScreen * vec3(p, 1.0);
  return h.xy / h.z;
}

vec3 toLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
}

vec3 toDisplay(vec3 c) {
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

vec3 wall(vec2 s, float lod) {
  return toLinear(textureLod(uContent, vec2(s.x, 1.0 - s.y), lod).rgb);
}

// LED panels clip softly instead of hard.
vec3 ledTone(vec3 c) {
  vec3 k = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2));
  return mix(c, k, step(0.8, c));
}

// Ground-plane coordinates of a floor pixel: x across, z depth.
vec2 floorPlane(vec2 p) {
  float z = 1.0 / max(p.y - uHorizon, 0.02);
  return vec2((p.x - uVanish.x) * uImageAspect * z, z);
}

// Brightness of the frosted lamps and the downlights at p. Every lamp breathes at its own pace, a
// soft band of light climbs through its glass, and the filament hums. A lamp's reflection is read
// at the mirrored height, so the band climbs down the reflection in step with the lamp.
float lampGain(vec2 p) {
  float gain = 0.97 + 0.03 * sin(uTime * 0.8 + p.x * 23.0);
  for (int i = 0; i < ${LAMP_COUNT}; i++) {
    vec4 box = uLamps[i];
    float margin = 0.005;
    float column = smoothstep(box.x - margin, box.x, p.x) * (1.0 - smoothstep(box.z, box.z + margin, p.x));
    if (column <= 0.0) {
      continue;
    }
    float base = uLampBases[i];
    float y = p.y > base ? 2.0 * base - p.y : p.y;
    float v = clamp((box.w - y) / (box.w - box.y), 0.0, 1.0);
    float fi = float(i);
    float breath = 0.92 + 0.08 * sin(uTime * (0.55 + 0.13 * fi) + fi * 2.1);
    float head = fract(uTime * 0.085 + fi * 0.27) * 1.7 - 0.35;
    float band = exp(-pow((v - head) / 0.13, 2.0));
    float hum = 0.97 + 0.03 * noise(vec2(uTime * 38.0, fi * 7.0));
    gain = mix(gain, breath * hum * (1.0 + 0.28 * band), column);
  }
  // The bolts draw the mains down: the lamps sag and stutter while they strike.
  float stutter = mix(1.0, 0.75 + 0.25 * noise(vec2(uTime * 60.0, 3.0)), 1.0 - uPower);
  return gain * uPower * stutter;
}

// Brightness of the LED strips at p. Pulses of light run along every strip towards the screen,
// following the floor and ceiling lines into the vanishing point. The lightning sequence opens
// with a surge: one hot front races from the edges of the room into the screen.
float ledGain(vec2 p, out float surge) {
  float dv = length((p - uVanish) * vec2(uImageAspect, 1.0));
  float chase = pow(0.5 + 0.5 * sin(dv * 34.0 + uTime * 2.4), 8.0);
  float slow = 0.9 + 0.1 * sin(uTime * 0.5 + dv * 3.0);
  surge = 0.0;
  if (uSurge >= 0.0) {
    float front = 1.15 - uSurge * 1.7;
    float ahead = dv - front;
    float trail = ahead > 0.0 ? exp(-ahead / 0.18) * 0.55 : 0.0;
    surge = (exp(-pow(ahead / 0.022, 2.0)) + trail) * smoothstep(0.2, 0.36, front + 0.02);
  }
  return (0.78 + 0.4 * chase) * slow * mix(1.0, uPower, 0.6) + surge * 2.6;
}

// Dust hanging in the air, only seen where light passes through it.
float dust(vec2 q) {
  float total = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float scale = 22.0 + fl * 17.0;
    vec2 g = q * scale + vec2(uTime * (0.05 + fl * 0.03), -uTime * (0.08 + fl * 0.02)) + fl * 11.7;
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + fl * 3.7);
    if (h < 0.93) {
      continue;
    }
    vec2 off = (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.6;
    off += 0.12 * vec2(sin(uTime * 0.7 + h * 40.0), cos(uTime * 0.5 + h * 20.0));
    float r = length(f - off);
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 60.0);
    total += exp(-r * r * (1400.0 - fl * 300.0)) * twinkle * (1.0 - fl * 0.3);
  }
  return total;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = uCover.xy + c * uCover.zw;
  vec4 masks = texture(uMasks, p);
  float gold = masks.r;
  float lamp = masks.g;
  float strip = masks.b;
  vec3 base = toLinear(texture(uImage, p).rgb);
  float lampLight = lampGain(p);
  float surge;
  float ledLight = ledGain(p, surge);
  base *= mix(1.0, lampLight, lamp) * mix(1.0, ledLight, strip);
  // A surging strip runs hotter and whiter than it rests.
  base += vec3(1.0, 0.85, 0.6) * strip * surge * 0.35;
  // The lamps' and the strips' light spills a little further than the plate shows.
  float lampHalo = textureLod(uMasks, p, 5.0).g * 0.024 + textureLod(uMasks, p, 7.0).g * 0.014;
  float ledHalo = textureLod(uMasks, p, 4.0).b * 0.05 + textureLod(uMasks, p, 6.0).b * 0.03;
  base += vec3(1.0, 0.64, 0.3) * lampHalo * lampLight + vec3(1.0, 0.52, 0.18) * ledHalo * ledLight;

  vec2 s = toScreen(p);
  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  // The gold steps in the corners of the frame stay in front of the screen.
  vec2 fromCorner = min(s, 1.0 - s) - uNotch;
  vec2 n = smoothstep(vec2(0.0), fw, fromCorner);
  float inside = m.x * m.y * (1.0 - (1.0 - n.x) * (1.0 - n.y));
  float outside = 1.0 - inside;

  // Video wall emission. It replaces the marble glass of the plate.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.12
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.08;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  // The glass sits recessed in its gold frame: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.03, min(edgeDist.x, edgeDist.y));
  emit *= 0.5 + 0.5 * recess;
  // Grazing reflections of the gold frame and the columns in the glass near its edges.
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * uRect.x - p.x : 2.0 * uRect.z - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 10.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 12.0);
  float lit = clamp(dot(emit, vec3(0.33)) * 3.0, 0.0, 1.0);
  vec3 glass = (sideRefl * 0.06 + topRefl * 0.04) * (1.0 - 0.6 * lit);
  float streak = smoothstep(0.3, 0.0, abs(s.x * 0.55 - s.y + 0.1)) * 0.002;
  vec3 col = base * outside + (emit + glass + streak) * inside;

  // Light the wall throws into the room. Polished gold throws most of it back.
  vec2 aspect = vec2(uImageAspect, 1.0);
  vec2 q = p * aspect;
  vec2 dd = max(max(uRect.xy * aspect - q, q - uRect.zw * aspect), 0.0);
  float d = length(dd);
  float near = 1.0 / (1.0 + d * d * 140.0);
  vec2 sc = clamp(s, 0.0, 1.0);
  vec3 edge = wall(sc, 6.0);
  vec3 average = wall(vec2(0.5), uLevels);
  vec2 flashAt = vec2(uFlash.w, mix(uRect.y, uRect.w, 0.3)) * aspect;
  float fd = length(q - flashAt);
  float flashFall = 1.0 / (1.0 + fd * fd * 4.0);
  vec3 flash = uFlash.rgb * (0.15 + flashFall * 1.6);
  vec3 light = edge * near * 3.0 + average * 0.8 + flash;
  float response = 0.3 + gold * 1.9;
  col += outside * (base * light * response * 1.4 + light * near * 0.003);

  // Reflection in the polished marble, mirrored about the wall-floor seam. It is squeezed into a band
  // right in front of the wall, and widens towards the camera along the floor lines.
  float floorMask = smoothstep(uFloorY - 0.003, uFloorY + 0.01, p.y);
  if (floorMask > 0.0) {
    const float squeeze = 0.45;
    float dist = p.y - uMirrorY;
    // Height of the reflected point above the seam; blur and fade follow it, not the squeezed floor.
    float source = dist / squeeze;
    // Follow the floor lines exactly: every point stays on its ray to the vanishing point.
    // The reflection keeps its true width at the reflected bottom edge of the screen, so the
    // reflected board sits right under the real one.
    float trueWidthY = uMirrorY + squeeze * (uMirrorY - uRect.w);
    float spread = (trueWidthY - uVanish.y) / max(p.y - uVanish.y, 1e-3);
    vec2 ripple = (vec2(fbm(p * vec2(40.0, 14.0)), fbm(p * vec2(40.0, 14.0) + 7.3)) - 0.5) * 0.006;
    vec2 sr = toScreen(vec2(uVanish.x + (p.x - uVanish.x) * spread, uMirrorY - source) + ripple);
    float soft = 0.012 + source * 0.25;
    vec2 mr = smoothstep(-soft, soft, sr) * smoothstep(-soft, soft, 1.0 - sr);
    float lod = 0.9 + source * 9.5;
    vec3 reflection = wall(clamp(sr, 0.0, 1.0), lod);
    // Dark stone mutes what it reflects: much less light and less colour.
    reflection = mix(reflection, vec3(dot(reflection, vec3(0.3, 0.59, 0.11))), 0.35);
    // The gold inlays and the veins break the mirror; the dark stone keeps it.
    float veins = 0.75 + 0.25 * fbm(p * vec2(60.0, 30.0));
    float stone = (1.0 - 0.6 * gold) * veins;
    float strength = 0.3 * exp(-source * 2.9) * floorMask * stone;
    col += reflection * mr.x * mr.y * strength;

    // The lit screen as a whole: a soft glow at the screen's own width that starts at the seam,
    // so the reflection reads as coming from the screen. It widens along the floor lines too.
    vec2 sg = toScreen(vec2(uVanish.x + (p.x - uVanish.x) * spread, uMirrorY - source));
    float glowEdge = 0.04 + source * 0.3;
    vec2 mg = smoothstep(-glowEdge, glowEdge, sg) * smoothstep(-glowEdge, glowEdge, 1.0 - sg);
    vec3 glow = wall(clamp(sg, 0.0, 1.0), 6.5);
    col += glow * mg.x * mg.y * 0.5 * exp(-source * 3.5) * floorMask * stone;

    // The lit screen as an area light: a soft pool on the marble in front of the wall.
    vec2 fp = floorPlane(p);
    float pool = exp(-pow(fp.x / 4.0, 2.0)) * smoothstep(1.2, 3.8, fp.y);
    col += (average * 1.4 + flash * 0.25) * pool * 0.05 * floorMask;
  }

  // Dust in the air, lit by the wall and the bolts; strongest in the light cone in front of the screen.
  vec2 fromScreen = (p - vec2(0.5 * (uRect.x + uRect.z), uRect.w)) * aspect;
  float cone = exp(-pow(fromScreen.x / 0.9, 2.0)) * smoothstep(0.7, 0.1, abs(fromScreen.y));
  vec3 airLight = average * 3.0 + flash * 1.4 + edge * near;
  col += dust(q) * outside * airLight * cone * 0.22;

  // Thin haze: a veil of the wall's light hanging in the air.
  float haze = fbm(vec2(p.x * 3.0 + uTime * 0.01, p.y * 4.5 - uTime * 0.006) + fbm(p * 2.0 - uTime * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  col += outside * haze * (edge * near * 0.05 + flash * flashFall * 0.05 + average * 0.02);

  // Lens halo around the bright wall.
  col += wall(sc, 7.0) * exp(-d * 14.0) * 0.05 * outside;

  // Lens: a soft vignette.
  vec2 vc = c - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.35;

  col = toDisplay(col);
  float grain = hash(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0)) - 0.5;
  col += grain * 0.012;

  if (uDebug > 0.5) {
    float border = (1.0 - smoothstep(0.0, fw.x * 2.0, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)))) * step(abs(s.x - 0.5), 0.5 + fw.x * 2.0) * step(abs(s.y - 0.5), 0.5 + fw.y * 2.0);
    col = mix(col, vec3(0.0, 1.0, 0.3), border);
    float lines = step(abs(p.y - uMirrorY), 0.0015) + step(abs(p.y - uFloorY), 0.0015) + step(abs(p.y - uHorizon), 0.0015);
    col = mix(col, vec3(1.0, 0.8, 0.0), clamp(lines, 0.0, 1.0));
  }

  outColor = vec4(col, 1.0);
}
`;

export { COMPOSITE_FRAG };
