import * as THREE from "three";
import { named } from "./geometry";
import type { Materials } from "./materials";
import { bayHalfLength, CENTER_BAY, inFrontOfBay, LAYOUT, onColumnShaft, SCONCE_HEIGHT } from "./studio";

// Every prop is stacked from the floor up: each part starts exactly where the part under it ends.
// Parts that sit on a curved surface (a globe on a neck, fronds in a trunk) are marked `seated`.
//
// The props are modelled at human size and then scaled up as a whole, so they read next to the wheel
// (7.8 m to the top of the ring) and the 12 m arches: this is a stylised set seen from a wide camera.
// A uniform scale keeps every contact exact.
const SCALE = {
  desk: 1.6,
  lampTable: 1.8,
  armchair: 1.7,
  palm: 2.0,
  sconce: 2.4,
};

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

// Art Deco fan emblem: a half disc with rays cut out, standing on the front flute of the desk drum.
// Its back touches the flute at the middle; the drum curves away behind its edges.
function createFanEmblem(materials: Materials, back: number, centerY: number): THREE.Mesh {
  const radius = 0.32;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.absarc(0, 0, radius, Math.PI, 0, true);
  shape.lineTo(-radius, 0);
  // Rays between the fan blades, from near the hinge to near the rim.
  const rays = 6;
  for (let i = 0; i < rays; i++) {
    const a = Math.PI * ((i + 0.5) / rays);
    const half = 0.07;
    const hole = new THREE.Path();
    hole.moveTo(Math.cos(a) * 0.08, Math.sin(a) * 0.08);
    hole.lineTo(Math.cos(a - half) * (radius - 0.04), Math.sin(a - half) * (radius - 0.04));
    hole.lineTo(Math.cos(a + half) * (radius - 0.04), Math.sin(a + half) * (radius - 0.04));
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 24 });
  return mesh("Fan Emblem", geometry, materials.goldPolished, 0, centerY - radius / 2, back);
}

// Host desk: gold foot ring, fluted navy drum, gold rim, marble top and two monitors resting on it.
function createHostDesk(materials: Materials, scale: number): THREE.Group {
  const desk = new THREE.Group();
  const radius = 1.0;
  const footTop = 0.16;
  const drumTop = 1.53;
  const rimTop = 1.67;
  const deskTop = 1.73;
  desk.add(drum("Foot", radius + 0.12, radius + 0.15, 0, footTop, materials.goldPolished));
  desk.add(drum("Drum", radius, radius, footTop, drumTop, materials.navy, 96));
  desk.add(flutes("Flutes", 28, radius, footTop + 0.08, drumTop - 0.08, materials.gold));
  desk.add(drum("Rim", radius + 0.14, radius + 0.1, drumTop, rimTop, materials.goldPolished));
  desk.add(drum("Top", radius + 0.1, radius + 0.1, rimTop, deskTop, materials.marble));
  desk.add(createFanEmblem(materials, radius + 0.0005 + 0.03, (footTop + drumTop) / 2));
  // Each monitor leans back and rests on its lower edge. Screens face the host, who stands behind the desk.
  const tilt = 0.35;
  const halfHeight = 0.19;
  const halfDepth = 0.02;
  for (const side of [-1, 1]) {
    const monitor = named(new THREE.Group(), side < 0 ? "Monitor Left" : "Monitor Right");
    monitor.add(mesh("Case", new THREE.BoxGeometry(0.62, halfHeight * 2, halfDepth * 2), materials.navy, 0, 0, 0));
    // The screen is on the host side of the case (local +z, turned away from the camera by the yaw below).
    // It floats 2.5 mm (after the desk scale) off the case: close enough to read as one part, far enough not to z-fight.
    monitor.add(mesh("Screen", new THREE.PlaneGeometry(0.56, 0.32), materials.screen, 0, 0, halfDepth + 0.0025 / scale));
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
function createLampTable(materials: Materials, scale: number): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  const bodyTop = 0.8;
  const tableTop = 0.86;
  const neckTop = 0.98;
  // 64 segments keep the flutes within a hair of the drum facets after the table scale.
  group.add(drum("Body", 0.44, 0.44, 0, bodyTop, materials.navy, 64));
  group.add(flutes("Flutes", 16, 0.44, 0.06, bodyTop - 0.06, materials.gold));
  group.add(drum("Table Top", 0.5, 0.5, bodyTop, tableTop, materials.goldPolished, 40));
  group.add(drum("Neck", 0.08, 0.12, tableTop, neckTop, materials.gold, 20));
  // The globe sits 3 cm deep on the neck, like on a lamp holder.
  const globe = mesh("Globe", new THREE.SphereGeometry(0.24, 32, 20), materials.lampGlobe, 0, neckTop + 0.24 - 0.03, 0);
  globe.castShadow = false;
  globe.userData.seated = true;
  group.add(globe);
  // The light range does not follow the group scale, so it is scaled here.
  const light = named(new THREE.PointLight(0xffd7a0, 2.5 * scale, 4 * scale, 2), "Lamp Light");
  light.position.set(0, globe.position.y, 0);
  group.add(light);
  return { group, light };
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

// The palms stand outside the 14.65 m inlay ring, in front of the lower step (its edge is 17.3 m out at a joint).
const PALM_RADIUS = 16.0;
const PALM_ANGLE = 39;

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

  // Floor plan, in metres from the studio centre (the wheel stands at z = -4).
  // The podium covers 4.6 m around the wheel; all furniture stays inside the 10.3 m inlay ring.
  // Right of the wheel: the host desk with a lamp table. Left of the wheel: two lamp tables.
  const desk = named(createHostDesk(materials, SCALE.desk), "Host Desk");
  desk.position.set(5.0, 0, 0.8);
  desk.rotation.y = -0.45;
  desk.scale.setScalar(SCALE.desk);
  group.add(desk);

  const tables = [
    new THREE.Vector3(-7.5, 0, -1.2),
    new THREE.Vector3(8.4, 0, -1.4),
    new THREE.Vector3(-6.6, 0, -5.6),
  ];
  for (const [index, position] of tables.entries()) {
    const table = createLampTable(materials, SCALE.lampTable);
    named(table.group, `Lamp Table ${index + 1}`);
    table.group.position.copy(position);
    table.group.scale.setScalar(SCALE.lampTable);
    group.add(table.group);
  }

  // The armchairs are round tub chairs in the lounge groups of the set dressing (dressing.ts).

  // The palms stand in their tall gold pots in front of the steps, at the joints beside the side arches,
  // like in the scene reference; the fronds stay clear of the drapes.
  for (const [index, side] of [-1, 1].entries()) {
    const palm = named(createPalm(materials), `Palm ${index + 1}`);
    const angle = THREE.MathUtils.degToRad(side * PALM_ANGLE);
    palm.position.set(Math.sin(angle) * PALM_RADIUS, 0, -Math.cos(angle) * PALM_RADIUS);
    palm.scale.setScalar(SCALE.palm);
    group.add(palm);
  }

  // Sconces on the shafts of the columns between the arches, in the gap between the flutes.
  for (const index of [CENTER_BAY - 1, CENTER_BAY, CENTER_BAY + 1, CENTER_BAY + 2]) {
    const sconce = named(createSconce(materials), `Sconce ${index + 1}`);
    sconce.scale.setScalar(SCALE.sconce);
    onColumnShaft(sconce, index, SCONCE_HEIGHT);
    group.add(sconce);
  }

  return group;
}

export { createLampTable, createProps, drum, flutes, mesh, SCALE, slab };
