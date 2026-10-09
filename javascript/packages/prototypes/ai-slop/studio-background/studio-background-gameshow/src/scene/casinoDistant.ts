import * as THREE from "three";
import { named } from "./geometry";
import { Glow, GlowBatch, LightGrid, Motion, SolidBatch, Sprite, Surface, place, random, type Paint } from "./casinoDistantKit";
import commonChunk from "./shaders/common.glsl";
import solidFragment from "./shaders/casinoDistant.frag";
import solidVertex from "./shaders/casinoDistant.vert";
import glowFragment from "./shaders/casinoGlow.frag";
import glowVertex from "./shaders/casinoGlow.vert";

// A luxury casino hall built as real geometry. The Game Show games stand in its foyer (casinoHall.ts).
//
// The technique follows the city backdrop (city.ts): the city stays convincing because nothing in it turns
// with the camera, and every light in it lives (window groups swell, aviation lights blink, cars run).
// The city is far enough (400 m) that its parallax is negligible. The casino is only 15-100 m away, so a
// picture cannot hold up there. Here every element stands at its true place in 3D, so it shifts against
// the others exactly like a real room when the camera moves. The look stays cheap:
// - no real lights: the light of every chandelier, sconce, table lamp and slot bank is baked into the vertex
//   colours once at startup (casinoDistantKit.ts);
// - the fragment shader adds only what depends on the view: chandelier glints in the gold and the marble
//   floor, velvet sheen, flashing crystal facets, and the distance haze;
// - everything that glows lives on its own rhythm, like the city windows: candle bulbs flicker, crystals
//   flash, slot reels spin and stop, topper bulbs chase, the sunburst shimmers, chandeliers sway, patrons
//   stroll;
// - halos, light shafts, star glints and haze clouds are camera-facing sprites in one additive mesh. A far
//   halo never shrinks below a pixel or two, so far lamps read as soft points (bokeh) instead of flickering.
//
// Frame: the origin is the bottom centre of the near edge of the hall, on its floor. The hall extends towards
// -Z (the viewer looks from +Z): x from -24 to 24, z from 0 to -100, ceiling at 17.8 (DISTANT_CASINO_SIZE).
// The near edge is open. With `foyer` the hall continues in front of it as an empty foyer (z from 0 to the
// foyer length) that a near wall closes; one side of the foyer can stay open (see `buildFoyer`).
//
// Layout (all in metres):
// - nave |x| < 9: a marble aisle |x| < 3.2 down the middle, 16 gaming tables at x = +-6, 7 large chandeliers
//   over the aisle; a marble cross aisle at z = -50;
// - two colonnades at x = +-9: gilded columns every 10 m (z = -5 ... -95), arches between them, an entablature
//   at 11-12.6 m;
// - side aisles 9 < |x| < 24: 10 double-sided slot banks (200 machines) with lit signs, 12 smaller chandeliers;
// - side walls: dark wood panelling, gilded pilasters, red velvet curtains before lit sheers, paintings,
//   candle sconces, lit lunettes high up;
// - coffered ceiling with lit rosettes; at the far end a long bar with a glowing back bar under a gilded
//   Art Deco sunburst;
// - about 120 patrons, some of them strolling.
//
// Draw calls: 4 solid meshes (one shared shader) and 1 additive glow mesh.
// Unlit ShaderMaterial, no fog of the scene: the haze is in the shaders. Colour stays linear; tone mapping
// comes from the renderer or the composer's OutputPass.

// The height matches the amphitheatre ceiling (studio.ts, LAYOUT.ceilingY), so the two ceilings meet level.
const DISTANT_CASINO_SIZE = { halfWidth: 24, depth: 100, height: 17.8 };

const W = DISTANT_CASINO_SIZE.halfWidth;
const D = DISTANT_CASINO_SIZE.depth;
const H = DISTANT_CASINO_SIZE.height;
const COLUMN_X = 9;
const COLUMN_TOP = 11;
const BEAM_TOP = 12.6;
const COLUMN_Z = Array.from({ length: 10 }, (_, i) => -5 - i * 10);
const CROSS_AISLE_Z = -50;
const SLOT_ROWS = [-12, -27, -40, -62, -77];
const NAVE_CHANDELIERS = [-9, -21, -33, -45, -57, -69, -81];
const AISLE_CHANDELIERS = [-6, -19.5, -33, -50, -69.5, -86];

const PALETTE = {
  woodDark: 0x2e1810,
  woodMid: 0x5a3220,
  woodPanel: 0x40221a,
  gold: 0xd0a040,
  goldDeep: 0x9a6a22,
  cream: 0xd8c4a0,
  upperWall: 0x7a5a40,
  velvet: 0x8a0f18,
  felt: 0x0f6a34,
  leather: 0x23302a,
  cabinet: 0x1a1218,
  marbleTop: 0xcfc2aa,
  black: 0x0c0a0a,
  floor: 0xb89878,
  skin: 0xe0a888,
};

const WARM = new THREE.Color(1.0, 0.66, 0.36);
const CANDLE = new THREE.Color(1.0, 0.62, 0.3);

interface DistantCasinoOptions {
  // Brightness of the hall, linear.
  exposure?: number;
  // Haze density per metre.
  haze?: number;
  // Strength of all the animation (flicker, sparkle, reels, sway, strolling).
  life?: number;
  // A foyer in front of the near edge (see `buildFoyer`): its length and the z range where its left side is open.
  // Without it the near edge stays open.
  foyer?: { length: number; open: [number, number] };
}

interface DistantCasino {
  group: THREE.Group;
  // Deterministic in time: the same time gives the same frame.
  update: (time: number) => void;
}

// Unit shapes, transformed into the batches.
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  cylinderFine: new THREE.CylinderGeometry(1, 1, 1, 24),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  octahedron: new THREE.OctahedronGeometry(1),
  plane: new THREE.PlaneGeometry(1, 1),
  capsule: new THREE.CapsuleGeometry(1, 1, 2, 6),
  cone: new THREE.CylinderGeometry(0.55, 1, 1, 10),
};

// Box between two corners.
function cuboid(batch: SolidBatch, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, paint: Paint): void {
  batch.add(SHAPES.box, place((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), paint);
}

// Upright cylinder standing on `y`.
function post(batch: SolidBatch, x: number, y: number, z: number, radius: number, height: number, paint: Paint, fine = false): void {
  batch.add(fine ? SHAPES.cylinderFine : SHAPES.cylinder, place(x, y + height / 2, z, radius, height, radius), paint);
}

// --- Architecture -----------------------------------------------------------------------------------------

function buildShell(batch: SolidBatch, glow: GlowBatch, lights: LightGrid): void {
  // Floor: fine enough for the baked light pools of the chandeliers and the tables.
  const floor = new THREE.PlaneGeometry(2 * W, D, 48, 100);
  floor.rotateX(-Math.PI / 2);
  batch.add(floor, place(0, 0, -D / 2), { color: PALETTE.floor, surface: Surface.floor });

  const ceiling = new THREE.PlaneGeometry(2 * W, D, 24, 50);
  ceiling.rotateX(Math.PI / 2);
  batch.add(ceiling, place(0, H, -D / 2), { color: PALETTE.woodMid });

  // Coffers: beams across every 5 m and along the hall, gold strips under them.
  for (let z = -2.5; z > -D; z -= 5) {
    cuboid(batch, -W, W, H - 0.9, H, z - 0.22, z + 0.22, { color: PALETTE.woodDark, surface: Surface.lacquer });
    cuboid(batch, -W, W, H - 0.96, H - 0.9, z - 0.26, z + 0.26, { color: PALETTE.gold, surface: Surface.gold });
  }
  const beamXs = [-21, -15, -9, -3, 3, 9, 15, 21];
  for (const x of beamXs) {
    cuboid(batch, x - 0.22, x + 0.22, H - 0.9, H, -D, 0, { color: PALETTE.woodDark, surface: Surface.lacquer });
    cuboid(batch, x - 0.26, x + 0.26, H - 0.96, H - 0.9, -D, 0, { color: PALETTE.gold, surface: Surface.gold });
  }
  // Rosettes with a lit centre in every coffer.
  const cellXs = [-22.5, -18, -12, -6, 0, 6, 12, 18, 22.5];
  for (const x of cellXs) {
    for (let z = -5; z > -D; z -= 5) {
      post(batch, x, H - 0.12, z, 0.6, 0.12, { color: PALETTE.gold, surface: Surface.gold }, true);
      post(batch, x, H - 0.16, z, 0.16, 0.04, { color: PALETTE.cream, emit: WARM, emitStrength: 3, glow: Glow.steady, seed: Math.abs(x * 0.37 + z * 0.11) % 1 });
      glow.add(new THREE.Vector3(x, H - 0.25, z), WARM, 1.2, 0.5, { seed: Math.abs(x + z * 0.3) % 1 });
    }
  }

  for (const side of [-1, 1]) {
    buildSideWall(batch, glow, lights, side, -D, 0);
  }

  buildColonnades(batch, lights);
  buildBackWall(batch, glow, lights);
}

// A run of side wall from z0 to z1 (z0 < z1) on `side`: dark wood up to the cornice, warm panels above, a wainscot
// with a gilded rail, pilasters at z = 5 + 10k, and a bay with curtains or a painting and a lit lunette at z = 10k.
// Only whole pilasters and bays inside the run are built.
function buildSideWall(batch: SolidBatch, glow: GlowBatch, lights: LightGrid, side: number, z0: number, z1: number): void {
  const facing = -side * (Math.PI / 2);
  const length = z1 - z0;
  const middle = (z0 + z1) / 2;
  const lower = new THREE.PlaneGeometry(length, BEAM_TOP, Math.max(1, Math.round(length / 2)), 13);
  batch.add(lower, place(side * W, BEAM_TOP / 2, middle, 1, 1, 1, 0, facing), { color: PALETTE.woodPanel, surface: Surface.lacquer });
  const upper = new THREE.PlaneGeometry(length, H - BEAM_TOP, Math.max(1, Math.round(length / 2)), 3);
  batch.add(upper, place(side * W, (BEAM_TOP + H) / 2, middle, 1, 1, 1, 0, facing), { color: PALETTE.upperWall });
  const inner = side * (W - 0.12);
  // Wainscot with a gilded chair rail; the cornice.
  cuboid(batch, side * W, inner, 0, 1.15, z0, z1, { color: PALETTE.woodDark, surface: Surface.lacquer });
  cuboid(batch, side * W, side * (W - 0.16), 1.15, 1.25, z0, z1, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, side * W, side * (W - 0.45), BEAM_TOP - 0.5, BEAM_TOP, z0, z1, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, side * W, side * (W - 0.3), BEAM_TOP - 1.1, BEAM_TOP - 0.5, z0, z1, { color: PALETTE.woodDark, surface: Surface.lacquer });

  for (let z = Math.ceil((z0 + 0.85 - 5) / 10) * 10 + 5; z <= z1 - 0.85; z += 10) {
    pilaster(batch, side, z);
  }
  for (let z = Math.ceil((z0 + 4) / 10) * 10; z <= z1 - 4; z += 10) {
    const bay = Math.round(Math.abs(z) / 10);
    if (bay % 2 === 1) {
      buildCurtainBay(batch, glow, lights, side, z);
    } else {
      buildPaintingBay(batch, glow, lights, side, z, bay);
    }
    // Lit lunette high up in every bay.
    const lunette = new THREE.Shape();
    lunette.moveTo(-2.6, 0);
    lunette.lineTo(2.6, 0);
    lunette.lineTo(2.6, 1.6);
    lunette.absarc(0, 1.6, 2.6, 0, Math.PI, false);
    lunette.lineTo(-2.6, 0);
    const window = new THREE.ShapeGeometry(lunette, 12);
    const uvs = window.getAttribute("uv");
    for (let i = 0; i < uvs.count; i++) {
      uvs.setXY(i, (uvs.getX(i) + 2.6) / 5.2, uvs.getY(i) / 4.2);
    }
    batch.add(window, place(side * (W - 0.02), 13.3, z, 1, 1, 1, 0, facing), { color: PALETTE.cream, emit: 0xffc890, emitStrength: 0.55, glow: Glow.sheer, seed: (bay * 0.31) % 1 });
    const frame = new THREE.TorusGeometry(2.6, 0.12, 4, 16, Math.PI);
    batch.add(frame, place(side * (W - 0.08), 14.9, z, 1, 1, 1, 0, facing), { color: PALETTE.gold, surface: Surface.gold });
    lights.add({ position: new THREE.Vector3(side * (W - 1.5), 14.5, z), color: WARM.clone().multiplyScalar(0.8), range: 2.5 });
  }
}

// A wooden pilaster with gilded flutes and a gilded capital against the side wall on `side`.
function pilaster(batch: SolidBatch, side: number, z: number): void {
  cuboid(batch, side * W, side * (W - 0.4), 0, BEAM_TOP - 1.1, z - 0.7, z + 0.7, { color: PALETTE.woodMid, surface: Surface.lacquer });
  for (const dz of [-0.4, 0, 0.4]) {
    cuboid(batch, side * (W - 0.4), side * (W - 0.45), 1.6, BEAM_TOP - 1.9, z + dz - 0.05, z + dz + 0.05, { color: PALETTE.gold, surface: Surface.gold });
  }
  cuboid(batch, side * W, side * (W - 0.55), BEAM_TOP - 1.9, BEAM_TOP - 1.1, z - 0.85, z + 0.85, { color: PALETTE.gold, surface: Surface.gold });
}

// The foyer: the hall continues `length` metres towards +z with its ceiling and walls but without furniture and
// without a floor of its own (the studio floor lies there). The near wall closes it at z = length.
// The left side (-x) stays open between z = open[0] and z = open[1]: there the foyer opens into the studio.
// A lintel runs over the opening, and a broad pilaster ends the left wall on each side of it.
function buildFoyer(batch: SolidBatch, fixtures: SolidBatch, glow: GlowBatch, lights: LightGrid, glints: THREE.Vector4[], length: number, open: [number, number]): void {
  const L = length;
  const ceiling = new THREE.PlaneGeometry(2 * W, L, 24, Math.max(1, Math.round(L / 2)));
  ceiling.rotateX(Math.PI / 2);
  batch.add(ceiling, place(0, H, L / 2), { color: PALETTE.woodMid });
  for (let z = 2.5; z < L - 0.3; z += 5) {
    cuboid(batch, -W, W, H - 0.9, H, z - 0.22, z + 0.22, { color: PALETTE.woodDark, surface: Surface.lacquer });
    cuboid(batch, -W, W, H - 0.96, H - 0.9, z - 0.26, z + 0.26, { color: PALETTE.gold, surface: Surface.gold });
  }
  for (const x of [-21, -15, -9, -3, 3, 9, 15, 21]) {
    cuboid(batch, x - 0.22, x + 0.22, H - 0.9, H, 0, L, { color: PALETTE.woodDark, surface: Surface.lacquer });
    cuboid(batch, x - 0.26, x + 0.26, H - 0.96, H - 0.9, 0, L, { color: PALETTE.gold, surface: Surface.gold });
  }
  for (const x of [-22.5, -18, -12, -6, 0, 6, 12, 18, 22.5]) {
    for (let z = 5; z < L - 1; z += 5) {
      post(batch, x, H - 0.12, z, 0.6, 0.12, { color: PALETTE.gold, surface: Surface.gold }, true);
      post(batch, x, H - 0.16, z, 0.16, 0.04, { color: PALETTE.cream, emit: WARM, emitStrength: 3, glow: Glow.steady, seed: Math.abs(x * 0.37 + z * 0.11) % 1 });
      glow.add(new THREE.Vector3(x, H - 0.25, z), WARM, 1.2, 0.5, { seed: Math.abs(x + z * 0.3) % 1 });
    }
  }

  // Walls: the right side whole, the left side on both sides of the opening, and the near wall.
  const [openFrom, openTo] = open;
  buildSideWall(batch, glow, lights, 1, 0, L);
  if (openFrom > 0.5) {
    buildSideWall(batch, glow, lights, -1, 0, openFrom);
  }
  if (L - openTo > 0.5) {
    buildSideWall(batch, glow, lights, -1, openTo, L);
  }
  const near = new THREE.PlaneGeometry(2 * W, H, 24, 9);
  batch.add(near, place(0, H / 2, L, 1, 1, 1, 0, Math.PI), { color: PALETTE.woodPanel, surface: Surface.lacquer });
  cuboid(batch, -W, W, 0, 1.15, L - 0.12, L, { color: PALETTE.woodDark, surface: Surface.lacquer });
  cuboid(batch, -W, W, 1.15, 1.25, L - 0.16, L, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, -W, W, BEAM_TOP - 0.5, BEAM_TOP, L - 0.45, L, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, -W, W, BEAM_TOP - 1.1, BEAM_TOP - 0.5, L - 0.3, L, { color: PALETTE.woodDark, surface: Surface.lacquer });
  for (const x of [-15, -5, 5, 15]) {
    cuboid(batch, x - 0.7, x + 0.7, 0, BEAM_TOP - 1.1, L - 0.4, L, { color: PALETTE.woodMid, surface: Surface.lacquer });
    cuboid(batch, x - 0.85, x + 0.85, BEAM_TOP - 1.9, BEAM_TOP - 1.1, L - 0.55, L, { color: PALETTE.gold, surface: Surface.gold });
  }

  // The lintel over the opening. It reaches 0.45 m outside the hall, under the edge of the studio ceiling,
  // and up to the roof of the shell (0.05 over the ceiling).
  const outside = -W - 0.45;
  cuboid(batch, outside, -W + 0.7, H - 1.4, H + 0.05, openFrom, openTo, { color: PALETTE.woodDark, surface: Surface.lacquer });
  cuboid(batch, outside - 0.02, -W + 0.72, H - 1.5, H - 1.4, openFrom, openTo, { color: PALETTE.gold, surface: Surface.gold });
  // The left wall ends in a broad pilaster on each side of the opening. It covers the end of the wall panels and
  // reaches back to the shell.
  for (const z of [openFrom, openTo]) {
    cuboid(batch, -W - 0.05, -W + 0.6, 0, H - 1.4, z - 0.6, z + 0.6, { color: PALETTE.woodMid, surface: Surface.lacquer });
    cuboid(batch, -W + 0.6, -W + 0.66, 1.6, H - 2.2, z - 0.4, z + 0.4, { color: PALETTE.gold, surface: Surface.gold });
  }

  // Chandeliers over the nave and the right aisle of the foyer. The left aisle stays clear for the studio.
  [0.22, 0.5, 0.78].forEach((share, i) => {
    glints.push(chandelier(fixtures, glow, lights, 0, L * share, 7.2, 1.25, (i * 0.37 + 0.21) % 1, true));
    glints.push(chandelier(fixtures, glow, lights, 16.5, L * share, 6.8, 0.8, (i * 0.29 + 0.43) % 1, false));
  });
}

function buildCurtainBay(batch: SolidBatch, glow: GlowBatch, lights: LightGrid, side: number, z: number): void {
  const facing = -side * (Math.PI / 2);
  // Sheer lit from behind.
  const sheer = new THREE.PlaneGeometry(6.4, 8.6);
  batch.add(sheer, place(side * (W - 0.03), 4.8, z, 1, 1, 1, 0, facing), { color: PALETTE.cream, emit: 0xffd8a8, emitStrength: 0.9, glow: Glow.sheer, seed: Math.abs(z * 0.13) % 1 });
  // Two velvet drapes gathered at tie-backs, with folds.
  for (const half of [-1, 1]) {
    const drape = new THREE.PlaneGeometry(2.6, 9.4, 24, 12);
    const position = drape.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i) + 4.7;
      // Gathered towards the outer edge below the tie-back at 2.6 m.
      const gather = 1 - 0.55 * Math.exp(-((y - 2.6) * (y - 2.6)) / 3);
      const outer = half * 1.3;
      const gx = outer + (x - outer) * gather;
      position.setXYZ(i, gx, position.getY(i), 0.14 * Math.sin(x * 7.5) * (0.6 + 0.4 * gather) + 0.12);
    }
    drape.computeVertexNormals();
    const x = half * 2.0;
    const matrix = place(side * (W - 0.05), 4.8, z, 1, 1, 1, 0, facing).multiply(place(x, 0, 0));
    batch.add(drape, matrix, { color: PALETTE.velvet, surface: Surface.velvet });
  }
  // Pelmet with a gold fringe.
  cuboid(batch, side * W, side * (W - 0.5), 9.3, 10.2, z - 3.4, z + 3.4, { color: PALETTE.velvet, surface: Surface.velvet });
  cuboid(batch, side * (W - 0.5), side * (W - 0.56), 9.2, 9.35, z - 3.4, z + 3.4, { color: PALETTE.gold, surface: Surface.gold });
  lights.add({ position: new THREE.Vector3(side * (W - 1.2), 4.5, z), color: new THREE.Color(1.0, 0.75, 0.5).multiplyScalar(1.1), range: 2.4 });
  glow.add(new THREE.Vector3(side * (W - 0.2), 5, z), 0xffc890, 0.06, 4.5, { seed: Math.abs(z) % 1 });
}

function buildPaintingBay(batch: SolidBatch, glow: GlowBatch, lights: LightGrid, side: number, z: number, bay: number): void {
  const facing = -side * (Math.PI / 2);
  // Gilded frame round a dark painting with a warm picture light.
  cuboid(batch, side * W, side * (W - 0.18), 3.6, 7.4, z - 2.4, z + 2.4, { color: PALETTE.gold, surface: Surface.gold });
  const canvas = new THREE.PlaneGeometry(4.2, 3.2);
  const tint = [0x3a2a1a, 0x24301e, 0x2c2034, 0x3a2416][bay % 4] ?? 0x3a2a1a;
  batch.add(canvas, place(side * (W - 0.19), 5.5, z, 1, 1, 1, 0, facing), { color: tint, emit: 0xffe0c0, emitStrength: 0.22, glow: Glow.painting, seed: (bay * 0.29 + (side > 0 ? 0.5 : 0)) % 1 });
  lights.add({ position: new THREE.Vector3(side * (W - 0.8), 7.8, z), color: WARM.clone().multiplyScalar(0.9), range: 1.6 });
  // Sconces with candle bulbs either side.
  for (const dz of [-3.3, 3.3]) {
    const sconceZ = z + dz;
    cuboid(batch, side * W, side * (W - 0.08), 2.6, 3.6, sconceZ - 0.2, sconceZ + 0.2, { color: PALETTE.gold, surface: Surface.gold });
    for (const arm of [-0.22, 0.22]) {
      const at = new THREE.Vector3(side * (W - 0.35), 3.55, sconceZ + arm);
      post(batch, at.x, 3.25, at.z, 0.025, 0.25, { color: PALETTE.cream });
      batch.add(SHAPES.sphere, place(at.x, at.y, at.z, 0.06, 0.08, 0.06), { color: PALETTE.cream, emit: CANDLE, emitStrength: 5, glow: Glow.flicker, seed: (sconceZ * 0.17 + arm + 5) % 1 });
      glow.add(at, CANDLE, 1.6, 0.35, { glow: Glow.flicker, seed: (sconceZ * 0.17 + arm + 5) % 1 });
    }
    lights.add({ position: new THREE.Vector3(side * (W - 0.6), 3.5, sconceZ), color: CANDLE.clone().multiplyScalar(0.9), range: 1.3 });
  }
}

function buildColonnades(batch: SolidBatch, lights: LightGrid): void {
  // A fluted shaft: 32 sides pushed in and out.
  const shaft = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false);
  const position = shaft.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius > 1e-3) {
      const angle = Math.atan2(z, x);
      const flute = 1 - 0.07 * Math.max(Math.cos(angle * 16), 0);
      position.setX(i, (x / radius) * flute);
      position.setZ(i, (z / radius) * flute);
    }
  }
  shaft.computeVertexNormals();
  const capital = new THREE.CylinderGeometry(1.45, 1, 1, 24);

  for (const side of [-1, 1]) {
    const x = side * COLUMN_X;
    for (const z of COLUMN_Z) {
      cuboid(batch, x - 0.85, x + 0.85, 0, 0.9, z - 0.85, z + 0.85, { color: PALETTE.woodDark, surface: Surface.lacquer });
      post(batch, x, 0.9, z, 0.72, 0.25, { color: PALETTE.gold, surface: Surface.gold }, true);
      batch.add(shaft, place(x, 1.15 + (COLUMN_TOP - 0.8 - 1.15) / 2, z, 0.55, COLUMN_TOP - 0.8 - 1.15, 0.55), { color: PALETTE.gold, surface: Surface.gold });
      batch.add(capital, place(x, COLUMN_TOP - 0.4, z, 0.6, 0.8, 0.6), { color: PALETTE.gold, surface: Surface.gold });
      cuboid(batch, x - 0.95, x + 0.95, COLUMN_TOP - 0.05, COLUMN_TOP + 0.05, z - 0.95, z + 0.95, { color: PALETTE.gold, surface: Surface.gold });
    }
    // Entablature along the colonnade.
    cuboid(batch, x - 0.95, x + 0.95, COLUMN_TOP, BEAM_TOP, -D, 0, { color: PALETTE.woodDark, surface: Surface.lacquer });
    for (const y of [COLUMN_TOP + 0.1, BEAM_TOP - 0.15]) {
      cuboid(batch, x - 1.0, x + 1.0, y - 0.07, y + 0.07, -D, 0, { color: PALETTE.gold, surface: Surface.gold });
    }
    // Arches between the columns: a wooden spandrel with a gilded archivolt.
    const half = 4.35;
    const spring = COLUMN_TOP - half - 0.15;
    const spandrel = new THREE.Shape();
    spandrel.moveTo(-half, spring);
    spandrel.lineTo(-half, COLUMN_TOP);
    spandrel.lineTo(half, COLUMN_TOP);
    spandrel.lineTo(half, spring);
    spandrel.absarc(0, spring, half, 0, Math.PI, false);
    const panel = new THREE.ExtrudeGeometry(spandrel, { depth: 0.7, bevelEnabled: false, curveSegments: 16 });
    panel.translate(0, 0, -0.35);
    const archivolt = new THREE.TorusGeometry(half, 0.16, 6, 24, Math.PI);
    for (let i = 0; i < COLUMN_Z.length - 1; i++) {
      const z = ((COLUMN_Z[i] ?? 0) + (COLUMN_Z[i + 1] ?? 0)) / 2;
      batch.add(panel, place(x, 0, z, 1, 1, 1, 0, Math.PI / 2), { color: PALETTE.woodMid, surface: Surface.lacquer });
      for (const face of [-0.38, 0.38]) {
        batch.add(archivolt, place(x + face, spring, z, 1, 1, 1, 0, Math.PI / 2), { color: PALETTE.gold, surface: Surface.gold });
      }
    }
    // Cove light on top of the entablature washes the ceiling.
    for (let z = -5; z > -D; z -= 10) {
      lights.add({ position: new THREE.Vector3(x, 14, z), color: WARM.clone().multiplyScalar(1.4), range: 4 });
    }
  }
}

function buildBackWall(batch: SolidBatch, glow: GlowBatch, lights: LightGrid): void {
  const wall = new THREE.PlaneGeometry(2 * W, H, 24, 9);
  batch.add(wall, place(0, H / 2, -D), { color: PALETTE.woodPanel, surface: Surface.lacquer });
  // Gilded Art Deco sunburst over the bar.
  const burst = new THREE.PlaneGeometry(26, 10);
  batch.add(burst, place(0, 12.4, -D + 0.04), { color: PALETTE.goldDeep, emit: 0xffb850, emitStrength: 0.9, glow: Glow.sunburst });
  cuboid(batch, -13.4, 13.4, 7.1, 7.4, -D, -D + 0.3, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, -13.4, -13.0, 7.1, 17.4, -D, -D + 0.3, { color: PALETTE.gold, surface: Surface.gold });
  cuboid(batch, 13.0, 13.4, 7.1, 17.4, -D, -D + 0.3, { color: PALETTE.gold, surface: Surface.gold });
  lights.add({ position: new THREE.Vector3(0, 12, -D + 4), color: new THREE.Color(1.0, 0.7, 0.35).multiplyScalar(3), range: 6 });
  glow.add(new THREE.Vector3(0, 11, -D + 1), 0xffb060, 0.12, 12, { seed: 0.4 });
}

// --- Gaming floor -----------------------------------------------------------------------------------------

function buildTables(batch: SolidBatch, people: SolidBatch, glow: GlowBatch, lights: LightGrid, rand: () => number): void {
  const top = new THREE.CylinderGeometry(1, 1, 1, 28);
  const rim = new THREE.TorusGeometry(1, 0.09, 6, 28);
  rim.rotateX(Math.PI / 2);
  let index = 0;
  for (const side of [-1, 1]) {
    for (let z = -10; z > -D + 12; z -= 10) {
      if (Math.abs(z - CROSS_AISLE_Z) < 1) {
        continue;
      }
      index++;
      const x = side * 6;
      const roulette = index % 3 === 0;
      const length = roulette ? 1.5 : 1.25;
      const width = roulette ? 0.75 : 0.8;
      cuboid(batch, x - 0.4, x + 0.4, 0, 0.72, z - length * 0.6, z + length * 0.6, { color: PALETTE.woodDark, surface: Surface.lacquer });
      batch.add(top, place(x, 0.76, z, width, 0.08, length), { color: PALETTE.felt, surface: Surface.felt });
      batch.add(rim, place(x, 0.8, z, width, 1, length), { color: 0x3a1c10, surface: Surface.lacquer });
      if (roulette) {
        post(batch, x, 0.8, z - length * 0.62, 0.36, 0.1, { color: PALETTE.woodMid, surface: Surface.lacquer }, true);
        post(batch, x, 0.9, z - length * 0.62, 0.22, 0.04, { color: PALETTE.gold, surface: Surface.gold }, true);
      }
      // Pendant lamp over the table: a green glass shade on a gilded rod, its light pooled on the felt.
      const lampY = 2.4;
      for (const dz of roulette ? [-0.6, 0.6] : [0]) {
        post(batch, x, lampY + 0.2, z + dz, 0.02, 1.4, { color: PALETTE.gold, surface: Surface.gold });
        batch.add(SHAPES.cone, place(x, lampY + 0.1, z + dz, 0.32, 0.22, 0.32), { color: 0x0c3a20, surface: Surface.lacquer, emit: 0x30a050, emitStrength: 0.25, glow: Glow.steady });
        batch.add(SHAPES.cylinder, place(x, lampY - 0.005, z + dz, 0.3, 0.01, 0.3), { color: PALETTE.cream, emit: 0xffe0b0, emitStrength: 4, glow: Glow.steady });
        glow.add(new THREE.Vector3(x, lampY - 0.05, z + dz), 0xffd8a0, 0.7, 0.45, { seed: rand() });
      }
      lights.add({ position: new THREE.Vector3(x, lampY - 0.2, z), color: new THREE.Color(1.0, 0.88, 0.65).multiplyScalar(3.2), range: 1.4 });
      // Chairs round the long sides and the player end; the dealer stands at the inner side.
      const seats = 6;
      for (let s = 0; s < seats; s++) {
        const angle = Math.PI * 0.2 + (s / (seats - 1)) * Math.PI * 1.6;
        const cx = x - side * Math.cos(angle) * (width + 0.55);
        const cz = z + Math.sin(angle) * (length + 0.45);
        const yaw = Math.atan2(x - cx, z - cz);
        chair(batch, cx, cz, yaw);
        if (rand() < 0.55) {
          person(people, cx, cz, yaw, rand, true);
        }
      }
      const dealerX = x + side * (width + 0.45);
      person(people, dealerX, z, Math.atan2(x - dealerX, 0), rand, false, true);
    }
  }
}

function chair(batch: SolidBatch, x: number, z: number, yaw: number): void {
  const at = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) => {
    const matrix = place(x, 0, z, 1, 1, 1, 0, yaw).multiply(place(dx, dy, dz, sx, sy, sz));
    return matrix;
  };
  batch.add(SHAPES.box, at(0, 0.48, 0, 0.5, 0.1, 0.5), { color: PALETTE.leather, surface: Surface.velvet });
  batch.add(SHAPES.box, at(0, 0.22, 0, 0.1, 0.44, 0.1), { color: PALETTE.goldDeep, surface: Surface.gold });
  batch.add(SHAPES.box, at(0, 0.02, 0, 0.44, 0.04, 0.44), { color: PALETTE.goldDeep, surface: Surface.gold });
  batch.add(SHAPES.box, at(0, 0.95, -0.24, 0.5, 0.85, 0.08), { color: PALETTE.leather, surface: Surface.velvet });
  batch.add(SHAPES.box, at(0, 1.39, -0.25, 0.54, 0.06, 0.1), { color: PALETTE.gold, surface: Surface.gold });
}

const OUTFITS = [0x26262e, 0x34343c, 0x3a2a22, 0x8a1824, 0x1e2c48, 0x4c4c56, 0x6e5630, 0xd8d0c4, 0x5a1a40, 0x1c1c22];

// A patron or a dealer, low-poly. Seated patrons face the table at `yaw`.
function person(batch: SolidBatch, x: number, z: number, yaw: number, rand: () => number, seated: boolean, dealer = false, walk?: [number, number, number, number]): void {
  const outfit = dealer ? 0xe8e4dc : OUTFITS[Math.floor(rand() * OUTFITS.length)] ?? 0x101014;
  const seed = rand();
  const motion = walk ? Motion.walk : Motion.none;
  const paint = (color: number): Paint => ({ color, seed, motion, pivot: walk });
  const at = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) => place(x, 0, z, 1, 1, 1, 0, yaw).multiply(place(dx, dy, dz, sx, sy, sz));
  const scale = 0.92 + rand() * 0.16;
  if (seated) {
    batch.add(SHAPES.capsule, at(0, 0.82 * scale, -0.05, 0.19, 0.22 * scale, 0.14), paint(outfit));
    batch.add(SHAPES.box, at(0, 0.56, 0.18, 0.34, 0.14, 0.45), paint(0x141418));
    batch.add(SHAPES.sphere, at(0, 1.22 * scale, -0.02, 0.105, 0.125, 0.11), paint(PALETTE.skin));
    return;
  }
  const dress = !dealer && rand() < 0.3;
  if (dress) {
    batch.add(SHAPES.cone, at(0, 0.55 * scale, 0, 0.26, 1.1 * scale, 0.2), paint(outfit));
  } else {
    batch.add(SHAPES.box, at(0, 0.45 * scale, 0, 0.3, 0.9 * scale, 0.18), paint(dealer ? 0x101014 : 0x121216));
  }
  batch.add(SHAPES.capsule, at(0, 1.25 * scale, 0, 0.2, 0.2 * scale, 0.13), paint(dealer ? 0x16161a : outfit));
  if (dealer) {
    batch.add(SHAPES.box, at(0, 1.3 * scale, 0.09, 0.14, 0.4 * scale, 0.04), paint(0xe8e4dc));
  }
  batch.add(SHAPES.sphere, at(0, 1.66 * scale, 0, 0.105, 0.125, 0.11), paint(PALETTE.skin));
}

const SLOT_THEMES = [
  new THREE.Color(1.0, 0.3, 0.1),
  new THREE.Color(0.3, 0.5, 1.0),
  new THREE.Color(1.0, 0.75, 0.15),
  new THREE.Color(0.85, 0.2, 0.9),
  new THREE.Color(0.2, 0.9, 0.5),
];

function buildSlots(batch: SolidBatch, people: SolidBatch, glow: GlowBatch, lights: LightGrid, rand: () => number): void {
  const count = 10;
  const pitch = 0.85;
  let bank = 0;
  for (const side of [-1, 1]) {
    for (const rowZ of SLOT_ROWS) {
      const theme = SLOT_THEMES[bank % SLOT_THEMES.length] ?? WARM;
      bank++;
      const x0 = side * 12.6;
      const length = (count - 1) * pitch;
      const xMin = Math.min(x0, x0 + side * length) - 0.45;
      const xMax = Math.max(x0, x0 + side * length) + 0.45;
      // Sign over the bank on two gilded posts, lit on both faces.
      for (const postX of [xMin + 0.15, xMax - 0.15]) {
        post(batch, postX, 0, rowZ, 0.1, 3.2, { color: PALETTE.gold, surface: Surface.gold });
      }
      cuboid(batch, xMin, xMax, 3.2, 3.9, rowZ - 0.2, rowZ + 0.2, { color: PALETTE.cabinet, surface: Surface.lacquer });
      for (const face of [-1, 1]) {
        const yaw = face > 0 ? 0 : Math.PI;
        const centerX = (xMin + xMax) / 2;
        const signZ = rowZ + face * 0.205;
        const sign = new THREE.PlaneGeometry(xMax - xMin - 0.3, 0.3);
        batch.add(sign, place(centerX, 3.55, signZ, 1, 1, 1, 0, yaw), { color: PALETTE.cabinet, emit: theme.clone().lerp(WARM, 0.3), emitStrength: 1.1, glow: Glow.steady, seed: rand() });
        // Marquee bulbs chasing along the top and the bottom edge of the sign.
        for (const edgeY of [3.3, 3.8]) {
          const marquee = new THREE.PlaneGeometry(xMax - xMin - 0.1, 0.07);
          const uv = marquee.getAttribute("uv");
          for (let i = 0; i < uv.count; i++) {
            uv.setX(i, uv.getX(i) * 6);
          }
          batch.add(marquee, place(centerX, edgeY, signZ + face * 0.002, 1, 1, 1, 0, yaw), { color: PALETTE.cabinet, emit: 0xffd890, emitStrength: 2.2, glow: Glow.chase, seed: rand() });
        }
        glow.add(new THREE.Vector3((xMin + xMax) / 2, 3.55, rowZ + face * 0.4), theme, 0.25, 3.2, { seed: rand() });
      }
      for (let k = 0; k < count; k++) {
        const x = x0 + side * k * pitch;
        for (const face of [-1, 1]) {
          slotMachine(batch, glow, x, rowZ, face, theme, rand);
          if (rand() < 0.3) {
            const seatZ = rowZ + face * 1.05;
            person(people, x, seatZ, face > 0 ? Math.PI : 0, rand, true);
          }
        }
      }
      for (const face of [-1, 1]) {
        for (const t of [0.2, 0.5, 0.8]) {
          lights.add({ position: new THREE.Vector3(xMin + (xMax - xMin) * t, 1.7, rowZ + face * 1.2), color: theme.clone().lerp(WARM, 0.4).multiplyScalar(0.9), range: 1.6 });
        }
      }
    }
  }
}

// One slot machine, back to back with its pair: `face` = 1 faces +Z (the viewer), -1 faces -Z.
function slotMachine(batch: SolidBatch, glow: GlowBatch, x: number, rowZ: number, face: number, theme: THREE.Color, rand: () => number): void {
  const yaw = face > 0 ? 0 : Math.PI;
  const at = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, rx = 0) => place(x, 0, rowZ, 1, 1, 1, 0, yaw).multiply(place(dx, dy, dz, sx, sy, sz, rx));
  const seed = rand();
  batch.add(SHAPES.box, at(0, 0.48, 0.38, 0.78, 0.96, 0.66), { color: PALETTE.cabinet, surface: Surface.lacquer });
  batch.add(SHAPES.box, at(0, 1.5, 0.28, 0.78, 1.08, 0.46), { color: PALETTE.cabinet, surface: Surface.lacquer });
  batch.add(SHAPES.box, at(0, 1.0, 0.62, 0.74, 0.08, 0.3, -0.35), { color: 0x20181c, emit: theme, emitStrength: 0.5, glow: Glow.steady, seed });
  batch.add(SHAPES.plane, at(0, 1.55, 0.515, 0.62, 0.6, 1), { color: 0x000000, emit: 0xffffff, emitStrength: 1.3, glow: Glow.slotScreen, seed });
  batch.add(SHAPES.box, at(0, 2.24, 0.3, 0.78, 0.4, 0.42), { color: PALETTE.goldDeep, surface: Surface.gold });
  batch.add(SHAPES.plane, at(0, 2.24, 0.515, 0.7, 0.3, 1), { color: 0x000000, emit: theme, emitStrength: 2.2, glow: Glow.chase, seed });
  for (const edge of [-0.4, 0.4]) {
    batch.add(SHAPES.box, at(edge, 1.25, 0.6, 0.03, 1.9, 0.03), { color: 0x000000, emit: theme, emitStrength: 1.2, glow: Glow.steady, seed });
  }
  // Stool.
  batch.add(SHAPES.cylinder, at(0, 0.36, 1.05, 0.04, 0.72, 0.04), { color: PALETTE.gold, surface: Surface.gold });
  batch.add(SHAPES.cylinder, at(0, 0.74, 1.05, 0.22, 0.08, 0.22), { color: 0x4a0a10, surface: Surface.velvet });
  glow.add(new THREE.Vector3(x, 2.24, rowZ + face * 0.7), theme, 0.5, 0.55, { seed });
  glow.add(new THREE.Vector3(x, 1.55, rowZ + face * 0.65), 0x9070ff, 0.18, 0.5, { seed });
}

function buildBar(batch: SolidBatch, people: SolidBatch, glow: GlowBatch, lights: LightGrid, rand: () => number): void {
  const front = -D + 7;
  cuboid(batch, -12, 12, 0, 1.1, front - 1.0, front, { color: PALETTE.woodMid, surface: Surface.lacquer });
  cuboid(batch, -12.2, 12.2, 1.1, 1.17, front - 1.15, front + 0.1, { color: PALETTE.marbleTop, surface: Surface.lacquer });
  cuboid(batch, -12, 12, 0.92, 1.0, front + 0.001, front + 0.03, { color: 0x000000, emit: 0xffb060, emitStrength: 2.4, glow: Glow.steady });
  batch.add(SHAPES.cylinderFine, place(0, 0.22, front + 0.3, 0.04, 24, 0.04, 0, 0, Math.PI / 2), { color: PALETTE.gold, surface: Surface.gold });
  for (let x = -11; x <= 11; x += 1.5) {
    post(batch, x, 0, front + 0.75, 0.04, 0.75, { color: PALETTE.gold, surface: Surface.gold });
    post(batch, x, 0.75, front + 0.75, 0.22, 0.08, { color: 0x4a0a10, surface: Surface.velvet });
    if (rand() < 0.45) {
      person(people, x, front + 0.75, Math.PI, rand, true);
    }
  }
  // Back bar: cabinet, backlit panel, gilded shelves full of glowing bottles.
  const back = -D + 0.6;
  cuboid(batch, -13, 13, 0, 1.05, back - 0.6, back, { color: PALETTE.woodDark, surface: Surface.lacquer });
  const panel = new THREE.PlaneGeometry(26, 3.0);
  batch.add(panel, place(0, 2.65, -D + 0.05), { color: 0x000000, emit: 0xffa850, emitStrength: 0.7, glow: Glow.steady, seed: 0.2 });
  const bottleColors = [0xffb040, 0xff7020, 0x60ff80, 0xfff0d0, 0xff3040, 0x80c0ff];
  for (const y of [1.55, 2.35, 3.15]) {
    cuboid(batch, -13, 13, y - 0.05, y, -D + 0.05, -D + 0.45, { color: PALETTE.gold, surface: Surface.gold });
    for (let x = -12.8; x < 12.8; x += 0.22) {
      if (rand() < 0.15) {
        continue;
      }
      const color = bottleColors[Math.floor(rand() * bottleColors.length)] ?? 0xffb040;
      const height = 0.26 + rand() * 0.12;
      post(batch, x, y, -D + 0.25, 0.045, height, { color: 0x101010, emit: color, emitStrength: 0.9 + rand() * 0.8, glow: Glow.steady, seed: rand() });
    }
  }
  for (let x = -10; x <= 10; x += 4) {
    lights.add({ position: new THREE.Vector3(x, 2.4, -D + 2.5), color: new THREE.Color(1.0, 0.65, 0.3).multiplyScalar(1.8), range: 2.2 });
    glow.add(new THREE.Vector3(x, 2.6, -D + 0.6), 0xffa040, 0.35, 2.2, { seed: rand() });
  }
  for (const x of [-7, 0, 6]) {
    person(people, x, -D + 3.2, 0, rand, false, true);
  }
}

// --- Chandeliers ------------------------------------------------------------------------------------------

function chandelier(batch: SolidBatch, glow: GlowBatch, lights: LightGrid, x: number, z: number, bottom: number, scale: number, seed: number, shaft: boolean): THREE.Vector4 {
  const pivot: [number, number, number, number] = [x, H, z, 0];
  const sway = (paint: Paint): Paint => ({ ...paint, motion: Motion.sway, pivot, seed: paint.seed ?? seed });
  const s = scale;
  const body = bottom + 1.0 * s;
  const crown = body + 1.7 * s;
  post(batch, x, crown, z, 0.03, H - crown, sway({ color: PALETTE.gold, surface: Surface.gold }));
  post(batch, x, bottom + 0.3 * s, z, 0.07 * s, crown - bottom - 0.3 * s, sway({ color: PALETTE.gold, surface: Surface.gold }));
  batch.add(SHAPES.sphere, place(x, crown, z, 0.25 * s, 0.18 * s, 0.25 * s), sway({ color: PALETTE.gold, surface: Surface.gold }));
  const tiers = [
    { radius: 1.5, height: 0, candles: 16, strands: 30, drops: 4 },
    { radius: 1.05, height: 0.6, candles: 12, strands: 22, drops: 3 },
    { radius: 0.6, height: 1.15, candles: 8, strands: 14, drops: 3 },
  ];
  const ring = new THREE.TorusGeometry(1, 0.03, 4, 36);
  ring.rotateX(Math.PI / 2);
  const crystalColor = 0xf4ece0;
  for (const tier of tiers) {
    const r = tier.radius * s;
    const y = body + tier.height * s;
    batch.add(ring, place(x, y, z, r, s, r), sway({ color: PALETTE.gold, surface: Surface.gold }));
    for (let c = 0; c < tier.candles; c++) {
      const angle = (c / tier.candles) * Math.PI * 2 + tier.height;
      const cx = x + Math.cos(angle) * r;
      const cz = z + Math.sin(angle) * r;
      batch.add(SHAPES.box, place(cx, y + 0.07 * s, cz, 0.045 * s, 0.14 * s, 0.045 * s), sway({ color: PALETTE.cream }));
      const bulbSeed = (seed * 7 + c * 0.137 + tier.height) % 1;
      batch.add(SHAPES.octahedron, place(cx, y + 0.19 * s, cz, 0.05 * s, 0.075 * s, 0.05 * s), sway({ color: PALETTE.cream, emit: CANDLE, emitStrength: 5, glow: Glow.flicker, seed: bulbSeed }));
      glow.add(new THREE.Vector3(cx, y + 0.19 * s, cz), CANDLE, 1.0, 0.2 * s, { glow: Glow.flicker, seed: bulbSeed });
    }
    for (let k = 0; k < tier.strands; k++) {
      const angle = ((k + 0.5) / tier.strands) * Math.PI * 2;
      for (let d = 0; d < tier.drops; d++) {
        const dropR = r * (1 - d * 0.04);
        const crystalSeed = (seed * 13 + k * 0.071 + d * 0.31 + tier.radius) % 1;
        batch.add(SHAPES.octahedron, place(x + Math.cos(angle) * dropR, y - (0.1 + d * 0.13) * s, z + Math.sin(angle) * dropR, 0.035 * s, 0.06 * s, 0.035 * s, 0, angle), sway({ color: crystalColor, emit: 0xfff4e0, emitStrength: 0.9, glow: Glow.crystal, seed: crystalSeed }));
      }
      // Swag of crystal beads from strand to strand.
      if (k % 2 === 0) {
        const next = ((k + 1.5) / tier.strands) * Math.PI * 2;
        const mid = (angle + next) / 2;
        batch.add(SHAPES.octahedron, place(x + Math.cos(mid) * r * 1.02, y - 0.16 * s, z + Math.sin(mid) * r * 1.02, 0.025 * s, 0.025 * s, 0.025 * s), sway({ color: crystalColor, emit: 0xfff4e0, emitStrength: 0.9, glow: Glow.crystal, seed: (seed * 5 + k * 0.093) % 1 }));
      }
    }
  }
  // Crystal bowl and drop at the bottom.
  batch.add(SHAPES.octahedron, place(x, bottom + 0.4 * s, z, 0.32 * s, 0.6 * s, 0.32 * s), sway({ color: crystalColor, emit: 0xfff4e0, emitStrength: 1.1, glow: Glow.crystal, seed: (seed + 0.37) % 1 }));
  for (let k = 0; k < 10; k++) {
    const angle = k * 2.399 + seed * 6;
    const radius = (0.4 + ((k * 0.37) % 1) * 1.1) * s;
    const y = body + (((k * 0.53) % 1) * 1.2 - 0.3) * s;
    glow.add(new THREE.Vector3(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius), 0xfff8f0, 2.5, 0.35 * s, { kind: Sprite.star, seed: (seed * 3 + k * 0.173) % 1 });
  }
  const center = new THREE.Vector3(x, body + 0.4 * s, z);
  glow.add(center, WARM, 0.28, 2.6 * s, { seed });
  if (shaft) {
    glow.add(new THREE.Vector3(x, bottom, z), WARM, 0.018, 2.2 * s, { kind: Sprite.shaft, length: bottom, seed });
  }
  lights.add({ position: center, color: WARM.clone().multiplyScalar(7 * s), range: 3.2 * s });
  return new THREE.Vector4(center.x, center.y, center.z, scale);
}

// --- Assembly ---------------------------------------------------------------------------------------------

function buildWalkers(people: SolidBatch, rand: () => number): void {
  // Paths: [x, z, direction x, direction z, range].
  const paths: [number, number, number, number, number][] = [
    [-1.2, -30, 0, 1, 40],
    [1.4, -45, 0, 1, 50],
    [0.3, -70, 0, 1, 30],
    [-0.8, -55, 0, 1, 60],
    [1.9, -25, 0, 1, 30],
    [10.6, -40, 0, 1, 50],
    [-10.8, -45, 0, 1, 60],
    [-22, -40, 0, 1, 40],
    [21.8, -60, 0, 1, 50],
    [-12, CROSS_AISLE_Z, 1, 0, 20],
    [14, CROSS_AISLE_Z + 0.8, 1, 0, 16],
    [-17, -20, 1, 0, 8],
  ];
  for (const [x, z, dx, dz, range] of paths) {
    const speed = 0.9 + rand() * 0.5;
    person(people, x, z, Math.atan2(dx, dz), rand, false, false, [dx, dz, speed, range]);
  }
  // Standing groups chatting in the aisles.
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * 6;
    const z = -6 - rand() * 84;
    if (Math.abs(z - CROSS_AISLE_Z) < 2) {
      continue;
    }
    person(people, x, z, rand() * Math.PI * 2, rand, false);
  }
  for (let i = 0; i < 14; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    person(people, side * (10.5 + rand() * 0.6), -6 - rand() * 84, rand() * Math.PI * 2, rand, false);
  }
}

function buildHaze(glow: GlowBatch, rand: () => number): void {
  for (let i = 0; i < 18; i++) {
    const x = (rand() - 0.5) * 36;
    const z = -8 - rand() * 86;
    const y = 4 + rand() * 10;
    glow.add(new THREE.Vector3(x, y, z), 0xffb070, 0.03, 9 + rand() * 6, { kind: Sprite.haze, seed: rand() });
  }
}

function ambient(normalY: number, height: number, target: THREE.Color): THREE.Color {
  // Warm bounce: a little more from above, a little more up high where the cove light fills the room.
  const up = 0.5 + 0.5 * normalY;
  const k = 1 + 0.4 * Math.min(height / H, 1);
  return target.setRGB((0.05 + 0.03 * up) * k, (0.032 + 0.02 * up) * k, (0.02 + 0.01 * up) * k);
}

function createDistantCasino(options: DistantCasinoOptions = {}): DistantCasino {
  const rand = random(20261008);
  const lights = new LightGrid();
  const architecture = new SolidBatch();
  const floor = new SolidBatch();
  const fixtures = new SolidBatch();
  const people = new SolidBatch();
  const glow = new GlowBatch();

  const glintList: THREE.Vector4[] = [];
  NAVE_CHANDELIERS.forEach((z, i) => {
    glintList.push(chandelier(fixtures, glow, lights, 0, z, 7.2, 1.25, (i * 0.618) % 1, true));
  });
  for (const side of [-1, 1]) {
    AISLE_CHANDELIERS.forEach((z, i) => {
      glintList.push(chandelier(fixtures, glow, lights, side * 16.5, z, 6.8, 0.8, (i * 0.414 + side * 0.25 + 1) % 1, false));
    });
  }
  buildShell(architecture, glow, lights);
  if (options.foyer) {
    buildFoyer(architecture, fixtures, glow, lights, glintList, options.foyer.length, options.foyer.open);
  }
  buildTables(floor, people, glow, lights, rand);
  buildSlots(floor, people, glow, lights, rand);
  buildBar(floor, people, glow, lights, rand);
  buildWalkers(people, rand);
  buildHaze(glow, rand);

  const shared = {
    uTime: { value: 0 },
    uLife: { value: options.life ?? 1 },
    uExposure: { value: options.exposure ?? 1 },
    uCameraLocal: { value: new THREE.Vector3() },
    uHazeColor: { value: new THREE.Color(0.085, 0.05, 0.026) },
    uHazeDensity: { value: options.haze ?? 0.012 },
    uPixelAngle: { value: 0.001 },
  };
  const glints = glintList.map((g) => new THREE.Vector4(g.x, g.y, g.z, g.w * 0.8));
  const solidMaterial = new THREE.ShaderMaterial({
    name: "Distant Casino",
    vertexShader: solidVertex,
    fragmentShader: solidFragment.replace("// @common", commonChunk),
    defines: { GLINT_COUNT: String(glints.length) },
    uniforms: { ...shared, uGlints: { value: glints } },
  });
  const glowMaterial = new THREE.ShaderMaterial({
    name: "Distant Casino Glow",
    vertexShader: glowVertex,
    fragmentShader: glowFragment.replace("// @common", commonChunk),
    uniforms: shared,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const group = named(new THREE.Group(), "Distant Casino", true);
  group.userData.auditIgnore = true;
  const inverse = new THREE.Matrix4();
  const drawingBuffer = new THREE.Vector2();
  // Every mesh sits at the group origin, so one camera position in the group frame serves all of them.
  const syncCamera = (renderer: THREE.WebGLRenderer, camera: THREE.Camera, mesh: THREE.Object3D) => {
    inverse.copy(mesh.matrixWorld).invert();
    shared.uCameraLocal.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
    if (camera instanceof THREE.PerspectiveCamera) {
      renderer.getDrawingBufferSize(drawingBuffer);
      const scale = mesh.matrixWorld.getMaxScaleOnAxis();
      shared.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (camera.zoom * Math.max(drawingBuffer.y, 1) * scale);
    }
  };
  // The vertex shader moves strolling patrons and grows the glow sprites, so their geometry bounds are too small.
  // They get the bounds of the whole hall with a margin for the largest halo instead: the hall is still culled
  // as a whole when the camera looks away from it.
  const hallBounds = new THREE.Sphere(new THREE.Vector3(0, H / 2, -D / 2), Math.hypot(W, H / 2, D / 2) + 15);
  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, moving: boolean) => {
    const mesh = named(new THREE.Mesh(geometry, material), name);
    mesh.userData.auditIgnore = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (moving) {
      geometry.boundingSphere = hallBounds.clone();
    }
    mesh.onBeforeRender = (renderer, _scene, camera) => syncCamera(renderer, camera, mesh);
    group.add(mesh);
    return mesh;
  };
  addMesh(architecture.build(lights, ambient), solidMaterial, "Architecture", false);
  addMesh(floor.build(lights, ambient), solidMaterial, "Gaming Floor", false);
  addMesh(fixtures.build(lights, ambient), solidMaterial, "Chandeliers", false);
  addMesh(people.build(lights, ambient), solidMaterial, "Patrons", true);
  const glowMesh = addMesh(glow.build(), glowMaterial, "Glow", true);
  // After the opaque hall, before the studio's own transparent objects are sorted in.
  glowMesh.renderOrder = 1;

  const update = (time: number) => {
    shared.uTime.value = time;
  };
  update(0);
  return { group, update };
}

export { createDistantCasino, DISTANT_CASINO_SIZE, type DistantCasino, type DistantCasinoOptions };
