// Light masks derived from the studio plate, so the shader can light it and bring it to life.
//   R: polished gold: how strongly a surface throws back the light of the screen and the bolts
//   G: warm emitters: the frosted column lamps, their reflections and the ceiling downlights
//   B: LED strips: the base of the walls, the back step, the ceiling coves, and their reflections
//   A: unused

import { CEILING_Y, IMAGE_HEIGHT, IMAGE_WIDTH, LAMPS, LED_BAND } from "./calibration";

type PlateMasks = {
  data: Uint8Array;
  width: number;
  height: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
// Two separable box passes, close enough to a gaussian for a mask.
function blur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = radius * 2 + 1;
  const clampX = (x: number) => Math.min(width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, y));
  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? src : out;
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += from[y * width + clampX(x)] ?? 0;
      }
      for (let x = 0; x < width; x++) {
        tmp[y * width + x] = sum / size;
        sum += (from[y * width + clampX(x + radius + 1)] ?? 0) - (from[y * width + clampX(x - radius)] ?? 0);
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += tmp[clampY(y) * width + x] ?? 0;
      }
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / size;
        sum += (tmp[clampY(y + radius + 1) * width + x] ?? 0) - (tmp[clampY(y - radius) * width + x] ?? 0);
      }
    }
  }
  return out;
}

// Returns raw bytes, not a canvas: a 2D canvas premultiplies alpha and would wipe RGB where A is 0.
function buildPlateMasks(plate: HTMLImageElement): PlateMasks {
  const width = plate.naturalWidth;
  const height = plate.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(plate, 0, 0);
  const src = ctx.getImageData(0, 0, width, height).data;
  const scaleX = width / IMAGE_WIDTH;
  const scaleY = height / IMAGE_HEIGHT;
  // The lamps' own columns, top to bottom: their reflections are lamps, not LED light.
  const lampColumns = new Uint8Array(width);
  for (const entry of LAMPS) {
    const x0 = Math.floor(entry.box[0] * width) - Math.round(6 * scaleX);
    const x1 = Math.ceil(entry.box[2] * width) + Math.round(6 * scaleX);
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
      lampColumns[x] = 1;
    }
  }
  const bandTop = LED_BAND[0] * scaleY;
  const bandBottom = LED_BAND[1] * scaleY;
  const ceiling = CEILING_Y * scaleY;
  const count = width * height;
  const gold = new Float32Array(count);
  const emit = new Float32Array(count);
  const led = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const warmth = r - b;
    // LED strips burn saturated orange; the frosted lamps and downlights near white.
    const bright = smoothstep(150, 215, lum) * smoothstep(40, 110, warmth);
    const inBand = y > bandTop && y < bandBottom && lampColumns[x] === 0 ? 1 : 0;
    const inCeiling = y < ceiling ? smoothstep(90, 140, warmth) : 0;
    const strip = bright * Math.max(inBand, inCeiling);
    let hot = smoothstep(190, 245, lum) * (1 - strip);
    if (y < ceiling) {
      hot *= smoothstep(110, 60, warmth);
    }
    led[i] = strip;
    emit[i] = hot;
    gold[i] = smoothstep(30, 170, lum) * smoothstep(8, 60, warmth) * (1 - hot * 0.7) * (1 - strip);
  }
  // Emitters are small and bright; a light blur makes the masks cover their soft edges too.
  const emitSoft = blur(emit, width, height, 2);
  const ledSoft = blur(led, width, height, 1);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = (gold[i] ?? 0) * 255;
    data[i * 4 + 1] = Math.min(1, (emitSoft[i] ?? 0) * 1.4) * 255;
    data[i * 4 + 2] = Math.min(1, (ledSoft[i] ?? 0) * 1.3) * 255;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

export { buildPlateMasks };
export type { PlateMasks };
