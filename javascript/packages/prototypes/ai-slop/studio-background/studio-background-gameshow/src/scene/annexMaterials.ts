import * as THREE from "three";
import { glow } from "./materials";

// The materials of the Game Show balcony (the `Annex` objects of the scene file) and of its dressing: the palette of the casino photo
// (warm black, deep bronze, amber gold). Each has its own name, so an edit to them leaves the amphitheatre alone.
// The lit ones carry `userData.ownEnvironment`: the material library gives them the warm casino environment
// as their own map, and the editor lighting swaps that map for its even sky (editorLighting.ts).

// The balcony materials, in the palette of the casino photo: warm black, deep bronze, amber gold.
// Each has its own name, so the editor saves it apart from the studio materials.
// `userData.ownEnvironment`: the engine gives the material the casino environment as its own map,
// and the editor lighting swaps that map for its even sky (editorLighting.ts).
function createAnnexMaterials() {
  const materials = {
    annexGold: new THREE.MeshStandardMaterial({ color: 0xe0b060, metalness: 1, roughness: 0.28 }),
    annexBronze: new THREE.MeshStandardMaterial({ color: 0xa87a3a, metalness: 1, roughness: 0.36 }),
    annexLacquer: new THREE.MeshStandardMaterial({ color: 0x1e130b, metalness: 0.3, roughness: 0.3 }),
    annexFascia: new THREE.MeshStandardMaterial({ color: 0x160e08, metalness: 0.2, roughness: 0.5 }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
    material.userData.ownEnvironment = true;
  }
  return materials;
}

// One texture tile of the floor marble spans this many metres.
const VEIN_TILE = 7;

// A small seeded random generator, so the veins are the same on every load.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warm black marble with gold veins, as one tile that repeats without seams.
// The clouds are sums of sines with whole periods per tile; each vein is drawn nine times, shifted by one tile,
// so a vein that leaves the tile on one side comes back on the other side.
function createVeinTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("cannot draw the marble");
  }
  const image = context.createImageData(size, size);
  const dark = [12, 7, 4];
  const light = [40, 25, 14];
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const cloud = 0.5 + 0.25 * Math.sin(2 * u + 1.3 * Math.sin(3 * v)) + 0.15 * Math.sin(5 * v + 2 * Math.sin(2 * u)) + 0.1 * Math.sin(7 * (u + v));
      const k = THREE.MathUtils.clamp(cloud, 0, 1) ** 1.6;
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        image.data[index + channel] = (dark[channel] as number) + ((light[channel] as number) - (dark[channel] as number)) * k;
      }
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const random = seededRandom(7);
  const veins: { points: THREE.Vector2[]; width: number; alpha: number }[] = [];
  const walk = (start: THREE.Vector2, heading: number, steps: number, width: number, alpha: number, depth: number) => {
    const points = [start.clone()];
    let angle = heading;
    const point = start.clone();
    for (let i = 0; i < steps; i++) {
      angle += (random() - 0.5) * 0.35;
      // The veins keep a main direction across the slab, like a cut block of marble.
      angle += (heading - angle) * 0.15;
      point.x += Math.cos(angle) * 14;
      point.y += Math.sin(angle) * 14;
      points.push(point.clone());
      if (depth < 2 && random() < 0.04) {
        walk(point, angle + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.6), Math.floor(steps * 0.4), width * 0.55, alpha * 0.8, depth + 1);
      }
    }
    veins.push({ points, width, alpha });
  };
  for (let i = 0; i < 9; i++) {
    walk(new THREE.Vector2(random() * size, random() * size), 0.6 + (random() - 0.5) * 0.5, 40 + Math.floor(random() * 40), 1 + random() * 1.6, 0.4 + random() * 0.4, 0);
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const vein of veins) {
        context.beginPath();
        vein.points.forEach((point, index) => {
          if (index === 0) {
            context.moveTo(point.x + dx * size, point.y + dy * size);
          } else {
            context.lineTo(point.x + dx * size, point.y + dy * size);
          }
        });
        // A soft halo first, then the thin gold line.
        context.strokeStyle = `rgba(150, 100, 50, ${vein.alpha * 0.1})`;
        context.lineWidth = vein.width * 7;
        context.stroke();
        context.strokeStyle = `rgba(200, 150, 80, ${vein.alpha * 0.6})`;
        context.lineWidth = vein.width;
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// Turns the annex part of the studio floor (`marbleFloorAnnex`, the balcony part of `Studio/Floor` in the scene file) into the balcony marble:
// warm black with gold veins. The floor plan UVs are in metres (ShapeGeometry), so the tile repeats every VEIN_TILE metres.
// The engine gives it the casino environment as its own map.
function styleAnnexFloor(material: THREE.MeshStandardMaterial): void {
  const veins = createVeinTexture();
  veins.repeat.set(1 / VEIN_TILE, 1 / VEIN_TILE);
  material.color.set(0xffffff);
  material.map = veins;
  material.envMapIntensity = 0.35;
  material.needsUpdate = true;
}

// The materials of the balcony dressing. The standard ones take the casino environment; the glowing ones are unlit.
function createDressingMaterials() {
  const lit = {
    annexVelvet: new THREE.MeshPhysicalMaterial({
      color: 0x4a0712,
      roughness: 0.85,
      sheen: 1,
      sheenColor: new THREE.Color(0xff4a3a),
      sheenRoughness: 0.45,
    }),
    annexCarpet: new THREE.MeshStandardMaterial({ map: createCarpetTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }),
    annexLeaf: new THREE.MeshStandardMaterial({ color: 0x2a5a22, roughness: 0.55, side: THREE.DoubleSide }),
    annexTrunk: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.85 }),
    annexGlass: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.4 }),
    annexBottle: new THREE.MeshStandardMaterial({ color: 0x0c2014, roughness: 0.15, metalness: 0.2 }),
  };
  const unlit = {
    annexLed: new THREE.MeshBasicMaterial({ color: glow(0xffa548, 1.8) }),
    annexBulb: new THREE.MeshBasicMaterial({ color: glow(0xffe2a8, 3) }),
    annexGlobe: new THREE.MeshBasicMaterial({ color: glow(0xffa040, 1.25) }),
    annexBuzzer: new THREE.MeshBasicMaterial({ color: glow(0xff3020, 1.6) }),
    annexTally: new THREE.MeshBasicMaterial({ color: glow(0xff2010, 2.5) }),
    annexSoftbox: new THREE.MeshBasicMaterial({ color: glow(0xffe4c0, 0.85) }),
    annexSign: new THREE.MeshBasicMaterial({ map: createSignTexture(), color: glow(0xffffff, 1.6) }),
    annexMonogram: new THREE.MeshBasicMaterial({ map: createPanelTexture("B"), color: glow(0xffffff, 1.4) }),
    annexPodium1: new THREE.MeshBasicMaterial({ map: createPanelTexture("1"), color: glow(0xffffff, 1.4) }),
    annexPodium2: new THREE.MeshBasicMaterial({ map: createPanelTexture("2"), color: glow(0xffffff, 1.4) }),
  };
  for (const [name, material] of Object.entries(lit)) {
    material.name = name;
    material.userData.ownEnvironment = true;
  }
  for (const [name, material] of Object.entries(unlit)) {
    material.name = name;
  }
  return { ...lit, ...unlit, lit: Object.values(lit) };
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2d canvas is unavailable");
  }
  return { canvas, context };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// The carpet runner: burgundy with a gold border, a black band inside it and gold diamonds down the middle.
// The canvas has the proportions of the runner (about 1.8 m by 4.7 m).
function createCarpetTexture(): THREE.CanvasTexture {
  const width = 400;
  const height = 1000;
  const { canvas, context } = canvas2d(width, height);
  context.fillStyle = "#4e0c14";
  context.fillRect(0, 0, width, height);
  // Border: a gold line, a black band, a thin gold line.
  context.fillStyle = "#b8893e";
  context.fillRect(10, 10, width - 20, height - 20);
  context.fillStyle = "#170708";
  context.fillRect(18, 18, width - 36, height - 36);
  context.fillStyle = "#9a7232";
  context.fillRect(44, 44, width - 88, height - 88);
  context.fillStyle = "#4e0c14";
  context.fillRect(48, 48, width - 96, height - 96);
  // Diamonds down the middle, joined by a fine lattice.
  context.strokeStyle = "rgba(184, 137, 62, 0.55)";
  context.lineWidth = 3;
  const step = 150;
  for (let y = 48 + step / 2; y < height - 48; y += step) {
    context.beginPath();
    context.moveTo(width / 2, y - step / 2);
    context.lineTo(width / 2 + 120, y);
    context.lineTo(width / 2, y + step / 2);
    context.lineTo(width / 2 - 120, y);
    context.closePath();
    context.stroke();
    context.fillStyle = "#b8893e";
    context.beginPath();
    context.moveTo(width / 2, y - 34);
    context.lineTo(width / 2 + 26, y);
    context.lineTo(width / 2, y + 34);
    context.lineTo(width / 2 - 26, y);
    context.closePath();
    context.fill();
    context.fillStyle = "#170708";
    context.beginPath();
    context.arc(width / 2, y, 9, 0, Math.PI * 2);
    context.fill();
  }
  const texture = toTexture(canvas);
  return texture;
}

// The marquee sign face: gold serif letters on a dark burgundy ground, with a fine gold inner line.
function createSignTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 440;
  const { canvas, context } = canvas2d(width, height);
  const ground = context.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, "#1c0508");
  ground.addColorStop(0.5, "#2c080e");
  ground.addColorStop(1, "#1c0508");
  context.fillStyle = ground;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#8a6428";
  context.lineWidth = 6;
  context.strokeRect(26, 26, width - 52, height - 52);
  const letters = context.createLinearGradient(0, 80, 0, 360);
  letters.addColorStop(0, "#fff0c0");
  letters.addColorStop(0.55, "#f2c060");
  letters.addColorStop(1, "#b07a28");
  context.fillStyle = letters;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 150px Georgia, serif";
  context.fillText("BONUS", width / 2, 150);
  context.font = "bold 118px Georgia, serif";
  context.fillText("SHOW", width / 2, 300);
  // Small stars on both sides of the lower word.
  context.fillStyle = "#f2c060";
  for (const x of [190, width - 190]) {
    context.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? 30 : 12;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      context.lineTo(x + Math.cos(angle) * radius, 300 + Math.sin(angle) * radius);
    }
    context.closePath();
    context.fill();
  }
  return toTexture(canvas);
}

// A podium or lectern panel: a gold glyph in a gold ring on a dark burgundy ground.
function createPanelTexture(glyph: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, context } = canvas2d(size, size * 1.5);
  context.fillStyle = "#24060b";
  context.fillRect(0, 0, size, size * 1.5);
  context.strokeStyle = "#b8893e";
  context.lineWidth = 5;
  context.strokeRect(12, 12, size - 24, size * 1.5 - 24);
  context.beginPath();
  context.arc(size / 2, size * 0.75, 82, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#f4c870";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 120px Georgia, serif";
  context.fillText(glyph, size / 2, size * 0.75 + 6);
  return toTexture(canvas);
}

export { createAnnexMaterials, createDressingMaterials, styleAnnexFloor };
