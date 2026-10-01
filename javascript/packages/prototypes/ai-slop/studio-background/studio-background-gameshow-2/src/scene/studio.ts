import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createCityBackdrop } from "./city";
import type { CityHandle } from "./city";
import { annularSector, arcBand, arcTorus, archFrame, archPath, group, mesh, polar } from "./geometry";
import { createLightRig } from "./lights";
import type { LightRigHandle } from "./lights";
import { createMaterials } from "./materials";
import type { StudioMaterials } from "./materials";
import { createWheel } from "./wheel";
import type { WheelHandle } from "./wheel";

// Studio layout, in metres.
// The numbers come from fitting the scene to the reference frame (assets/scene-reference.png):
// the camera, the wheel, the podium, the floor ring, the arches and the steps were solved together
// so that their key points land on the same pixels as in the reference.
const WALL_RADIUS = 11.8;
// Pilasters stand at these angles (degrees) on both sides; the arches sit between them.
// The wide middle segment is hidden behind the wheel.
// 28° per arch: the centre arch stands behind the wheel, one arch on each side of it,
// then the next ones are half hidden by the curtains.
const PILASTER_DEGREES = [14, 42, 70, 98, 126];
// The arches are taller and wider than in the reference fit, by request, so they dwarf the wheel less.
const WALL_TOP = 10.4;
const ARCH_HALF_WIDTH = 2.0;
const ARCH_SILL = 1.65;
const ARCH_SPRING = 7.6;
// The stage steps run behind the wheel only; the side arches stand on a plain wall.
const STEPS_HALF_ANGLE = THREE.MathUtils.degToRad(42);
const RIG_HEIGHT = 11.15;
const CEILING_HEIGHT = 11.7;
const PODIUM_TIERS = [
  { radius: 3.6, height: 0.12 },
  { radius: 2.9, height: 0.12 },
  { radius: 2.2, height: 0.12 },
];
const PODIUM_Z = -0.6;
const WHEEL_CENTER_Y = 3.16;

interface StudioHandle {
  root: THREE.Group;
  wheel: WheelHandle;
  city: CityHandle;
  lights: LightRigHandle;
  update: (time: number) => void;
}

function pilasterAngles(): number[] {
  const right = PILASTER_DEGREES.map((degrees) => THREE.MathUtils.degToRad(degrees));
  const left = right.map((phi) => -phi).reverse();
  return [...left, ...right];
}

function createArchSegment(index: number, phiFrom: number, phiTo: number, m: StudioMaterials): THREE.Group {
  const phi = (phiFrom + phiTo) / 2;
  const width = 2 * WALL_RADIUS * Math.sin((phiTo - phiFrom) / 2) + 0.06;
  const segment = group(`Arch ${index + 1}`);
  segment.position.copy(polar(WALL_RADIUS, phi, 0));
  segment.rotation.y = -phi;

  // Wall slab with the arch opening cut out. The city is visible through the opening.
  const wallShape = new THREE.Shape();
  wallShape.moveTo(-width / 2, 0);
  wallShape.lineTo(width / 2, 0);
  wallShape.lineTo(width / 2, WALL_TOP);
  wallShape.lineTo(-width / 2, WALL_TOP);
  wallShape.lineTo(-width / 2, 0);
  wallShape.holes.push(archPath(new THREE.Path(), ARCH_HALF_WIDTH, ARCH_SILL, ARCH_SPRING));
  const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
    depth: 0.3,
    bevelEnabled: false,
    curveSegments: 48,
  });
  wallGeometry.translate(0, 0, -0.3);
  // Extrude groups: 0 = front and back faces, 1 = side faces. The sides of the opening are gold,
  // otherwise the unlit navy reveal reads as a black shadow around the city.
  const wall = new THREE.Mesh(wallGeometry, [m.navyWall, m.goldArch]);
  wall.name = "Wall";
  wall.receiveShadow = true;
  segment.add(wall);

  segment.add(mesh("Arch Frame", archFrame(ARCH_HALF_WIDTH, ARCH_HALF_WIDTH + 0.42, ARCH_SILL, ARCH_SPRING, 0.4), m.goldArch));
  const moulding = mesh("Arch Moulding", archFrame(ARCH_HALF_WIDTH + 0.48, ARCH_HALF_WIDTH + 0.58, ARCH_SILL, ARCH_SPRING, 0.16), m.goldArch);
  segment.add(moulding);

  // Imposts at the spring line, a sill ledge under the opening.
  for (const side of [-1, 1]) {
    const impost = mesh("Impost", new THREE.BoxGeometry(0.7, 0.24, 0.48), m.goldArch);
    impost.position.set(side * (ARCH_HALF_WIDTH + 0.24), ARCH_SPRING, 0.14);
    segment.add(impost);
  }
  const sill = mesh("Sill", new THREE.BoxGeometry(ARCH_HALF_WIDTH * 2 + 0.9, 0.14, 0.5), m.goldArch);
  sill.position.set(0, ARCH_SILL - 0.07, 0.1);
  segment.add(sill);
  const keystone = mesh("Keystone", new THREE.BoxGeometry(0.4, 0.55, 0.46), m.goldArch);
  keystone.position.set(0, ARCH_SPRING + ARCH_HALF_WIDTH + 0.24, 0.12);
  segment.add(keystone);

  // Gold panel line below the sill.
  const panel = mesh("Panel Line", new THREE.BoxGeometry(width - 1.2, 0.05, 0.04), m.goldArch);
  panel.position.set(0, ARCH_SILL - 0.45, 0.02);
  segment.add(panel);
  return segment;
}

function createPilaster(index: number, phi: number, m: StudioMaterials): THREE.Group {
  const pilaster = group(`Pilaster ${index + 1}`);
  pilaster.position.copy(polar(WALL_RADIUS - 0.1, phi, 0));
  pilaster.rotation.y = -phi;

  const shaftHeight = WALL_TOP - 0.85;
  const shaft = mesh("Shaft", new THREE.BoxGeometry(0.9, shaftHeight, 0.5), m.navyLacquer);
  shaft.position.set(0, 0.45 + shaftHeight / 2, 0);
  pilaster.add(shaft);

  const flute = new THREE.BoxGeometry(0.05, shaftHeight - 0.1, 0.06);
  for (let i = 0; i < 7; i++) {
    const strip = mesh("Flute", flute, m.goldArch);
    strip.position.set(-0.36 + i * 0.12, 0.45 + shaftHeight / 2, 0.26);
    pilaster.add(strip);
  }

  const base = mesh("Base", new THREE.BoxGeometry(1.12, 0.32, 0.68), m.goldArch);
  base.position.set(0, 0.16, 0);
  pilaster.add(base);
  const baseTop = mesh("Base Torus", new THREE.BoxGeometry(1.0, 0.13, 0.6), m.goldArch);
  baseTop.position.set(0, 0.385, 0);
  pilaster.add(baseTop);
  const capital = mesh("Capital", new THREE.BoxGeometry(1.12, 0.4, 0.68), m.goldArch);
  capital.position.set(0, WALL_TOP - 0.2, 0);
  pilaster.add(capital);
  return pilaster;
}

// Solid wall behind the curtains: no opening, just the navy panel with a gold panel line.
function createPlainSegment(index: number, phiFrom: number, phiTo: number, m: StudioMaterials): THREE.Group {
  const phi = (phiFrom + phiTo) / 2;
  const width = 2 * WALL_RADIUS * Math.sin((phiTo - phiFrom) / 2) + 0.06;
  const segment = group(`Wall ${index + 1}`);
  segment.position.copy(polar(WALL_RADIUS, phi, 0));
  segment.rotation.y = -phi;
  const wall = mesh("Wall", new THREE.BoxGeometry(width, WALL_TOP, 0.3), m.navyWall);
  wall.position.set(0, WALL_TOP / 2, -0.15);
  segment.add(wall);
  for (const y of [ARCH_SILL - 0.45, WALL_TOP - 0.6]) {
    const line = mesh("Panel Line", new THREE.BoxGeometry(width - 1.2, 0.05, 0.04), m.goldArch);
    line.position.set(0, y, 0.02);
    segment.add(line);
  }
  return segment;
}

function createArches(m: StudioMaterials): THREE.Group {
  const arches = group("Arches", false);
  const angles = pilasterAngles();
  const lastArch = THREE.MathUtils.degToRad(CURTAIN_TO_DEGREES);
  for (let i = 0; i < angles.length - 1; i++) {
    const from = angles[i] ?? 0;
    const to = angles[i + 1] ?? 0;
    // Segments that start past the curtains are a plain wall.
    const isPastCurtain = Math.min(Math.abs(from), Math.abs(to)) >= lastArch - 1e-6;
    arches.add(isPastCurtain ? createPlainSegment(i, from, to, m) : createArchSegment(i, from, to, m));
  }
  angles.forEach((phi, index) => {
    arches.add(createPilaster(index, phi, m));
  });

  // Wall sconces on the pilasters on both sides of the first visible arches.
  const sconces = group("Sconces");
  for (const degrees of [-70, -42, 42, 70]) {
    const phi = THREE.MathUtils.degToRad(degrees);
    const sconce = group(`Sconce ${degrees}`, false);
    sconce.position.copy(polar(WALL_RADIUS - 0.45, phi, 6.8));
    sconce.rotation.y = -phi;
    const arm = mesh("Arm", new THREE.CylinderGeometry(0.035, 0.035, 0.45, 8), m.gold);
    arm.rotation.x = Math.PI / 2;
    sconce.add(arm);
    const cup = mesh("Cup", new THREE.CylinderGeometry(0.15, 0.07, 0.15, 16), m.gold);
    cup.position.set(0, 0.06, 0.22);
    sconce.add(cup);
    const globe = mesh("Globe", new THREE.SphereGeometry(0.2, 20, 14), m.lampGlobe);
    globe.castShadow = false;
    globe.position.set(0, 0.3, 0.22);
    sconce.add(globe);
    if (Math.abs(degrees) < 50) {
      const light = new THREE.PointLight(0xffc483, 5, 6, 2);
      light.name = "Sconce Light";
      light.position.set(0, 0.3, 0.5);
      sconce.add(light);
    }
    sconces.add(sconce);
  }
  arches.add(sconces);
  return arches;
}

function createUpperRing(m: StudioMaterials): THREE.Group {
  const ring = group("Upper Ring");
  const last = THREE.MathUtils.degToRad(PILASTER_DEGREES[PILASTER_DEGREES.length - 1] ?? 110);
  const from = -last - 0.05;
  const to = last + 0.05;

  const cornice = mesh("Cornice", arcBand(WALL_RADIUS - 0.4, from, to, WALL_TOP, 0.4), m.gold);
  ring.add(cornice);
  const corniceLip = mesh("Cornice Lip", arcTorus(WALL_RADIUS - 0.42, 0.08, from, to), m.gold);
  corniceLip.position.y = WALL_TOP;
  ring.add(corniceLip);

  const rigBottom = WALL_TOP + 0.4;
  const rigBand = mesh("Lighting Rig Band", arcBand(WALL_RADIUS - 0.3, from, to, rigBottom, CEILING_HEIGHT - 0.25 - rigBottom), m.navyWall);
  ring.add(rigBand);
  const upperLip = mesh("Upper Cornice", arcBand(WALL_RADIUS - 0.5, from, to, CEILING_HEIGHT - 0.25, 0.25), m.gold);
  ring.add(upperLip);
  const upperTorus = mesh("Upper Lip", arcTorus(WALL_RADIUS - 0.52, 0.07, from, to), m.gold);
  upperTorus.position.y = CEILING_HEIGHT - 0.25;
  ring.add(upperTorus);

  // Fixtures along the rig band: dark cans with bright lenses, every fourth one is blue.
  const count = 34;
  const cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.13, 0.32, 14), m.fixture, count);
  cans.name = "Rig Fixtures";
  const lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 16), m.spotLens, count);
  lenses.name = "Rig Lenses";
  const blueLenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 16), m.blueLens, count);
  blueLenses.name = "Rig Blue Lenses";
  const matrix = new THREE.Matrix4();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const tilt = 0.6;
  for (let i = 0; i < count; i++) {
    const phi = from + 0.1 + (i / (count - 1)) * (to - from - 0.2);
    const position = polar(WALL_RADIUS - 0.6, phi, RIG_HEIGHT);
    // Local +Z of this frame points to the studio centre, tilted down.
    quaternion.setFromEuler(new THREE.Euler(tilt, -phi, 0, "YXZ"));
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

    // The can is a cylinder along Y, so turn Y onto the facing direction first.
    const canQuaternion = quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    matrix.compose(position, canQuaternion, scale);
    cans.setMatrixAt(i, matrix);

    const lensPosition = position.clone().addScaledVector(facing, 0.165);
    matrix.compose(lensPosition, quaternion, scale);
    const isBlue = i % 4 === 1;
    lenses.setMatrixAt(i, isBlue ? hiddenMatrix : matrix);
    blueLenses.setMatrixAt(i, isBlue ? matrix : hiddenMatrix);
  }
  ring.add(cans, lenses, blueLenses);

  // Ceiling with a ring of downlights.
  const ceiling = mesh("Ceiling", new THREE.CircleGeometry(WALL_RADIUS + 0.4, 96), m.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CEILING_HEIGHT;
  ring.add(ceiling);
  const downlightCount = 22;
  const downlights = new THREE.InstancedMesh(new THREE.CircleGeometry(0.13, 16), m.spotLens, downlightCount);
  downlights.name = "Downlights";
  for (let i = 0; i < downlightCount; i++) {
    const phi = -1.3 + (i / (downlightCount - 1)) * 2.6;
    const position = polar(WALL_RADIUS - 2.0, phi, CEILING_HEIGHT - 0.02);
    quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    matrix.compose(position, quaternion, scale);
    downlights.setMatrixAt(i, matrix);
  }
  ring.add(downlights);
  return ring;
}

// Three steps rise from the floor to the arch sills behind the wheel.
function createStageSteps(m: StudioMaterials): THREE.Group {
  const steps = group("Stage Steps");
  const from = -STEPS_HALF_ANGLE;
  const to = STEPS_HALF_ANGLE;
  const stepCount = 3;
  for (let i = 0; i < stepCount; i++) {
    const inner = WALL_RADIUS - 0.95 + i * 0.3;
    const height = (ARCH_SILL * (i + 1)) / stepCount;
    const step = mesh(`Step ${i + 1}`, annularSector(inner, WALL_RADIUS + 0.3, from, to, height), m.blackMarble);
    steps.add(step);
    const glow = mesh(`Step ${i + 1} Glow`, arcTorus(inner, 0.02, from, to), m.goldGlow);
    glow.castShadow = false;
    glow.position.y = height - 0.02;
    steps.add(glow);
    const trim = mesh(`Step ${i + 1} Trim`, arcTorus(inner, 0.03, from, to), m.gold);
    trim.position.y = height - (ARCH_SILL / stepCount) * 0.5;
    steps.add(trim);
  }
  return steps;
}

function createFloor(m: StudioMaterials): THREE.Group {
  const floor = group("Floor");

  // A mirror under a dark, half transparent glossy floor gives the polished marble look.
  const mirror = new Reflector(new THREE.CircleGeometry(WALL_RADIUS + 2, 96), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x5a6070,
    clipBias: 0.003,
    multisample: 0,
  });
  mirror.name = "Floor Mirror";
  mirror.rotation.x = -Math.PI / 2;
  floor.add(mirror);

  const gloss = mesh("Floor Marble", new THREE.CircleGeometry(WALL_RADIUS + 2, 96), m.floorGloss);
  gloss.castShadow = false;
  gloss.rotation.x = -Math.PI / 2;
  gloss.position.y = 0.003;
  floor.add(gloss);

  // Gold inlay rings around the podium.
  const inlays = group("Floor Inlays", false);
  const ringRadii = [4.3, 5.0, 6.18, 7.4, 8.6, 9.8];
  for (const radius of ringRadii) {
    const inlay = mesh("Inlay", new THREE.RingGeometry(radius - 0.025, radius + 0.025, 160), m.goldGlow);
    inlay.castShadow = false;
    inlay.receiveShadow = false;
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(0, 0.006, PODIUM_Z);
    inlays.add(inlay);
  }
  floor.add(inlays);
  return floor;
}

function createPodium(m: StudioMaterials): { podium: THREE.Group; top: number } {
  const podium = group("Podium");
  podium.position.set(0, 0, PODIUM_Z);
  let y = 0;
  PODIUM_TIERS.forEach((tier, index) => {
    const body = mesh(`Tier ${index + 1}`, new THREE.CylinderGeometry(tier.radius, tier.radius, tier.height, 96), m.blackMarble);
    body.position.y = y + tier.height / 2;
    podium.add(body);
    const glow = mesh(`Tier ${index + 1} Glow`, new THREE.CylinderGeometry(tier.radius + 0.006, tier.radius + 0.006, 0.035, 96, 1, true), m.goldGlow);
    glow.castShadow = false;
    glow.position.y = y + tier.height * 0.45;
    podium.add(glow);
    const edge = mesh(`Tier ${index + 1} Edge`, new THREE.TorusGeometry(tier.radius - 0.02, 0.035, 8, 128), m.gold);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = y + tier.height;
    podium.add(edge);
    y += tier.height;
  });
  return { podium, top: y };
}

// Straight floor-to-cornice drapes with even vertical pleats, hung from a gold rod in front of the wall.
// Each one covers the outer half of the 4th / 5th arch and the pilaster after it,
// so the frame shows the centre arch, its two neighbours and half of the next two.
// The wall past the curtains is solid, so no camera move can reveal more openings.
const CURTAIN_FROM_DEGREES = 58;
const CURTAIN_TO_DEGREES = 70;

function createCurtain(side: number, m: StudioMaterials): THREE.Group {
  const curtain = group(side < 0 ? "Curtain L" : "Curtain R");
  const from = THREE.MathUtils.degToRad(CURTAIN_FROM_DEGREES);
  const to = THREE.MathUtils.degToRad(CURTAIN_TO_DEGREES + 3);
  const top = WALL_TOP - 0.25;
  const radius = WALL_RADIUS - 0.75;
  const pleats = 16;
  const geometry = new THREE.PlaneGeometry(1, 1, pleats * 12, 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const s = position.getX(i) + 0.5;
    const v = position.getY(i) + 0.5;
    // Rounded pleats: the cloth swings 16 times between the rod line and 18 cm in front of it.
    const pleat = Math.abs(Math.sin(s * pleats * Math.PI));
    const fold = 0.18 * Math.sqrt(pleat);
    const point = polar(radius - fold, side * THREE.MathUtils.lerp(from, to, s), v * top);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  curtain.add(mesh("Drape", geometry, m.velvet));

  const rod = mesh("Curtain Rod", arcTorus(radius - 0.1, 0.06, Math.min(side * from, side * to), Math.max(side * from, side * to)), m.gold);
  rod.position.y = top + 0.05;
  curtain.add(rod);
  for (const phi of [from, to]) {
    const finial = mesh("Finial", new THREE.SphereGeometry(0.12, 16, 12), m.gold);
    finial.position.copy(polar(radius - 0.1, side * phi, top + 0.05));
    curtain.add(finial);
  }
  return curtain;
}

function createSideTable(name: string, x: number, z: number, m: StudioMaterials, withLight: boolean): THREE.Group {
  const table = group(name);
  table.position.set(x, 0, z);
  const body = mesh("Body", new THREE.CylinderGeometry(0.48, 0.48, 0.78, 40), m.navyLacquer);
  body.position.y = 0.39;
  table.add(body);
  for (const y of [0.05, 0.78]) {
    const band = mesh("Gold Band", new THREE.TorusGeometry(0.48, 0.035, 8, 48), m.gold);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    table.add(band);
  }
  const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.66, 0.03), m.gold, 18);
  stripes.name = "Stripes";
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    matrix.makeRotationY(-angle).setPosition(Math.cos(angle) * 0.49, 0.4, Math.sin(angle) * 0.49);
    stripes.setMatrixAt(i, matrix);
  }
  table.add(stripes);
  const top = mesh("Top", new THREE.CylinderGeometry(0.55, 0.55, 0.06, 40), m.gold);
  top.position.y = 0.81;
  table.add(top);
  const globe = mesh("Lamp Globe", new THREE.SphereGeometry(0.24, 24, 16), m.lampGlobe);
  globe.castShadow = false;
  globe.position.y = 1.08;
  table.add(globe);
  if (withLight) {
    const light = new THREE.PointLight(0xffc98a, 6, 6, 2);
    light.name = "Lamp Light";
    light.position.y = 1.1;
    table.add(light);
  }
  return table;
}

function createSofa(name: string, x: number, z: number, rotation: number, m: StudioMaterials): THREE.Group {
  const sofa = group(name);
  sofa.position.set(x, 0, z);
  sofa.rotation.y = rotation;
  const seat = mesh("Seat", new THREE.BoxGeometry(2.2, 0.45, 0.95), m.velvet);
  seat.position.y = 0.3;
  sofa.add(seat);
  const back = mesh("Back", new THREE.BoxGeometry(2.2, 0.75, 0.3), m.velvet);
  back.position.set(0, 0.8, -0.38);
  sofa.add(back);
  for (const side of [-1, 1]) {
    const arm = mesh("Arm", new THREE.CylinderGeometry(0.2, 0.2, 0.95, 20), m.velvet);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 1.08, 0.62, 0);
    sofa.add(arm);
  }
  const plinth = mesh("Plinth", new THREE.BoxGeometry(2.3, 0.08, 1.0), m.gold);
  plinth.position.y = 0.04;
  sofa.add(plinth);
  return sofa;
}

function createPalm(name: string, x: number, z: number, m: StudioMaterials): THREE.Group {
  const palm = group(name);
  palm.position.set(x, 0, z);
  const pot = mesh("Pot", new THREE.CylinderGeometry(0.42, 0.32, 0.7, 32), m.gold);
  pot.position.y = 0.35;
  palm.add(pot);

  const frond = new THREE.PlaneGeometry(0.42, 1.7, 1, 10);
  frond.translate(0, 0.85, 0);
  const frondPos = frond.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < frondPos.count; i++) {
    const t = frondPos.getY(i) / 1.7;
    const width = Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.05;
    frondPos.setX(i, frondPos.getX(i) * width);
    frondPos.setZ(i, t * t * 0.9);
  }
  frond.computeVertexNormals();

  const trunks = [
    { h: 1.7, lean: 0.12, turn: 0.4 },
    { h: 1.3, lean: -0.2, turn: 2.1 },
    { h: 2.1, lean: 0.05, turn: 4.0 },
  ];
  trunks.forEach((trunk, index) => {
    const stem = group(`Stem ${index + 1}`, false);
    stem.position.y = 0.6;
    stem.rotation.set(trunk.lean, trunk.turn, trunk.lean * 0.5);
    const bark = mesh("Trunk", new THREE.CylinderGeometry(0.05, 0.08, trunk.h, 10), m.trunk);
    bark.position.y = trunk.h / 2;
    stem.add(bark);
    for (let i = 0; i < 9; i++) {
      const leaf = mesh("Frond", frond, m.leaf);
      leaf.position.y = trunk.h;
      leaf.rotation.set(0, (i / 9) * Math.PI * 2, 0);
      leaf.rotateX(0.75 + (i % 3) * 0.15);
      stem.add(leaf);
    }
    palm.add(stem);
  });
  return palm;
}

function createHostDesk(m: StudioMaterials): THREE.Group {
  const desk = group("Host Desk");
  desk.position.set(3.2, 0, 3.0);
  desk.rotation.y = -0.35;
  const body = mesh("Body", new THREE.CylinderGeometry(0.85, 0.85, 1.25, 48), m.navyLacquer);
  body.position.y = 0.72;
  desk.add(body);
  const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 1.1, 0.035), m.gold, 30);
  stripes.name = "Stripes";
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2;
    matrix.makeRotationY(-angle).setPosition(Math.cos(angle) * 0.86, 0.72, Math.sin(angle) * 0.86);
    stripes.setMatrixAt(i, matrix);
  }
  desk.add(stripes);
  const base = mesh("Base", new THREE.CylinderGeometry(0.98, 1.02, 0.1, 48), m.gold);
  base.position.y = 0.05;
  desk.add(base);
  const top = mesh("Top", new THREE.CylinderGeometry(0.98, 0.9, 0.1, 48), m.gold);
  top.position.y = 1.39;
  desk.add(top);
  const topGlow = mesh("Top Glow", new THREE.CylinderGeometry(0.985, 0.985, 0.025, 48, 1, true), m.goldGlow);
  topGlow.castShadow = false;
  topGlow.position.y = 1.39;
  desk.add(topGlow);
  for (const side of [-1, 1]) {
    const laptop = group("Laptop", false);
    laptop.position.set(side * 0.38, 1.44, 0.1);
    laptop.rotation.y = side * 0.25;
    const deck = mesh("Deck", new THREE.BoxGeometry(0.5, 0.025, 0.34), m.black);
    laptop.add(deck);
    const lid = mesh("Lid", new THREE.BoxGeometry(0.5, 0.34, 0.02), m.black);
    lid.position.set(0, 0.16, -0.17);
    lid.rotation.x = -0.25;
    laptop.add(lid);
    const screen = mesh("Screen", new THREE.PlaneGeometry(0.44, 0.28), m.screen);
    screen.castShadow = false;
    screen.position.set(0, 0.16, -0.155);
    screen.rotation.x = -0.25;
    screen.rotation.y = Math.PI;
    laptop.add(screen);
    desk.add(laptop);
  }
  return desk;
}

// Prop positions are solved from the reference frame (see the note at WALL_RADIUS).
function createProps(m: StudioMaterials): THREE.Group {
  const props = group("Props", false);
  const facing = (x: number, z: number): number => Math.atan2(-x, -z);
  const place = (object: THREE.Object3D, x: number, z: number, scale: number): THREE.Object3D => {
    object.position.set(x, 0, z);
    object.rotation.y = facing(x, z);
    object.scale.setScalar(scale);
    return object;
  };
  props.add(place(createSofa("Sofa L", 0, 0, 0, m), -8.9, -6.47, 1.4));
  props.add(place(createSofa("Sofa R", 0, 0, 0, m), 9.33, -5.83, 1.4));
  props.add(place(createSideTable("Side Table L1", 0, 0, m, true), -8.1, -5.55, 1.32));
  props.add(place(createSideTable("Side Table L2", 0, 0, m, false), -7.0, -8.6, 1.3));
  props.add(place(createSideTable("Side Table R1", 0, 0, m, true), 8.97, -6.94, 1.31));
  props.add(place(createPalm("Palm L", 0, 0, m), -7.5, -8.04, 1.7));
  props.add(place(createPalm("Palm R", 0, 0, m), 7.5, -8.04, 1.7));
  const desk = createHostDesk(m);
  // Further back than in the reference fit: the wider camera stands closer to the stage.
  desk.position.set(5.2, 0, -0.85);
  desk.rotation.y = -0.2;
  desk.scale.set(1.2, 1.35, 1.2);
  props.add(desk);
  return props;
}

function createStudio(renderer: THREE.WebGLRenderer): StudioHandle {
  const m = createMaterials();
  const root = group("Studio", false);

  const environment = group("Environment", false);
  environment.add(createFloor(m));
  environment.add(createStageSteps(m));
  environment.add(createArches(m));
  environment.add(createUpperRing(m));
  environment.add(createCurtain(-1, m));
  environment.add(createCurtain(1, m));
  root.add(environment);

  // The city sits well behind the arches; the openings frame it.
  const city = createCityBackdrop(renderer, {
    radius: WALL_RADIUS + 4,
    phiFrom: -2.1,
    phiTo: 2.1,
    bottom: -2,
    height: 18,
  });
  root.add(city.mesh);

  const { podium, top } = createPodium(m);
  root.add(podium);
  // The wheel stands a little into the top tier, as in the reference.
  const wheel = createWheel(m, WHEEL_CENTER_Y, top, PODIUM_Z);
  root.add(wheel.root);

  root.add(createProps(m));

  const lights = createLightRig({
    wallRadius: WALL_RADIUS,
    rigHeight: RIG_HEIGHT,
    ceilingHeight: CEILING_HEIGHT,
    wheelCenter: wheel.center,
  });
  root.add(lights.root);

  function update(time: number): void {
    wheel.update(time);
    city.update(time);
    lights.update(time);
  }

  return { root, wheel, city, lights, update };
}

export { createStudio };
export type { StudioHandle };
