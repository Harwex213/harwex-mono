import * as THREE from "three";
import { named } from "./geometry";
import type { Materials } from "./materials";
import { bayHalfLength, CENTER_BAY, inFrontOfBay, LAYOUT, onColumnShaft, SCONCE_HEIGHT } from "./studio";

// Every prop is stacked from the floor up: each part starts exactly where the part under it ends.
// Parts that sit on a curved surface (a globe on a neck, fronds in a trunk) are marked `seated`.

function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const result = named(new THREE.Mesh(geometry, material), name);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

// Upright cylinder between two heights.
function drum(name: string, radiusTop: number, radiusBottom: number, bottom: number, top: number, material: THREE.Material, segments = 64): THREE.Mesh {
  return mesh(name, new THREE.CylinderGeometry(radiusTop, radiusBottom, top - bottom, segments), material, 0, (bottom + top) / 2, 0);
}

// Box between two heights, with its back face at `back` along z.
function slab(name: string, width: number, bottom: number, top: number, back: number, front: number, material: THREE.Material, x = 0): THREE.Mesh {
  return mesh(name, new THREE.BoxGeometry(width, top - bottom, front - back), material, x, (bottom + top) / 2, (back + front) / 2);
}

// Vertical strips standing on the side of a drum of `radius`, from `bottom` to `top`.
// The strip back is a hair outside the drum, so no drum edge pokes through it.
function flutes(name: string, count: number, radius: number, bottom: number, top: number, material: THREE.Material): THREE.Group {
  const group = named(new THREE.Group(), name);
  const geometry = new THREE.BoxGeometry(0.035, top - bottom, 0.03);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = radius + 0.0005 + 0.015;
    const flute = new THREE.Mesh(geometry, material);
    flute.position.set(Math.sin(a) * r, (bottom + top) / 2, Math.cos(a) * r);
    flute.rotation.y = a;
    flute.castShadow = true;
    group.add(flute);
  }
  return group;
}

// Velvet drape hanging from the ceiling to the floor, with sine folds.
function createCurtain(materials: Materials, width: number, height: number): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(width, height, 80, 20);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    // Folds get deeper towards the floor where the drape is gathered.
    const gather = 0.6 + 0.4 * (1 - (y + height / 2) / height);
    position.setZ(i, Math.sin(x * 7.5) * 0.12 * gather + Math.sin(x * 2.3) * 0.08);
  }
  geometry.computeVertexNormals();
  const drape = named(new THREE.Mesh(geometry, materials.velvet), "Drape");
  drape.position.y = height / 2;
  drape.castShadow = true;
  group.add(drape);
  return group;
}

// Host desk: gold foot ring, fluted navy drum, gold rim, marble top and two monitors resting on it.
function createHostDesk(materials: Materials): THREE.Group {
  const desk = new THREE.Group();
  const radius = 1.0;
  const footTop = 0.16;
  const drumTop = 1.53;
  const rimTop = 1.67;
  const deskTop = 1.73;
  desk.add(drum("Foot", radius + 0.12, radius + 0.15, 0, footTop, materials.goldPolished));
  desk.add(drum("Drum", radius, radius, footTop, drumTop, materials.navy));
  desk.add(flutes("Flutes", 28, radius, footTop + 0.08, drumTop - 0.08, materials.gold));
  desk.add(drum("Rim", radius + 0.14, radius + 0.1, drumTop, rimTop, materials.goldPolished));
  desk.add(drum("Top", radius + 0.1, radius + 0.1, rimTop, deskTop, materials.marble));
  // Each monitor leans back and rests on its lower edge. Screens face the host, who stands behind the desk.
  const tilt = 0.35;
  const halfHeight = 0.19;
  const halfDepth = 0.02;
  for (const side of [-1, 1]) {
    const monitor = named(new THREE.Group(), side < 0 ? "Monitor Left" : "Monitor Right");
    monitor.add(mesh("Case", new THREE.BoxGeometry(0.62, halfHeight * 2, halfDepth * 2), materials.navy, 0, 0, 0));
    // The screen is on the host side of the case (local +z, turned away from the camera by the yaw below).
    // It floats 2.5 mm off the case: close enough to read as one part, far enough not to z-fight.
    monitor.add(mesh("Screen", new THREE.PlaneGeometry(0.56, 0.32), materials.screen, 0, 0, halfDepth + 0.0025));
    monitor.rotation.set(-tilt, side * 0.15, 0);
    monitor.rotation.y += Math.PI;
    // The yaw lowers one corner a little, so the exact lowest point comes from the bounds.
    monitor.updateMatrixWorld(true);
    const lowest = new THREE.Box3().setFromObject(monitor, true).min.y;
    monitor.position.set(side * 0.38, deskTop - lowest, 0.1);
    desk.add(monitor);
  }
  return desk;
}

// Lamp table: fluted navy drum, gold top, a neck and a frosted globe.
function createLampTable(materials: Materials): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  const bodyTop = 0.8;
  const tableTop = 0.86;
  const neckTop = 0.98;
  group.add(drum("Body", 0.44, 0.44, 0, bodyTop, materials.navy, 40));
  group.add(flutes("Flutes", 16, 0.44, 0.06, bodyTop - 0.06, materials.gold));
  group.add(drum("Table Top", 0.5, 0.5, bodyTop, tableTop, materials.goldPolished, 40));
  group.add(drum("Neck", 0.08, 0.12, tableTop, neckTop, materials.gold, 20));
  // The globe sits 3 cm deep on the neck, like on a lamp holder.
  const globe = mesh("Globe", new THREE.SphereGeometry(0.24, 32, 20), materials.lampGlobe, 0, neckTop + 0.24 - 0.03, 0);
  globe.castShadow = false;
  globe.userData.seated = true;
  group.add(globe);
  const light = named(new THREE.PointLight(0xffd7a0, 2.5, 4, 2), "Lamp Light");
  light.position.set(0, globe.position.y, 0);
  group.add(light);
  return { group, light };
}

// Armchair: gold base, a back across the full width, two arms in front of it and a seat between the arms.
function createArmchair(materials: Materials): THREE.Group {
  const chair = new THREE.Group();
  const baseTop = 0.1;
  const width = 1.3;
  const armWidth = 0.24;
  const backFront = -0.5;
  chair.add(slab("Base", width, 0, baseTop, -0.78, 0.5, materials.goldDark));
  chair.add(slab("Back", width, baseTop, 1.3, -0.78, backFront, materials.velvet));
  for (const side of [-1, 1]) {
    chair.add(slab(side < 0 ? "Arm Left" : "Arm Right", armWidth, baseTop, 0.65, backFront, 0.5, materials.velvet, side * (width / 2 - armWidth / 2)));
  }
  chair.add(slab("Seat", width - armWidth * 2, baseTop, 0.45, backFront, 0.5, materials.velvet));
  return chair;
}

// Potted palm: a gold pot, a trunk standing on the pot, drooping fronds growing out of the trunk top.
function createPalm(materials: Materials): THREE.Group {
  const palm = new THREE.Group();
  const potTop = 0.8;
  const trunkTop = 2.3;
  palm.add(drum("Pot", 0.42, 0.32, 0, potTop, materials.goldPolished, 32));
  palm.add(drum("Trunk", 0.07, 0.1, potTop, trunkTop, materials.trunk, 10));
  const length = 1.9;
  const frondGeometry = new THREE.PlaneGeometry(0.42, length, 1, 10);
  const position = frondGeometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + length / 2;
    const x = position.getX(i);
    // Narrow at the root so it fits inside the trunk top, wide in the middle, pinched to a tip.
    const width = (1 - (y / length) * 0.8) * Math.min(1, 0.3 + y / 0.4);
    position.setX(i, x * width);
    // Bend the frond downwards along its length.
    position.setZ(i, -Math.pow(y / length, 2) * 0.9);
    position.setY(i, y);
  }
  frondGeometry.computeVertexNormals();
  const fronds = named(new THREE.Group(), "Fronds");
  for (let i = 0; i < 11; i++) {
    const frond = new THREE.Mesh(frondGeometry, materials.leaf);
    frond.position.y = trunkTop - 0.02;
    frond.rotation.order = "YXZ";
    frond.rotation.y = (i / 11) * Math.PI * 2;
    frond.rotation.x = -0.9 + (i % 3) * 0.25;
    frond.castShadow = true;
    frond.userData.seated = true;
    fronds.add(frond);
  }
  palm.add(fronds);
  return palm;
}

// Wall sconce on a column shaft: a back plate, an arm, a cup at the end of the arm and a globe in the cup.
// In the sconce frame the shaft front is z = 0.
function createSconce(materials: Materials): THREE.Group {
  const sconce = new THREE.Group();
  const plateDepth = 0.05;
  const armEnd = 0.36;
  sconce.add(slab("Plate", 0.16, -0.2, 0.2, 0, plateDepth, materials.goldPolished));
  sconce.add(slab("Arm", 0.05, -0.025, 0.025, plateDepth, armEnd, materials.gold));
  sconce.add(slab("Cup", 0.14, -0.025, 0.035, armEnd, armEnd + 0.14, materials.gold));
  const globe = mesh("Globe", new THREE.SphereGeometry(0.15, 24, 16), materials.lampGlobe, 0, 0.035 + 0.15 - 0.02, armEnd + 0.07);
  globe.castShadow = false;
  globe.userData.seated = true;
  sconce.add(globe);
  return sconce;
}

function createProps(materials: Materials) {
  const group = named(new THREE.Group(), "Props", true);

  // Drapes hang from the ceiling to the floor in front of the steps and close the shot on both sides:
  // the first panel covers the outer half of the outer arch, the next panels cover the plain bays beyond it.
  // Each panel is flat inside one bay. Neighbouring panels stand at different depths (3.0 m and 3.6 m from
  // the wall), so the deeper one can run 0.3 m past the joint and overlap its neighbour without touching it.
  const near = 3.0;
  const far = 3.6;
  const overhang = 0.3;
  // The first panel starts 1.2 m inside the middle of the outer arch, so the wide shot still shows
  // the inner third of that arch, and runs to the joint.
  const outerArchFrom = -1.2;
  const outerArchTo = bayHalfLength(near + 0.2);
  const panels = [
    { bay: 2, offset: near, width: outerArchTo - outerArchFrom, along: (outerArchFrom + outerArchTo) / 2 },
    { bay: 3, offset: far, width: 2 * bayHalfLength(far) + 2 * overhang, along: 0 },
    { bay: 4, offset: near, width: 2 * bayHalfLength(near + 0.2), along: 0 },
  ];
  for (const side of [-1, 1]) {
    const drapes = named(new THREE.Group(), side < 0 ? "Curtains Left" : "Curtains Right");
    for (const [index, panel] of panels.entries()) {
      const curtain = named(createCurtain(materials, panel.width, LAYOUT.ceilingY), `Curtain ${index + 1}`);
      inFrontOfBay(curtain, CENTER_BAY + side * panel.bay, side * panel.along, panel.offset);
      drapes.add(curtain);
    }
    group.add(drapes);
  }

  const desk = named(createHostDesk(materials), "Host Desk");
  desk.position.set(3.7, 0, 1.0);
  desk.rotation.y = -0.4;
  group.add(desk);

  const tables = [
    new THREE.Vector3(-5.3, 0, 2.0),
    new THREE.Vector3(5.4, 0, 2.2),
    new THREE.Vector3(-8.5, 0, -4.0),
  ];
  for (const [index, position] of tables.entries()) {
    const table = createLampTable(materials);
    named(table.group, `Lamp Table ${index + 1}`);
    table.group.position.copy(position);
    group.add(table.group);
  }

  const chairs = [
    { position: new THREE.Vector3(-7.0, 0, -2.0), rotation: 1.0 },
    { position: new THREE.Vector3(7.2, 0, -1.5), rotation: -1.0 },
  ];
  for (const [index, chair] of chairs.entries()) {
    const armchair = named(createArmchair(materials), `Armchair ${index + 1}`);
    armchair.position.copy(chair.position);
    armchair.rotation.y = chair.rotation;
    group.add(armchair);
  }

  // The palms stand in front of the drapes, far enough that the fronds stay clear of them.
  for (const [index, position] of [new THREE.Vector3(-9.3, 0, -8.8), new THREE.Vector3(9.4, 0, -9.0)].entries()) {
    const palm = named(createPalm(materials), `Palm ${index + 1}`);
    palm.position.copy(position);
    palm.scale.setScalar(1.5);
    group.add(palm);
  }

  // Sconces on the shafts of the columns between the arches, in the gap between the flutes.
  for (const index of [CENTER_BAY - 1, CENTER_BAY, CENTER_BAY + 1, CENTER_BAY + 2]) {
    const sconce = named(createSconce(materials), `Sconce ${index + 1}`);
    sconce.scale.setScalar(1.4);
    onColumnShaft(sconce, index, SCONCE_HEIGHT);
    group.add(sconce);
  }

  return group;
}

export { createProps };
