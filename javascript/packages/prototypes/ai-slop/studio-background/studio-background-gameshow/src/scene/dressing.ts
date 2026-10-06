import * as THREE from "three";
import { named, planPrism, polar } from "./geometry";
import { beam } from "./lights";
import type { Materials } from "./materials";
import { createLampTable, drum, flutes, mesh, SCALE, slab } from "./props";
import { boundaryAngle, CENTER_BAY, jointRadius, LAYOUT } from "./studio";
import { PODIUM_Z } from "./wheel";

// Set dressing of the floor, after the art brief's scene reference:
// lounge groups of round red velvet tub chairs around striped navy-and-gold tables with globe lamps,
// flowers and champagne glasses; small plants beside the palms; a fine gold tile grid on the floor;
// uplights on the steps that wash the columns.
//
// The pieces are modelled at human size and scaled up as a whole (SCALE.lounge), like the props,
// so every contact stays exact. Every part is stacked from the floor up.
//
// Floor plan, in metres from the studio centre (the wheel stands at z = -4). Furniture stays clear of
// the inlay rings (10.3/10.55 m and 14.85/15.1 m); the small plants stand outside them, by the palms.
// Inside the inner ring:
// - front left: a lounge table with two tub chairs and a lamp table beside them;
// - front right, in front of the host desk: a lounge table with three tub chairs;
// - left of the wheel: two tub chairs, one between the lamp tables, one turned to the host;
// - right of the wheel: a tub chair beside the host desk, turned to it.
// In the band between the rings, four rows of chair, table, chair along the ring: two at the front
// (behind the camera in the Game view) and one on each side.

const LOUNGE_SCALE = 2.0;
// Table centre to chair centre: the table radius, a 12 cm gap and the chair radius, at set scale.
const CHAIR_DISTANCE = (0.52 + 0.06 + 0.43) * LOUNGE_SCALE;

function createLoungeMaterials() {
  const flowers = new THREE.MeshStandardMaterial({ color: 0xf3eee0, roughness: 0.8 });
  flowers.name = "flowers";
  const glass = new THREE.MeshStandardMaterial({ color: 0xe8f2ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35 });
  glass.name = "glass";
  const satinGold = new THREE.MeshStandardMaterial({ color: 0xc9a050, roughness: 0.4, metalness: 0.4 });
  satinGold.name = "satinGold";
  return { flowers, glass, satinGold };
}

type LoungeMaterials = ReturnType<typeof createLoungeMaterials>;

// Turns an object so that its local +z faces the point (x, z) on the floor.
function face(object: THREE.Object3D, x: number, z: number): void {
  const dx = x - object.position.x;
  const dz = z - object.position.z;
  object.rotation.y = Math.atan2(dx, dz);
}

// Upright solid of revolution from a (radius, height) profile that starts and ends on the axis.
function lathe(name: string, profile: [number, number][], bottom: number, material: THREE.Material, x = 0, z = 0): THREE.Mesh {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return mesh(name, new THREE.LatheGeometry(points, 40), material, x, bottom, z);
}

// Round tub chair: a gold base ring, a velvet seat drum and a channel-tufted shell round the back.
// The shell stands on the seat. Its inner face has vertical ridges, the channels of the tufting.
// Local +z is the open front of the chair.
function createTubChair(materials: Materials, pillow: THREE.Material): THREE.Group {
  const chair = new THREE.Group();
  const seatTop = 0.42;
  chair.add(drum("Base Ring", 0.42, 0.42, 0, 0.06, materials.goldPolished, 64));
  chair.add(drum("Seat", 0.41, 0.41, 0.06, seatTop, materials.velvet, 64));
  const from = THREE.MathUtils.degToRad(48);
  const to = THREE.MathUtils.degToRad(312);
  const samples = 66;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  for (let i = 0; i <= samples; i++) {
    const angle = from + ((to - from) * i) / samples;
    const channel = 0.5 + 0.5 * Math.cos((angle - from) * (2 * Math.PI) / THREE.MathUtils.degToRad(22));
    const innerRadius = 0.275 - 0.016 * channel;
    outer.push(new THREE.Vector2(Math.sin(angle) * 0.43, Math.cos(angle) * 0.43));
    inner.push(new THREE.Vector2(Math.sin(angle) * innerRadius, Math.cos(angle) * innerRadius));
  }
  const shell = named(new THREE.Mesh(planPrism([...outer, ...inner.reverse()], seatTop, 0.4), materials.velvet), "Shell");
  shell.castShadow = true;
  shell.receiveShadow = true;
  chair.add(shell);
  // A throw pillow stands on the seat just in front of the shell ridges, clear of them.
  chair.add(slab("Pillow", 0.26, seatTop, seatTop + 0.26, -0.2, -0.12, pillow));
  return chair;
}

// Lounge table: a gold base ring, a navy drum with gold stripes, a gold rim and a black glass top,
// with a globe lamp, a vase of white flowers and two champagne glasses on it.
function createLoungeTable(materials: Materials, lounge: LoungeMaterials, withLight: boolean): THREE.Group {
  const table = new THREE.Group();
  const top = 0.56;
  table.add(drum("Base Ring", 0.5, 0.52, 0, 0.04, materials.goldPolished, 64));
  table.add(drum("Drum", 0.46, 0.46, 0.04, 0.5, materials.navy, 96));
  table.add(flutes("Stripes", 24, 0.46, 0.07, 0.47, materials.gold));
  table.add(drum("Rim", 0.52, 0.52, 0.5, 0.54, materials.goldPolished, 64));
  table.add(drum("Glass Top", 0.5, 0.5, 0.54, top, materials.marble, 64));

  const lamp = named(new THREE.Group(), "Globe Lamp");
  lamp.add(drum("Neck", 0.04, 0.06, top, top + 0.12, materials.gold, 20));
  const globe = mesh("Globe", new THREE.SphereGeometry(0.14, 28, 18), materials.lampGlobe, 0, top + 0.12 + 0.14 - 0.015, 0);
  globe.castShadow = false;
  globe.userData.seated = true;
  lamp.add(globe);
  if (withLight) {
    const light = named(new THREE.PointLight(0xffd7a0, 1.6, 3.5, 2), "Lamp Light");
    light.position.set(0, globe.position.y, 0);
    lamp.add(light);
  }
  lamp.position.set(-0.2, 0, 0.05);
  table.add(lamp);

  const vase = named(new THREE.Group(), "Flowers");
  const vaseProfile: [number, number][] = [
    [0, 0],
    [0.06, 0],
    [0.045, 0.03],
    [0.08, 0.12],
    [0.065, 0.17],
    [0, 0.17],
  ];
  vase.add(lathe("Vase", vaseProfile, top, materials.goldPolished));
  // Seven blooms in a dome, each sunk into the vase mouth or its neighbours.
  const blooms: [number, number, number][] = [
    [0, 0.06, 0],
    [0.05, 0.03, 0],
    [-0.05, 0.03, 0],
    [0, 0.03, 0.05],
    [0, 0.03, -0.05],
    [0.035, 0.07, 0.035],
    [-0.035, 0.07, -0.035],
  ];
  for (const [x, y, z] of blooms) {
    const bloom = mesh("Bloom", new THREE.SphereGeometry(0.045, 14, 10), lounge.flowers, x, top + 0.17 + y, z);
    bloom.userData.seated = true;
    vase.add(bloom);
  }
  vase.position.set(0.18, 0, -0.12);
  table.add(vase);

  const glassProfile: [number, number][] = [
    [0, 0],
    [0.03, 0],
    [0.03, 0.004],
    [0.004, 0.01],
    [0.004, 0.09],
    [0.025, 0.12],
    [0.03, 0.17],
    [0, 0.17],
  ];
  table.add(lathe("Champagne Glass", glassProfile, top, lounge.glass, 0.2, 0.22));
  table.add(lathe("Champagne Glass", glassProfile, top, lounge.glass, 0.03, 0.3));
  return table;
}

// Small plant in a gold pot: three leafy balls sunk into each other and into the pot mouth.
function createSmallPlant(materials: Materials): THREE.Group {
  const plant = new THREE.Group();
  const potProfile: [number, number][] = [
    [0, 0],
    [0.22, 0],
    [0.28, 0.45],
    [0.31, 0.5],
    [0.31, 0.53],
    [0, 0.53],
  ];
  plant.add(lathe("Pot", potProfile, 0, materials.goldPolished));
  const leaves: [number, number, number][] = [
    [0, 0.73, 0],
    [0.12, 0.68, 0.05],
    [-0.1, 0.72, -0.06],
  ];
  for (const [x, y, z] of leaves) {
    const ball = mesh("Leaves", new THREE.SphereGeometry(0.26, 20, 14), materials.leaf, x, y, z);
    ball.userData.seated = true;
    plant.add(ball);
  }
  return plant;
}

// Fine gold grid of floor tile joints: a decal on the marble, like the inlay rings.
function createFloorGrid(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(214, 170, 92, 0.55)";
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, 0, 3, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  const radius = LAYOUT.wallRadius + 2;
  // 2 m tiles: the circle UVs run 0..1 across the diameter.
  texture.repeat.set(radius, radius);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0x6a4818,
    emissiveMap: texture,
    emissiveIntensity: 0.6,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  material.name = "floorGrid";
  const grid = named(new THREE.Mesh(new THREE.CircleGeometry(radius, 128), material), "Floor Grid");
  grid.rotation.x = -Math.PI / 2;
  // Drawn after the marble, which is transparent too.
  grid.renderOrder = 1;
  grid.userData.auditIgnore = true;
  return grid;
}

// Uplight can on the lower step at a column joint, with a warm beam up the column front.
function createUplight(materials: Materials, joint: number): THREE.Group {
  const group = named(new THREE.Group(), `Uplight ${joint + 1}`);
  const angle = boundaryAngle(joint);
  const step = LAYOUT.lowerStep.top;
  const can = new THREE.Group();
  can.add(drum("Can", 0.18, 0.2, step, step + 0.3, materials.goldDark, 24));
  can.add(drum("Lens", 0.15, 0.15, step + 0.3, step + 0.32, materials.fixture, 24));
  can.position.copy(polar(angle, jointRadius(2.1)));
  group.add(named(can, "Can"));
  const from = polar(angle, jointRadius(2.1), step + 0.32);
  const to = polar(angle, jointRadius(0.7), 10.5);
  group.add(named(beam(0xffc070, from, to, 0.9, 0.09), "Uplight Beam"));
  return group;
}

function createDressing(materials: Materials) {
  const group = named(new THREE.Group(), "Set Dressing", true);
  const lounge = createLoungeMaterials();
  const wheel = { x: 0, z: PODIUM_Z };
  const host = { x: 5.0, z: 0.8 };

  group.add(createFloorGrid());

  // Lounge groups: a table, and tub chairs around it, each facing the table.
  const lounges = named(new THREE.Group(), "Lounges", true);
  let chairIndex = 0;
  const addChair = (parent: THREE.Object3D, x: number, z: number, target: { x: number; z: number }) => {
    chairIndex += 1;
    const pillow = chairIndex % 2 === 0 ? materials.navy : lounge.satinGold;
    const chair = named(createTubChair(materials, pillow), `Tub Chair ${chairIndex}`);
    chair.position.set(x, 0, z);
    face(chair, target.x, target.z);
    chair.scale.setScalar(LOUNGE_SCALE);
    parent.add(chair);
  };
  const addTable = (parent: THREE.Object3D, x: number, z: number, withLight: boolean) => {
    const table = named(createLoungeTable(materials, lounge, withLight), "Lounge Table");
    table.position.set(x, 0, z);
    table.scale.setScalar(LOUNGE_SCALE);
    parent.add(table);
  };
  const groups = [
    { name: "Lounge Left", x: -6.0, z: 4.2, chairs: [250, 320] },
    { name: "Lounge Right", x: 5.6, z: 4.6, chairs: [0, 90, 300] },
  ];
  for (const spec of groups) {
    const loungeGroup = named(new THREE.Group(), spec.name);
    addTable(loungeGroup, spec.x, spec.z, true);
    for (const degrees of spec.chairs) {
      const angle = THREE.MathUtils.degToRad(degrees);
      addChair(loungeGroup, spec.x + Math.sin(angle) * CHAIR_DISTANCE, spec.z + Math.cos(angle) * CHAIR_DISTANCE, spec);
    }
    lounges.add(loungeGroup);
  }
  // Rows in the band between the rings: chair, table, chair along the ring, 12.7 m out.
  const rowRadius = 12.7;
  const rows = [
    { name: "Lounge Front Left", angle: -150 },
    { name: "Lounge Front Right", angle: 150 },
    { name: "Lounge Side Left", angle: -80 },
    // Turned further out than its left twin: the game props stand on the right side of the floor.
    { name: "Lounge Side Right", angle: 96 },
  ];
  for (const row of rows) {
    const angle = THREE.MathUtils.degToRad(row.angle);
    const centre = polar(angle, rowRadius);
    // Along the ring: the derivative of polar() by the angle.
    const along = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const rowGroup = named(new THREE.Group(), row.name);
    addTable(rowGroup, centre.x, centre.z, false);
    for (const side of [-1, 1]) {
      addChair(rowGroup, centre.x + along.x * side * CHAIR_DISTANCE, centre.z + along.z * side * CHAIR_DISTANCE, centre);
    }
    lounges.add(rowGroup);
  }
  // A lamp table beside the left lounge.
  const sideTable = createLampTable(materials, SCALE.lampTable);
  named(sideTable.group, "Lamp Table 4");
  sideTable.group.position.set(-3.9, 0, 3.9);
  sideTable.group.scale.setScalar(SCALE.lampTable);
  lounges.add(sideTable.group);
  // Single tub chairs by the wheel: two on the left, one beside the host desk.
  const singles = [
    { x: -8.6, z: -3.6, target: wheel },
    { x: -5.4, z: 0.6, target: host },
    { x: 6.9, z: -4.5, target: host },
  ];
  for (const single of singles) {
    chairIndex += 1;
    const pillow = chairIndex % 2 === 0 ? materials.navy : lounge.satinGold;
    const chair = named(createTubChair(materials, pillow), `Tub Chair ${chairIndex}`);
    chair.position.set(single.x, 0, single.z);
    face(chair, single.target.x, single.target.z);
    chair.scale.setScalar(LOUNGE_SCALE);
    lounges.add(chair);
  }
  group.add(lounges);

  // Small plants beside the palms, on the side of the middle arches. A folder: the two plants stand far apart.
  const plants = named(new THREE.Group(), "Plants", true);
  for (const [index, side] of [-1, 1].entries()) {
    const plant = named(createSmallPlant(materials), `Small Plant ${index + 1}`);
    const point = polar(THREE.MathUtils.degToRad(side * 32), 15.6);
    plant.position.set(point.x, 0, point.z);
    plant.scale.setScalar(LOUNGE_SCALE);
    plants.add(plant);
  }
  group.add(plants);

  // Uplights at the four inner joints beside the middle arches.
  const uplights = named(new THREE.Group(), "Uplights");
  for (const joint of [CENTER_BAY - 1, CENTER_BAY, CENTER_BAY + 1, CENTER_BAY + 2]) {
    uplights.add(createUplight(materials, joint));
  }
  group.add(uplights);

  return group;
}

export { createDressing };
