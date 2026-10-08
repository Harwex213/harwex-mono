import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { named, planPrism, polar } from "./geometry";
import type { Materials } from "./materials";
import { createCurtain } from "./props";
import { FLOOR, LAYOUT, boundaryAngle, jointRadius } from "./studio";

// The annex: a rectangular room at the front right of the amphitheatre (the camera side, +z), as on the plan sketch.
// The amphitheatre opens into it: the annex has no wall between its left wall and the right end of the colonnade.
// A partition splits the annex in two parts:
// - the Game Show room on the left, with the Bonus Show wheel; the Game Show shot looks across it along +x;
// - the casino part on the right, behind a large opening in the partition. The casino is a photo backdrop with shaders,
//   mounted on `Annex/Casino Backdrop`. The casino part has no walls, ceiling or floor of its own: the backdrop room
//   is much larger than the annex and replaces them. The partition is the only wall between the two parts.
//
// Floor plan, in metres from the studio centre (the hero wheel stands at z = -4):
//   inner faces: left wall x = -2, back wall z = 9.67, front wall z = 31.4; the casino part reaches x = 39.2 on the plan;
//   the partition stands at x = 22.8..23.2, its opening is 16 m wide (z 12.53..28.53) and 9 m high.
// The ceiling is the ceiling of the amphitheatre: the same height, thickness and material, so the two read as one.
// The marble floor of the annex is a part of the amphitheatre floor (`Studio/Floor/Marble`, see `annexFloorPlan`).

// The right end of the colonnade: the corners of the end face of the last wall slab, on its front and back face.
const COLONNADE_END_FRONT = polar(boundaryAngle(LAYOUT.segments), jointRadius(0));
const COLONNADE_END_BACK = polar(boundaryAngle(LAYOUT.segments), jointRadius(-LAYOUT.wallThickness));

const ANNEX = {
  wall: 0.4,
  // Inner faces of the walls.
  left: -2,
  back: COLONNADE_END_BACK.z + 0.4,
  front: 31.4,
  right: 39.2,
  // Centre line of the partition.
  partition: 23,
  height: LAYOUT.ceilingY,
  // The opening in the partition, centred across the room.
  opening: { width: 16, height: 9 },
};

// The casino floor lies higher than the Game Show room: steps lead up to the opening. The landing of the steps
// fills the partition thickness, and the backdrop floor starts on the casino face of the partition.
const CASINO_STEPS = { risers: 5, riser: 0.15, tread: 0.35 };
const CASINO_FLOOR = CASINO_STEPS.risers * CASINO_STEPS.riser;

// The back line of the annex: the outer face of the back wall, and the front edge of the amphitheatre ceiling.
const BACK_LINE = COLONNADE_END_BACK.z;
const OPENING_Z = (ANNEX.back + ANNEX.front) / 2;
const PARTITION_NEAR = ANNEX.partition - ANNEX.wall / 2;
const PARTITION_FAR = ANNEX.partition + ANNEX.wall / 2;

// Entablature bands of the Game Show room, at the heights of the colonnade entablature (studio.ts).
const ENTABLATURE = [
  { name: "Architrave", depth: 0.8, bottom: LAYOUT.capitalTop, top: LAYOUT.capitalTop + 0.9, material: "gold" },
  { name: "Frieze", depth: 0.5, bottom: LAYOUT.capitalTop + 0.9, top: LAYOUT.capitalTop + 2.2, material: "wall" },
  { name: "Cornice", depth: 1.0, bottom: LAYOUT.capitalTop + 2.2, top: LAYOUT.capitalTop + 2.5, material: "goldPolished" },
] as const;

// Where the user placed Bonus Show (`Game Props/Bonus Show` in scene-overrides.json). Its face looks along -x.
const BONUS_SHOW_SPOT = new THREE.Vector3(18.28, 0, 20.38);

// The Game Show shot (shot II on the sketch): the camera stands near the edge of the round floor, at the left
// of the Game Show room, and looks along +x at Bonus Show. The partition opening and the casino behind it
// fill the background.
const GAMESHOW_SHOT = {
  position: new THREE.Vector3(8.3, 3.0, 20.2),
  target: new THREE.Vector3(BONUS_SHOW_SPOT.x, 2.6, BONUS_SHOW_SPOT.z),
};

// The projector of the casino backdrop stands on the line of sight of the Game Show shot, this far behind the
// rest position of the camera. The camera pushes in from there and drifts sideways, so it always stays in front
// of the projector. From a point in front of the projector the camera sees the picture over a wider angle,
// so the photo edges stay outside the opening during the whole idle motion.
const PROJECTOR_SETBACK = 0.6;

// Box geometry between two corners.
function cuboid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geometry;
}

function solid(name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.receiveShadow = true;
  return mesh;
}

// Several boxes of one material as one mesh.
function merged(name: string, geometries: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const geometry = mergeGeometries(geometries.map((item) => item.toNonIndexed()));
  if (!geometry) {
    throw new Error(`cannot merge ${name}`);
  }
  return solid(name, geometry, material);
}

// The floor of the annex as a plan polygon of (x, z) points: the rectangle under the Game Show room and under
// the partition, minus the round amphitheatre floor. The cut follows the exact polygon of the round floor,
// so the two parts meet edge to edge. The studio floor (studio.ts) adds this polygon to its marble and its mirror.
function annexFloorPlan(): THREE.Vector2[] {
  const left = ANNEX.left - ANNEX.wall;
  const front = ANNEX.front + ANNEX.wall;
  const inside = (point: THREE.Vector2) => point.x > left && point.y > BACK_LINE;
  // Vertices of the round floor CircleGeometry in world space: (r cos t, -r sin t).
  const circle: THREE.Vector2[] = [];
  for (let i = 0; i <= FLOOR.segments; i++) {
    const t = (i / FLOOR.segments) * Math.PI * 2;
    circle.push(new THREE.Vector2(FLOOR.radius * Math.cos(t), -FLOOR.radius * Math.sin(t)));
  }
  // The part of the circle inside the annex, in the order of the circle, with the two cut points on its edges.
  const arc: THREE.Vector2[] = [];
  for (let i = 1; i <= FLOOR.segments; i++) {
    const a = circle[i - 1] as THREE.Vector2;
    const b = circle[i] as THREE.Vector2;
    if (inside(a) !== inside(b)) {
      // The edge crosses the left line or the back line: take the crossing that lies on the annex boundary.
      const crossings: number[] = [];
      if ((a.x > left) !== (b.x > left)) {
        crossings.push((left - a.x) / (b.x - a.x));
      }
      if ((a.y > BACK_LINE) !== (b.y > BACK_LINE)) {
        crossings.push((BACK_LINE - a.y) / (b.y - a.y));
      }
      const k = inside(a) ? Math.min(...crossings) : Math.max(...crossings);
      arc.push(new THREE.Vector2().lerpVectors(a, b, k));
    }
    if (inside(b)) {
      arc.push(b.clone());
    }
  }
  return [new THREE.Vector2(left, front), ...arc, new THREE.Vector2(PARTITION_FAR, BACK_LINE), new THREE.Vector2(PARTITION_FAR, front)];
}

// The outer walls and the partition. The back wall starts on the end face of the colonnade.
function createWalls(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Walls", true);
  const { wall, left, back, front, height, opening } = ANNEX;
  const backPlan = [
    new THREE.Vector2(COLONNADE_END_FRONT.x, COLONNADE_END_FRONT.z),
    new THREE.Vector2(COLONNADE_END_BACK.x, COLONNADE_END_BACK.z),
    new THREE.Vector2(PARTITION_FAR, BACK_LINE),
    new THREE.Vector2(PARTITION_FAR, back),
    new THREE.Vector2(COLONNADE_END_FRONT.x, back),
  ];
  group.add(solid("Back Wall", planPrism(backPlan, 0, height), materials.wall));
  group.add(solid("Left Wall", cuboid(left - wall, left, 0, height, BACK_LINE, front), materials.wall));
  group.add(solid("Front Wall", cuboid(left - wall, PARTITION_FAR, 0, height, front, front + wall), materials.wall));

  // The partition: two jambs and a head over the opening.
  const partition = named(new THREE.Group(), "Partition");
  const near = OPENING_Z - opening.width / 2;
  const far = OPENING_Z + opening.width / 2;
  partition.add(merged("Wall", [
    cuboid(PARTITION_NEAR, PARTITION_FAR, 0, height, back, near),
    cuboid(PARTITION_NEAR, PARTITION_FAR, 0, height, far, front),
    cuboid(PARTITION_NEAR, PARTITION_FAR, opening.height, height, near, far),
  ], materials.wall));
  // A gold casing around the opening, on the Game Show face. The head runs over the tops of the jambs.
  const casing = 0.4;
  const casingDepth = 0.12;
  partition.add(merged("Casing", [
    cuboid(PARTITION_NEAR - casingDepth, PARTITION_NEAR, 0, opening.height, near - casing, near),
    cuboid(PARTITION_NEAR - casingDepth, PARTITION_NEAR, 0, opening.height, far, far + casing),
    cuboid(PARTITION_NEAR - casingDepth, PARTITION_NEAR, opening.height, opening.height + casing, near - casing, far + casing),
  ], materials.goldPolished));
  // Marquee bulbs up both jambs and along the head of the casing, like a stage portal. Each bulb touches the casing
  // face with its pole.
  const bulbRadius = 0.07;
  const bulbGeometry = new THREE.SphereGeometry(bulbRadius, 12, 8);
  bulbGeometry.rotateZ(-Math.PI / 2);
  const bulbX = PARTITION_NEAR - casingDepth - bulbRadius;
  const bulbSpots: THREE.Vector3[] = [];
  const jambCount = 19;
  for (let i = 0; i < jambCount; i++) {
    const y = 0.45 + ((opening.height - 0.25) * i) / (jambCount - 1);
    bulbSpots.push(new THREE.Vector3(bulbX, y, near - casing / 2), new THREE.Vector3(bulbX, y, far + casing / 2));
  }
  const headCount = 33;
  for (let i = 1; i < headCount - 1; i++) {
    const z = near - casing / 2 + ((far - near + casing) * i) / (headCount - 1);
    bulbSpots.push(new THREE.Vector3(bulbX, opening.height + casing / 2, z));
  }
  const bulbs = new THREE.InstancedMesh(bulbGeometry, materials.bulb, bulbSpots.length);
  bulbSpots.forEach((spot, index) => {
    bulbs.setMatrixAt(index, new THREE.Matrix4().makeTranslation(spot.x, spot.y, spot.z));
  });
  partition.add(named(bulbs, "Marquee Bulbs"));
  // Red drapes on both sides of the opening, from the floor up to the architrave.
  const drapeWidth = 2.2;
  for (const [name, z] of [["Drape Left", (back + near - casing) / 2], ["Drape Right", (far + casing + front) / 2]] as const) {
    const drape = named(createCurtain(materials, drapeWidth, LAYOUT.capitalTop - 0.01), name);
    drape.position.set(PARTITION_NEAR - 0.4, 0, z);
    drape.rotation.y = -Math.PI / 2;
    partition.add(drape);
  }
  group.add(partition);
  return group;
}

// Marble steps from the Game Show floor up to the casino floor, across the full width of the opening.
// The top step is the landing inside the partition; an amber LED strip runs along each riser.
function createSteps(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Casino Steps");
  const { risers, riser, tread } = CASINO_STEPS;
  const near = OPENING_Z - ANNEX.opening.width / 2;
  const far = OPENING_Z + ANNEX.opening.width / 2;
  // Warm brown marble. A Phong material ignores the scene environment: seen at a grazing angle, a standard
  // material mirrors its blue side panels as blue stripes along every tread.
  const marble = new THREE.MeshPhongMaterial({ color: 0x5a4632, specular: 0x4a3620, shininess: 50 });
  marble.name = "marbleSteps";
  const blocks: THREE.BufferGeometry[] = [];
  const strips: THREE.BufferGeometry[] = [];
  for (let i = 0; i < risers; i++) {
    const top = (i + 1) * riser;
    const x0 = PARTITION_NEAR - (risers - 1 - i) * tread;
    const x1 = i === risers - 1 ? PARTITION_FAR : x0 + tread;
    blocks.push(cuboid(x0, x1, 0, top, near, far));
    strips.push(cuboid(x0 - 0.012, x0, top - 0.055, top - 0.03, near + 0.15, far - 0.15));
  }
  group.add(merged("Steps", blocks, marble));
  group.add(merged("Riser Lights", strips, materials.led));
  return group;
}

// Architrave, frieze and cornice along the walls of the Game Show room, at the heights of the colonnade
// entablature. Each band runs along the front wall, the left wall, the partition and the back wall,
// and the runs meet end to end in the corners.
function createEntablature(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Entablature");
  const { left, back, front } = ANNEX;
  for (const band of ENTABLATURE) {
    const { depth, bottom, top } = band;
    group.add(merged(band.name, [
      cuboid(left, PARTITION_NEAR, bottom, top, front - depth, front),
      cuboid(left, left + depth, bottom, top, BACK_LINE, front - depth),
      cuboid(PARTITION_NEAR - depth, PARTITION_NEAR, bottom, top, back + depth, front - depth),
      cuboid(COLONNADE_END_FRONT.x, PARTITION_NEAR, bottom, top, back, back + depth),
    ], materials[band.material]));
  }
  return group;
}

// The ceiling slab at the height of the amphitheatre ceiling, and two straight trusses with rows of downlights
// over the Game Show room, like the round trusses of the amphitheatre.
function createCeiling(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Ceiling");
  const { wall, left, front, height } = ANNEX;
  group.add(solid("Ceiling Slab", cuboid(left - wall, PARTITION_FAR, height, height + LAYOUT.ceilingThickness, BACK_LINE, front + wall), materials.ceiling));

  const tube = 0.14;
  const from = left + 1.5;
  const to = PARTITION_NEAR - 1.5;
  const count = 14;
  const fixtureBody = new THREE.CylinderGeometry(0.24, 0.3, 0.42, 16);
  const fixtureLens = new THREE.CylinderGeometry(0.21, 0.21, 0.02, 16);
  const trussY = height - tube;
  const bodyY = trussY - tube - 0.21;
  const lensY = bodyY - 0.21 - 0.01;
  const matrix = new THREE.Matrix4();
  for (const [index, z] of [ANNEX.back + 5.5, front - 5.5].entries()) {
    const truss = named(new THREE.Group(), `Truss ${index + 1}`);
    const tubeGeometry = new THREE.CylinderGeometry(tube, tube, to - from, 16);
    tubeGeometry.rotateZ(Math.PI / 2);
    tubeGeometry.translate((from + to) / 2, trussY, z);
    truss.add(solid("Tube", tubeGeometry, materials.goldDark));
    const bodies = new THREE.InstancedMesh(fixtureBody, materials.goldDark, count);
    const lenses = new THREE.InstancedMesh(fixtureLens, materials.fixture, count);
    for (let i = 0; i < count; i++) {
      const x = from + 0.4 + ((to - from - 0.8) * i) / (count - 1);
      matrix.makeTranslation(x, bodyY, z);
      bodies.setMatrixAt(i, matrix);
      matrix.makeTranslation(x, lensY, z);
      lenses.setMatrixAt(i, matrix);
    }
    truss.add(named(bodies, "Fixture Bodies"), named(lenses, "Fixture Lenses"));
    group.add(truss);
  }
  return group;
}

// Four real lights: a key on Bonus Show, a wash over the partition, a fill over the floor of the room and a wash
// over the steps up to the casino.
// The truss downlights only glow.
function createLights(): THREE.Group {
  const group = named(new THREE.Group(), "Lights", true);
  const add = (name: string, light: THREE.SpotLight, from: THREE.Vector3, to: THREE.Vector3) => {
    named(light, name);
    named(light.target, `${name} Target`);
    light.position.copy(from);
    light.target.position.copy(to);
    group.add(light, light.target);
  };
  const deg = THREE.MathUtils.degToRad;
  add("Bonus Show Key", new THREE.SpotLight(0xffd9a8, 150, 0, deg(20), 0.6, 2), new THREE.Vector3(11, 13, 22), new THREE.Vector3(BONUS_SHOW_SPOT.x, 2.6, BONUS_SHOW_SPOT.z));
  add("Partition Wash", new THREE.SpotLight(0xffb878, 900, 0, deg(40), 0.8, 2), new THREE.Vector3(4, ANNEX.height - 1.2, OPENING_Z), new THREE.Vector3(PARTITION_NEAR, 5, OPENING_Z));
  add("Room Fill", new THREE.SpotLight(0xffd2a0, 500, 0, deg(50), 1, 2), new THREE.Vector3(10, ANNEX.height - 1.2, OPENING_Z), new THREE.Vector3(10, 0, OPENING_Z));
  add("Steps Wash", new THREE.SpotLight(0xffc890, 500, 0, deg(38), 0.9, 2), new THREE.Vector3(15, ANNEX.height - 1.2, OPENING_Z), new THREE.Vector3(PARTITION_NEAR - 1, 0, OPENING_Z));
  return group;
}

interface Backdrop {
  group: THREE.Object3D;
  update: (time: number) => void;
  // Moves the near edge of the backdrop room `depth` units (of the backdrop frame) away from the projector.
  setNear: (depth: number) => void;
  // The projector in the backdrop frame (casinoBackdrop.ts): the floor is at y = 0, the hall lies towards -z.
  projector: { position: THREE.Vector3 };
}

// Places the backdrop under the anchor. The projector lands at the eye of the Game Show camera,
// PROJECTOR_SETBACK behind it, and the backdrop floor lands on the casino floor. That fixes the scale:
// the eye height of the camera above the casino floor over the eye height of the picture.
// The backdrop room starts on the casino face of the partition (anchor z = 0).
function mountBackdrop(anchor: THREE.Object3D, backdrop: Backdrop): void {
  const { position, target } = GAMESHOW_SHOT;
  const sight = new THREE.Vector3().subVectors(target, position).setY(0).normalize();
  const eye = position.clone().addScaledVector(sight, -PROJECTOR_SETBACK);
  // World to anchor frame: the anchor is turned by -90 deg about y.
  const projector = new THREE.Vector3(eye.z - OPENING_Z, eye.y, PARTITION_FAR - eye.x);
  const scale = (projector.y - CASINO_FLOOR) / backdrop.projector.position.y;
  backdrop.group.scale.setScalar(scale);
  backdrop.group.position.copy(projector).addScaledVector(backdrop.projector.position, -scale);
  backdrop.setNear(projector.z / scale);
  anchor.add(backdrop.group);
}

// The annex. `backdrop` is the casino view to mount behind the partition opening; `update` drives its animation.
function createAnnex(materials: Materials, backdrop?: Backdrop): { group: THREE.Group; update: (time: number) => void } {
  const group = named(new THREE.Group(), "Annex", true);
  // Light zones (lightZones.ts): every light under this group belongs to the annex.
  group.userData.lightZone = "annex";
  group.add(createWalls(materials), createSteps(materials), createEntablature(materials), createCeiling(materials), createLights());

  // Mount point of the casino backdrop: the bottom centre of the partition opening, on the casino face of the
  // partition, at the level of the Game Show floor. Local +z looks back into the Game Show room, towards the
  // Game Show camera; local +x runs along world +z. Everything at local z < 0 is free space for the backdrop.
  // `userData.width` x `userData.height` is the clear opening, `userData.floor` the height of the casino floor.
  const anchor = named(new THREE.Group(), "Casino Backdrop", true);
  anchor.position.set(PARTITION_FAR, 0, OPENING_Z);
  anchor.rotation.y = -Math.PI / 2;
  anchor.userData.width = ANNEX.opening.width;
  anchor.userData.height = ANNEX.opening.height;
  anchor.userData.floor = CASINO_FLOOR;
  if (backdrop) {
    mountBackdrop(anchor, backdrop);
  }
  group.add(anchor);

  const update = (time: number) => {
    backdrop?.update(time);
  };
  return { group, update };
}

export { ANNEX, BONUS_SHOW_SPOT, GAMESHOW_SHOT, annexFloorPlan, createAnnex };
export type { Backdrop };
