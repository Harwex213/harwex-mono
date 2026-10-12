import * as THREE from "three";
import screenUrl from "../assets/game-slot-screen.jpg";
import barUrl from "../assets/casino-bar.jpg";
import glowFragment from "./shaders/casinoGlow.frag";
import glowVertex from "./shaders/casinoGlow.vert";
import { relativeMatrix } from "../engine/staticBatch";
import { decodeColor } from "../engine/sceneFormat";
import type { ColorValue, ComponentData } from "../engine/sceneFormat";

// Shading of the casino hall (casino.ts). The hall has no real lights: a light costs frame time in every shot.
// Instead every casino surface adds "baked" light in its shader: the light of the chandeliers, the candelabra on the
// columns, the lamps of the galleries, the lanterns of the aisle, the table lamps and the glow of the slot screens.
// The shader evaluates these virtual lamps per fragment in the hall frame (u along the nave, y up, v across it).
// The lamps are objects of the scene file with a `virtualLamp` or `virtualLine` component (components.ts).
// `CasinoLamps` reads their places after every edit and writes them into uniforms, so a lamp moved in the editor
// moves its light at once.
// - A lamp without a row (a chandelier) lights every point of the hall.
// - Lamps with the same row name form a row along the nave. Each half of the hall (each sign of v) has its own copy
//   of every row, and a point sees only the rows, the lines and the stray lamps of its own half: the columns stand
//   between. A point takes the two lamps of a row on both sides of it along u, not the whole row: that keeps the
//   cost flat. The shader finds them in closed form on the grid of the row (first lamp, period).
// - A row lamp off the grid of its row (moved alone in the editor) lights its half of the hall as a stray lamp.
// The shader code is straight-line code written for the lamp layout: a loop over lamps costs far more per fragment.
// The layout (`LampLayout`) holds what an edit in the editor does not change: the colour and radius of each lamp,
// the period of each row and which grid slots hold a lamp. The code has them as constants. The places of the lamps
// are uniforms, so a moved lamp needs no compile. A change of the layout (a lamp that leaves the grid of its row,
// a lamp added, deleted or hidden) compiles the casino materials again.
// The halves come in pairs: row n of one half goes with row n of the other half (a missing one stays dark), and a
// point picks the member of the pair on its side. So each point evaluates one row of each pair. A pair whose halves
// mirror each other across the axis is evaluated on the point folded onto the +v half, with the +v member only.
// The settings of the `casinoLighting` component on the `Casino` object: ambient light and the surface patterns.
interface CasinoSettings {
  // Ambient light at the floor and under the ceiling (linear colours).
  ambientLow: [number, number, number];
  ambientHigh: [number, number, number];
  floorY: number;
  ceilingY: number;
  // Patterns of the floor: the marble aisle on the axis (|v|) and the marble border along the outer walls.
  aisle: number;
  outer: number;
  // The vault of the nave, for its coffers.
  vaultSpring: number;
  vaultRise: number;
  vaultHalf: number;
  bay: number;
  firstColumn: number;
}

// The constants of one lamp, one row and one line lamp in the shader code.
interface LampConstants {
  color: [number, number, number];
  radius: number;
}

interface RowConstants extends LampConstants {
  period: number;
  // A bit per grid slot with a lamp.
  mask: number;
}

interface LineConstants extends LampConstants {
  // The line runs along u: the shader takes the cheap form.
  alongU: boolean;
}

// A pair of one half and the other: [+v member, -v member], null for a missing member. `mirrored`: the -v member is
// the mirror image of the +v member.
interface Pair<T> {
  members: [T | null, T | null];
  mirrored: boolean;
}

// The layout of the virtual lamps that the shader code is written for: the point lamps for the whole hall,
// and the pairs of rows, stray lamps and lines.
interface LampLayout {
  points: LampConstants[];
  rows: Pair<RowConstants>[];
  strays: Pair<LampConstants>[];
  lines: Pair<LineConstants>[];
}

// A float literal of GLSL with the full precision of the value.
const literal = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const vec3Literal = (values: [number, number, number]) => `vec3(${values.map(literal).join(", ")})`;

const f = (value: number) => value.toFixed(4);
const v3 = (color: [number, number, number]) => `vec3(${f(color[0])}, ${f(color[1])}, ${f(color[2])})`;

// The GLSL of the virtual lamps and of the surface patterns, with the settings of the hall written in.
function lightChunk(settings: CasinoSettings, layout: LampLayout): string {
  const size = (count: number) => Math.max(1, count);
  const dark: LampConstants = { color: [0, 0, 0], radius: 1 };
  // A mirrored pair reads its +v member on the folded point (q, m, g); any other pair picks the member by side.
  const frame = (mirrored: boolean) => (mirrored ? "q, m, g" : "p, n, e");
  const place = (name: string, n: number, mirrored: boolean) => (mirrored ? `${name}[${2 * n}]` : `(negative ? ${name}[${2 * n + 1}] : ${name}[${2 * n}])`);
  // The same constant on both halves, or a pick by side.
  const both = (values: [string, string]) => (values[0] === values[1] ? values[0] : `(negative ? ${values[1]} : ${values[0]})`);
  const code: string[] = [];
  layout.rows.forEach((pair, n) => {
    const [plus, minus] = pair.members.map((row) => row ?? { ...(pair.members[0] ?? pair.members[1])!, mask: 0 }) as [RowConstants, RowConstants];
    const period = both([literal(plus.period), literal(minus.period)]);
    const color = both([vec3Literal(plus.color), vec3Literal(minus.color)]);
    const radius = both([literal(plus.radius), literal(minus.radius)]);
    // A row with a lamp in every slot from the first one on takes the cheap range test.
    const full = (mask: number) => mask > 0 && (mask & (mask + 1)) === 0;
    if (full(plus.mask) && full(minus.mask)) {
      const last = both([literal(Math.log2(plus.mask + 1) - 1), literal(Math.log2(minus.mask + 1) - 1)]);
      code.push(`  casinoRowFull(${frame(pair.mirrored)}, ${place("uCasinoRow", n, pair.mirrored)}, ${period}, ${last}, ${color}, ${radius}, diffuse, spec);`);
    } else {
      const mask = both([String(plus.mask), String(minus.mask)]);
      code.push(`  casinoRow(${frame(pair.mirrored)}, ${place("uCasinoRow", n, pair.mirrored)}, ${period}, ${mask}, ${color}, ${radius}, diffuse, spec);`);
    }
  });
  layout.strays.forEach((pair, n) => {
    const [plus, minus] = pair.members.map((lamp) => lamp ?? dark) as [LampConstants, LampConstants];
    code.push(`  casinoPoint(${frame(pair.mirrored)}, ${place("uCasinoStray", n, pair.mirrored)}, ${both([vec3Literal(plus.color), vec3Literal(minus.color)])}, ${both([literal(plus.radius), literal(minus.radius)])}, 1.0, diffuse, spec);`);
  });
  layout.lines.forEach((pair, n) => {
    const [plus, minus] = pair.members.map((line) => line ?? { ...dark, alongU: true }) as [LineConstants, LineConstants];
    const color = both([vec3Literal(plus.color), vec3Literal(minus.color)]);
    const radius = both([literal(plus.radius), literal(minus.radius)]);
    const form = plus.alongU && minus.alongU ? "casinoLineAlongU" : "casinoLine";
    const normal = pair.mirrored ? "m" : "n";
    const point = pair.mirrored ? "q" : "p";
    code.push(`  diffuse += ${form}(${point}, ${normal}, ${place("uCasinoLineA", n, pair.mirrored)}, ${place("uCasinoLineB", n, pair.mirrored)}, ${color}, ${radius});`);
  });
  const points = layout.points.map((lamp, i) => `  casinoPoint(p, n, e, uCasinoPoint[${i}], ${vec3Literal(lamp.color)}, ${literal(lamp.radius)}, 1.0, diffuse, spec);`);
  return /* glsl */ `
uniform mat4 uWorldToHall;
uniform float uGloss;
uniform float uDiffuseGain;
uniform float uSpecGain;
varying vec3 vHall;
varying vec3 vHallNormal;

// The places of the lamps in the hall frame. Point lamps that light the whole hall (the chandeliers).
uniform vec3 uCasinoPoint[${size(layout.points.length)}];
// Rows: the first grid slot (u, y, v); stray row lamps; line lamps from A to B.
uniform vec3 uCasinoRow[${2 * size(layout.rows.length)}];
uniform vec3 uCasinoStray[${2 * size(layout.strays.length)}];
uniform vec3 uCasinoLineA[${2 * size(layout.lines.length)}];
uniform vec3 uCasinoLineB[${2 * size(layout.lines.length)}];

${chunkBody(settings, points.join("\n"), code.join("\n"))}`;
}

// The functions of the chunk: the lamps, the bake (with the lamp code written in) and the surface patterns.
function chunkBody(settings: CasinoSettings, points: string, half: string): string {
  return /* glsl */ `
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

// The two lamps of a row on both sides of the point along u. grid: the first slot (u, y, v); mask: a bit per slot
// with a lamp.
void casinoRow(vec3 p, vec3 n, vec3 e, vec3 grid, float period, int mask, vec3 color, float radius, inout vec3 diffuse, inout vec3 spec) {
  float k = floor((p.x - grid.x) / period);
  for (int j = 0; j < 2; j++) {
    float slot = k + float(j);
    float inside = slot >= 0.0 && slot < 31.5 && ((mask >> int(slot)) & 1) == 1 ? 1.0 : 0.0;
    casinoPoint(p, n, e, vec3(grid.x + slot * period, grid.y, grid.z), color, radius, inside, diffuse, spec);
  }
}

// The same for a row with a lamp in every slot from 0 to last.
void casinoRowFull(vec3 p, vec3 n, vec3 e, vec3 grid, float period, float last, vec3 color, float radius, inout vec3 diffuse, inout vec3 spec) {
  float k = floor((p.x - grid.x) / period);
  for (int j = 0; j < 2; j++) {
    float slot = k + float(j);
    float inside = step(-0.5, slot) * step(slot, last + 0.5);
    casinoPoint(p, n, e, vec3(grid.x + slot * period, grid.y, grid.z), color, radius, inside, diffuse, spec);
  }
}

// A line lamp from a to b.
vec3 casinoLine(vec3 p, vec3 n, vec3 a, vec3 b, vec3 color, float radius) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec3 d = a + ab * t - p;
  float d2 = max(dot(d, d), 1e-4);
  vec3 l = d * inversesqrt(d2);
  return color / (1.0 + d2 / (radius * radius)) * (0.3 + 0.7 * max(dot(n, l), 0.0));
}

// A line lamp that runs along u from a.x to b.x.
vec3 casinoLineAlongU(vec3 p, vec3 n, vec3 a, vec3 b, vec3 color, float radius) {
  vec3 d = vec3(clamp(p.x, a.x, b.x), a.y, a.z) - p;
  float d2 = max(dot(d, d), 1e-4);
  vec3 l = d * inversesqrt(d2);
  return color / (1.0 + d2 / (radius * radius)) * (0.3 + 0.7 * max(dot(n, l), 0.0));
}

// The light that reaches the point p with the normal n, seen from the direction e (all in the hall frame).
void casinoBake(vec3 p, vec3 n, vec3 e, out vec3 diffuse, out vec3 spec) {
  diffuse = vec3(0.0);
  spec = vec3(0.0);
${points}
  // A point sees the rows, the stray lamps and the lines of its own half of the hall.
  // The folded point: the point, its normal and the view direction mirrored onto the +v half.
  bool negative = p.z < 0.0;
  float side = negative ? -1.0 : 1.0;
  vec3 q = vec3(p.xy, abs(p.z));
  vec3 m = vec3(n.xy, n.z * side);
  vec3 g = vec3(e.xy, e.z * side);
${half}
  float height = clamp((p.y - ${f(settings.floorY)}) / ${f(settings.ceilingY - settings.floorY)}, 0.0, 1.0);
  diffuse += mix(${v3(settings.ambientLow)}, ${v3(settings.ambientHigh)}, height) * (0.6 + 0.4 * abs(n.y));
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
  float band = casinoLines(av - ${f(settings.aisle - 0.25)}, 1000.0, 0.06, fu) + casinoLines(av - ${f(settings.aisle - 0.55)}, 1000.0, 0.025, fu);
  vec3 marble = casinoMarble(p, vec3(0.0, 1.0, 0.0), vec3(0.016, 0.013, 0.014));
  vec3 inlay = vec3(0.42, 0.28, 0.10);
  vec3 aisle = mix(marble, inlay, clamp(max(diamondA, diamondB) * 0.8 + band, 0.0, 1.0));
  // The carpet: fans in cells of 2.4 m, each a set of rings round the bottom of its cell.
  vec2 cell = vec2(p.x, av - ${f(settings.aisle)}) / 2.4;
  vec2 local = fract(cell) - vec2(0.5, 0.0);
  float shift = mod(floor(cell.y), 2.0) * 0.5;
  local.x = fract(cell.x + shift) - 0.5;
  float r = length(local);
  float rings = casinoLines(r * 2.4, 0.42, 0.035, fu * 1.2) * step(r, 0.95);
  float rays = casinoLines(atan(local.x, max(local.y, 0.001)) * 2.4, 0.5, 0.03, fu * 2.0) * step(r, 0.95) * step(0.2, r);
  float edge = casinoLines(cell.y * 2.4, 2.4, 0.04, fu);
  vec3 red = vec3(0.11, 0.008, 0.012) * (0.85 + 0.3 * casinoNoise(p.xz * 3.0));
  vec3 carpet = mix(red, vec3(0.22, 0.11, 0.035), clamp(rings * 0.45 + rays * 0.2 + edge * 0.4, 0.0, 1.0));
  float onAisle = 1.0 - smoothstep(${f(settings.aisle)} - fu, ${f(settings.aisle)} + fu, av);
  float onBorder = smoothstep(${f(settings.outer - 1.4)} - fu, ${f(settings.outer - 1.4)} + fu, av);
  float onMarble = max(onAisle, onBorder);
  gloss = onMarble;
  return mix(carpet, aisle, onMarble);
}

// The vault: dark blue coffers in gold frames.
vec3 casinoVault(vec3 p, vec3 base) {
  float x = clamp(p.z / ${f(settings.vaultHalf)}, -1.0, 1.0);
  float y = max((p.y - ${f(settings.vaultSpring)}) / ${f(settings.vaultRise)}, 0.0);
  float angle = atan(y, x);
  float along = (p.x - ${f(settings.firstColumn)}) / ${f(settings.bay / 6)};
  float around = angle / 3.14159 * 26.0;
  float fa = fwidth(along) + 0.001;
  float fr = fwidth(around) + 0.001;
  float frame = max(casinoLines(along, 1.0, 0.06, fa), casinoLines(around, 1.0, 0.06, fr));
  float inner = casinoNoise(vec2(floor(along), floor(around)) * 3.1) * 0.3;
  return mix(base * (0.8 + inner), vec3(0.09, 0.06, 0.025), frame * 0.25);
}
`;
}

// The shared uniforms of every casino material: the hall frame, the scene time and the virtual lamps.
interface CasinoUniforms {
  uWorldToHall: { value: THREE.Matrix4 };
  uTime: { value: number };
  uCasinoPoint: { value: THREE.Vector3[] };
  uCasinoRow: { value: THREE.Vector3[] };
  uCasinoStray: { value: THREE.Vector3[] };
  uCasinoLineA: { value: THREE.Vector3[] };
  uCasinoLineB: { value: THREE.Vector3[] };
}

const LAMP_UNIFORMS = ["uCasinoPoint", "uCasinoRow", "uCasinoStray", "uCasinoLineA", "uCasinoLineB"] as const;

// The GLSL of the hall: its settings and the lamp layout. The materials compile with the current state,
// so `configure` and the first lamp update must run before the first render.
interface ShadingState {
  chunk: string;
  key: string;
}

interface Finish {
  gloss: number;
  diffuseGain: number;
  specGain: number;
  pattern?: "floor" | "marble" | "vault";
}

// Hooks the baked light into a standard material.
function bakeInto(material: THREE.MeshStandardMaterial, finish: Finish, state: ShadingState, shared: CasinoUniforms): void {
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
    for (const name of LAMP_UNIFORMS) {
      shader.uniforms[name] = shared[name];
    }
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
      .replace("#include <common>", `#include <common>\n${state.chunk}`)
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
  material.customProgramCacheKey = () => `casino-${finish.pattern ?? "plain"}-${state.key}`;
}

const DEFAULT_SETTINGS: CasinoSettings = {
  ambientLow: [0, 0, 0],
  ambientHigh: [0, 0, 0],
  floorY: 0,
  ceilingY: 1,
  aisle: 1,
  outer: 2,
  vaultSpring: 0,
  vaultRise: 1,
  vaultHalf: 1,
  bay: 1,
  firstColumn: 0,
};


// The materials of the casino. Each has its own name, so the editor saves it apart from the studio materials.
// `userData.ownEnvironment`: the material library gives them the casino environment, the editor lighting swaps it for its sky.
class CasinoShading {
  readonly shared: CasinoUniforms;
  readonly materials: Record<string, THREE.Material>;
  readonly standard: THREE.MeshStandardMaterial[];
  private readonly state: ShadingState = { chunk: "", key: "" };
  private settings: CasinoSettings = DEFAULT_SETTINGS;
  private layout: LampLayout = { points: [], rows: [], strays: [], lines: [] };

  constructor() {
    this.shared = {
      uWorldToHall: { value: new THREE.Matrix4() },
      uTime: { value: 0 },
      uCasinoPoint: { value: [] },
      uCasinoRow: { value: [] },
      uCasinoStray: { value: [] },
      uCasinoLineA: { value: [] },
      uCasinoLineB: { value: [] },
    };
    this.compose();
    const standard = (name: string, parameters: THREE.MeshStandardMaterialParameters, finish: Finish) => {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, ...parameters });
      material.name = name;
      material.userData.ownEnvironment = true;
      bakeInto(material, finish, this.state, this.shared);
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
    this.standard = Object.values(materials);
    this.materials = { ...materials, casinoGlow: createGlowMaterial(this.shared) };
  }

  // The settings of the hall (the `casinoLighting` component).
  // A change of the settings on disk calls it again: the materials compile again.
  configure(settings: CasinoSettings): void {
    this.settings = settings;
    this.compose();
    for (const material of this.standard) {
      material.needsUpdate = true;
    }
  }

  // Sets the lamp layout. A new layout writes new shader code and compiles the materials again.
  arrange(layout: LampLayout): void {
    if (JSON.stringify(layout) === JSON.stringify(this.layout)) {
      return;
    }
    this.layout = layout;
    this.compose();
    for (const material of this.standard) {
      material.needsUpdate = true;
    }
  }

  private compose(): void {
    const { points, rows, strays, lines } = this.layout;
    const shared = this.shared;
    const vectors = (count: number) => Array.from({ length: count }, () => new THREE.Vector3());
    shared.uCasinoPoint.value = vectors(Math.max(1, points.length));
    shared.uCasinoRow.value = vectors(2 * Math.max(1, rows.length));
    shared.uCasinoStray.value = vectors(2 * Math.max(1, strays.length));
    shared.uCasinoLineA.value = vectors(2 * Math.max(1, lines.length));
    shared.uCasinoLineB.value = vectors(2 * Math.max(1, lines.length));
    this.state.chunk = lightChunk(this.settings, this.layout);
    this.state.key = `${JSON.stringify(this.layout)}${JSON.stringify(this.settings)}`;
  }
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
  return new THREE.ShaderMaterial({
    name: "casinoGlow",
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    uniforms: {
      uTime: shared.uTime,
      uScreen: { value: loadTexture(screenUrl) },
      uBar: { value: loadTexture(barUrl) },
    },
  });
}

// A virtual lamp (the `virtualLamp` component): a point light at `position` in the frame of its object.
interface LampData {
  position: [number, number, number];
  color: ColorValue;
  intensity?: number;
  radius: number;
  row?: string;
}

// A virtual line lamp (the `virtualLine` component): lamps so close that they act as one line, `from` to `to`
// in the frame of its object.
interface LineData {
  from: [number, number, number];
  to: [number, number, number];
  color: ColorValue;
  intensity?: number;
  radius: number;
}

interface PlacedLamp {
  position: THREE.Vector3;
  color: THREE.Color;
  radius: number;
}

// Reads the virtual lamps under the `Casino` object and writes them into the uniforms of the casino materials.
// The lamps are read again after every edit (a lamp moved, hidden, deleted); the hall frame is read every frame.
class CasinoLamps {
  private readonly hall: THREE.Object3D;
  private readonly shading: CasinoShading;
  private revision = "";

  constructor(hall: THREE.Object3D, shading: CasinoShading) {
    this.hall = hall;
    this.shading = shading;
  }

  update(revision: string): void {
    this.hall.updateWorldMatrix(true, false);
    this.shading.shared.uWorldToHall.value.copy(this.hall.matrixWorld).invert();
    if (revision === this.revision) {
      return;
    }
    this.revision = revision;
    const points: PlacedLamp[] = [];
    const rows = new Map<string, PlacedLamp[]>();
    const lines: { a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; radius: number }[] = [];
    const matrix = new THREE.Matrix4();
    const color = (data: { color: ColorValue; intensity?: number }) => decodeColor(data.color, new THREE.Color()).multiplyScalar(data.intensity ?? 1);
    this.hall.traverseVisible((object) => {
      const components = object.userData.components as Record<string, ComponentData> | undefined;
      const lamp = components?.virtualLamp as LampData | undefined;
      const line = components?.virtualLine as LineData | undefined;
      if (!lamp && !line) {
        return;
      }
      relativeMatrix(this.hall, object, matrix);
      if (lamp) {
        const placed = { position: new THREE.Vector3().fromArray(lamp.position).applyMatrix4(matrix), color: color(lamp), radius: lamp.radius };
        if (lamp.row) {
          // Each half of the hall has its own copy of the row.
          const key = `${lamp.row}|${placed.position.z < 0 ? -1 : 1}`;
          const row = rows.get(key) ?? [];
          row.push(placed);
          rows.set(key, row);
        } else {
          points.push(placed);
        }
      }
      if (line) {
        lines.push({ a: new THREE.Vector3().fromArray(line.from).applyMatrix4(matrix), b: new THREE.Vector3().fromArray(line.to).applyMatrix4(matrix), color: color(line), radius: line.radius });
      }
    });
    // The rows in the order their names first came, both halves of a row together.
    const names: string[] = [];
    for (const key of rows.keys()) {
      const name = key.slice(0, key.lastIndexOf("|"));
      if (!names.includes(name)) {
        names.push(name);
      }
    }
    // Pairs: index 0 for the +v half, 1 for the -v half.
    const rowPairs: (RowGrid | null)[][] = [];
    const strays: PlacedLamp[][] = [[], []];
    for (const name of names) {
      const pair: (RowGrid | null)[] = [null, null];
      [1, -1].forEach((side, half) => {
        const lamps = rows.get(`${name}|${side}`);
        if (lamps) {
          const { grid, stray } = fitGrid(lamps, side);
          pair[half] = grid;
          strays[half]!.push(...stray);
        }
      });
      rowPairs.push(pair);
    }
    const linePairs: (typeof lines)[] = [[], []];
    for (const line of lines) {
      // The half of the hall that a line lights: the side of its middle.
      linePairs[line.a.z + line.b.z < 0 ? 1 : 0]!.push(line);
    }
    const strayCount = Math.max(strays[0]!.length, strays[1]!.length);
    const lineCount = Math.max(linePairs[0]!.length, linePairs[1]!.length);
    const constants = (lamp: { color: THREE.Color; radius: number }): LampConstants => ({ color: [lamp.color.r, lamp.color.g, lamp.color.b], radius: lamp.radius });
    const alongU = (line: (typeof lines)[number]) => line.a.y === line.b.y && line.a.z === line.b.z && line.a.x <= line.b.x;
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const mirror = (a: THREE.Vector3, b: THREE.Vector3) => near(a.x, b.x) && near(a.y, b.y) && near(a.z, -b.z);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const rowLayout = rowPairs.map((pair): Pair<RowConstants> => {
      const members = pair.map((grid) => (grid ? { ...constants(grid), period: grid.period, mask: grid.mask } : null)) as [RowConstants | null, RowConstants | null];
      const [plus, minus] = pair;
      const mirrored = Boolean(plus && minus && same(members[0], members[1]) && mirror(new THREE.Vector3(plus.first, plus.y, plus.v), new THREE.Vector3(minus.first, minus.y, minus.v)));
      return { members, mirrored };
    });
    const strayLayout = Array.from({ length: strayCount }, (_, n): Pair<LampConstants> => {
      const [plus, minus] = [strays[0]![n], strays[1]![n]];
      const members = [plus ? constants(plus) : null, minus ? constants(minus) : null] as [LampConstants | null, LampConstants | null];
      return { members, mirrored: Boolean(plus && minus && same(members[0], members[1]) && mirror(plus.position, minus.position)) };
    });
    const lineLayout = Array.from({ length: lineCount }, (_, n): Pair<LineConstants> => {
      const [plus, minus] = [linePairs[0]![n], linePairs[1]![n]];
      const members = [plus ? { ...constants(plus), alongU: alongU(plus) } : null, minus ? { ...constants(minus), alongU: alongU(minus) } : null] as [LineConstants | null, LineConstants | null];
      return { members, mirrored: Boolean(plus && minus && same(members[0], members[1]) && mirror(plus.a, minus.a) && mirror(plus.b, minus.b)) };
    });
    this.shading.arrange({ points: points.map(constants), rows: rowLayout, strays: strayLayout, lines: lineLayout });
    const shared = this.shading.shared;
    points.forEach((lamp, i) => {
      shared.uCasinoPoint.value[i]!.copy(lamp.position);
    });
    rowPairs.forEach((pair, n) => {
      pair.forEach((grid, half) => {
        shared.uCasinoRow.value[2 * n + half]!.set(grid?.first ?? 0, grid?.y ?? 0, grid?.v ?? 0);
      });
    });
    for (let n = 0; n < strayCount; n++) {
      [0, 1].forEach((half) => {
        shared.uCasinoStray.value[2 * n + half]!.copy(strays[half]![n]?.position ?? new THREE.Vector3());
      });
    }
    for (let n = 0; n < lineCount; n++) {
      [0, 1].forEach((half) => {
        const line = linePairs[half]![n];
        shared.uCasinoLineA.value[2 * n + half]!.copy(line?.a ?? new THREE.Vector3());
        shared.uCasinoLineB.value[2 * n + half]!.copy(line?.b ?? new THREE.Vector3(1, 0, 0));
      });
    }
  }
}

// A row on a grid along u: lamp slot k stands at first + k * period, at (v, y). `mask` has a bit per slot with a lamp.
interface RowGrid {
  side: number;
  first: number;
  period: number;
  v: number;
  y: number;
  color: THREE.Color;
  radius: number;
  mask: number;
}

const GRID_TOLERANCE = 1e-4;
const MAX_SLOTS = 31;

// The most common value of a list, compared within the grid tolerance.
function mostCommon(values: number[]): number | undefined {
  let best: number | undefined;
  let bestCount = 0;
  for (const value of values) {
    const count = values.filter((other) => Math.abs(other - value) < GRID_TOLERANCE).length;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// The grid of a row: the lamps that agree with most of the row (height, v, colour, radius) and stand on a common
// spacing. Every other lamp of the row is a stray lamp.
function fitGrid(row: PlacedLamp[], side: number): { grid: RowGrid | null; stray: PlacedLamp[] } {
  const lamps = [...row].sort((a, b) => a.position.x - b.position.x);
  const key = (lamp: PlacedLamp) => [lamp.position.y, lamp.position.z, lamp.color.r, lamp.color.g, lamp.color.b, lamp.radius].map((value) => Math.round(value / GRID_TOLERANCE)).join(",");
  const keys = lamps.map(key);
  const common = keys.reduce((best, item) => (keys.filter((other) => other === item).length > keys.filter((other) => other === best).length ? item : best), keys[0]!);
  const candidates = lamps.filter((_, i) => keys[i] === common);
  if (candidates.length < 2) {
    return { grid: null, stray: lamps };
  }
  const spacing: number[] = [];
  for (let i = 1; i < candidates.length; i++) {
    const gap = candidates[i]!.position.x - candidates[i - 1]!.position.x;
    if (gap > GRID_TOLERANCE) {
      spacing.push(gap);
    }
  }
  const period = mostCommon(spacing);
  if (period === undefined) {
    return { grid: null, stray: lamps };
  }
  const residue = (lamp: PlacedLamp) => {
    const r = ((lamp.position.x % period) + period) % period;
    return r > period - GRID_TOLERANCE ? r - period : r;
  };
  const anchor = mostCommon(candidates.map(residue))!;
  const onGrid = candidates.filter((lamp) => Math.abs(residue(lamp) - anchor) < GRID_TOLERANCE);
  const first = onGrid[0]!;
  const grid: RowGrid = { side, first: first.position.x, period, v: first.position.z, y: first.position.y, color: first.color, radius: first.radius, mask: 0 };
  const stray: PlacedLamp[] = [];
  for (const lamp of lamps) {
    const slot = Math.round((lamp.position.x - grid.first) / period);
    const placed = onGrid.includes(lamp) && slot <= MAX_SLOTS - 1 && (grid.mask & (1 << slot)) === 0;
    if (placed) {
      grid.mask |= 1 << slot;
    } else {
      stray.push(lamp);
    }
  }
  return { grid, stray };
}

export { CasinoLamps, CasinoShading };
export type { CasinoSettings, LampLayout };
