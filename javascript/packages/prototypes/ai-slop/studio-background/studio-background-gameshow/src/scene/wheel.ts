import * as THREE from "three";
import { decodeColor } from "../engine/sceneFormat";
import type { ColorValue } from "../engine/sceneFormat";
import { glow } from "./materials";

// The hero wheel lives in the scene file under `Wheel`. This module keeps what code draws for it:
// the printed face and the hub logo (canvas textures) with their materials, and the `wheelSpin` component.

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

// The own materials of the wheel parts: the printed face, the hub logo, the chasing bulbs and the pointer gem.
function createWheelMaterials() {
  const faceTexture = createFaceTexture();
  const hubTexture = createHubTexture();
  return {
    wheelFace: new THREE.MeshStandardMaterial({
      map: faceTexture,
      emissive: 0xffffff,
      emissiveMap: faceTexture,
      emissiveIntensity: 0.06,
      roughness: 0.32,
      metalness: 0.1,
    }),
    wheelBulbs: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    wheelHubFace: new THREE.MeshStandardMaterial({
      map: hubTexture,
      emissive: 0xffffff,
      emissiveMap: hubTexture,
      emissiveIntensity: 0.12,
      roughness: 0.3,
    }),
    wheelGem: new THREE.MeshBasicMaterial({ color: glow(0xff2a2a, 3) }),
  };
}

interface WheelSpinData {
  sectors: number;
  // Seconds of one eased spin, and of the rest after it.
  spinTime: number;
  restTime: number;
  bulbColor: ColorValue;
}

// The `wheelSpin` component: an eased spin of the rotor that lands on a sector, then a short rest.
// The bulbs run a chase while the wheel spins and pulse in pairs while it rests.
class WheelSpin {
  private readonly rotor: THREE.Object3D;
  private readonly bulbs: THREE.InstancedMesh;
  private readonly data: WheelSpinData;
  private readonly sectorStep: number;
  private readonly base = new THREE.Color();
  private readonly chase = new THREE.Color();
  private cycleTime = 0;
  private startAngle = 0;
  private spinDistance: number;

  constructor(rotor: THREE.Object3D, bulbs: THREE.InstancedMesh, data: WheelSpinData) {
    this.rotor = rotor;
    this.bulbs = bulbs;
    this.data = data;
    this.sectorStep = (Math.PI * 2) / data.sectors;
    this.spinDistance = Math.PI * 2 * 3 + this.sectorStep * 5;
    decodeColor(data.bulbColor, this.base);
  }

  step(dt: number, time: number, spinning: boolean): void {
    const { spinTime, restTime, sectors } = this.data;
    if (spinning) {
      this.cycleTime += dt;
      if (this.cycleTime > spinTime + restTime) {
        this.cycleTime -= spinTime + restTime;
        this.startAngle += this.spinDistance;
        this.spinDistance = Math.PI * 2 * (3 + Math.floor(Math.random() * 2)) + this.sectorStep * Math.floor(Math.random() * sectors);
      }
      const t = Math.min(this.cycleTime / spinTime, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      // Negative rotation turns the wheel clockwise for the viewer.
      this.rotor.rotation.z = -(this.startAngle + this.spinDistance * eased);
    }
    const resting = this.cycleTime > spinTime;
    for (let i = 0; i < this.bulbs.count; i++) {
      const wave = resting ? 0.5 + 0.5 * Math.sin(time * 5 + (i % 2) * Math.PI) : 0.5 + 0.5 * Math.sin(time * 9 - i * 0.7);
      this.chase.copy(this.base).multiplyScalar(0.7 + wave * 1.9);
      this.bulbs.setColorAt(i, this.chase);
    }
    if (this.bulbs.instanceColor) {
      this.bulbs.instanceColor.needsUpdate = true;
    }
  }
}

export { WheelSpin, createWheelMaterials };
export type { WheelSpinData };
