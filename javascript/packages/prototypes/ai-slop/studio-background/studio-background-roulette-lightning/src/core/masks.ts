// Light masks derived from a background plate, so the shader can light the plate and bring it to life.
//   R: sheen: how strongly a surface throws back the light of the screen and the bolts
//   G: warm emitters: tall lamps, their reflections and the ceiling downlights
//   B: LED strips: they chase towards the screen along the floor and ceiling lines
//   A: magma: glowing cracks where lava creeps and breathes

import type { Lamp } from "./calibration";

type PlateMasks = {
  data: Uint8Array;
  width: number;
  height: number;
};

// Mask values per pixel, 0..1.
type MaskLayers = {
  sheen: Float32Array;
  emit: Float32Array;
  led: Float32Array;
  magma: Float32Array;
};

type PlatePixels = {
  src: Uint8ClampedArray;
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

function readPixels(plate: HTMLImageElement): PlatePixels {
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
  return { src: ctx.getImageData(0, 0, width, height).data, width, height };
}

// Marks the columns of the lamps, from the ceiling to the bottom of the plate: a lamp's
// reflection is lamp light too, not LED light. Margin is in UV.
function lampColumns(lamps: Lamp[], width: number, margin: number): Uint8Array {
  const columns = new Uint8Array(width);
  for (const entry of lamps) {
    const x0 = Math.floor((entry.box[0] - margin) * width);
    const x1 = Math.ceil((entry.box[2] + margin) * width);
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
      columns[x] = 1;
    }
  }
  return columns;
}

function createLayers(count: number): MaskLayers {
  return {
    sheen: new Float32Array(count),
    emit: new Float32Array(count),
    led: new Float32Array(count),
    magma: new Float32Array(count),
  };
}

// Emitters are small and bright; a light blur makes the masks cover their soft edges too.
// Returns raw bytes, not a canvas: a 2D canvas premultiplies alpha and would wipe RGB where A is 0.
function packMasks(layers: MaskLayers, width: number, height: number): PlateMasks {
  const count = width * height;
  const emitSoft = blur(layers.emit, width, height, 2);
  const ledSoft = blur(layers.led, width, height, 1);
  const magmaSoft = blur(layers.magma, width, height, 1);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = (layers.sheen[i] ?? 0) * 255;
    data[i * 4 + 1] = Math.min(1, (emitSoft[i] ?? 0) * 1.4) * 255;
    data[i * 4 + 2] = Math.min(1, (ledSoft[i] ?? 0) * 1.3) * 255;
    data[i * 4 + 3] = Math.min(1, (magmaSoft[i] ?? 0) * 1.2) * 255;
  }
  return { data, width, height };
}

export type { MaskLayers, PlateMasks, PlatePixels };

export { createLayers, lampColumns, packMasks, readPixels, smoothstep };
