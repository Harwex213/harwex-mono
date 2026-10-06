import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createCasinoBackdrop } from "./casinoBackdrop";
import { named, planPrism } from "./geometry";
import type { Materials } from "./materials";
import { createCurtain } from "./props";

// The casino hall: a rectangular room in front of the amphitheatre, on the camera side (+z).
// The amphitheatre opens into it through a wide opening in the back wall of the hall,
// and the round marble floor of the amphitheatre reaches into the hall as a half disc.
//
// Floor plan, in metres from the studio centre (the hero wheel stands at z = -4):
//   back wall inner face z = 9.8 (the colonnade ends at z = 9.08..9.26, just behind the outer face 9.3),
//   front wall inner face z = 37.5, side walls x = -36 and x = 36.
// Heights: floor 0, coffer beams 9.6..10, ceiling 10..10.3, a header closes the amphitheatre front up to 18.1.
//
// The walls are dark wood with gold pilasters. A pilaster stands under every end of a coffer beam,
// so each beam rests on a capital. The wall trim (dado, rail, raised panels, crown) runs between the pilasters.
const HALL = {
  halfWidth: 36,
  backZ: 9.8,
  frontZ: 37.5,
  wallThickness: 0.5,
  height: 10,
  ceilingThickness: 0.3,
  // The opening into the amphitheatre, in the back wall.
  openingHalfWidth: 17.6,
  lintelBottom: 9.2,
  headerTop: 18.1,
  // The round marble floor of the amphitheatre (`Studio/Floor/Marble`): the carpet stops at its edge.
  floorRadius: 22,
  floorSegments: 96,
  // Coffer grid: beams along x at 4 depths, beam lines along z at 13 positions across.
  xBeams: 4,
  zLines: 13,
  beam: 0.4,
};

// Pilaster parts: width along the wall, depth from the wall face.
const PILASTER = {
  plinth: { width: 1.05, depth: 0.45, top: 0.5 },
  shaft: { width: 0.9, depth: 0.35 },
  capital: { width: 1.05, depth: 0.45, bottom: HALL.height - HALL.beam },
};

// The middle of the front wall, behind the Game Show station: a stretch without trim between the pilasters
// at x = -7.7 and 7.7. It holds the portal, and the casino backdrop is mounted behind the portal (`Casino/Backdrop`).
const BACKDROP = {
  halfWidth: 7.1,
  height: HALL.height - HALL.beam,
};

// The height of the Game Show camera (cameraRig.ts). The photo backdrop is scaled so that its projector
// stands at this height: the photo horizon and the floor of the photo room then line up with the hall.
const BACKDROP_EYE = 2.9;

// The portal: an opening through the front wall with a gold frame on the hall side. The Game Show camera looks
// through it into the photo backdrop, which stands outside the hall. The opening must stay inside the photo
// window (casinoBackdrop.ts): about 9.7 m x 5.6 m at the inner face of the wall, for the scale above.
const PORTAL = {
  // The hole in the slab.
  halfWidth: 4.7,
  height: 5.3,
  // Gold lining of the reveal; it narrows the clear opening.
  lining: 0.05,
  // Architrave around the opening, on the hall face.
  casing: 0.4,
  casingDepth: 0.12,
  // A pilaster on each side and an entablature over them.
  pilasterX: 5.8,
  capitalBottom: 5.95,
  capitalTop: 6.3,
  friezeTop: 6.9,
  corniceTop: 7.15,
};

// The carpet is a slab from -5 cm to 5 cm.
const CARPET_TOP = 0.05;

const X_BEAM_Z = Array.from({ length: HALL.xBeams }, (_, i) => HALL.backZ + ((HALL.frontZ - HALL.backZ) * (i + 1)) / (HALL.xBeams + 1));
const Z_LINE_X = Array.from({ length: HALL.zLines }, (_, i) => -HALL.halfWidth + (2 * HALL.halfWidth * (i + 1)) / (HALL.zLines + 1));

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Red casino carpet: a gold lattice with rosettes, one tile per 2.5 m.
function createCarpetTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#4a0a10";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(196, 146, 62, 0.75)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(128, 0);
    ctx.lineTo(256, 128);
    ctx.lineTo(128, 256);
    ctx.lineTo(0, 128);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "rgba(20, 4, 6, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(128, 22);
    ctx.lineTo(234, 128);
    ctx.lineTo(128, 234);
    ctx.lineTo(22, 128);
    ctx.closePath();
    ctx.stroke();
    const rosette = (x: number, y: number, radius: number) => {
      ctx.fillStyle = "#b8862e";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1c0507";
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7a1420";
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
    };
    rosette(128, 128, 30);
    for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]] as const) {
      rosette(x, y, 18);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // The carpet UVs are in metres.
  texture.repeat.set(1 / 2.5, 1 / 2.5);
  return texture;
}

// Slot screen: three reels of symbols under a glass.
function createSlotScreenTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#1a2a6a");
    gradient.addColorStop(1, "#3a0a4a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const symbols = ["7", "$", "BAR", "7", "$", "7", "BAR", "$", "7"];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let reel = 0; reel < 3; reel++) {
      ctx.fillStyle = "#f4ead2";
      ctx.fillRect(16 + reel * 78, 40, 68, 176);
      for (let row = 0; row < 3; row++) {
        const symbol = symbols[reel * 3 + row] ?? "7";
        ctx.fillStyle = symbol === "7" ? "#c8101e" : symbol === "$" ? "#1a8a3a" : "#20202a";
        ctx.font = symbol === "BAR" ? "bold 22px Georgia, serif" : "bold 46px Georgia, serif";
        ctx.fillText(symbol, 50 + reel * 78, 70 + row * 58);
      }
    }
    ctx.strokeStyle = "#f0c060";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 34, 236, 188);
  });
}

// Slot topper: a lit sign.
function createSlotTopperTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = "#7a0a14";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#ffd86a";
    ctx.font = "bold 40px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("JACKPOT", 128, 34);
  });
}

function createCasinoMaterials() {
  const screen = createSlotScreenTexture();
  const topper = createSlotTopperTexture();
  const materials = {
    casinoWood: new THREE.MeshStandardMaterial({ color: 0x2a1408, metalness: 0.05, roughness: 0.42 }),
    casinoPanel: new THREE.MeshStandardMaterial({ color: 0x4a2412, metalness: 0.05, roughness: 0.32 }),
    casinoCeiling: new THREE.MeshStandardMaterial({ color: 0x1c0d05, metalness: 0.1, roughness: 0.55 }),
    casinoCarpet: new THREE.MeshStandardMaterial({ map: createCarpetTexture(), roughness: 0.92, metalness: 0 }),
    casinoFelt: new THREE.MeshStandardMaterial({ color: 0x0b5a2c, roughness: 0.88, metalness: 0 }),
    casinoBlack: new THREE.MeshStandardMaterial({ color: 0x0b0b10, metalness: 0.5, roughness: 0.3 }),
    casinoCrystal: new THREE.MeshStandardMaterial({ color: 0xfff1da, emissive: 0xffc98a, emissiveIntensity: 2.2, roughness: 0.15 }),
    casinoSlotScreen: new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 1.1, roughness: 0.3 }),
    casinoSlotTopper: new THREE.MeshStandardMaterial({ map: topper, emissive: 0xffffff, emissiveMap: topper, emissiveIntensity: 1.6, roughness: 0.3 }),
  };
  // The editor lists and saves shared materials by name.
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
  }
  return materials;
}

type CasinoMaterials = ReturnType<typeof createCasinoMaterials>;

// Box geometry between two corners.
function cuboid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geometry;
}

function solid(name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.receiveShadow = true;
  return mesh;
}

// Several boxes of one material as one mesh: fewer draw calls and fewer solids for the audit.
function merged(name: string, geometries: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const geometry = mergeGeometries(geometries.map((item) => item.toNonIndexed()));
  if (!geometry) {
    throw new Error(`cannot merge ${name}`);
  }
  return solid(name, geometry, material);
}

// Upright cylinder between two heights at (x, z).
function drumGeometry(radiusTop: number, radiusBottom: number, bottom: number, top: number, x = 0, z = 0, segments = 32): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, top - bottom, segments);
  geometry.translate(x, (bottom + top) / 2, z);
  return geometry;
}

// The floor of the hall: carpet everywhere except the half disc of marble that reaches in from the amphitheatre.
// The cut follows the exact polygon of the marble circle, so the two floors meet edge to edge.
function createCarpet(materials: CasinoMaterials): THREE.Mesh {
  const back = HALL.backZ - HALL.wallThickness;
  const front = HALL.frontZ + HALL.wallThickness;
  const side = HALL.halfWidth + HALL.wallThickness;
  // Vertices of the marble CircleGeometry in world space: (r cos t, 0, -r sin t).
  const circle: THREE.Vector2[] = [];
  for (let i = 0; i <= HALL.floorSegments; i++) {
    const t = (i / HALL.floorSegments) * Math.PI * 2;
    circle.push(new THREE.Vector2(HALL.floorRadius * Math.cos(t), -HALL.floorRadius * Math.sin(t)));
  }
  // The part of the polygon in front of the back face of the hall, from left to right, with the two cut points on its edges.
  const arc: THREE.Vector2[] = [];
  for (let i = 1; i <= HALL.floorSegments; i++) {
    const a = circle[i - 1] as THREE.Vector2;
    const b = circle[i] as THREE.Vector2;
    const aIn = a.y > back;
    const bIn = b.y > back;
    if (aIn !== bIn) {
      const k = (back - a.y) / (b.y - a.y);
      arc.push(new THREE.Vector2(a.x + (b.x - a.x) * k, back));
    }
    if (bIn) {
      arc.push(b.clone());
    }
  }
  const plan = [new THREE.Vector2(-side, back), ...arc, new THREE.Vector2(side, back), new THREE.Vector2(side, front), new THREE.Vector2(-side, front)];
  return solid("Carpet", planPrism(plan, -CARPET_TOP, CARPET_TOP), materials.casinoCarpet);
}

interface WallSpec {
  name: string;
  // The wall frame: the face at local z = 0 looks along local +z into the hall, local x runs along the wall.
  position: THREE.Vector3;
  rotationY: number;
  // The slab, along local x.
  slabFrom: number;
  slabTo: number;
  // The stretch of the face that carries trim, between the corner pilasters of the neighbouring walls.
  trimFrom: number;
  trimTo: number;
  pilasters: number[];
  // A stretch of the face without trim (the backdrop wall).
  bare?: [number, number];
  // A hole through the slab, centred on local x = 0, from the floor up.
  opening?: { halfWidth: number; height: number };
}

// One wall: the slab, gold pilasters, and the trim between the pilasters.
function createWall(spec: WallSpec, materials: Materials, casino: CasinoMaterials): THREE.Group {
  const wall = named(new THREE.Group(), spec.name);
  wall.position.copy(spec.position);
  wall.rotation.y = spec.rotationY;
  if (spec.opening) {
    const { halfWidth, height } = spec.opening;
    wall.add(merged("Slab", [
      cuboid(spec.slabFrom, -halfWidth, 0, HALL.height, -HALL.wallThickness, 0),
      cuboid(halfWidth, spec.slabTo, 0, HALL.height, -HALL.wallThickness, 0),
      cuboid(-halfWidth, halfWidth, height, HALL.height, -HALL.wallThickness, 0),
    ], casino.casinoWood));
  } else {
    wall.add(solid("Slab", cuboid(spec.slabFrom, spec.slabTo, 0, HALL.height, -HALL.wallThickness, 0), casino.casinoWood));
  }

  const { plinth, shaft, capital } = PILASTER;
  const pilasters: THREE.BufferGeometry[] = [];
  for (const x of spec.pilasters) {
    pilasters.push(cuboid(x - plinth.width / 2, x + plinth.width / 2, 0, plinth.top, 0, plinth.depth));
    pilasters.push(cuboid(x - shaft.width / 2, x + shaft.width / 2, plinth.top, capital.bottom, 0, shaft.depth));
    pilasters.push(cuboid(x - capital.width / 2, x + capital.width / 2, capital.bottom, HALL.height, 0, capital.depth));
  }
  if (pilasters.length > 0) {
    wall.add(merged("Pilasters", pilasters, materials.gold));
  }

  // Spans of free wall between the pilasters.
  const sorted = [...spec.pilasters].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  let cursor = spec.trimFrom;
  for (const x of sorted) {
    spans.push([cursor, x - plinth.width / 2]);
    cursor = x + plinth.width / 2;
  }
  spans.push([cursor, spec.trimTo]);

  const trim: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  for (const [a, b] of spans) {
    const middle = (a + b) / 2;
    if (b - a < 0.3 || (spec.bare && middle > spec.bare[0] && middle < spec.bare[1])) {
      continue;
    }
    // Dado panel, with a rail on top of it.
    panels.push(cuboid(a, b, 0, 1.1, 0, 0.06));
    trim.push(cuboid(a, b, 1.1, 1.18, 0, 0.1));
    // A tall raised panel in a gold frame. The top and bottom bars run over the ends of the side bars.
    if (b - a > 1.4) {
      panels.push(cuboid(a + 0.5, b - 0.5, 2.0, 8.6, 0, 0.04));
      trim.push(cuboid(a + 0.4, b - 0.4, 1.9, 2.0, 0, 0.06));
      trim.push(cuboid(a + 0.4, b - 0.4, 8.6, 8.7, 0, 0.06));
      trim.push(cuboid(a + 0.4, a + 0.5, 2.0, 8.6, 0, 0.06));
      trim.push(cuboid(b - 0.5, b - 0.4, 2.0, 8.6, 0, 0.06));
    }
    // Crown moulding under the ceiling, between the capitals.
    trim.push(cuboid(a, b, 9.5, HALL.height, 0, 0.25));
  }
  if (panels.length > 0) {
    wall.add(merged("Panels", panels, casino.casinoPanel));
    wall.add(merged("Trim", trim, materials.goldDark));
  }
  return wall;
}

function createWalls(materials: Materials, casino: CasinoMaterials): THREE.Group {
  const group = named(new THREE.Group(), "Walls", true);
  const { halfWidth, backZ, frontZ, wallThickness, openingHalfWidth } = HALL;
  const plinthHalf = PILASTER.plinth.width / 2;
  // The side walls carry the corner pilasters; the back and front walls start their trim in front of them.
  const cornerTrim = halfWidth - PILASTER.capital.depth;
  // Side walls: a pilaster under each end of a beam along x, and one in each corner.
  const sidePilasters = [backZ + plinthHalf, ...X_BEAM_Z, frontZ - plinthHalf];
  // Left wall: local x runs along -z.
  group.add(createWall({
    name: "Left Wall",
    position: new THREE.Vector3(-halfWidth, 0, 0),
    rotationY: Math.PI / 2,
    slabFrom: -frontZ,
    slabTo: -backZ,
    trimFrom: -frontZ,
    trimTo: -backZ,
    pilasters: sidePilasters.map((z) => -z),
  }, materials, casino));
  // Right wall: local x runs along +z.
  group.add(createWall({
    name: "Right Wall",
    position: new THREE.Vector3(halfWidth, 0, 0),
    rotationY: -Math.PI / 2,
    slabFrom: backZ,
    slabTo: frontZ,
    trimFrom: backZ,
    trimTo: frontZ,
    pilasters: sidePilasters,
  }, materials, casino));
  // Back wall: two pieces beside the opening. A pilaster frames each side of the opening,
  // the others stand under the beam lines along z.
  for (const side of [-1, 1]) {
    const lines = Z_LINE_X.filter((x) => Math.abs(x) > openingHalfWidth && Math.sign(x) === side);
    const frame = side * (openingHalfWidth + plinthHalf);
    const from = side < 0 ? -halfWidth - wallThickness : openingHalfWidth;
    const to = side < 0 ? -openingHalfWidth : halfWidth + wallThickness;
    group.add(createWall({
      name: side < 0 ? "Back Wall Left" : "Back Wall Right",
      position: new THREE.Vector3(0, 0, backZ),
      rotationY: 0,
      slabFrom: from,
      slabTo: to,
      trimFrom: side < 0 ? -cornerTrim : openingHalfWidth,
      trimTo: side < 0 ? -openingHalfWidth : cornerTrim,
      pilasters: [frame, ...lines],
    }, materials, casino));
  }
  // Front wall: local x runs along -x. The middle stretch has no trim: it holds the portal.
  const front = createWall({
    name: "Front Wall",
    position: new THREE.Vector3(0, 0, frontZ),
    rotationY: Math.PI,
    slabFrom: -halfWidth - wallThickness,
    slabTo: halfWidth + wallThickness,
    trimFrom: -cornerTrim,
    trimTo: cornerTrim,
    pilasters: Z_LINE_X.filter((x) => Math.abs(x) > BACKDROP.halfWidth).map((x) => -x),
    bare: [-BACKDROP.halfWidth, BACKDROP.halfWidth],
    opening: { halfWidth: PORTAL.halfWidth, height: PORTAL.height },
  }, materials, casino);
  front.add(createPortal(materials, casino));
  group.add(front);
  return group;
}

// The gold frame of the portal, in the frame of the front wall (local z = 0 is the hall face).
// The opening floor is the carpet, so every part that stands in the opening or on the floor starts on the
// carpet top. The reveal lining, the casing and the frame parts meet face to face, never inside each other.
function createPortal(materials: Materials, casino: CasinoMaterials): THREE.Group {
  const portal = named(new THREE.Group(), "Portal");
  const { halfWidth: w, height: h, lining, casing, casingDepth, pilasterX, capitalBottom, capitalTop, friezeTop, corniceTop } = PORTAL;
  const floor = CARPET_TOP;
  const wall = -HALL.wallThickness;
  // Reveal: the jambs and the soffit through the wall thickness, and a sill on the carpet between the jambs.
  portal.add(merged("Reveal", [
    cuboid(-w, -w + lining, floor, h, wall, 0),
    cuboid(w - lining, w, floor, h, wall, 0),
    cuboid(-w + lining, w - lining, h - lining, h, wall, 0),
    cuboid(-w + lining, w - lining, floor, floor + 0.04, wall, 0),
  ], materials.goldDark));
  // Architrave: two jambs and a head that runs over their tops.
  portal.add(merged("Casing", [
    cuboid(-w - casing, -w, floor, h, 0, casingDepth),
    cuboid(w, w + casing, floor, h, 0, casingDepth),
    cuboid(-w - casing, w + casing, h, h + casing, 0, casingDepth),
  ], materials.goldPolished));
  // Keystone between the casing head and the frieze.
  portal.add(solid("Keystone", cuboid(-0.32, 0.32, h + casing, capitalTop, 0, 0.2), materials.goldPolished));
  // Pilasters on plinths, with capitals under the entablature.
  const pilasters: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * pilasterX;
    pilasters.push(cuboid(x - 0.5, x + 0.5, floor, 0.6, 0, 0.42));
    pilasters.push(cuboid(x - 0.4, x + 0.4, 0.6, capitalBottom, 0, 0.32));
    pilasters.push(cuboid(x - 0.5, x + 0.5, capitalBottom, capitalTop, 0, 0.42));
  }
  // Dark gold: the chandeliers hang close in front of the pilasters, and a brighter gold glares under them.
  portal.add(merged("Pilasters", pilasters, materials.goldDark));
  // Entablature: a dark frieze on the capitals and a gold cornice on top, with a fan crest in the middle.
  const outer = pilasterX + 0.5;
  portal.add(solid("Frieze", cuboid(-outer, outer, capitalTop, friezeTop, 0, 0.36), casino.casinoBlack));
  portal.add(solid("Cornice", cuboid(-outer - 0.2, outer + 0.2, friezeTop, corniceTop, 0, 0.5), materials.goldPolished));
  const fan = new THREE.Shape();
  fan.absarc(0, 0, 0.85, 0, Math.PI, false);
  fan.closePath();
  const crest = new THREE.ExtrudeGeometry(fan, { depth: 0.12, bevelEnabled: false, curveSegments: 32 });
  crest.translate(0, corniceTop, 0.14);
  portal.add(solid("Crest", crest, materials.goldPolished));
  return portal;
}

// Ceiling slab, the lintel over the opening, the header that closes the amphitheatre front above the hall,
// and the coffer beams. Each beam ends on a capital, on the lintel or on the bare backdrop wall.
function createCeiling(materials: Materials, casino: CasinoMaterials): THREE.Group {
  const group = named(new THREE.Group(), "Ceiling");
  const { halfWidth, backZ, frontZ, wallThickness, height, ceilingThickness, openingHalfWidth, beam } = HALL;
  const side = halfWidth + wallThickness;
  const back = backZ - wallThickness;
  group.add(solid("Ceiling Slab", cuboid(-side, side, height, height + ceilingThickness, back, frontZ + wallThickness), casino.casinoCeiling));
  group.add(solid("Lintel", cuboid(-openingHalfWidth, openingHalfWidth, HALL.lintelBottom, height, back, backZ), casino.casinoWood));
  group.add(solid("Header", cuboid(-side, side, height + ceilingThickness, HALL.headerTop, back, backZ), casino.casinoWood));

  const beams: THREE.BufferGeometry[] = [];
  const beamBottom = height - beam;
  const capitalFace = halfWidth - PILASTER.capital.depth;
  for (const z of X_BEAM_Z) {
    beams.push(cuboid(-capitalFace, capitalFace, beamBottom, height, z - beam / 2, z + beam / 2));
  }
  for (const x of Z_LINE_X) {
    const start = Math.abs(x) < openingHalfWidth ? backZ : backZ + PILASTER.capital.depth;
    const end = Math.abs(x) < BACKDROP.halfWidth ? frontZ : frontZ - PILASTER.capital.depth;
    const stops = [start, ...X_BEAM_Z.flatMap((z) => [z - beam / 2, z + beam / 2]), end];
    for (let i = 0; i < stops.length; i += 2) {
      beams.push(cuboid(x - beam / 2, x + beam / 2, beamBottom, height, stops[i] as number, stops[i + 1] as number));
    }
  }
  group.add(merged("Coffer Beams", beams, materials.goldDark));
  return group;
}

// Crystal chandelier hanging from the ceiling: canopy, rod, a crown, a gold band, the body and a drop.
function createChandelier(materials: Materials, casino: CasinoMaterials, withLight: boolean): THREE.Group {
  const chandelier = new THREE.Group();
  const top = HALL.height;
  const gold: THREE.BufferGeometry[] = [
    drumGeometry(0.35, 0.35, top - 0.15, top),
    drumGeometry(0.035, 0.035, 8.9, top - 0.15, 0, 0, 12),
    drumGeometry(0.95, 0.95, 8.45, 8.55, 0, 0, 32),
  ];
  const crystal: THREE.BufferGeometry[] = [
    drumGeometry(0.3, 0.9, 8.55, 8.9, 0, 0, 24),
    drumGeometry(0.9, 0.9, 8.25, 8.45, 0, 0, 24),
    drumGeometry(0.9, 0.08, 7.5, 8.25, 0, 0, 24),
  ];
  chandelier.add(merged("Frame", gold, materials.goldPolished));
  const body = merged("Crystals", crystal, casino.casinoCrystal);
  body.castShadow = false;
  chandelier.add(body);
  if (withLight) {
    const light = named(new THREE.PointLight(0xffd2a0, 160, 13, 2), "Chandelier Light");
    light.position.set(0, 7.9, 0);
    chandelier.add(light);
  }
  return chandelier;
}

// Round card table with six chairs around it.
function createGamingTable(materials: Materials, casino: CasinoMaterials): THREE.Group {
  const table = new THREE.Group();
  table.add(merged("Base", [drumGeometry(0.45, 0.5, 0, 0.08), drumGeometry(1.3, 1.3, 0.66, 0.76, 0, 0, 48)], casino.casinoWood));
  table.add(solid("Pedestal", drumGeometry(0.18, 0.18, 0.08, 0.66, 0, 0, 16), materials.gold));
  table.add(solid("Felt", drumGeometry(1.12, 1.12, 0.76, 0.78, 0, 0, 48), casino.casinoFelt));
  const legs: THREE.BufferGeometry[] = [];
  const seats: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    // The chair frame: the seat centre on the local origin, the back on the far side from the table.
    matrix.makeRotationY(angle).setPosition(Math.sin(angle) * 1.8, 0, Math.cos(angle) * 1.8);
    legs.push(drumGeometry(0.22, 0.22, 0, 0.03, 0, 0, 16).applyMatrix4(matrix));
    legs.push(drumGeometry(0.05, 0.05, 0.03, 0.42, 0, 0, 12).applyMatrix4(matrix));
    seats.push(drumGeometry(0.28, 0.28, 0.42, 0.5, 0, 0, 24).applyMatrix4(matrix));
    seats.push(cuboid(-0.25, 0.25, 0.5, 1.1, 0.16, 0.24).applyMatrix4(matrix));
  }
  table.add(merged("Chair Legs", legs, materials.gold));
  table.add(merged("Chairs", seats, materials.velvet));
  return table;
}

// A row of slot machines side by side, fronts along local +z. Each machine: a wooden base,
// a black cabinet with a button deck, a lit screen and a lit topper sign.
function createSlotRow(count: number, casino: CasinoMaterials): THREE.Group {
  const row = new THREE.Group();
  const width = 0.84;
  const bases: THREE.BufferGeometry[] = [];
  const cabinets: THREE.BufferGeometry[] = [];
  const screens: THREE.BufferGeometry[] = [];
  const toppers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * width;
    bases.push(cuboid(x - width / 2, x + width / 2, 0, 0.75, -0.4, 0.4));
    cabinets.push(cuboid(x - 0.4, x + 0.4, 0.75, 1.95, -0.35, 0.3));
    cabinets.push(cuboid(x - 0.4, x + 0.4, 0.75, 0.85, 0.3, 0.42));
    cabinets.push(cuboid(x - 0.4, x + 0.4, 1.95, 2.25, -0.35, 0.2));
    screens.push(cuboid(x - 0.33, x + 0.33, 1.05, 1.8, 0.3, 0.31));
    toppers.push(cuboid(x - 0.36, x + 0.36, 2.0, 2.2, 0.2, 0.21));
  }
  row.add(merged("Bases", bases, casino.casinoWood));
  row.add(merged("Cabinets", cabinets, casino.casinoBlack));
  row.add(merged("Screens", screens, casino.casinoSlotScreen));
  row.add(merged("Toppers", toppers, casino.casinoSlotTopper));
  return row;
}

// The casino hall and the photo backdrop behind its portal. `update` drives the backdrop animation.
function createCasino(materials: Materials, casino: CasinoMaterials): { group: THREE.Group; update: (time: number) => void } {
  const group = named(new THREE.Group(), "Casino", true);
  const floor = named(new THREE.Group(), "Floor", true);
  floor.add(createCarpet(casino));
  group.add(floor, createWalls(materials, casino), createCeiling(materials, casino));

  // Chandeliers hang in the middle of coffer bays. The inner four carry a light.
  const chandeliers = named(new THREE.Group(), "Chandeliers", true);
  const bayX = (index: number) => -HALL.halfWidth + (2 * HALL.halfWidth * (index + 0.5)) / (HALL.zLines + 1);
  const bayZ = (index: number) => HALL.backZ + ((HALL.frontZ - HALL.backZ) * (index + 0.5)) / (HALL.xBeams + 1);
  const spots = [
    { x: bayX(5), z: bayZ(1), light: true },
    { x: bayX(8), z: bayZ(1), light: true },
    { x: bayX(5), z: bayZ(3), light: true },
    { x: bayX(8), z: bayZ(3), light: true },
    { x: bayX(2), z: bayZ(1), light: false },
    { x: bayX(11), z: bayZ(1), light: false },
    { x: bayX(2), z: bayZ(3), light: false },
    { x: bayX(11), z: bayZ(3), light: false },
  ];
  for (const [index, spot] of spots.entries()) {
    const chandelier = named(createChandelier(materials, casino, spot.light), `Chandelier ${index + 1}`);
    chandelier.position.set(spot.x, 0, spot.z);
    chandeliers.add(chandelier);
  }
  group.add(chandeliers);

  // Warm washes on the side walls, from the ceiling, so the panelling reads behind the slot and dice stations.
  const lights = named(new THREE.Group(), "Hall Lights", true);
  for (const side of [-1, 1]) {
    for (const [index, z] of [bayZ(1), bayZ(3)].entries()) {
      const name = `Wall Wash ${side < 0 ? "Left" : "Right"} ${index + 1}`;
      const light = named(new THREE.SpotLight(0xffc890, 900, 0, THREE.MathUtils.degToRad(38), 0.8, 2), name);
      light.position.set(side * (HALL.halfWidth - 7), HALL.height - 0.5, z);
      named(light.target, `${name} Target`);
      light.target.position.set(side * HALL.halfWidth, 3.5, z);
      lights.add(light, light.target);
    }
  }
  group.add(lights);

  // Card tables in the front corners of the hall.
  const tables = named(new THREE.Group(), "Gaming Tables", true);
  for (const [index, [x, z]] of ([[-28.5, 33.5], [-21, 33.5], [21, 33.5], [28.5, 33.5]] as const).entries()) {
    const table = named(createGamingTable(materials, casino), `Gaming Table ${index + 1}`);
    table.position.set(x, 0, z);
    tables.add(table);
  }
  group.add(tables);

  // Slot rows stand a little off the side walls, in the bays on both sides of the stations.
  // A row is 0.8 m deep: its back stays 5 cm in front of the pilaster plinths.
  const slots = named(new THREE.Group(), "Slot Rows", true);
  const rowOffset = HALL.halfWidth - PILASTER.plinth.depth - 0.05 - 0.4;
  const rows = [
    { name: "Slot Row Left Back", x: -rowOffset, z: 16.2, count: 7, facing: 1 },
    { name: "Slot Row Left Front", x: -rowOffset, z: 29.8, count: 7, facing: 1 },
    { name: "Slot Row Right Back", x: rowOffset, z: 16.2, count: 7, facing: -1 },
    { name: "Slot Row Right Front", x: rowOffset, z: 29.8, count: 7, facing: -1 },
  ];
  for (const spec of rows) {
    const row = named(createSlotRow(spec.count, casino), spec.name);
    row.position.set(spec.x, 0, spec.z);
    row.rotation.y = (spec.facing * Math.PI) / 2;
    slots.add(row);
  }
  // Along the front wall, on both sides of the backdrop.
  for (const side of [-1, 1]) {
    const row = named(createSlotRow(9, casino), side < 0 ? "Slot Row Front Left" : "Slot Row Front Right");
    row.position.set(side * 25.7, 0, HALL.frontZ - PILASTER.plinth.depth - 0.05 - 0.4);
    row.rotation.y = Math.PI;
    slots.add(row);
  }
  group.add(slots);

  // Red velvet drapes in the side wall bays behind the slot and dice stations.
  const curtains = named(new THREE.Group(), "Curtains", true);
  const bayMiddle = ((X_BEAM_Z[1] as number) + (X_BEAM_Z[2] as number)) / 2;
  const bayWidth = (X_BEAM_Z[2] as number) - (X_BEAM_Z[1] as number) - PILASTER.plinth.width - 0.3;
  for (const side of [-1, 1]) {
    const curtain = named(createCurtain(materials, bayWidth, 9.4), side < 0 ? "Curtain Left" : "Curtain Right");
    curtain.position.set(side * (HALL.halfWidth - 0.55), 0, bayMiddle);
    curtain.rotation.y = (-side * Math.PI) / 2;
    curtains.add(curtain);
  }
  group.add(curtains);

  // Mount point of the casino backdrop (src/scene/casinoBackdrop.ts): the bottom centre of the portal, on the
  // inner face of the front wall. Local +z looks into the hall, towards the Game Show camera.
  // `userData.width` x `userData.height` is the clear opening of the portal.
  const backdrop = named(new THREE.Group(), "Backdrop", true);
  backdrop.position.set(0, 0, HALL.frontZ);
  backdrop.rotation.y = Math.PI;
  backdrop.userData.width = (PORTAL.halfWidth - PORTAL.lining) * 2;
  backdrop.userData.height = PORTAL.height - PORTAL.lining;
  // The photo room stands outside the hall: its near edge is just behind the outer face of the wall,
  // its floor is the hall floor, and the scale puts the projector at the height of the Game Show camera.
  // The projector then stands on the line of sight of that camera, about 8.5 m in front of it, so the camera
  // sees the room through the portal from straight behind the projector and never sees past the photo edges.
  const view = createCasinoBackdrop();
  view.group.scale.setScalar(BACKDROP_EYE / view.projector.position.y);
  view.group.position.z = -HALL.wallThickness - 0.05;
  backdrop.add(view.group);
  group.add(backdrop);
  return { group, update: view.update };
}

export { BACKDROP, BACKDROP_EYE, HALL, canvasTexture, createCasino, createCasinoMaterials, createSlotRow, cuboid, drumGeometry, merged, solid };
export type { CasinoMaterials };
