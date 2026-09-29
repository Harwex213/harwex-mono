// Light masks derived from the studio plate, so the shader can bring its fixtures to life.
//   R: red lights (neon blades, paper lanterns) and their floor reflections
//   G: warm lights (ceiling panels, shoji, stone lanterns, the plinth strip)
//   B: unused
//   A: the thick red blobs only, i.e. the paper lanterns

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
function buildPlateMasks(plate: HTMLCanvasElement): PlateMasks {
  const width = plate.width;
  const height = plate.height;
  const ctx = plate.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  const src = ctx.getImageData(0, 0, width, height).data;
  const count = width * height;
  const red = new Float32Array(count);
  const warm = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const redness = smoothstep(50, 150, r - Math.max(g, b)) * smoothstep(90, 200, r);
    red[i] = redness;
    warm[i] = smoothstep(140, 230, lum) * smoothstep(10, 60, r - b) * (1 - redness);
  }
  const redBlur = blur(red, width, height, 7);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = red[i] ?? 0;
    data[i * 4] = r * 255;
    data[i * 4 + 1] = (warm[i] ?? 0) * 255;
    data[i * 4 + 3] = smoothstep(0.45, 0.8, redBlur[i] ?? 0) * r * 255;
  }
  return { data, width, height };
}

export { buildPlateMasks };
export type { PlateMasks };
