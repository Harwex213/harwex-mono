import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { annularSector, archFrameShape, archPath, cylinderArc, faceCenter, floorArc, polar } from "./geometry";
import type { Materials } from "./materials";
import { PODIUM_Z } from "./wheel";

const deg = THREE.MathUtils.degToRad;

// Proportions read off the scene reference: the arches stand about twice as far as the wheel,
// yet their openings are taller than the wheel, so the set dwarfs the hero object.
const LAYOUT = {
  wallRadius: 20,
  arcFrom: deg(-100),
  arcTo: deg(100),
  segments: 12,
  wallHeight: 13.5,
  archHalfWidth: 1.6,
  archSill: 1.3,
  archSpring: 9.2,
  ceilingY: 15.9,
};

function segmentAngle(index: number): number {
  const step = (LAYOUT.arcTo - LAYOUT.arcFrom) / LAYOUT.segments;
  return LAYOUT.arcFrom + step * (index + 0.5);
}

function boundaryAngle(index: number): number {
  const step = (LAYOUT.arcTo - LAYOUT.arcFrom) / LAYOUT.segments;
  return LAYOUT.arcFrom + step * index;
}

function box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// One wall panel with an arch opening, its gold frame and the jamb pilasters.
function createArchBay(materials: Materials): THREE.Group {
  const { wallRadius, segments, wallHeight, archHalfWidth, archSill, archSpring } = LAYOUT;
  const step = (LAYOUT.arcTo - LAYOUT.arcFrom) / segments;
  const width = 2 * wallRadius * Math.sin(step / 2) + 0.06;
  const bay = new THREE.Group();

  const wallShape = new THREE.Shape();
  wallShape.moveTo(-width / 2, 0);
  wallShape.lineTo(width / 2, 0);
  wallShape.lineTo(width / 2, wallHeight);
  wallShape.lineTo(-width / 2, wallHeight);
  wallShape.closePath();
  const hole = new THREE.Path();
  archPath(hole, archHalfWidth, archSill, archSpring);
  wallShape.holes.push(hole);
  const wallGeometry = new THREE.ExtrudeGeometry(wallShape, { depth: 0.4, bevelEnabled: false, curveSegments: 32 });
  wallGeometry.translate(0, 0, -0.4);
  const wall = new THREE.Mesh(wallGeometry, materials.wall);
  wall.receiveShadow = true;
  bay.add(wall);

  // Recessed panel trim above the arch, like the framed panels in the studio reference.
  const trimTop = archSpring + archHalfWidth + 0.9;
  bay.add(box(width - 0.9, 0.04, 0.04, materials.goldDark, 0, trimTop, 0.02));
  bay.add(box(width - 0.9, 0.04, 0.04, materials.goldDark, 0, wallHeight - 0.35, 0.02));

  const frameGeometry = new THREE.ExtrudeGeometry(archFrameShape(archHalfWidth, archHalfWidth + 0.34, archSill, archSpring), {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 40,
  });
  const frame = new THREE.Mesh(frameGeometry, materials.goldPolished);
  frame.castShadow = true;
  bay.add(frame);

  // Second, thinner molding a step outside the first one.
  const outerFrameGeometry = new THREE.ExtrudeGeometry(archFrameShape(archHalfWidth + 0.46, archHalfWidth + 0.56, archSill, archSpring), {
    depth: 0.1,
    bevelEnabled: false,
    curveSegments: 40,
  });
  bay.add(new THREE.Mesh(outerFrameGeometry, materials.gold));

  // Jamb pilasters with capitals at the spring line.
  for (const side of [-1, 1]) {
    const x = side * (archHalfWidth + 0.7);
    bay.add(box(0.3, archSpring - archSill, 0.26, materials.gold, x, (archSpring + archSill) / 2, 0.13));
    bay.add(box(0.46, 0.26, 0.36, materials.goldPolished, x, archSpring + 0.13, 0.16));
    bay.add(box(0.46, 0.3, 0.36, materials.goldPolished, x, archSill + 0.15, 0.16));
  }
  bay.add(box(0.42, 0.6, 0.34, materials.goldPolished, 0, archSpring + archHalfWidth + 0.28, 0.16));
  bay.add(box(archHalfWidth * 2 + 0.8, 0.1, 0.6, materials.goldPolished, 0, archSill, 0.12));

  return bay;
}

// Big fluted column standing on every bay boundary.
function createColumn(materials: Materials): THREE.Group {
  const column = new THREE.Group();
  const height = LAYOUT.wallHeight - 0.3;
  column.add(box(1.05, height, 0.7, materials.gold, 0, height / 2, 0));
  for (let i = 0; i < 5; i++) {
    const x = -0.34 + i * 0.17;
    column.add(box(0.065, height - 3.0, 0.05, materials.goldDark, x, height / 2 + 0.25, 0.36));
  }
  column.add(box(1.45, 1.3, 1.0, materials.goldPolished, 0, 0.65, 0));
  column.add(box(1.3, 0.28, 0.9, materials.gold, 0, 1.44, 0));
  column.add(box(1.4, 0.6, 0.95, materials.goldPolished, 0, height - 0.15, 0));
  return column;
}

function createWalls(materials: Materials): THREE.Group {
  const { wallRadius, segments } = LAYOUT;
  const step = (LAYOUT.arcTo - LAYOUT.arcFrom) / segments;
  const walls = new THREE.Group();

  for (let i = 0; i < segments; i++) {
    const angle = segmentAngle(i);
    const bay = createArchBay(materials);
    bay.position.copy(polar(angle, wallRadius * Math.cos(step / 2)));
    faceCenter(bay, angle);
    walls.add(bay);
  }

  for (let i = 0; i <= segments; i++) {
    const angle = boundaryAngle(i);
    const column = createColumn(materials);
    column.position.copy(polar(angle, wallRadius - 0.45));
    faceCenter(column, angle);
    walls.add(column);
  }

  return walls;
}

// Gold entablature, dark frieze and cornice that crown the colonnade.
function createEntablature(materials: Materials): THREE.Group {
  const { wallRadius, wallHeight, arcFrom, arcTo } = LAYOUT;
  const { thetaStart, thetaLength } = cylinderArc(arcFrom - deg(4), arcTo + deg(4));
  const group = new THREE.Group();

  const band = (radius: number, height: number, y: number, material: THREE.Material) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 160, 1, true, thetaStart, thetaLength);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    group.add(mesh);
  };
  const wallBack = materials.wall.clone();
  wallBack.side = THREE.BackSide;
  const goldBack = materials.gold.clone();
  goldBack.side = THREE.BackSide;
  const goldPolishedBack = materials.goldPolished.clone();
  goldPolishedBack.side = THREE.BackSide;

  band(wallRadius - 0.75, 1.0, wallHeight + 0.1, goldBack);
  band(wallRadius - 0.45, 1.3, wallHeight + 1.25, wallBack);
  band(wallRadius - 0.8, 0.3, wallHeight + 2.0, goldPolishedBack);

  const torus = (radius: number, tube: number, y: number) => {
    const mesh = new THREE.Mesh(floorArc(radius, tube, arcFrom - deg(4), arcTo + deg(4)), materials.goldPolished);
    mesh.position.y = y;
    group.add(mesh);
  };
  torus(wallRadius - 0.85, 0.11, wallHeight - 0.4);
  torus(wallRadius - 0.85, 0.08, wallHeight + 0.6);
  torus(wallRadius - 0.95, 0.1, wallHeight + 2.15);
  return group;
}

// Dark ceiling with rows of downlight fixtures.
function createCeiling(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(LAYOUT.wallRadius + 1, 96), materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = LAYOUT.ceilingY;
  group.add(ceiling);

  // Inner gold ring that carries the front row of fixtures.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(13.6, 0.16, 8, 200), materials.gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LAYOUT.ceilingY - 0.4;
  group.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(18, 0.14, 8, 200), materials.goldDark);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = LAYOUT.ceilingY - 0.3;
  group.add(ring2);

  const fixtureBody = new THREE.CylinderGeometry(0.24, 0.3, 0.42, 16);
  const fixtureLens = new THREE.CircleGeometry(0.21, 16);
  fixtureLens.rotateX(Math.PI / 2);
  const addRow = (radius: number, count: number, from: number, to: number, y: number) => {
    const bodies = new THREE.InstancedMesh(fixtureBody, materials.goldDark, count);
    const lenses = new THREE.InstancedMesh(fixtureLens, materials.fixture, count);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const angle = from + ((to - from) * i) / (count - 1);
      const p = polar(angle, radius, y);
      matrix.makeTranslation(p.x, p.y, p.z);
      bodies.setMatrixAt(i, matrix);
      matrix.makeTranslation(p.x, p.y - 0.22, p.z);
      lenses.setMatrixAt(i, matrix);
    }
    group.add(bodies, lenses);
  };
  addRow(18, 30, deg(-95), deg(95), LAYOUT.ceilingY - 0.7);
  addRow(13.6, 20, deg(-80), deg(80), LAYOUT.ceilingY - 0.8);
  return group;
}

// Two-tier stage riser along the colonnade with warm LED edges.
function createBackSteps(materials: Materials): THREE.Group {
  const { arcFrom, arcTo, wallRadius } = LAYOUT;
  const group = new THREE.Group();
  const tiers = [
    { inner: wallRadius - 2.6, height: 0.65 },
    { inner: wallRadius - 1.6, height: 1.3 },
  ];
  for (const tier of tiers) {
    const step = new THREE.Mesh(annularSector(tier.inner, wallRadius, arcFrom, arcTo, tier.height), materials.marble);
    step.receiveShadow = true;
    group.add(step);
    const edge = new THREE.Mesh(floorArc(tier.inner + 0.02, 0.025, arcFrom, arcTo), materials.goldPolished);
    edge.position.y = tier.height;
    group.add(edge);
    const led = new THREE.Mesh(floorArc(tier.inner - 0.005, 0.014, arcFrom, arcTo), materials.led);
    led.position.y = tier.height - 0.12;
    group.add(led);
  }
  return group;
}

// Mirror floor under a semi-transparent black marble layer with gold ring inlays.
function createFloor(materials: Materials, width: number, height: number): { group: THREE.Group; reflector: Reflector } {
  const group = new THREE.Group();
  const reflector = new Reflector(new THREE.CircleGeometry(LAYOUT.wallRadius + 2, 96), {
    textureWidth: width * 0.5,
    textureHeight: height * 0.5,
    color: 0x8a8a8a,
  });
  reflector.rotation.x = -Math.PI / 2;
  group.add(reflector);

  const marble = materials.marble.clone();
  marble.transparent = true;
  marble.opacity = 0.72;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(LAYOUT.wallRadius + 2, 96), marble);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  group.add(floor);

  const inlays = [5.3, 5.55, 7.3, 7.5, 9.9, 12.6, 12.8];
  for (const radius of inlays) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.025, radius + 0.025, 160), materials.goldPolished);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.012, PODIUM_Z);
    group.add(ring);
  }
  return { group, reflector };
}

function createStudio(materials: Materials, width: number, height: number) {
  const group = new THREE.Group();
  const floor = createFloor(materials, width, height);
  group.add(floor.group, createWalls(materials), createEntablature(materials), createCeiling(materials), createBackSteps(materials));
  return { group, reflector: floor.reflector };
}

export { LAYOUT, createStudio, segmentAngle, boundaryAngle };
