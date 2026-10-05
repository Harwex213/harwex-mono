import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { archFrameHalf, archFrameShape, archPath, faceCenter, floorArc, keystoneShape, named, planPrism, polar } from "./geometry";
import type { Materials } from "./materials";
import { PODIUM_Z } from "./wheel";

const deg = THREE.MathUtils.degToRad;

// The colonnade is a polygon of straight bays, not a circle: a straight wall with an arch opening
// cannot meet a round step or a round beam without gaps or overlaps. Every part that runs along the
// wall (the wall, the steps, the entablature, the ceiling) is built on the same polygon, and all of
// them end on the same radial planes through the joints, so neighbours meet exactly.
//
// Distances along the wall are measured as an inward offset from the wall front:
// offset 0 is the wall front, offset 1.6 is 1.6 m in front of it towards the studio center.
//
// Heights, bottom to top:
//   0.00  floor            0.65  lower step top      1.30  upper step top = arch sill = column foot
//   13.1  capital top = architrave bottom            15.9  wall top = ceiling bottom
const LAYOUT = {
  // Radius of the joints between bays, at the wall front.
  wallRadius: 20,
  arcFrom: deg(-100),
  arcTo: deg(100),
  segments: 12,
  wallThickness: 0.4,
  ceilingY: 15.9,
  ceilingThickness: 0.3,
  archHalfWidth: 1.6,
  archSill: 1.3,
  archSpring: 9.2,
  // The arch frame: inner edge on the opening, outer edge, depth from the wall front.
  frameOuter: 1.94,
  frameDepth: 0.24,
  // Thin outer moulding a step outside the frame.
  mouldingInner: 2.04,
  mouldingOuter: 2.12,
  mouldingDepth: 0.1,
  // Steps along the wall: the upper one carries the columns and meets the arch sills.
  lowerStep: { depth: 2.6, top: 0.65 },
  upperStep: { depth: 1.6, top: 1.3 },
  capitalTop: 13.1,
};

const STEP = (LAYOUT.arcTo - LAYOUT.arcFrom) / LAYOUT.segments;
// Half of the angle between neighbouring bays.
const HALF_STEP = STEP / 2;
// Distance from the studio center to the middle of a bay's wall front.
const APOTHEM = LAYOUT.wallRadius * Math.cos(HALF_STEP);
// Length of one bay's wall front, joint to joint.
const BAY_LENGTH = 2 * LAYOUT.wallRadius * Math.sin(HALF_STEP);

// Column parts, bottom to top, from the upper step top (1.3) to the capital top (13.1). Width runs along the wall, depth is the offset of the front face.
const COLUMN = [
  { name: "Plinth", width: 1.3, depth: 0.8, height: 0.55, material: "goldPolished" },
  { name: "Base Band", width: 1.15, depth: 0.7, height: 0.15, material: "gold" },
  { name: "Shaft", width: 1.0, depth: 0.6, height: 10.5, material: "gold" },
  { name: "Capital Band", width: 1.15, depth: 0.7, height: 0.15, material: "gold" },
  { name: "Capital", width: 1.3, depth: 0.8, height: 0.45, material: "goldPolished" },
] as const;
const SHAFT_DEPTH = 0.6;
// Flutes run in two lengths, with a gap for a sconce at SCONCE_HEIGHT.
const SCONCE_HEIGHT = 7.6;

// Entablature bands, bottom to top, against the wall front.
const ENTABLATURE = [
  { name: "Architrave", depth: 0.8, height: 0.9, material: "gold" },
  { name: "Frieze", depth: 0.5, height: 1.3, material: "wall" },
  { name: "Cornice", depth: 1.0, height: 0.3, material: "goldPolished" },
] as const;

function segmentAngle(index: number): number {
  return LAYOUT.arcFrom + STEP * (index + 0.5);
}

function boundaryAngle(index: number): number {
  return LAYOUT.arcFrom + STEP * index;
}

// Joint radius of the polygon that runs `offset` metres in front of the wall front.
function jointRadius(offset: number): number {
  return (APOTHEM - offset) / Math.cos(HALF_STEP);
}

function planPoint(angle: number, radius: number): THREE.Vector2 {
  const point = polar(angle, radius);
  return new THREE.Vector2(point.x, point.z);
}

// A band along the whole colonnade between two offsets, mitred at every joint.
function colonnadeStrip(fromOffset: number, toOffset: number, bottom: number, height: number): THREE.BufferGeometry {
  const plan: THREE.Vector2[] = [];
  for (let i = 0; i <= LAYOUT.segments; i++) {
    plan.push(planPoint(boundaryAngle(i), jointRadius(fromOffset)));
  }
  for (let i = LAYOUT.segments; i >= 0; i--) {
    plan.push(planPoint(boundaryAngle(i), jointRadius(toOffset)));
  }
  return planPrism(plan, bottom, height);
}

function box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The wall slab of one bay, in the bay frame: x along the wall, the front face at z = 0, the back at -thickness.
// The slab is built flat and then each point is pushed along the radius from the studio center,
// so both ends lie on the radial planes through the joints and meet the next slab without a gap.
function wallSlabGeometry(): THREE.BufferGeometry {
  const { wallThickness, ceilingY, archHalfWidth, archSill, archSpring } = LAYOUT;
  const shape = new THREE.Shape();
  shape.moveTo(-BAY_LENGTH / 2, 0);
  shape.lineTo(BAY_LENGTH / 2, 0);
  shape.lineTo(BAY_LENGTH / 2, ceilingY);
  shape.lineTo(-BAY_LENGTH / 2, ceilingY);
  shape.closePath();
  const hole = new THREE.Path();
  archPath(hole, archHalfWidth, archSill, archSpring);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: wallThickness, bevelEnabled: false, curveSegments: 48 });
  geometry.translate(0, 0, -wallThickness);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    // The studio center sits at z = APOTHEM in the bay frame.
    const scale = (APOTHEM - position.getZ(i)) / APOTHEM;
    position.setX(i, position.getX(i) * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function extruded(shape: THREE.Shape, depth: number, material: THREE.Material, name: string): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// One bay: the wall slab with the arch opening, the arch frame with its keystone, the moulding,
// the sill in the opening and two panel lines. Everything stands on the upper step or on the wall front.
function createArchBay(materials: Materials, slab: THREE.BufferGeometry): THREE.Group {
  const { archHalfWidth, archSill, archSpring, frameOuter, frameDepth, mouldingInner, mouldingOuter, mouldingDepth, wallThickness } = LAYOUT;
  const bay = new THREE.Group();

  const wall = named(new THREE.Mesh(slab, materials.wall), "Wall");
  wall.receiveShadow = true;
  bay.add(wall);

  // The frame is cut at the crown, and the keystone fills the cut exactly.
  const keyHalfAngle = 0.2 / archHalfWidth;
  const left = Math.PI / 2 + keyHalfAngle;
  const right = Math.PI / 2 - keyHalfAngle;
  bay.add(extruded(archFrameHalf(-1, archHalfWidth, frameOuter, archSill, archSpring, left), frameDepth, materials.goldPolished, "Arch Frame Left"));
  bay.add(extruded(archFrameHalf(1, archHalfWidth, frameOuter, archSill, archSpring, right), frameDepth, materials.goldPolished, "Arch Frame Right"));
  // The keystone stands proud of the frame, and its top stays under the moulding.
  bay.add(extruded(keystoneShape(archHalfWidth, frameOuter + 0.08, archSpring, right, left), frameDepth + 0.08, materials.goldPolished, "Keystone"));
  bay.add(extruded(archFrameShape(mouldingInner, mouldingOuter, archSill, archSpring), mouldingDepth, materials.gold, "Outer Moulding"));

  // Sill: fills the bottom of the opening through the wall and runs on over the step in front of it.
  const sillFront = 0.3;
  const sill = named(box(archHalfWidth * 2, 0.08, wallThickness + sillFront, materials.goldPolished, 0, archSill + 0.04, (sillFront - wallThickness) / 2), "Sill");
  bay.add(sill);

  // Panel lines between the columns, above the arch and under the architrave.
  const lineLength = 2 * (BAY_LENGTH / 2 - 0.75);
  for (const [index, y] of [archSpring + mouldingOuter + 0.4, LAYOUT.capitalTop - 0.4].entries()) {
    bay.add(named(box(lineLength, 0.04, 0.04, materials.goldDark, 0, y, 0.02), `Panel Line ${index + 1}`));
  }
  return bay;
}

// Plan of a column part in the joint frame: z points to the studio center, the joint is at the origin.
// The back follows the two wall fronts that meet at the joint, so the part sits flat on both.
function columnPlan(width: number, depth: number): THREE.Vector2[] {
  const back = (width / 2) * Math.tan(HALF_STEP);
  return [
    new THREE.Vector2(-width / 2, back),
    new THREE.Vector2(0, 0),
    new THREE.Vector2(width / 2, back),
    new THREE.Vector2(width / 2, depth),
    new THREE.Vector2(-width / 2, depth),
  ];
}

function createColumn(materials: Materials): THREE.Group {
  const column = new THREE.Group();
  let y = LAYOUT.upperStep.top;
  for (const part of COLUMN) {
    const mesh = named(new THREE.Mesh(planPrism(columnPlan(part.width, part.depth), y, part.height), materials[part.material]), part.name);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    column.add(mesh);
    y += part.height;
  }
  // Flutes stand on the shaft front, in two runs with a gap for the sconce.
  const shaftBottom = LAYOUT.upperStep.top + COLUMN[0].height + COLUMN[1].height;
  const shaftTop = shaftBottom + COLUMN[2].height;
  const runs = [
    { from: shaftBottom + 0.5, to: SCONCE_HEIGHT - 0.6 },
    { from: SCONCE_HEIGHT + 0.6, to: shaftTop - 0.5 },
  ];
  const flutes = named(new THREE.Group(), "Flutes");
  for (const run of runs) {
    for (let i = 0; i < 5; i++) {
      const x = -0.3 + i * 0.15;
      flutes.add(box(0.06, run.to - run.from, 0.05, materials.goldDark, x, (run.from + run.to) / 2, SHAFT_DEPTH + 0.025));
    }
  }
  column.add(flutes);
  return column;
}

function createWalls(materials: Materials): THREE.Group {
  const walls = named(new THREE.Group(), "Walls", true);
  const slab = wallSlabGeometry();
  for (let i = 0; i < LAYOUT.segments; i++) {
    const angle = segmentAngle(i);
    const bay = named(createArchBay(materials, slab), `Arch Bay ${i + 1}`);
    bay.position.copy(polar(angle, APOTHEM));
    faceCenter(bay, angle);
    walls.add(bay);
  }
  // A column stands on every inner joint. The two ends of the colonnade have no wall on one side,
  // so a column there would hang half over the end of the step.
  for (let i = 1; i < LAYOUT.segments; i++) {
    const angle = boundaryAngle(i);
    const column = named(createColumn(materials), `Column ${i + 1}`);
    column.position.copy(polar(angle, LAYOUT.wallRadius));
    faceCenter(column, angle);
    walls.add(column);
  }
  return walls;
}

// Architrave, frieze and cornice run along the wall front on top of the capitals.
function createEntablature(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Entablature");
  let y = LAYOUT.capitalTop;
  for (const band of ENTABLATURE) {
    const mesh = named(new THREE.Mesh(colonnadeStrip(0, band.depth, y, band.height), materials[band.material]), band.name);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    y += band.height;
  }
  return group;
}

// Ceiling slab on top of the walls, and two trusses under it with rows of downlights.
function createCeiling(materials: Materials): THREE.Group {
  const { ceilingY, ceilingThickness, wallThickness } = LAYOUT;
  const group = named(new THREE.Group(), "Ceiling");
  // The slab covers the walls up to their back face and closes straight across the open front.
  const plan: THREE.Vector2[] = [];
  for (let i = 0; i <= LAYOUT.segments; i++) {
    plan.push(planPoint(boundaryAngle(i), jointRadius(-wallThickness)));
  }
  const ceiling = named(new THREE.Mesh(planPrism(plan, ceilingY, ceilingThickness), materials.ceiling), "Ceiling Panel");
  group.add(ceiling);

  // Each truss is an arc of tube that touches the ceiling with its top.
  // Fixtures hang from the truss: a body that touches the tube bottom, a lens under the body.
  const fixtureBody = new THREE.CylinderGeometry(0.24, 0.3, 0.42, 16);
  const fixtureLens = new THREE.CylinderGeometry(0.21, 0.21, 0.02, 16);
  const addTruss = (name: string, radius: number, tube: number, material: THREE.Material, count: number, from: number, to: number) => {
    const truss = named(new THREE.Group(), name);
    const trussY = ceilingY - tube;
    const margin = deg(2);
    const arc = named(new THREE.Mesh(floorArc(radius, tube, from - margin, to + margin), material), "Tube");
    arc.position.y = trussY;
    truss.add(arc);
    const bodies = new THREE.InstancedMesh(fixtureBody, materials.goldDark, count);
    const lenses = new THREE.InstancedMesh(fixtureLens, materials.fixture, count);
    const bodyY = trussY - tube - 0.21;
    const lensY = bodyY - 0.21 - 0.01;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const angle = from + ((to - from) * i) / (count - 1);
      const p = polar(angle, radius);
      matrix.makeTranslation(p.x, bodyY, p.z);
      bodies.setMatrixAt(i, matrix);
      matrix.makeTranslation(p.x, lensY, p.z);
      lenses.setMatrixAt(i, matrix);
    }
    truss.add(named(bodies, "Fixture Bodies"), named(lenses, "Fixture Lenses"));
    group.add(truss);
  };
  addTruss("Outer Truss", 18, 0.14, materials.goldDark, 30, deg(-95), deg(95));
  addTruss("Inner Truss", 13.6, 0.16, materials.gold, 20, deg(-80), deg(80));
  return group;
}

// Two steps along the colonnade, with a gold nosing on each tread and an LED strip on each riser.
function createBackSteps(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Back Steps");
  const { lowerStep, upperStep } = LAYOUT;
  // The upper step stands on the lower one.
  const tiers = [
    { name: "Lower", depth: lowerStep.depth, bottom: 0, top: lowerStep.top },
    { name: "Upper", depth: upperStep.depth, bottom: lowerStep.top, top: upperStep.top },
  ];
  for (const tier of tiers) {
    const step = named(new THREE.Mesh(colonnadeStrip(0, tier.depth, tier.bottom, tier.top - tier.bottom), materials.marble), `${tier.name} Step`);
    step.receiveShadow = true;
    group.add(step);
    group.add(named(new THREE.Mesh(colonnadeStrip(tier.depth - 0.06, tier.depth, tier.top, 0.04), materials.goldPolished), `${tier.name} Nosing`));
    group.add(named(new THREE.Mesh(colonnadeStrip(tier.depth, tier.depth + 0.015, tier.top - 0.14, 0.03), materials.led), `${tier.name} LED`));
  }
  return group;
}

// Mirror floor under a semi-transparent black marble layer with gold ring inlays.
// The marble top is the floor plane y = 0; the mirror lies just under it.
function createFloor(materials: Materials, width: number, height: number): { group: THREE.Group; reflector: Reflector } {
  const group = named(new THREE.Group(), "Floor");
  const reflector = named(new Reflector(new THREE.CircleGeometry(LAYOUT.wallRadius + 2, 96), {
    textureWidth: width * 0.5,
    textureHeight: height * 0.5,
    color: 0x8a8a8a,
  }), "Mirror");
  // The mirror only feeds the reflection under the marble; it is not part of the set.
  reflector.userData.auditIgnore = true;
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = -0.005;
  group.add(reflector);

  const marble = materials.marble.clone();
  marble.transparent = true;
  marble.opacity = 0.72;
  marble.name = "marbleFloor";
  const floor = named(new THREE.Mesh(new THREE.CircleGeometry(LAYOUT.wallRadius + 2, 96), marble), "Marble");
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Inlays are decals on the marble: they lie in the floor plane and win the depth test by polygon offset,
  // so furniture stands on the floor over them, like over a real inlay.
  const inlay = materials.goldPolished.clone();
  inlay.name = "goldInlay";
  inlay.polygonOffset = true;
  inlay.polygonOffsetFactor = -1;
  inlay.polygonOffsetUnits = -4;
  const rings = named(new THREE.Group(), "Inlays");
  rings.userData.auditIgnore = true;
  group.add(rings);
  for (const radius of [5.3, 5.55, 7.3, 7.5, 9.9, 12.6, 12.8]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.025, radius + 0.025, 160), inlay);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0, PODIUM_Z);
    rings.add(ring);
  }
  return { group, reflector };
}

function createStudio(materials: Materials, width: number, height: number) {
  const group = named(new THREE.Group(), "Studio", true);
  const floor = createFloor(materials, width, height);
  group.add(floor.group, createWalls(materials), createEntablature(materials), createCeiling(materials), createBackSteps(materials));
  return { group, reflector: floor.reflector };
}

// Puts an object on the front of a column shaft at `height`: local +z faces the studio center.
function onColumnShaft(object: THREE.Object3D, columnIndex: number, height: number): void {
  const angle = boundaryAngle(columnIndex);
  object.position.copy(polar(angle, LAYOUT.wallRadius - SHAFT_DEPTH, height));
  faceCenter(object, angle);
}

// Puts an object in front of the steps of a bay: `along` runs along the wall from the bay middle
// (positive to the right as seen from the studio center), `offset` is the distance from the wall front.
function inFrontOfBay(object: THREE.Object3D, bayIndex: number, along: number, offset: number): void {
  const angle = segmentAngle(bayIndex);
  const position = new THREE.Vector3(along, 0, offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
  object.position.copy(polar(angle, APOTHEM)).add(position);
  faceCenter(object, angle);
}

// The longest stretch along the wall that stays inside one bay at a given offset from the wall front.
function bayHalfLength(offset: number): number {
  return (BAY_LENGTH / 2) * ((APOTHEM - offset) / APOTHEM);
}

export { LAYOUT, SCONCE_HEIGHT, bayHalfLength, boundaryAngle, createStudio, inFrontOfBay, onColumnShaft, segmentAngle };
