import * as THREE from "three";
import { named } from "./geometry";
import { glow } from "./materials";
import type { Materials } from "./materials";

// Wheel body, front to back along z (the wheel center is z = 0):
//   hub 0.02..0.22 on the face, face disc 0..0.02 on the shell, shell -0.36..0,
//   legs -0.64..-0.36 against the shell back, base -1.2..-0.36 under the legs.
// The housing ring is centred on z = 0 and sits half inside the shell rim.
// The face stops 1 cm short of the housing tube, so the spinning face never touches the ring.
const FACE_RADIUS = 2.97;
const FACE_THICKNESS = 0.02;
const HOUSING_RADIUS = 3.22;
const HOUSING_TUBE = 0.24;
const SHELL_RADIUS = 3.32;
const SHELL_DEPTH = 0.36;
const BULB_COUNT = 44;
const PODIUM = [
  { radius: 4.6, height: 0.25 },
  { radius: 3.9, height: 0.25 },
  { radius: 3.2, height: 0.25 },
];
// The wheel stands close to the back arches, like in the scene reference.
const PODIUM_Z = -4;
const PODIUM_TOP = PODIUM.reduce((sum, tier) => sum + tier.height, 0);
const WHEEL_CENTER = new THREE.Vector3(0, PODIUM_TOP + HOUSING_RADIUS + 0.35, PODIUM_Z);

const COLORS = {
  red: "#b3121f",
  cream: "#e6cf98",
  blue: "#1d3fae",
  green: "#13854a",
  purple: "#6b1fa3",
};

type SectorColor = keyof typeof COLORS;

// Clockwise from the pointer, read off the scene reference.
const SECTORS: Array<[SectorColor, string]> = [
  ["red", "crown"],
  ["green", "1000"],
  ["cream", "1000"],
  ["red", "200"],
  ["purple", "50"],
  ["cream", "200"],
  ["green", "star"],
  ["purple", "2000"],
  ["cream", "500"],
  ["blue", "50"],
  ["cream", "200"],
  ["red", "1000"],
  ["red", "crown"],
  ["green", "500"],
  ["cream", "1000"],
  ["blue", "star"],
  ["red", "100"],
  ["cream", "2000"],
  ["blue", "500"],
  ["red", "2000"],
  ["cream", "100"],
  ["green", "2000"],
  ["purple", "500"],
  ["cream", "50"],
];

function drawStar(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function drawCrown(ctx: CanvasRenderingContext2D, size: number): void {
  const w = size;
  const h = size * 0.75;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(-w / 2, -h / 4);
  ctx.lineTo(-w / 4, h / 8);
  ctx.lineTo(0, -h / 2);
  ctx.lineTo(w / 4, h / 8);
  ctx.lineTo(w / 2, -h / 4);
  ctx.lineTo(w / 2, h / 2);
  ctx.closePath();
  ctx.fill();
}

function shade(hex: string, factor: number): string {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return `#${color.getHexString()}`;
}

function createFaceTexture(): THREE.CanvasTexture {
  const size = 2048;
  const c = size / 2;
  const radius = size / 2 - 4;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  const step = (Math.PI * 2) / SECTORS.length;

  SECTORS.forEach(([colorName, label], i) => {
    const color = COLORS[colorName];
    const start = -Math.PI / 2 + (i - 0.5) * step;
    const end = start + step;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, radius, start, end);
    ctx.closePath();
    const gradient = ctx.createRadialGradient(c, c, radius * 0.2, c, c, radius);
    gradient.addColorStop(0, shade(color, 0.55));
    gradient.addColorStop(0.7, color);
    gradient.addColorStop(1, shade(color, 0.8));
    ctx.fillStyle = gradient;
    ctx.fill();
    // Glitter speckles inside the sector.
    ctx.clip();
    for (let k = 0; k < 900; k++) {
      const a = start + Math.random() * step;
      const r = radius * (0.3 + Math.random() * 0.7);
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
      ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 3, 3);
    }
    ctx.restore();

    // Label plate reads along the radius, like on the reference wheel.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(start + step / 2);
    ctx.translate(radius * 0.7, 0);
    const plateW = radius * 0.3;
    const plateH = radius * 0.12;
    ctx.fillStyle = "#121212";
    ctx.strokeStyle = "#e8b94e";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(-plateW / 2, -plateH / 2, plateW, plateH, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f3d27a";
    if (label === "star") {
      drawStar(ctx, plateH * 0.38);
    } else if (label === "crown") {
      drawCrown(ctx, plateH * 0.7);
    } else {
      ctx.font = `bold ${Math.round(plateH * 0.62)}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, plateH * 0.04);
    }
    ctx.restore();
  });

  // Gold separators between sectors.
  ctx.strokeStyle = "#e3b04b";
  ctx.lineWidth = 12;
  for (let i = 0; i < SECTORS.length; i++) {
    const a = -Math.PI / 2 + (i - 0.5) * step;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * radius * 0.3, c + Math.sin(a) * radius * 0.3);
    ctx.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
    ctx.stroke();
  }
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(c, c, radius - 9, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createHubTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  ctx.fillStyle = "#d8a44a";
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#141018";
  ctx.beginPath();
  ctx.arc(c, c, c * 0.93, 0, Math.PI * 2);
  ctx.fill();
  // Ring of white dots around the logo.
  ctx.fillStyle = "#fff6e0";
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * c * 0.86, c + Math.sin(a) * c * 0.86, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  const red = ctx.createRadialGradient(c, c * 0.9, 20, c, c, c * 0.78);
  red.addColorStop(0, "#d42a2a");
  red.addColorStop(1, "#5a0610");
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e8b94e";
  ctx.lineWidth = 12;
  ctx.stroke();

  ctx.fillStyle = "#f5cf6e";
  ctx.strokeStyle = "#5a3408";
  ctx.lineWidth = 8;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 170px Georgia, serif";
  ctx.strokeText("GAME", c, c - 40);
  ctx.fillText("GAME", c, c - 40);
  ctx.strokeText("SHOW", c, c + 135);
  ctx.fillText("SHOW", c, c + 135);
  ctx.save();
  ctx.translate(c, c - 220);
  drawCrown(ctx, 120);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPodium(materials: Materials): THREE.Group {
  const podium = named(new THREE.Group(), "Podium");
  let y = 0;
  for (const [index, tier] of PODIUM.entries()) {
    const geometry = new THREE.CylinderGeometry(tier.radius, tier.radius, tier.height, 128);
    // Cylinder material groups: side, top cap, bottom cap.
    const mesh = named(new THREE.Mesh(geometry, [materials.goldPolished, materials.marble, materials.marble]), `Tier ${index + 1}`);
    mesh.position.y = y + tier.height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    podium.add(mesh);
    // A bead lies on the tread near its edge, an LED tube runs along the riser: both only touch the tier.
    // The LED keeps 1.5 mm off the riser, more than the sag of its own segments, so no chord cuts into the tier.
    const lip = named(new THREE.Mesh(new THREE.TorusGeometry(tier.radius - 0.05, 0.03, 8, 160), materials.gold), `Bead ${index + 1}`);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = y + tier.height + 0.03;
    podium.add(lip);
    const led = named(new THREE.Mesh(new THREE.TorusGeometry(tier.radius + 0.012 + 0.0015, 0.012, 8, 160), materials.led), `LED ${index + 1}`);
    led.rotation.x = Math.PI / 2;
    led.position.y = y + tier.height * 0.5;
    podium.add(led);
    y += tier.height;
  }
  podium.position.z = PODIUM_Z;
  return podium;
}

function createWheel(materials: Materials) {
  const group = named(new THREE.Group(), "Wheel");
  group.add(createPodium(materials));

  const wheel = named(new THREE.Group(), "Wheel Body");
  wheel.position.copy(WHEEL_CENTER);
  group.add(wheel);

  // Rear shell, and the A-frame stand behind it: a base on the podium, two legs from the base to the shell back.
  const shell = named(new THREE.Mesh(new THREE.CylinderGeometry(SHELL_RADIUS, SHELL_RADIUS, SHELL_DEPTH, 96), materials.navy), "Shell");
  shell.rotation.x = Math.PI / 2;
  shell.position.z = -SHELL_DEPTH / 2;
  shell.castShadow = true;
  wheel.add(shell);
  const baseHeight = 0.3;
  const baseTop = PODIUM_TOP + baseHeight - WHEEL_CENTER.y;
  const base = named(new THREE.Mesh(new THREE.BoxGeometry(3.2, baseHeight, 1.2 - SHELL_DEPTH), materials.goldDark), "Base");
  base.position.set(0, baseTop - baseHeight / 2, -SHELL_DEPTH - (1.2 - SHELL_DEPTH) / 2);
  wheel.add(base);
  // Each leg is a slanted prism with level ends: the foot stands flat on the base, the front face lies on the shell back.
  const legWidth = 0.28;
  const legTop = 0.2;
  const legLean = (legTop - baseTop) * Math.tan(0.22);
  for (const side of [-1, 1]) {
    const foot = side * (1.0 + legLean / 2);
    const head = side * (1.0 - legLean / 2);
    const shape = new THREE.Shape();
    shape.moveTo(foot - legWidth / 2, baseTop);
    shape.lineTo(foot + legWidth / 2, baseTop);
    shape.lineTo(head + legWidth / 2, legTop);
    shape.lineTo(head - legWidth / 2, legTop);
    shape.closePath();
    const legGeometry = new THREE.ExtrudeGeometry(shape, { depth: legWidth, bevelEnabled: false });
    legGeometry.translate(0, 0, -SHELL_DEPTH - legWidth);
    const leg = named(new THREE.Mesh(legGeometry, materials.goldDark), side < 0 ? "Leg Left" : "Leg Right");
    leg.castShadow = true;
    wheel.add(leg);
  }

  // Spinning part: printed face and its sector pegs.
  const rotor = named(new THREE.Group(), "Rotor");
  rotor.userData.animated = true;
  wheel.add(rotor);
  const faceTexture = createFaceTexture();
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    emissive: 0xffffff,
    emissiveMap: faceTexture,
    emissiveIntensity: 0.06,
    roughness: 0.32,
    metalness: 0.1,
  });
  // A thin disc on the shell front. The two rotations give its cap the same UVs as a CircleGeometry.
  const faceGeometry = new THREE.CylinderGeometry(FACE_RADIUS, FACE_RADIUS, FACE_THICKNESS, 128);
  faceGeometry.rotateX(Math.PI / 2);
  faceGeometry.rotateZ(Math.PI / 2);
  const face = named(new THREE.Mesh(faceGeometry, [materials.goldDark, faceMaterial, materials.goldDark]), "Face");
  face.position.z = FACE_THICKNESS / 2;
  rotor.add(face);
  const pegGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10);
  pegGeometry.rotateX(Math.PI / 2);
  const pegs = named(new THREE.InstancedMesh(pegGeometry, materials.goldPolished, SECTORS.length), "Pegs");
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < SECTORS.length; i++) {
    const a = Math.PI / 2 + ((i - 0.5) * Math.PI * 2) / SECTORS.length;
    matrix.makeTranslation(Math.cos(a) * (FACE_RADIUS - 0.08), Math.sin(a) * (FACE_RADIUS - 0.08), FACE_THICKNESS + 0.06);
    pegs.setMatrixAt(i, matrix);
  }
  rotor.add(pegs);

  // Static housing ring with chasing bulbs. The ring is mounted half into the shell rim,
  // and every bulb sits half in the ring, like in a socket.
  const housing = named(new THREE.Mesh(new THREE.TorusGeometry(HOUSING_RADIUS, HOUSING_TUBE, 24, 160), materials.goldPolished), "Housing");
  housing.userData.seated = true;
  housing.castShadow = true;
  wheel.add(housing);

  const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bulbs = named(new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 16, 12), bulbMaterial, BULB_COUNT), "Bulbs");
  for (let i = 0; i < BULB_COUNT; i++) {
    const a = (i / BULB_COUNT) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(a) * HOUSING_RADIUS, Math.sin(a) * HOUSING_RADIUS, 0.2);
    bulbs.setMatrixAt(i, matrix);
    bulbs.setColorAt(i, glow(0xffe2a8, 6));
  }
  bulbs.userData.seated = true;
  wheel.add(bulbs);

  // Hub with the logo stays still while the face spins behind it.
  const hubGeometry = new THREE.CylinderGeometry(0.95, 0.95, 0.2, 96);
  hubGeometry.rotateX(Math.PI / 2);
  // Cap UVs put the canvas top along +X; turn the logo upright.
  hubGeometry.rotateZ(Math.PI / 2);
  const hubTexture = createHubTexture();
  const hubFace = new THREE.MeshStandardMaterial({
    map: hubTexture,
    emissive: 0xffffff,
    emissiveMap: hubTexture,
    emissiveIntensity: 0.12,
    roughness: 0.3,
  });
  // The hub stands on the face; the ring is a bead around its front edge.
  const hub = named(new THREE.Mesh(hubGeometry, [materials.goldPolished, hubFace, materials.goldDark]), "Hub");
  hub.position.z = FACE_THICKNESS + 0.1;
  wheel.add(hub);
  const hubRing = named(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 12, 96), materials.goldPolished), "Hub Ring");
  hubRing.position.z = FACE_THICKNESS + 0.2;
  hubRing.userData.seated = true;
  wheel.add(hubRing);

  // Pointer at the top: a bracket lies on the housing top, the gold drop hangs from its front end
  // just in front of the ring, and a cap with a red gem sits on the bracket above the drop.
  const pointer = named(new THREE.Group(), "Pointer");
  const ringTop = HOUSING_RADIUS + HOUSING_TUBE;
  const bracketHeight = 0.12;
  const dropZ = HOUSING_TUBE + 0.26;
  const bracket = named(new THREE.Mesh(new THREE.BoxGeometry(0.24, bracketHeight, dropZ + 0.44), materials.goldPolished), "Bracket");
  bracket.position.set(0, ringTop + bracketHeight / 2, (dropZ + 0.24 - 0.2) / 2);
  pointer.add(bracket);
  const drop = named(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 24), materials.goldPolished), "Drop");
  drop.rotation.z = Math.PI;
  drop.position.set(0, ringTop - 0.31, dropZ);
  pointer.add(drop);
  const cap = named(new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), materials.goldPolished), "Cap");
  cap.position.set(0, ringTop + bracketHeight + 0.2, dropZ);
  cap.userData.seated = true;
  pointer.add(cap);
  const gem = named(new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshBasicMaterial({ color: glow(0xff2a2a, 3) })), "Gem");
  gem.position.set(0, cap.position.y, dropZ + 0.18);
  gem.userData.seated = true;
  pointer.add(gem);
  wheel.add(pointer);

  // Spin cycle: an eased spin that lands on a sector, then a short rest.
  const SPIN_TIME = 7;
  const REST_TIME = 2.5;
  const sectorStep = (Math.PI * 2) / SECTORS.length;
  let cycleTime = 0;
  let startAngle = 0;
  let spinDistance = Math.PI * 2 * 3 + sectorStep * 5;
  const chase = new THREE.Color();

  const update = (dt: number, time: number, spinning: boolean) => {
    if (spinning) {
      cycleTime += dt;
      if (cycleTime > SPIN_TIME + REST_TIME) {
        cycleTime -= SPIN_TIME + REST_TIME;
        startAngle += spinDistance;
        spinDistance = Math.PI * 2 * (3 + Math.floor(Math.random() * 2)) + sectorStep * Math.floor(Math.random() * SECTORS.length);
      }
      const t = Math.min(cycleTime / SPIN_TIME, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      // Negative rotation turns the wheel clockwise for the viewer.
      rotor.rotation.z = -(startAngle + spinDistance * eased);
    }

    // Bulbs run a chase while the wheel spins and pulse in pairs while it rests.
    const resting = cycleTime > SPIN_TIME;
    for (let i = 0; i < BULB_COUNT; i++) {
      const wave = resting ? 0.5 + 0.5 * Math.sin(time * 5 + (i % 2) * Math.PI) : 0.5 + 0.5 * Math.sin(time * 9 - i * 0.7);
      chase.setHex(0xffe2a8).multiplyScalar(0.7 + wave * 1.9);
      bulbs.setColorAt(i, chase);
    }
    if (bulbs.instanceColor) {
      bulbs.instanceColor.needsUpdate = true;
    }
  };

  return { group, update };
}

export { createWheel, WHEEL_CENTER, PODIUM_Z };
