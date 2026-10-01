import * as THREE from "three";
import { annulus, group, mesh } from "./geometry";
import type { StudioMaterials } from "./materials";

const SEGMENT_COUNT = 24;
const DISC_RADIUS = 2.55;
const FRAME_RADIUS = 2.95;
const RIM_BULB_COUNT = 44;
const HUB_BULB_COUNT = 26;

const SEGMENT_COLORS = ["#c3172b", "#e8d39a", "#1d4dc0", "#d9a637", "#11925a", "#7b2bab"];
const SEGMENT_LABELS = ["1000", "50", "500", "200", "2000", "100", "★", "500", "50", "1000", "200", "♛"];

// One spin: the wheel starts at full speed and slows down to a stop, then rests.
const SPIN_SECONDS = 7;
const REST_SECONDS = 2.5;
const SPIN_START_SPEED = 9;

interface WheelHandle {
  root: THREE.Group;
  center: THREE.Vector3;
  update: (time: number) => void;
}

function createWheelFaceTexture(): THREE.CanvasTexture {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const c = size / 2;
  const r = size / 2;
  const step = (Math.PI * 2) / SEGMENT_COUNT;

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const from = -Math.PI / 2 + (i - 0.5) * step;
    const to = from + step;
    const gradient = ctx.createRadialGradient(c, c, r * 0.2, c, c, r);
    const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? "#c3172b";
    gradient.addColorStop(0, "#1a0b06");
    gradient.addColorStop(0.35, color);
    gradient.addColorStop(0.8, color);
    gradient.addColorStop(1, "#2a1808");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, from, to);
    ctx.closePath();
    ctx.fill();
  }

  // Gold dividers between the segments.
  ctx.strokeStyle = "#f1c56a";
  ctx.lineWidth = 10;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const angle = -Math.PI / 2 + (i - 0.5) * step;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
    ctx.stroke();
  }

  // Value plates, oriented along the radius as on the reference wheel.
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const angle = -Math.PI / 2 + i * step;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    ctx.translate(r * 0.7, 0);
    const plateW = r * 0.3;
    const plateH = r * 0.12;
    ctx.fillStyle = "#14100c";
    ctx.strokeStyle = "#e8b65a";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(-plateW / 2, -plateH / 2, plateW, plateH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f5d27e";
    ctx.font = "bold 84px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SEGMENT_LABELS[i % SEGMENT_LABELS.length] ?? "", 0, 4);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createHubTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c * 0.9, 20, c, c, c);
  gradient.addColorStop(0, "#d4283a");
  gradient.addColorStop(0.7, "#7c0a17");
  gradient.addColorStop(1, "#3a0309");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Sunburst rays.
  ctx.strokeStyle = "rgba(255, 120, 120, 0.12)";
  ctx.lineWidth = 6;
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(angle) * c, c + Math.sin(angle) * c);
    ctx.stroke();
  }

  // Crown.
  ctx.fillStyle = "#f2c35e";
  ctx.beginPath();
  ctx.moveTo(c - 90, 330);
  ctx.lineTo(c - 110, 230);
  ctx.lineTo(c - 45, 285);
  ctx.lineTo(c, 210);
  ctx.lineTo(c + 45, 285);
  ctx.lineTo(c + 110, 230);
  ctx.lineTo(c + 90, 330);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#f6cf73";
  ctx.strokeStyle = "#5a2c06";
  ctx.lineWidth = 10;
  ctx.font = "bold 190px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeText("GAME", c, 470);
  ctx.fillText("GAME", c, 470);
  ctx.strokeText("SHOW", c, 670);
  ctx.fillText("SHOW", c, 670);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBulbRing(name: string, count: number, radius: number, bulbRadius: number, z: number, materials: StudioMaterials): THREE.InstancedMesh {
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(bulbRadius, 12, 8), materials.bulb, count);
  bulbs.name = name;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    bulbs.setMatrixAt(i, matrix);
    bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  return bulbs;
}

function createWheel(materials: StudioMaterials, centerY: number, podiumTop: number, z: number): WheelHandle {
  const root = group("Wheel");
  root.position.set(0, centerY, z);

  // Stand behind the wheel, standing on the podium.
  const stand = mesh("Stand", new THREE.BoxGeometry(0.7, centerY - podiumTop, 0.5), materials.goldDark);
  stand.position.set(0, -(centerY - podiumTop) / 2, -0.45);
  root.add(stand);

  const back = mesh("Back Plate", new THREE.CylinderGeometry(FRAME_RADIUS + 0.05, FRAME_RADIUS + 0.05, 0.3, 96), materials.navyLacquer);
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.2;
  root.add(back);

  const frame = group("Frame", false);
  const frameRing = mesh("Frame Ring", annulus(DISC_RADIUS, FRAME_RADIUS, 0.16), materials.goldDark);
  frame.add(frameRing);
  const outerRim = mesh("Outer Rim", new THREE.TorusGeometry(FRAME_RADIUS, 0.09, 12, 160), materials.gold);
  outerRim.position.z = 0.12;
  frame.add(outerRim);
  const innerRim = mesh("Inner Rim", new THREE.TorusGeometry(DISC_RADIUS, 0.06, 12, 160), materials.gold);
  innerRim.position.z = 0.14;
  frame.add(innerRim);
  const rimBulbs = createBulbRing("Rim Bulbs", RIM_BULB_COUNT, (DISC_RADIUS + FRAME_RADIUS) / 2, 0.075, 0.2, materials);
  frame.add(rimBulbs);
  root.add(frame);

  const disc = group("Spinning Disc", false);
  // The face glows a little by itself so the colours read even outside the key light.
  const faceTexture = createWheelFaceTexture();
  const face = mesh("Face", new THREE.CircleGeometry(DISC_RADIUS, 128), new THREE.MeshStandardMaterial({
    name: "Wheel Face",
    map: faceTexture,
    emissiveMap: faceTexture,
    emissive: new THREE.Color(0.08, 0.08, 0.08),
    metalness: 0.25,
    roughness: 0.32,
  }));
  face.position.z = 0.06;
  disc.add(face);

  const pegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), materials.gold, SEGMENT_COUNT);
  pegs.name = "Pegs";
  const pegMatrix = new THREE.Matrix4();
  const pegRotation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const angle = Math.PI / 2 + (i + 0.5) * ((Math.PI * 2) / SEGMENT_COUNT);
    pegMatrix.makeTranslation(Math.cos(angle) * (DISC_RADIUS - 0.12), Math.sin(angle) * (DISC_RADIUS - 0.12), 0.12);
    pegMatrix.multiply(pegRotation);
    pegs.setMatrixAt(i, pegMatrix);
  }
  disc.add(pegs);
  root.add(disc);

  const hub = group("Hub", false);
  const hubFace = mesh("Hub Face", new THREE.CircleGeometry(0.8, 96), new THREE.MeshBasicMaterial({
    name: "Hub Face",
    map: createHubTexture(),
  }));
  hubFace.position.z = 0.24;
  hub.add(hubFace);
  const hubBody = mesh("Hub Body", new THREE.CylinderGeometry(0.84, 0.84, 0.16, 64), materials.goldDark);
  hubBody.rotation.x = Math.PI / 2;
  hubBody.position.z = 0.15;
  hub.add(hubBody);
  const hubRim = mesh("Hub Rim", new THREE.TorusGeometry(0.84, 0.05, 10, 96), materials.gold);
  hubRim.position.z = 0.24;
  hub.add(hubRim);
  const hubOuterRim = mesh("Hub Outer Rim", new THREE.TorusGeometry(1.04, 0.04, 10, 96), materials.gold);
  hubOuterRim.position.z = 0.2;
  hub.add(hubOuterRim);
  const hubBulbs = createBulbRing("Hub Bulbs", HUB_BULB_COUNT, 0.94, 0.035, 0.24, materials);
  hub.add(hubBulbs);
  root.add(hub);

  const pointer = group("Pointer", false);
  const pointerTip = mesh("Pointer Tip", new THREE.ConeGeometry(0.2, 0.55, 24), materials.gold);
  pointerTip.rotation.x = Math.PI;
  pointerTip.position.y = FRAME_RADIUS - 0.05;
  pointer.add(pointerTip);
  const pointerCap = mesh("Pointer Cap", new THREE.SphereGeometry(0.22, 24, 16), materials.gold);
  pointerCap.position.y = FRAME_RADIUS + 0.25;
  pointer.add(pointerCap);
  const pointerGem = mesh("Pointer Gem", new THREE.SphereGeometry(0.1, 16, 12), materials.lampGlobe);
  pointerGem.position.set(0, FRAME_RADIUS + 0.25, 0.17);
  pointer.add(pointerGem);
  pointer.position.z = 0.25;
  root.add(pointer);

  const bulbColor = new THREE.Color();
  // Kept just above the bloom threshold: a soft glow, not a flare.
  const warm = new THREE.Color(1.55, 1.15, 0.68);
  const dim = new THREE.Color(0.38, 0.26, 0.12);

  let previousTime = 0;
  let spinAngle = 0;

  function update(time: number): void {
    const cycle = SPIN_SECONDS + REST_SECONDS;
    const local = time % cycle;
    const dt = Math.max(0, Math.min(0.1, time - previousTime));
    previousTime = time;

    const spinning = local < SPIN_SECONDS;
    if (spinning) {
      const remaining = 1 - local / SPIN_SECONDS;
      spinAngle -= SPIN_START_SPEED * remaining * remaining * dt;
    }
    disc.rotation.z = spinAngle;

    // While the wheel spins the rim lights chase; at rest they blink in two alternating groups.
    for (let i = 0; i < RIM_BULB_COUNT; i++) {
      let on: number;
      if (spinning) {
        const head = (time * 18) % RIM_BULB_COUNT;
        const distance = (i - head + RIM_BULB_COUNT) % RIM_BULB_COUNT;
        on = distance % 4 < 2 ? 1 : 0.15;
      } else {
        on = (i % 2 === 0) === (Math.floor(time * 3) % 2 === 0) ? 1 : 0.2;
      }
      bulbColor.copy(dim).lerp(warm, on);
      rimBulbs.setColorAt(i, bulbColor);
    }
    for (let i = 0; i < HUB_BULB_COUNT; i++) {
      const on = 0.55 + 0.45 * Math.sin(time * 4 + i * 0.9);
      bulbColor.copy(dim).lerp(warm, on);
      hubBulbs.setColorAt(i, bulbColor);
    }
    if (rimBulbs.instanceColor) {
      rimBulbs.instanceColor.needsUpdate = true;
    }
    if (hubBulbs.instanceColor) {
      hubBulbs.instanceColor.needsUpdate = true;
    }
  }

  return {
    root,
    center: new THREE.Vector3(0, centerY, z),
    update,
  };
}

export { createWheel };
export type { WheelHandle };
