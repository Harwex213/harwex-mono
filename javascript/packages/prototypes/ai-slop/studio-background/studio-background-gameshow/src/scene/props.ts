import * as THREE from "three";
import { faceCenter, polar } from "./geometry";
import type { Materials } from "./materials";
import { boundaryAngle, LAYOUT } from "./studio";

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

// Velvet drape: a tall plane with sine folds and a gold tassel.
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
  const drape = new THREE.Mesh(geometry, materials.velvet);
  drape.position.y = height / 2;
  drape.castShadow = true;
  group.add(drape);
  const tieback = mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 24), materials.goldPolished, 0, 5.6, 0.3);
  group.add(tieback);
  const tassel = mesh(new THREE.ConeGeometry(0.17, 0.85, 12), materials.gold, 0, 5.0, 0.33);
  group.add(tassel);
  return group;
}

// Host desk: fluted navy drum with gold rims and two tilted monitors.
function createHostDesk(materials: Materials): THREE.Group {
  const desk = new THREE.Group();
  const radius = 1.0;
  const height = 1.75;
  desk.add(mesh(new THREE.CylinderGeometry(radius + 0.12, radius + 0.15, 0.16, 64), materials.goldPolished, 0, 0.08, 0));
  desk.add(mesh(new THREE.CylinderGeometry(radius, radius, height - 0.3, 64), materials.navy, 0, height / 2, 0));
  const flute = new THREE.BoxGeometry(0.04, height - 0.45, 0.04);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    desk.add(mesh(flute, materials.gold, Math.sin(a) * (radius + 0.01), height / 2, Math.cos(a) * (radius + 0.01)));
  }
  desk.add(mesh(new THREE.CylinderGeometry(radius + 0.14, radius + 0.1, 0.14, 64), materials.goldPolished, 0, height - 0.15, 0));
  desk.add(mesh(new THREE.CylinderGeometry(radius + 0.1, radius + 0.1, 0.06, 64), materials.marble, 0, height - 0.05, 0));
  for (const side of [-1, 1]) {
    const monitor = new THREE.Group();
    monitor.add(mesh(new THREE.BoxGeometry(0.62, 0.38, 0.04), materials.navy, 0, 0, 0));
    monitor.add(mesh(new THREE.PlaneGeometry(0.56, 0.32), materials.screen, 0, 0, -0.025));
    monitor.position.set(side * 0.38, height + 0.22, 0.1);
    // Screens face the host, who stands behind the desk.
    monitor.rotation.set(-0.35, side * 0.15, 0);
    monitor.rotation.y += Math.PI;
    desk.add(monitor);
  }
  return desk;
}

function createLampTable(materials: Materials): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 40), materials.goldPolished, 0, 0.82, 0));
  group.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.8, 40), materials.navy, 0, 0.4, 0));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    group.add(mesh(new THREE.BoxGeometry(0.03, 0.72, 0.03), materials.gold, Math.sin(a) * 0.44, 0.42, Math.cos(a) * 0.44));
  }
  group.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.12, 20), materials.gold, 0, 0.91, 0));
  const globe = mesh(new THREE.SphereGeometry(0.24, 32, 20), materials.lampGlobe, 0, 1.18, 0);
  globe.castShadow = false;
  group.add(globe);
  const light = new THREE.PointLight(0xffd7a0, 2.5, 4, 2);
  light.position.set(0, 1.2, 0);
  group.add(light);
  return { group, light };
}

function createArmchair(materials: Materials): THREE.Group {
  const chair = new THREE.Group();
  chair.add(mesh(new THREE.BoxGeometry(1.3, 0.45, 1.0), materials.velvet, 0, 0.35, 0));
  chair.add(mesh(new THREE.BoxGeometry(1.3, 0.9, 0.28), materials.velvet, 0, 0.95, -0.42));
  for (const side of [-1, 1]) {
    chair.add(mesh(new THREE.BoxGeometry(0.24, 0.55, 1.0), materials.velvet, side * 0.6, 0.6, 0));
  }
  chair.add(mesh(new THREE.BoxGeometry(1.32, 0.1, 1.02), materials.goldDark, 0, 0.08, 0));
  return chair;
}

// Potted palm: a gold pot, a short trunk and drooping fronds.
function createPalm(materials: Materials): THREE.Group {
  const palm = new THREE.Group();
  palm.add(mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.8, 32), materials.goldPolished, 0, 0.4, 0));
  palm.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 10), materials.trunk, 0, 1.5, 0));
  const frondGeometry = new THREE.PlaneGeometry(0.42, 1.9, 1, 10);
  const position = frondGeometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + 0.95;
    const x = position.getX(i);
    // Bend the frond downwards along its length and pinch it to a tip.
    position.setX(i, x * (1 - (y / 1.9) * 0.8));
    position.setZ(i, -Math.pow(y / 1.9, 2) * 0.9);
    position.setY(i, y);
  }
  frondGeometry.computeVertexNormals();
  for (let i = 0; i < 11; i++) {
    const frond = new THREE.Mesh(frondGeometry, materials.leaf);
    frond.position.y = 2.2;
    frond.rotation.order = "YXZ";
    frond.rotation.y = (i / 11) * Math.PI * 2;
    frond.rotation.x = -0.9 + (i % 3) * 0.25;
    frond.castShadow = true;
    palm.add(frond);
  }
  return palm;
}

// Wall sconce: a gold arm with a glowing globe on a column face.
function createSconce(materials: Materials): THREE.Group {
  const sconce = new THREE.Group();
  sconce.add(mesh(new THREE.BoxGeometry(0.16, 0.4, 0.1), materials.goldPolished, 0, 0, 0));
  sconce.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), materials.gold, 0, 0.05, 0.2));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), materials.lampGlobe);
  globe.position.set(0, 0.25, 0.4);
  sconce.add(globe);
  return sconce;
}

function createProps(materials: Materials) {
  const group = new THREE.Group();

  // Drapes hang in the near side arches and frame the shot, like in the reference.
  for (const side of [-1, 1]) {
    const angle = side * THREE.MathUtils.degToRad(47);
    const curtain = createCurtain(materials, 3.6, LAYOUT.wallHeight + 1.5);
    curtain.position.copy(polar(angle, LAYOUT.wallRadius - 1.6));
    faceCenter(curtain, angle);
    group.add(curtain);
  }

  const desk = createHostDesk(materials);
  desk.position.set(3.7, 0, 1.0);
  desk.rotation.y = -0.4;
  group.add(desk);

  const tables = [
    new THREE.Vector3(-5.3, 0, 2.0),
    new THREE.Vector3(5.4, 0, 2.2),
    new THREE.Vector3(-8.5, 0, -4.0),
  ];
  for (const position of tables) {
    const table = createLampTable(materials);
    table.group.position.copy(position);
    group.add(table.group);
  }

  const chairs = [
    { position: new THREE.Vector3(-7.0, 0, -2.0), rotation: 1.0 },
    { position: new THREE.Vector3(7.2, 0, -1.5), rotation: -1.0 },
  ];
  for (const chair of chairs) {
    const armchair = createArmchair(materials);
    armchair.position.copy(chair.position);
    armchair.rotation.y = chair.rotation;
    group.add(armchair);
  }

  for (const position of [new THREE.Vector3(-10.5, 0, -10.0), new THREE.Vector3(10.7, 0, -10.3)]) {
    const palm = createPalm(materials);
    palm.position.copy(position);
    palm.scale.setScalar(1.5);
    group.add(palm);
  }

  // Sconces on the columns that flank the side arches.
  for (const index of [1, 2, 3, 4, 8, 9, 10, 11]) {
    const angle = boundaryAngle(index);
    const sconce = createSconce(materials);
    sconce.scale.setScalar(1.4);
    sconce.position.copy(polar(angle, LAYOUT.wallRadius - 0.85, 7.6));
    faceCenter(sconce, angle);
    group.add(sconce);
  }

  return group;
}

export { createProps };
