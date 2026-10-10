import * as THREE from "three";
import screenUrl from "../assets/game-slot-screen.jpg";
import barUrl from "../assets/casino-bar.jpg";
import glowFragment from "./shaders/casinoGlow.frag";
import glowVertex from "./shaders/casinoGlow.vert";

// Shading of the casino hall (casino.ts). The hall has no real lights: a light costs frame time in every shot.
// Instead every casino surface adds "baked" light in its shader: the light of the chandeliers, the candelabra on the
// columns, the lamps of the galleries, the lanterns of the aisle, the table lamps and the glow of the slot screens.
// The shader evaluates these virtual lamps per fragment in the hall frame (u along the nave, y up, v across it).
// The hall is symmetric about its axis, so a row of lamps on one side also stands for its mirror on the other side.
// The lamps light the surface as emission: albedo * irradiance, plus a highlight that follows the camera,
// so marble and gold glint like in the photo. The scene lights (the two Bonus Show spots) still add their part.

// A row of lamps along u: the first lamp at `first`, then every `period` metres up to `last`, at |v| = `v` and height `y`.
interface LampRow {
  first: number;
  period: number;
  last: number;
  v: number;
  y: number;
  color: THREE.Color;
  radius: number;
}

// A line light along u from `from` to `to`, at |v| = `v` and height `y`: lamps so close that they act as one line.
interface LampLine {
  from: number;
  to: number;
  v: number;
  y: number;
  color: THREE.Color;
  radius: number;
}

interface CasinoLighting {
  chandeliers: { position: THREE.Vector3; strength: number }[];
  chandelierColor: THREE.Color;
  rows: LampRow[];
  lines: LampLine[];
  // Ambient light, at the floor and under the ceiling.
  ambientLow: THREE.Color;
  ambientHigh: THREE.Color;
  floorY: number;
  ceilingY: number;
  // Patterns of the floor: the marble aisle on the axis and the marble border along the outer walls.
  aisle: number;
  outer: number;
  // The vault of the nave, for its coffers.
  vaultSpring: number;
  vaultRise: number;
  vaultHalf: number;
  bay: number;
  firstColumn: number;
}

const f = (value: number) => value.toFixed(4);
const v3 = (color: THREE.Color) => `vec3(${f(color.r)}, ${f(color.g)}, ${f(color.b)})`;

// The GLSL of the virtual lamps and of the surface patterns, with the layout of the hall written in.
function lightChunk(lighting: CasinoLighting): string {
  const chandeliers = lighting.chandeliers
    .map(({ position, strength }) => `  casinoPoint(p, n, e, vec3(${f(position.x)}, ${f(position.y)}, ${f(position.z)}), ${v3(lighting.chandelierColor)} * ${f(strength)}, 10.0, 1.0, diffuse, spec);`)
    .join("\n");
  const rows = lighting.rows
    .map((row) => `  casinoRow(q, m, g, ${f(row.first)}, ${f(row.period)}, ${f(row.last)}, vec2(${f(row.v)}, ${f(row.y)}), ${v3(row.color)}, ${f(row.radius)}, diffuse, spec);`)
    .join("\n");
  const lines = lighting.lines
    .map((line) => `  diffuse += casinoLine(q, m, ${f(line.from)}, ${f(line.to)}, vec2(${f(line.v)}, ${f(line.y)}), ${v3(line.color)}, ${f(line.radius)});`)
    .join("\n");
  return /* glsl */ `
uniform mat4 uWorldToHall;
uniform float uGloss;
uniform float uDiffuseGain;
uniform float uSpecGain;
varying vec3 vHall;
varying vec3 vHallNormal;

float casinoHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float casinoNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 t = fract(x);
  vec2 s = t * t * (3.0 - 2.0 * t);
  float a = casinoHash(i);
  float b = casinoHash(i + vec2(1.0, 0.0));
  float c = casinoHash(i + vec2(0.0, 1.0));
  float d = casinoHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

float casinoFbm(vec2 x) {
  return casinoNoise(x) * 0.55 + casinoNoise(x * 2.1 + 3.7) * 0.3 + casinoNoise(x * 4.3 + 7.1) * 0.15;
}

// Coverage of thin lines at every multiple of 'period' along x, faded to their average where they get too thin to draw.
float casinoLines(float x, float period, float halfWidth, float fw) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  float line = 1.0 - smoothstep(halfWidth - fw, halfWidth + fw, d);
  return mix(line, 2.0 * halfWidth / period, smoothstep(halfWidth, halfWidth * 6.0, fw));
}

void casinoPoint(vec3 p, vec3 n, vec3 e, vec3 lamp, vec3 color, float radius, float weight, inout vec3 diffuse, inout vec3 spec) {
  vec3 d = lamp - p;
  float d2 = max(dot(d, d), 1e-4);
  vec3 l = d * inversesqrt(d2);
  float falloff = weight / (1.0 + d2 / (radius * radius));
  float ndl = dot(n, l);
  diffuse += color * falloff * (0.2 + 0.8 * max(ndl, 0.0));
  vec3 h = normalize(l + e);
  spec += color * falloff * pow(max(dot(n, h), 0.0), uGloss) * step(0.0, ndl);
}

// The two lamps of a row on both sides of the point along u.
void casinoRow(vec3 p, vec3 n, vec3 e, float first, float period, float last, vec2 vy, vec3 color, float radius, inout vec3 diffuse, inout vec3 spec) {
  float k = floor((p.x - first) / period);
  for (int j = 0; j < 2; j++) {
    float u = first + (k + float(j)) * period;
    float inside = step(first - 0.01, u) * step(u, last + 0.01);
    casinoPoint(p, n, e, vec3(u, vy.y, vy.x), color, radius, inside, diffuse, spec);
  }
}

vec3 casinoLine(vec3 p, vec3 n, float from, float to, vec2 vy, vec3 color, float radius) {
  vec3 d = vec3(clamp(p.x, from, to), vy.y, vy.x) - p;
  float d2 = max(dot(d, d), 1e-4);
  vec3 l = d * inversesqrt(d2);
  return color / (1.0 + d2 / (radius * radius)) * (0.3 + 0.7 * max(dot(n, l), 0.0));
}

// The light that reaches the point p with the normal n, seen from the direction e (all in the hall frame).
void casinoBake(vec3 p, vec3 n, vec3 e, out vec3 diffuse, out vec3 spec) {
  diffuse = vec3(0.0);
  spec = vec3(0.0);
${chandeliers}
  // The side rows: fold the point onto the +v side.
  float side = p.z < 0.0 ? -1.0 : 1.0;
  vec3 q = vec3(p.xy, abs(p.z));
  vec3 m = vec3(n.xy, n.z * side);
  vec3 g = vec3(e.xy, e.z * side);
${rows}
${lines}
  float height = clamp((p.y - ${f(lighting.floorY)}) / ${f(lighting.ceilingY - lighting.floorY)}, 0.0, 1.0);
  diffuse += mix(${v3(lighting.ambientLow)}, ${v3(lighting.ambientHigh)}, height) * (0.6 + 0.4 * abs(n.y));
}

// Warm black marble with pale gold veins. The pattern runs in the plane that faces the normal most.
vec3 casinoMarble(vec3 p, vec3 n, vec3 base) {
  vec3 a = abs(n);
  vec2 st = a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? p.zy : p.xy);
  st *= 0.45;
  float warp = casinoFbm(st * 0.7);
  float vein = casinoFbm(st + vec2(warp * 2.5, warp * 1.3));
  float fw = fwidth(vein) + 0.004;
  float line = 1.0 - smoothstep(0.0, 0.02 + fw, abs(vein - 0.5));
  float cloud = casinoFbm(st * 2.3 + 11.0);
  vec3 color = base * (0.75 + 0.5 * cloud);
  return color + vec3(0.30, 0.22, 0.13) * line * 0.12;
}

// The floor: a black marble aisle with gold inlay along the axis, red carpet with gold art deco fans,
// and a marble border along the outer walls. 'gloss' is 1 on the marble and 0 on the carpet.
vec3 casinoFloor(vec3 p, out float gloss) {
  float av = abs(p.z);
  float fu = fwidth(p.x) + 0.001;
  // The aisle: marble in diamonds, framed by two gold bands.
  float diamondA = casinoLines(p.x + av, 3.0, 0.03, fu);
  float diamondB = casinoLines(p.x - av, 3.0, 0.03, fu);
  float band = casinoLines(av - ${f(lighting.aisle - 0.25)}, 1000.0, 0.06, fu) + casinoLines(av - ${f(lighting.aisle - 0.55)}, 1000.0, 0.025, fu);
  vec3 marble = casinoMarble(p, vec3(0.0, 1.0, 0.0), vec3(0.016, 0.013, 0.014));
  vec3 inlay = vec3(0.42, 0.28, 0.10);
  vec3 aisle = mix(marble, inlay, clamp(max(diamondA, diamondB) * 0.8 + band, 0.0, 1.0));
  // The carpet: fans in cells of 2.4 m, each a set of rings round the bottom of its cell.
  vec2 cell = vec2(p.x, av - ${f(lighting.aisle)}) / 2.4;
  vec2 local = fract(cell) - vec2(0.5, 0.0);
  float shift = mod(floor(cell.y), 2.0) * 0.5;
  local.x = fract(cell.x + shift) - 0.5;
  float r = length(local);
  float rings = casinoLines(r * 2.4, 0.42, 0.035, fu * 1.2) * step(r, 0.95);
  float rays = casinoLines(atan(local.x, max(local.y, 0.001)) * 2.4, 0.5, 0.03, fu * 2.0) * step(r, 0.95) * step(0.2, r);
  float edge = casinoLines(cell.y * 2.4, 2.4, 0.04, fu);
  vec3 red = vec3(0.11, 0.008, 0.012) * (0.85 + 0.3 * casinoNoise(p.xz * 3.0));
  vec3 carpet = mix(red, vec3(0.22, 0.11, 0.035), clamp(rings * 0.45 + rays * 0.2 + edge * 0.4, 0.0, 1.0));
  float onAisle = 1.0 - smoothstep(${f(lighting.aisle)} - fu, ${f(lighting.aisle)} + fu, av);
  float onBorder = smoothstep(${f(lighting.outer - 1.4)} - fu, ${f(lighting.outer - 1.4)} + fu, av);
  float onMarble = max(onAisle, onBorder);
  gloss = onMarble;
  return mix(carpet, aisle, onMarble);
}

// The vault: dark blue coffers in gold frames.
vec3 casinoVault(vec3 p, vec3 base) {
  float x = clamp(p.z / ${f(lighting.vaultHalf)}, -1.0, 1.0);
  float y = max((p.y - ${f(lighting.vaultSpring)}) / ${f(lighting.vaultRise)}, 0.0);
  float angle = atan(y, x);
  float along = (p.x - ${f(lighting.firstColumn)}) / ${f(lighting.bay / 6)};
  float around = angle / 3.14159 * 26.0;
  float fa = fwidth(along) + 0.001;
  float fr = fwidth(around) + 0.001;
  float frame = max(casinoLines(along, 1.0, 0.06, fa), casinoLines(around, 1.0, 0.06, fr));
  float inner = casinoNoise(vec2(floor(along), floor(around)) * 3.1) * 0.3;
  return mix(base * (0.8 + inner), vec3(0.09, 0.06, 0.025), frame * 0.25);
}
`;
}

// The shared uniforms of every casino material: the hall frame and the scene time.
interface CasinoUniforms {
  uWorldToHall: { value: THREE.Matrix4 };
  uTime: { value: number };
}

interface Finish {
  gloss: number;
  diffuseGain: number;
  specGain: number;
  pattern?: "floor" | "marble" | "vault";
}

// Hooks the baked light into a standard material.
function bakeInto(material: THREE.MeshStandardMaterial, finish: Finish, chunk: string, shared: CasinoUniforms): void {
  const defines: Record<string, string> = {};
  if (finish.pattern) {
    defines[`CASINO_${finish.pattern.toUpperCase()}`] = "";
  }
  material.defines = { ...(material.defines ?? {}), ...defines };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldToHall = shared.uWorldToHall;
    shader.uniforms.uGloss = { value: finish.gloss };
    shader.uniforms.uDiffuseGain = { value: finish.diffuseGain };
    shader.uniforms.uSpecGain = { value: finish.specGain };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uWorldToHall;\nvarying vec3 vHall;\nvarying vec3 vHallNormal;")
      .replace(
        "#include <project_vertex>",
        /* glsl */ `#include <project_vertex>
  vec4 hallPosition = vec4(transformed, 1.0);
  vec3 hallNormal = objectNormal;
  #ifdef USE_INSTANCING
    hallPosition = instanceMatrix * hallPosition;
    hallNormal = mat3(instanceMatrix) * hallNormal;
  #endif
  mat4 toHall = uWorldToHall * modelMatrix;
  vHall = (toHall * hallPosition).xyz;
  vHallNormal = mat3(toHall) * hallNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${chunk}`)
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
  float casinoGlossMask = 1.0;
  #ifdef CASINO_FLOOR
    diffuseColor.rgb = casinoFloor(vHall, casinoGlossMask);
  #endif
  #ifdef CASINO_MARBLE
    diffuseColor.rgb = casinoMarble(vHall, normalize(vHallNormal), diffuseColor.rgb);
  #endif
  #ifdef CASINO_VAULT
    diffuseColor.rgb = casinoVault(vHall, diffuseColor.rgb);
  #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
  #ifdef CASINO_FLOOR
    roughnessFactor = mix(0.85, 0.14, casinoGlossMask);
  #endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
  {
    vec3 hallN = normalize(vHallNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 eye = (uWorldToHall * vec4(cameraPosition, 1.0)).xyz;
    vec3 hallE = normalize(eye - vHall);
    vec3 bakedDiffuse;
    vec3 bakedSpec;
    casinoBake(vHall, hallN, hallE, bakedDiffuse, bakedSpec);
    vec3 specTint = mix(vec3(0.05), diffuseColor.rgb, metalnessFactor);
    totalEmissiveRadiance += diffuseColor.rgb * bakedDiffuse * uDiffuseGain + specTint * bakedSpec * uSpecGain * casinoGlossMask;
  }`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `#include <opaque_fragment>
  // A light warm depth haze far away (the same as casinoGlow.frag): it never reaches the near hall.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.10, 0.06, 0.03), (1.0 - exp(-max(length(vViewPosition) - 55.0, 0.0) * 0.012)) * 0.35);`,
      );
  };
  material.customProgramCacheKey = () => `casino-${finish.pattern ?? "plain"}`;
}

// The materials of the casino. Each has its own name, so the editor saves it apart from the studio materials.
// `userData.ownEnvironment`: the engine gives them the casino environment, the editor lighting swaps it for its sky.
function createCasinoMaterials(lighting: CasinoLighting) {
  const shared: CasinoUniforms = { uWorldToHall: { value: new THREE.Matrix4() }, uTime: { value: 0 } };
  const chunk = lightChunk(lighting);
  const standard = (name: string, parameters: THREE.MeshStandardMaterialParameters, finish: Finish) => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, ...parameters });
    material.name = name;
    material.userData.ownEnvironment = true;
    bakeInto(material, finish, chunk, shared);
    return material;
  };
  const materials = {
    casinoMarble: standard("casinoMarble", { color: 0x16110f, metalness: 0.1, roughness: 0.22, envMapIntensity: 0.5 }, { gloss: 70, diffuseGain: 1, specGain: 0.5, pattern: "marble" }),
    casinoGold: standard("casinoGold", { color: 0xd2a052, metalness: 1, roughness: 0.3, envMapIntensity: 0.8 }, { gloss: 24, diffuseGain: 0.22, specGain: 0.6 }),
    casinoVelvet: standard("casinoVelvet", { color: 0x3c050b, metalness: 0, roughness: 0.85, envMapIntensity: 0.2, side: THREE.DoubleSide }, { gloss: 4, diffuseGain: 0.95, specGain: 0.15 }),
    casinoVault: standard("casinoVault", { color: 0x0e1322, metalness: 0.2, roughness: 0.55, envMapIntensity: 0.3 }, { gloss: 12, diffuseGain: 1, specGain: 0.2, pattern: "vault" }),
    casinoFloor: standard("casinoFloor", { color: 0xffffff, metalness: 0, roughness: 0.5, envMapIntensity: 0.6 }, { gloss: 90, diffuseGain: 1, specGain: 1.2, pattern: "floor" }),
    casinoFelt: standard("casinoFelt", { color: 0x13704a, metalness: 0, roughness: 0.9, envMapIntensity: 0.1 }, { gloss: 4, diffuseGain: 1.2, specGain: 0 }),
    casinoDark: standard("casinoDark", { color: 0xffffff, metalness: 0.3, roughness: 0.4, envMapIntensity: 0.4 }, { gloss: 30, diffuseGain: 1, specGain: 0.3 }),
    casinoLeaf: standard("casinoLeaf", { color: 0x2f6a2c, metalness: 0, roughness: 0.6, envMapIntensity: 0.2, side: THREE.DoubleSide }, { gloss: 8, diffuseGain: 1, specGain: 0.1 }),
  };
  const glow = createGlowMaterial(shared);
  return { ...materials, casinoGlow: glow, shared, standard: Object.values(materials) };
}

function loadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// The emitters of the casino: crystal, candle flames, lamp shades, slot screens, the bar shelves, the windows.
// Each vertex carries its HDR colour (`aColor`) and its kind and phase (`aFx`), so one material animates them all.
function createGlowMaterial(shared: CasinoUniforms): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: "casinoGlow",
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    uniforms: {
      uTime: shared.uTime,
      uScreen: { value: loadTexture(screenUrl) },
      uBar: { value: loadTexture(barUrl) },
    },
  });
  return material;
}

type CasinoMaterials = ReturnType<typeof createCasinoMaterials>;

export { createCasinoMaterials };
export type { CasinoLighting, CasinoMaterials, LampLine, LampRow };
