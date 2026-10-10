import * as THREE from "three";
import { annexFloorPlan } from "./annex";
import {
  Batch,
  GLOW,
  archBand,
  archOpening,
  at,
  candelabrum,
  chandelier,
  clipPolygon,
  cuboid,
  drape,
  drum,
  mirrored,
  palm,
  person,
  planFace,
  planPrism,
  ring,
  seededRandom,
  slotMachine,
  spandrel,
  spanAt,
  statue,
} from "./casinoKit";
import { createCasinoMaterials } from "./casinoShading";
import type { CasinoLighting, CasinoMaterials } from "./casinoShading";
import { named } from "./geometry";

// The casino hall round the Game Show balcony (annex.ts): real geometry, rebuilt one to one from the casino photo
// (assets/casino-panorama-center.png). Because it is real geometry, the perspective holds from every camera position.
//
// The hall frame: u runs along the nave, v across it (to the right of a camera that looks down the nave), y is world y.
// The nave axis starts at the rest pose of the Bonus Show camera (cameraRig.ts) and runs along its line of sight
// (azimuth 33 degrees from +x towards +z), so from that camera the hall looks like the photo: the vanishing point of
// the nave in the middle of the frame, behind the wheel. The balcony is a gallery at the near end of the nave:
// its tip points into the nave at u = 15.
//
// What the photo shows, and where it stands (u, v in metres; heights in world y):
// - the casino floor 3.4 m under the balcony floor, so the camera (3.7 m over the balcony) is 7.1 m over the casino floor,
//   the height that the table and aisle widths of the photo give;
// - the nave between two rows of 7 black marble columns (v = +-12.5, from u = 15 every 13 m), 18.4 m tall, with gold
//   bands, art deco fan capitals and an entablature at 15..16.5; an elliptic barrel vault with gold ribs over it (crown 27);
// - side aisles out to the outer walls at v = +-24, with a gallery at 6.5 (gold balustrade, gold statues, lamps on its
//   fascia), arches with red velvet drapes on both levels, and tall night windows in the outer walls;
// - three tiered crystal chandeliers on the axis at u = 22, 38, 54, their main rings at y = 12, 4.6, 3.6 and 3 m wide;
// - the gaming floor: a black marble aisle with gold inlay on the axis, lanterns along it, red carpet with gold fans,
//   green tables with lamps, banks of slot machines with glowing screens, palms, guests;
// - the bar with backlit shelves under a great arched window at the far end (u = 100).
// There are no real lights: casinoShading.ts bakes the light of the lamps into every surface.

const deg = THREE.MathUtils.degToRad;

const HALL = {
  // The rest pose of the Bonus Show camera on the plan (x, z), and its line of sight.
  origin: new THREE.Vector2(10.82, 16.38),
  azimuth: deg(33),
  floor: -3.4,
  // The back wall behind the balcony, and the far wall.
  back: -8,
  end: 100,
  // The column lines and the outer walls, as |v|.
  nave: 12.5,
  outer: 24,
  wall: 0.6,
  // The top of the walls and the spring of the vault.
  ceiling: 16.5,
  vaultRise: 10.5,
  // The vault starts on the back faces of the end piers.
  vaultStart: 9.4,
  firstColumn: 15,
  bay: 13,
  columns: 7,
  // The marble aisle on the axis, as |v|.
  aisle: 2.2,
};

const COLUMN = { radius: 1.0, plinth: 1.4, plinthTop: HALL.floor + 1.4, drumTop: HALL.floor + 2.2, capitalBottom: 13.0, capitalTop: 14.6, top: 15.0 };
const END_PIER = { u: 10.5, half: 1.1 };
const GALLERY = { front: 13.6, floor: 6.5, slab: 0.9, railTop: 7.65 };
const GROUND_ARCH = { spring: 1.0, rise: 3.6, top: GALLERY.floor - GALLERY.slab };
const UPPER_ARCH = { spring: 10.5, rise: 3.0, top: COLUMN.top };
const CHANDELIERS = [
  { u: 22, diameter: 4.6 },
  { u: 38, diameter: 3.6 },
  { u: 54, diameter: 3.0 },
];
const CHANDELIER_RING = 12;
const LANTERNS = { first: 18, period: 8, last: 98, v: 2.9, height: 2.5 };
const TABLES = { first: 20, period: 12, last: 80, v: 6.5, radius: 1.2, top: 0.8, lamp: 1.85 };
const SLOT_ROWS = [16.8, 21.0];

const columnU = (index: number) => HALL.firstColumn + index * HALL.bay;

// The hall frame on the plan: (u, v) to world (x, z) and back.
function toWorld(u: number, v: number): THREE.Vector2 {
  const c = Math.cos(HALL.azimuth);
  const s = Math.sin(HALL.azimuth);
  return new THREE.Vector2(HALL.origin.x + u * c - v * s, HALL.origin.y + u * s + v * c);
}

function toHall(x: number, z: number): THREE.Vector2 {
  const c = Math.cos(HALL.azimuth);
  const s = Math.sin(HALL.azimuth);
  const dx = x - HALL.origin.x;
  const dz = z - HALL.origin.y;
  return new THREE.Vector2(dx * c + dz * s, -dx * s + dz * c);
}

// The edges of the balcony on the plan, with its fascia (annex.ts): the casino side (x), the front (z) and the back fascia line where the balcony ends towards the colonnade.
function balconyEdges() {
  const plan = annexFloorPlan();
  const fascia = 0.2;
  return {
    side: Math.max(...plan.map((point) => point.x)) + fascia,
    front: Math.max(...plan.map((point) => point.y)) + fascia,
    back: Math.min(...plan.filter((point) => point.x > 20).map((point) => point.y)) - fascia,
    fasciaBottom: -0.6,
  };
}

// The plan of the hall in the hall frame, counter-clockwise seen from above with v down:
// the left outer wall, the far wall, the right outer wall, the back wall, then along the front of the balcony
// to its tip, and back along its casino side.
function hallPlan(edges: ReturnType<typeof balconyEdges>) {
  const c = Math.cos(HALL.azimuth);
  const s = Math.sin(HALL.azimuth);
  const leftStart = new THREE.Vector2((edges.side - HALL.origin.x - HALL.outer * s) / c, -HALL.outer);
  const backCorner = new THREE.Vector2(HALL.back, HALL.outer);
  const frontStart = new THREE.Vector2(HALL.back, (edges.front - HALL.origin.y - HALL.back * s) / c);
  const tipWorld = new THREE.Vector2(edges.side, edges.front);
  const tip = toHall(tipWorld.x, tipWorld.y);
  const plan = [leftStart, new THREE.Vector2(HALL.end, -HALL.outer), new THREE.Vector2(HALL.end, HALL.outer), backCorner, frontStart, tip];
  // Where the full wall along the casino side gives way to the low pier under the balcony fascia.
  const sidePier = toHall(edges.side, edges.back);
  return { plan, tip, frontStart, leftStart, sidePier };
}

function createLighting(): CasinoLighting {
  const warm = (r: number, g: number, b: number, k: number) => new THREE.Color(r, g, b).multiplyScalar(k);
  return {
    chandeliers: CHANDELIERS.map(({ u, diameter }) => ({ position: new THREE.Vector3(u, CHANDELIER_RING - diameter * 0.1, 0), strength: diameter * 0.32 })),
    chandelierColor: new THREE.Color(1.0, 0.72, 0.42),
    rows: [
      { first: HALL.firstColumn, period: HALL.bay, last: columnU(HALL.columns - 1), v: HALL.nave - 1.5, y: COLUMN.plinthTop + 3.6, color: warm(1, 0.6, 0.28, 0.5), radius: 4 },
      { first: HALL.firstColumn, period: HALL.bay, last: columnU(HALL.columns - 1), v: HALL.nave - 1.5, y: 9.6, color: warm(1, 0.6, 0.28, 0.5), radius: 4 },
      { first: LANTERNS.first, period: LANTERNS.period, last: LANTERNS.last, v: LANTERNS.v, y: HALL.floor + LANTERNS.height, color: warm(1, 0.66, 0.32, 0.35), radius: 3 },
      { first: TABLES.first, period: TABLES.period, last: TABLES.last, v: TABLES.v, y: HALL.floor + TABLES.lamp, color: warm(1, 0.78, 0.5, 0.4), radius: 2.6 },
    ],
    lines: [
      { from: HALL.vaultStart, to: HALL.end, v: GALLERY.front - 0.3, y: GALLERY.floor - 0.6, color: warm(1, 0.6, 0.28, 0.14), radius: 3 },
      { from: 16, to: 93, v: 10, y: HALL.floor + 1.4, color: new THREE.Color(0.22, 0.16, 0.8).multiplyScalar(0.2), radius: 2 },
      { from: 16, to: 93, v: SLOT_ROWS[0] as number, y: HALL.floor + 1.4, color: new THREE.Color(0.22, 0.16, 0.8).multiplyScalar(0.2), radius: 2 },
    ],
    ambientLow: new THREE.Color(0.014, 0.008, 0.005),
    ambientHigh: new THREE.Color(0.006, 0.006, 0.01),
    floorY: HALL.floor,
    ceilingY: HALL.ceiling + HALL.vaultRise,
    aisle: HALL.aisle,
    outer: HALL.outer,
    vaultSpring: HALL.ceiling,
    vaultRise: HALL.vaultRise,
    vaultHalf: HALL.nave,
    bay: HALL.bay,
    firstColumn: HALL.firstColumn,
  };
}

// The hall shell: floor, walls, ceilings, the vault and its ribs.
function buildShell(batch: Batch, plans: ReturnType<typeof hallPlan>, edges: ReturnType<typeof balconyEdges>): void {
  const { plan } = plans;
  batch.add("floor", planFace(plan, HALL.floor, true));

  // Walls. The outer side of the plan edge a -> b is on its left (u right, v down on the plan).
  const full = (a: THREE.Vector2, b: THREE.Vector2) => {
    batch.add("marble", wallSide(a, b, HALL.floor, HALL.ceiling + 0.5, HALL.wall));
    batch.add("gold", wallSide(a, b, HALL.floor, HALL.floor + 0.25, 0.08, -0.08));
  };
  const pier = (a: THREE.Vector2, b: THREE.Vector2) => {
    batch.add("marble", wallSide(a, b, HALL.floor, edges.fasciaBottom, 0.4, -0.4));
    batch.add("gold", wallSide(a, b, edges.fasciaBottom - 0.18, edges.fasciaBottom, 0.06, -0.06));
    batch.add("gold", wallSide(a, b, HALL.floor, HALL.floor + 0.25, 0.08, -0.08));
  };
  const [leftStart, farLeft, farRight, backCorner, frontStart, tip] = plan as [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2];
  full(leftStart, farLeft);
  full(farLeft, farRight);
  full(farRight, backCorner);
  full(backCorner, frontStart);
  // Left of the balcony the wall stays low too: the palm at the balcony corner (annexDressing.ts) leans out over it.
  pier(frontStart, tip);
  pier(tip, plans.sidePier);
  full(plans.sidePier, leftStart);
  // Ledges of the walls: a gold cornice under the ceiling.
  for (const [a, b] of [
    [leftStart, farLeft],
    [farLeft, farRight],
    [farRight, backCorner],
    [backCorner, frontStart],
  ] as [THREE.Vector2, THREE.Vector2][]) {
    batch.add("gold", wallSide(a, b, HALL.ceiling - 0.35, HALL.ceiling, 0.25, -0.25));
  }

  // Flat ceilings over the aisles and over the back of the nave; the vault covers the rest of the nave.
  const leftSide = clipPolygon(plan, 0, -1, -HALL.nave);
  const rightSide = clipPolygon(plan, 0, 1, -HALL.nave);
  const backMiddle = clipPolygon(clipPolygon(clipPolygon(plan, -1, 0, HALL.vaultStart), 0, 1, HALL.nave), 0, -1, HALL.nave);
  for (const part of [leftSide, rightSide, backMiddle]) {
    if (part.length >= 3) {
      batch.add("vault", planFace(part, HALL.ceiling, false));
    }
  }

  // The vault: an elliptic barrel from the spring at the column lines up to the crown.
  const segmentsU = 46;
  const segmentsA = 28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segmentsU; i++) {
    const u = HALL.vaultStart + ((HALL.end - HALL.vaultStart) * i) / segmentsU;
    for (let j = 0; j <= segmentsA; j++) {
      const angle = (Math.PI * j) / segmentsA;
      positions.push(u, HALL.ceiling + HALL.vaultRise * Math.sin(angle), HALL.nave * Math.cos(angle));
      uvs.push(i / segmentsU, j / segmentsA);
    }
  }
  const row = segmentsA + 1;
  for (let i = 0; i < segmentsU; i++) {
    for (let j = 0; j < segmentsA; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      // Wound to face down into the nave.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const vault = new THREE.BufferGeometry();
  vault.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  vault.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  vault.setIndex(index);
  vault.computeVertexNormals();
  // The normal at the crown must point down; otherwise turn the winding round.
  const crown = vault.getAttribute("normal").getY(Math.floor(segmentsA / 2));
  if (crown > 0) {
    batch.add("vault", mirroredWinding(vault));
  } else {
    batch.add("vault", vault);
  }
  // The ribs: a heavy gold rib over every column pair, a light one over every mid bay, a heavy one at each end.
  const rib = (u: number, width: number, depth: number) => {
    const band = archBand(-HALL.nave + width, HALL.nave - width, HALL.ceiling, HALL.vaultRise - width, width, depth);
    band.rotateY(Math.PI / 2);
    band.translate(u - depth / 2, 0, 0);
    batch.add("gold", band);
  };
  for (let i = 0; i < HALL.columns; i++) {
    rib(columnU(i), 0.55, 1.0);
    rib(columnU(i) + HALL.bay / 2, 0.25, 0.4);
  }
  rib(HALL.vaultStart + 0.5, 0.7, 1.0);
  rib(HALL.end - 0.5, 0.7, 1.0);
  // Longitudinal ribs along the vault.
  for (const angle of [deg(30), deg(60), deg(90), deg(120), deg(150)]) {
    const y = HALL.ceiling + HALL.vaultRise * Math.sin(angle) - 0.08;
    const v = HALL.nave * Math.cos(angle) * 0.995;
    batch.add("gold", cuboid(HALL.vaultStart, HALL.end, y - 0.1, y + 0.02, v - 0.12, v + 0.12));
  }
  // The end faces of the vault: the half ellipses over the entablature at both ends.
  const tympanum = archOpening(-HALL.nave, HALL.nave, HALL.ceiling, HALL.ceiling, HALL.vaultRise);
  batch.add("marble", at(tympanum, HALL.vaultStart, 0, 0, Math.PI / 2));
  batch.add("marble", at(tympanum, HALL.end, 0, 0, -Math.PI / 2));
}

// The same geometry with every triangle wound the other way.
function mirroredWinding(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.index;
  if (index) {
    const flipped: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      flipped.push(index.getX(i), index.getX(i + 2), index.getX(i + 1));
    }
    geometry.setIndex(flipped);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A box along the plan edge a -> b, from y0 to y1, between the offsets `from` and `from + thickness` from the edge
// towards the outside of the hall (a negative offset reaches into the hall).
function wallSide(a: THREE.Vector2, b: THREE.Vector2, y0: number, y1: number, thickness: number, from = 0): THREE.BufferGeometry {
  const along = new THREE.Vector2().subVectors(b, a);
  const length = along.length();
  const angle = Math.atan2(along.y, along.x);
  // In the box frame x runs along the edge; local -z is the left of a -> b on the plan (u right, v down).
  const geometry = new THREE.BoxGeometry(length, y1 - y0, Math.abs(thickness));
  const offset = from + thickness / 2;
  geometry.translate(length / 2, (y0 + y1) / 2, -offset);
  geometry.rotateY(-angle);
  geometry.translate(a.x, 0, a.y);
  return geometry;
}

// One column: plinth, base drum, shaft with gold bands, fan capital and abacus. Its candelabra face the nave.
function buildColumn(batch: Batch, u: number, v: number, random: () => number): void {
  const { radius, plinth } = COLUMN;
  const marble = (geometry: THREE.BufferGeometry) => batch.add("marble", at(geometry, u, 0, v));
  const gold = (geometry: THREE.BufferGeometry) => batch.add("gold", at(geometry, u, 0, v));
  marble(cuboid(-plinth, plinth, HALL.floor, COLUMN.plinthTop, -plinth, plinth));
  gold(cuboid(-plinth - 0.05, plinth + 0.05, COLUMN.plinthTop - 0.14, COLUMN.plinthTop, -plinth - 0.05, plinth + 0.05));
  gold(cuboid(-plinth - 0.05, plinth + 0.05, HALL.floor, HALL.floor + 0.18, -plinth - 0.05, plinth + 0.05));
  marble(drum(radius * 1.22, radius * 1.3, COLUMN.plinthTop, COLUMN.drumTop, 28));
  gold(ring(radius * 1.27, 0.08, COLUMN.plinthTop + 0.12, 36));
  gold(ring(radius * 1.2, 0.07, COLUMN.drumTop - 0.06, 36));
  marble(drum(radius, radius, COLUMN.drumTop, COLUMN.capitalBottom, 28));
  for (const y of [COLUMN.drumTop + 0.25, GALLERY.floor - 0.2, GALLERY.floor + 0.25, COLUMN.capitalBottom - 2.6, COLUMN.capitalBottom - 0.1]) {
    gold(ring(radius + 0.02, 0.07, y, 36));
  }
  // The art deco fan: gold ribs splaying up the top of the shaft into the flared capital.
  const fins = 14;
  for (let i = 0; i < fins; i++) {
    const angle = (i / fins) * Math.PI * 2;
    const fin = cuboid(-0.03, 0.03, 0, 2.5, -0.03, 0.03);
    batch.add("gold", at(fin, u + Math.cos(angle) * (radius + 0.01), COLUMN.capitalBottom - 2.6, v + Math.sin(angle) * (radius + 0.01), -angle, 1, 0, 0));
  }
  gold(drum(radius * 1.35, radius, COLUMN.capitalBottom, COLUMN.capitalTop, 28));
  gold(ring(radius * 1.35, 0.09, COLUMN.capitalTop, 36));
  marble(cuboid(-1.65, 1.65, COLUMN.capitalTop, COLUMN.top, -1.65, 1.65));
  gold(cuboid(-1.7, 1.7, COLUMN.top - 0.1, COLUMN.top, -1.7, 1.7));
  // Candelabra on the nave face, low and high: the candelabrum frame stands out along +z, so it turns to face the nave.
  const face = v > 0 ? Math.PI : 0;
  const faceV = v - Math.sign(v) * radius;
  for (const [y, size] of [
    [COLUMN.plinthTop + 3.0, 1.5],
    [8.9, 1.7],
  ] as [number, number][]) {
    batch.within(new THREE.Matrix4().makeRotationY(face).setPosition(u, y, faceV), () => {
      candelabrum(batch, "gold", "glow", 7, size, random);
    });
  }
}

// The two drapes of an arch opening, each tied back to its side. `u0`..`u1` is the opening, `top` the rod,
// `bottom` where they end; the drapes hang in the plane v = `v` on the nave side of it (`side` is the sign of v).
function archDrapes(batch: Batch, u0: number, u1: number, top: number, bottom: number, v: number, tie: number, random: () => number): void {
  const width = (u1 - u0) * 0.5;
  const height = top - bottom;
  const folds = Math.max(4, Math.round(width * 1.1));
  for (const side of [-1, 1] as const) {
    const geometry = drape(width, height, tie, side, folds);
    const u = side < 0 ? u0 : u0 + width;
    batch.add("velvet", at(geometry, u, top, v, 0), new THREE.Color(1, 0.9 + random() * 0.1, 0.9 + random() * 0.1));
  }
  batch.add("gold", cuboid(u0, u1, top - 0.04, top + 0.08, v - 0.06, v + 0.06));
}

// The column lines with everything that hangs between the columns: the end piers, the spandrels of the ground and
// gallery arches with their gold bands and drapes, the entablature. Built for the +v side, then mirrored.
function buildColonnade(batch: Batch, random: () => number): void {
  const side = new Batch();
  const v = HALL.nave;
  const front = v - 0.45;
  // The end pier at the back of the nave, under the end of the entablature.
  side.add("marble", cuboid(END_PIER.u - END_PIER.half, END_PIER.u + END_PIER.half, HALL.floor, COLUMN.top, v - END_PIER.half, v + END_PIER.half));
  side.add("gold", cuboid(END_PIER.u - END_PIER.half - 0.04, END_PIER.u + END_PIER.half + 0.04, HALL.floor, HALL.floor + 0.25, v - END_PIER.half - 0.04, v + END_PIER.half + 0.04));
  side.add("gold", cuboid(END_PIER.u - END_PIER.half - 0.04, END_PIER.u + END_PIER.half + 0.04, GALLERY.floor - 0.4, GALLERY.floor, v - END_PIER.half - 0.04, v + END_PIER.half + 0.04));
  // Solid wall from the pier to the first column, and from the last column to the far wall.
  side.add("marble", cuboid(END_PIER.u + END_PIER.half, HALL.firstColumn - COLUMN.plinth, HALL.floor, COLUMN.top, v - 0.4, GALLERY.front));
  side.add("marble", cuboid(columnU(HALL.columns - 1) + COLUMN.plinth, HALL.end, HALL.floor, COLUMN.top, v - 0.4, GALLERY.front));
  // The entablature on the column line, with gold mouldings.
  side.add("marble", cuboid(HALL.vaultStart, HALL.end, COLUMN.top, HALL.ceiling, v - 1.1, GALLERY.front));
  side.add("gold", cuboid(HALL.vaultStart, HALL.end, COLUMN.top, COLUMN.top + 0.16, v - 1.18, v - 1.1));
  side.add("gold", cuboid(HALL.vaultStart, HALL.end, HALL.ceiling - 0.3, HALL.ceiling - 0.1, v - 1.3, v - 1.1));
  side.add("gold", cuboid(HALL.vaultStart, HALL.end, COLUMN.top + 0.7, COLUMN.top + 0.78, v - 1.14, v - 1.1));
  for (let i = 0; i < HALL.columns - 1; i++) {
    const u0 = columnU(i);
    const u1 = columnU(i + 1);
    // Ground arch: between the plinths, under the gallery.
    const g0 = u0 + COLUMN.plinth;
    const g1 = u1 - COLUMN.plinth;
    const ground = spandrel(g0, g1, GROUND_ARCH.spring, GROUND_ARCH.rise, GROUND_ARCH.top, GALLERY.front - front);
    side.add("marble", at(ground, 0, 0, front));
    side.add("gold", at(archBand(g0, g1, GROUND_ARCH.spring, GROUND_ARCH.rise, 0.28, 0.08), 0, 0, front - 0.08));
    archDrapes(side, g0 + 0.1, g1 - 0.1, GROUND_ARCH.spring + GROUND_ARCH.rise - 0.4, HALL.floor + 0.02, front + 0.35, 0.55, random);
    // Gallery arch: between the shafts, over the gallery balustrade.
    const a0 = u0 + COLUMN.radius + 0.15;
    const a1 = u1 - COLUMN.radius - 0.15;
    const upper = spandrel(a0, a1, UPPER_ARCH.spring, UPPER_ARCH.rise, UPPER_ARCH.top, 0.9);
    side.add("marble", at(upper, 0, 0, front));
    side.add("gold", at(archBand(a0, a1, UPPER_ARCH.spring, UPPER_ARCH.rise, 0.3, 0.08), 0, 0, front - 0.08));
    archDrapes(side, a0 + 0.15, a1 - 0.15, UPPER_ARCH.spring + UPPER_ARCH.rise - 0.35, GALLERY.floor + 0.02, front + 1.2, 0.5, random);
  }
  batch.within(new THREE.Matrix4(), () => {
    for (const key of side.keys()) {
      const geometry = side.merged(key);
      batch.addPrepared(key, geometry);
      batch.addPrepared(key, mirrored(geometry));
    }
  });
  for (let i = 0; i < HALL.columns; i++) {
    buildColumn(batch, columnU(i), HALL.nave, random);
    buildColumn(batch, columnU(i), -HALL.nave, random);
  }
}

// The galleries over the side aisles: the slab, its fascia lamps, the gold balustrade and the statues.
function buildGalleries(batch: Batch, plan: THREE.Vector2[], random: () => number): void {
  // The galleries keep 1.5 m clear of the balcony edges, so nothing hangs over the balcony.
  const c = Math.cos(HALL.azimuth);
  const s = Math.sin(HALL.azimuth);
  const edges = balconyEdges();
  const clear = clipPolygon(clipPolygon(plan, s, c, HALL.origin.y - edges.front - 1.5), c, -s, HALL.origin.x - edges.side - 1.5);
  for (const sign of [1, -1]) {
    const part = clipPolygon(clear, 0, sign, -GALLERY.front);
    if (part.length < 3) {
      continue;
    }
    batch.add("marble", planPrism(part, GALLERY.floor - GALLERY.slab, GALLERY.floor));
    const inner = spanAt(part, sign * (GALLERY.front + 0.01));
    const outer = spanAt(part, sign * (GALLERY.front + 0.4));
    const span: [number, number] | null = inner && outer ? [Math.max(inner[0], outer[0]), Math.min(inner[1], outer[1])] : null;
    if (!span) {
      continue;
    }
    const [from, to] = span;
    const near = sign * GALLERY.front;
    const box = (u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) => cuboid(u0, u1, y0, y1, Math.min(near + sign * d0, near + sign * d1), Math.max(near + sign * d0, near + sign * d1));
    // Fascia mouldings.
    batch.add("gold", box(from, to, GALLERY.floor - 0.12, GALLERY.floor, -0.06, 0));
    batch.add("gold", box(from, to, GALLERY.floor - GALLERY.slab, GALLERY.floor - GALLERY.slab + 0.1, -0.06, 0));
    // Balustrade: plinth, balusters, rail.
    batch.add("marble", box(from, to, GALLERY.floor, GALLERY.floor + 0.2, 0, 0.36));
    batch.add("gold", box(from, to, GALLERY.railTop - 0.1, GALLERY.railTop, 0.02, 0.34));
    const baluster = drum(0.035, 0.045, GALLERY.floor + 0.2, GALLERY.railTop - 0.1, 6, true);
    for (let u = from + 0.3; u < to - 0.15; u += 0.3) {
      batch.add("gold", at(baluster, u, 0, near + sign * 0.18));
    }
    // Lamps on the fascia: a gold bracket and a glowing shade.
    for (let u = from + 1.3; u < to - 0.5; u += 2.6) {
      batch.add("gold", box(u - 0.05, u + 0.05, GALLERY.floor - 0.75, GALLERY.floor - 0.3, -0.25, 0));
      batch.glow("glow", at(drum(0.12, 0.16, 0, 0.28, 10), u, GALLERY.floor - 0.62, near - sign * 0.28), new THREE.Color(2.2, 1.55, 0.85), GLOW.flame, random());
    }
    // Gold statues at the gallery front, beside each column.
    for (let i = 0; i < HALL.columns; i++) {
      const u = columnU(i) + 2.6;
      if (u > from + 0.6 && u < to - 0.6) {
        batch.within(new THREE.Matrix4().makeRotationY(sign > 0 ? Math.PI : 0).setPosition(u, GALLERY.floor, near + sign * 0.9), () => {
          statue(batch, "gold", "marble", 2.6);
        });
      }
    }
  }
}

// The outer walls and the far wall: pilasters, tall night windows with drapes, the great window over the bar.
function buildOuterWalls(batch: Batch, random: () => number): void {
  for (const sign of [1, -1]) {
    const face = sign * HALL.outer;
    // Into the hall: a +v wall faces -v.
    const yaw = sign > 0 ? Math.PI : 0;
    for (let i = 0; i < HALL.columns; i++) {
      const u = columnU(i);
      batch.add("marble", cuboid(u - 0.8, u + 0.8, HALL.floor, HALL.ceiling, Math.min(face, face - sign * 0.4), Math.max(face, face - sign * 0.4)));
      batch.add("gold", cuboid(u - 0.88, u + 0.88, HALL.ceiling - 1.0, HALL.ceiling - 0.6, Math.min(face, face - sign * 0.5), Math.max(face, face - sign * 0.5)));
      batch.add("gold", cuboid(u - 0.88, u + 0.88, GALLERY.floor - 0.3, GALLERY.floor, Math.min(face, face - sign * 0.5), Math.max(face, face - sign * 0.5)));
    }
    for (let i = 0; i < HALL.columns - 1; i++) {
      const mid = columnU(i) + HALL.bay / 2;
      for (const [bottom, spring, rise, width] of [
        [HALL.floor + 1.2, 1.6, 1.6, 4.4],
        [GALLERY.floor + 1.6, 12.4, 2.0, 5.6],
      ] as [number, number, number, number][]) {
        const window = archOpening(-width / 2, width / 2, bottom, spring, rise);
        batch.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(mid, 0, face - sign * 0.05), () => {
          batch.glow("glow", window, new THREE.Color(0.035, 0.06, 0.16), GLOW.window, random());
          batch.add("gold", at(archBand(-width / 2, width / 2, spring, rise, 0.22, 0.12), 0, 0, 0));
          batch.add("gold", cuboid(-width / 2 - 0.22, -width / 2, bottom, spring, 0, 0.12));
          batch.add("gold", cuboid(width / 2, width / 2 + 0.22, bottom, spring, 0, 0.12));
          batch.add("gold", cuboid(-width / 2 - 0.3, width / 2 + 0.3, bottom - 0.2, bottom, 0, 0.25));
          // Mullions.
          batch.add("gold", cuboid(-0.04, 0.04, bottom, spring + rise, 0, 0.06));
          batch.add("gold", cuboid(-width / 2, width / 2, (bottom + spring) / 2 - 0.04, (bottom + spring) / 2 + 0.04, 0, 0.06));
        });
        // Drapes either side of the window, inside the hall.
        const u0 = mid - width / 2 - 1.2;
        const top = spring + rise + 0.4;
        const drapeWidth = 1.9;
        for (const end of [-1, 1] as const) {
          const geometry = drape(drapeWidth, top - bottom + 0.3, 0.6, end < 0 ? 1 : -1, 4, 12, 12);
          const u = end < 0 ? u0 : mid + width / 2 + 1.2 - drapeWidth;
          batch.within(new THREE.Matrix4().setPosition(0, 0, face - sign * 0.35), () => {
            batch.add("velvet", at(geometry, u, top, 0), new THREE.Color(1, 0.95, 0.95));
          });
        }
        batch.add("gold", cuboid(u0, mid + width / 2 + 1.2, top - 0.05, top + 0.06, Math.min(face - sign * 0.3, face - sign * 0.42), Math.max(face - sign * 0.3, face - sign * 0.42)));
      }
      // Sconces between the windows at the gallery level.
      for (const u of [columnU(i) + 1.6, columnU(i + 1) - 1.6]) {
        batch.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(u, GALLERY.floor + 2.4, face), () => {
          candelabrum(batch, "gold", "glow", 3, 1.0, random);
        });
      }
    }
  }
  // The great window over the bar in the far wall, with drapes.
  const width = 10;
  const bottom = 7;
  const spring = 17;
  const rise = 5;
  batch.within(new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(HALL.end - 0.05, 0, 0), () => {
    batch.glow("glow", archOpening(-width / 2, width / 2, bottom, spring, rise), new THREE.Color(0.03, 0.055, 0.15), GLOW.window, 0.5);
    batch.add("gold", archBand(-width / 2, width / 2, spring, rise, 0.4, 0.2));
    batch.add("gold", cuboid(-width / 2 - 0.4, -width / 2, bottom, spring, 0, 0.2));
    batch.add("gold", cuboid(width / 2, width / 2 + 0.4, bottom, spring, 0, 0.2));
    for (let i = 1; i < 4; i++) {
      batch.add("gold", cuboid(-width / 2 + (i * width) / 4 - 0.05, -width / 2 + (i * width) / 4 + 0.05, bottom, spring + rise, 0, 0.08));
    }
    for (const y of [10.3, 13.6, 17]) {
      batch.add("gold", cuboid(-width / 2, width / 2, y - 0.05, y + 0.05, 0, 0.08));
    }
  });
  for (const end of [-1, 1] as const) {
    const geometry = drape(3.2, spring + rise - bottom + 1.5, 0.62, end < 0 ? 1 : -1, 6, 14, 14);
    batch.within(new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(HALL.end - 0.5, 0, 0), () => {
      batch.add("velvet", at(geometry, end < 0 ? -width / 2 - 2.4 : width / 2 + 2.4 - 3.2, spring + rise + 0.8, 0), new THREE.Color(1, 0.95, 0.95));
    });
  }
}

// The chandeliers. Each one is its own group that hangs from the vault crown, so it can sway.
function buildChandeliers(materials: CasinoMaterials): { group: THREE.Group; lamps: THREE.Group[] } {
  const group = named(new THREE.Group(), "Chandeliers", true);
  const crown = HALL.ceiling + HALL.vaultRise;
  const lamps: THREE.Group[] = [];
  CHANDELIERS.forEach(({ u, diameter }, index) => {
    const batch = new Batch();
    const drop = crown - CHANDELIER_RING;
    batch.within(new THREE.Matrix4().makeTranslation(0, -drop, 0), () => {
      chandelier(batch, "gold", "glow", diameter, 31 + index * 17);
    });
    // The chain from the crown of the chandelier up to the vault.
    batch.add("gold", drum(0.05, 0.05, -drop + diameter * 0.8, 0, 6));
    batch.add("gold", drum(0.5, 0.25, -0.35, 0, 16));
    const lamp = named(new THREE.Group(), `Chandelier ${index + 1}`);
    lamp.position.set(u, crown, 0);
    lamp.userData.animated = true;
    lamp.add(named(new THREE.Mesh(batch.merged("gold"), materials.casinoGold), "Frame"));
    lamp.add(named(new THREE.Mesh(batch.merged("glow"), materials.casinoGlow), "Crystal"));
    group.add(lamp);
    lamps.push(lamp);
  });
  return { group, lamps };
}

// The gaming floor: lanterns along the aisle, tables, slot banks, palms, a flower urn and the guests.
function buildGamingFloor(batch: Batch, random: () => number): void {
  const y = HALL.floor;
  const keys = { dark: "dark", gold: "gold", glow: "glow" };
  const tints = [new THREE.Color(0.55, 0.45, 1.6), new THREE.Color(0.35, 0.55, 1.7), new THREE.Color(1.1, 0.4, 1.4), new THREE.Color(0.4, 0.85, 1.5)];
  const tint = () => (tints[Math.floor(random() * tints.length)] as THREE.Color).clone();
  for (const sign of [1, -1]) {
    // Lanterns on marble posts along the aisle.
    for (let u = LANTERNS.first; u <= LANTERNS.last + 0.01; u += LANTERNS.period) {
      const v = sign * LANTERNS.v;
      batch.add("marble", cuboid(u - 0.28, u + 0.28, y, y + 1.0, v - 0.28, v + 0.28));
      batch.add("gold", cuboid(u - 0.32, u + 0.32, y + 1.0, y + 1.08, v - 0.32, v + 0.32));
      batch.add("gold", at(drum(0.05, 0.07, 0, 1.2, 8), u, y + 1.08, v));
      batch.add("gold", at(drum(0.2, 0.14, 0, 0.1, 8), u, y + 2.25, v));
      batch.glow("glow", at(drum(0.15, 0.15, 0, 0.5, 8), u, y + 2.35, v), new THREE.Color(1.7, 1.15, 0.55), GLOW.flame, random());
      batch.add("gold", at(drum(0.03, 0.22, 0, 0.18, 8), u, y + 2.85, v));
    }
    // Tables with a lamp in the middle, six chairs, players and a dealer.
    for (let u = TABLES.first; u <= TABLES.last + 0.01; u += TABLES.period) {
      const v = sign * TABLES.v;
      batch.add("dark", at(drum(0.4, 0.5, 0, TABLES.top - 0.08, 12), u, y, v), new THREE.Color(0.12, 0.07, 0.05));
      batch.add("felt", at(drum(TABLES.radius, TABLES.radius, TABLES.top - 0.08, TABLES.top, 32), u, y, v));
      batch.add("gold", at(ring(TABLES.radius, 0.06, TABLES.top - 0.02, 40), u, y, v));
      batch.add("gold", at(drum(0.025, 0.025, TABLES.top, TABLES.lamp, 6), u, y, v));
      batch.glow("glow", at(drum(0.2, 0.32, 0, 0.32, 14, true), u, y + TABLES.lamp - 0.1, v), new THREE.Color(1.5, 1.1, 0.65), GLOW.flame, random());
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2 + 0.3;
        const cu = u + Math.cos(angle) * (TABLES.radius + 0.45);
        const cv = v + Math.sin(angle) * (TABLES.radius + 0.45);
        const yaw = Math.atan2(Math.cos(angle), Math.sin(angle)) + Math.PI;
        batch.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(cu, y, cv), () => {
          batch.add("velvet", cuboid(-0.24, 0.24, 0.42, 0.52, -0.24, 0.24));
          batch.add("velvet", cuboid(-0.24, 0.24, 0.52, 1.0, -0.3, -0.22));
          batch.add("gold", cuboid(-0.2, 0.2, 0, 0.42, -0.2, 0.2));
        });
        if (random() < 0.6) {
          batch.within(new THREE.Matrix4().setPosition(cu, y + 0.42, cv), () => {
            person(batch, "dark", 0.95, new THREE.Color().setHSL(random(), 0.3, 0.05 + random() * 0.08));
          });
        }
      }
      batch.within(new THREE.Matrix4().setPosition(u - sign * 0.0 + 0.0, y, v + sign * (TABLES.radius + 0.5)), () => {
        person(batch, "dark", 1.78, new THREE.Color(0.03, 0.03, 0.035));
      });
    }
    // Slot banks in the nave, between the columns, either side of a palm; they face the nave.
    for (let i = 0; i < HALL.columns - 1; i++) {
      const mid = columnU(i) + HALL.bay / 2;
      for (const du of [-3.6, -2.8, -2.0, 2.0, 2.8, 3.6]) {
        batch.within(new THREE.Matrix4().makeRotationY(sign > 0 ? Math.PI : 0).setPosition(mid + du, y, sign * 10.0), () => {
          slotMachine(batch, keys, tint(), random());
        });
      }
      batch.within(new THREE.Matrix4().setPosition(mid, y, sign * 10.3), () => {
        palm(batch, "gold", "leaf", "dark", 4.6, random);
      });
    }
    // Slot rows in the side aisles, facing the nave, in banks of eight.
    for (const row of SLOT_ROWS) {
      for (let u = 17; u < 93; u += 0.8) {
        if (Math.floor((u - 17) / 0.8) % 10 >= 8) {
          continue;
        }
        batch.within(new THREE.Matrix4().makeRotationY(sign > 0 ? Math.PI : 0).setPosition(u, y, sign * row), () => {
          slotMachine(batch, keys, tint(), random());
        });
      }
    }
    // Palms at the far end of the aisle.
    for (const [u, v] of [
      [62, 4.0],
      [87, 4.4],
    ] as [number, number][]) {
      batch.within(new THREE.Matrix4().setPosition(u, y, sign * v), () => {
        palm(batch, "gold", "leaf", "dark", 5.2, random);
      });
    }
  }
  // The flower urn on the aisle.
  batch.add("marble", cuboid(47.5, 48.5, y, y + 1.1, -0.5, 0.5));
  batch.add("gold", at(new THREE.LatheGeometry([new THREE.Vector2(0.15, 0), new THREE.Vector2(0.35, 0.3), new THREE.Vector2(0.55, 0.75), new THREE.Vector2(0.6, 0.85)].map((p) => p), 16), 48, y + 1.1, 0));
  for (let i = 0; i < 40; i++) {
    const angle = random() * Math.PI * 2;
    const r = random() * 0.7;
    batch.add("velvet", at(new THREE.IcosahedronGeometry(0.16, 0), 48 + Math.cos(angle) * r, y + 2.0 + random() * 0.6 - r * 0.5, Math.sin(angle) * r), new THREE.Color(1.4, 0.4, 0.4));
  }
  // Guests strolling on the aisle and the carpet.
  for (let i = 0; i < 40; i++) {
    const u = 18 + random() * 76;
    const v = (random() - 0.5) * 2 * 9;
    if (Math.abs(Math.abs(v) - TABLES.v) < 2.2 || Math.abs(Math.abs(v) - LANTERNS.v) < 0.5) {
      continue;
    }
    batch.within(new THREE.Matrix4().setPosition(u, y, v), () => {
      person(batch, "dark", 1.65 + random() * 0.2, new THREE.Color().setHSL(random(), 0.25, 0.04 + random() * 0.1));
    });
  }
}

// The bar at the far end: an arched back bar with the shelves of the photo, a gold counter with a blue glow, stools.
function buildBar(batch: Batch, random: () => number): void {
  const y = HALL.floor;
  const back = HALL.end - 0.06;
  batch.within(new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(back, 0, 0), () => {
    // The shelves picture over the whole back bar, with its arches drawn in.
    const shelves = archOpening(-6.5, 6.5, y + 0.4, y + 6.4, 2.6);
    batch.glow("glow", shelves, new THREE.Color(1.15, 1.0, 0.85), GLOW.bar, 0.3);
    batch.add("gold", archBand(-6.5, 6.5, y + 6.4, 2.6, 0.35, 0.25));
    batch.add("gold", cuboid(-6.85, -6.5, y, y + 6.4, 0, 0.25));
    batch.add("gold", cuboid(6.5, 6.85, y, y + 6.4, 0, 0.25));
  });
  // Counter.
  const counterU = HALL.end - 4.2;
  batch.add("dark", cuboid(counterU - 0.4, counterU + 0.4, y, y + 1.05, -6, 6), new THREE.Color(0.08, 0.05, 0.04));
  batch.add("gold", cuboid(counterU - 0.5, counterU + 0.5, y + 1.05, y + 1.15, -6.1, 6.1));
  batch.add("gold", cuboid(counterU - 0.44, counterU - 0.4, y + 0.1, y + 0.95, -5.9, 5.9));
  batch.glow("glow", cuboid(counterU - 0.47, counterU - 0.44, y + 0.15, y + 0.3, -5.9, 5.9), new THREE.Color(0.35, 0.6, 2.2), GLOW.steady, 0);
  // Stools.
  for (let i = 0; i < 9; i++) {
    const v = -4.8 + i * 1.2;
    batch.add("gold", at(drum(0.04, 0.04, 0, 0.75, 6), counterU - 1.0, y, v));
    batch.add("velvet", at(drum(0.22, 0.22, 0.75, 0.85, 12), counterU - 1.0, y, v));
    if (random() < 0.5) {
      batch.within(new THREE.Matrix4().setPosition(counterU - 1.0, y + 0.85, v), () => {
        person(batch, "dark", 0.95, new THREE.Color(0.04, 0.035, 0.035));
      });
    }
  }
}

interface Casino {
  group: THREE.Group;
  update: (time: number) => void;
  materials: THREE.MeshStandardMaterial[];
  stats: { meshes: number; triangles: number };
}

function createCasino(): Casino {
  const lighting = createLighting();
  const materials = createCasinoMaterials(lighting);
  const random = seededRandom(20261009);
  const edges = balconyEdges();
  const plans = hallPlan(edges);
  const byKey: Record<string, THREE.Material> = {
    floor: materials.casinoFloor,
    marble: materials.casinoMarble,
    gold: materials.casinoGold,
    velvet: materials.casinoVelvet,
    vault: materials.casinoVault,
    felt: materials.casinoFelt,
    dark: materials.casinoDark,
    leaf: materials.casinoLeaf,
    glow: materials.casinoGlow,
  };
  const names: Record<string, string> = {
    floor: "Floor",
    marble: "Marble",
    gold: "Gold",
    velvet: "Velvet",
    vault: "Vault",
    felt: "Felt",
    dark: "Furniture",
    leaf: "Leaves",
    glow: "Lamps",
  };
  const meshes = (batch: Batch, folder: string) => {
    const group = named(new THREE.Group(), folder, true);
    for (const key of batch.keys()) {
      const material = byKey[key];
      if (!material) {
        throw new Error(`no casino material for ${key}`);
      }
      group.add(named(new THREE.Mesh(batch.merged(key), material), names[key] ?? key));
    }
    return group;
  };

  const architecture = new Batch();
  buildShell(architecture, plans, edges);
  buildColonnade(architecture, random);
  buildGalleries(architecture, plans.plan, random);
  buildOuterWalls(architecture, random);
  const gaming = new Batch();
  buildGamingFloor(gaming, random);
  const bar = new Batch();
  buildBar(bar, random);
  const chandeliers = buildChandeliers(materials);

  const group = named(new THREE.Group(), "Casino", true);
  // Not part of the set: the blocking audit and the pivot rule leave the hall alone.
  group.userData.auditIgnore = true;
  group.position.set(HALL.origin.x, 0, HALL.origin.y);
  group.rotation.y = -HALL.azimuth;
  group.add(meshes(architecture, "Architecture"), chandeliers.group, meshes(gaming, "Gaming Floor"), meshes(bar, "Bar"));
  let triangles = 0;
  let count = 0;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      count += 1;
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
    }
  });

  const update = (time: number) => {
    materials.shared.uTime.value = time;
    group.updateWorldMatrix(true, false);
    materials.shared.uWorldToHall.value.copy(group.matrixWorld).invert();
    // A slow sway, each chandelier on its own rhythm: a few centimetres at the ring.
    chandeliers.lamps.forEach((lamp, index) => {
      lamp.rotation.x = Math.sin(time * 0.37 + index * 1.7) * 0.0035;
      lamp.rotation.z = Math.sin(time * 0.29 + index * 2.3 + 0.8) * 0.0035;
    });
  };
  update(0);
  return { group, update, materials: materials.standard, stats: { meshes: count, triangles } };
}

export { createCasino, toHall, toWorld };
