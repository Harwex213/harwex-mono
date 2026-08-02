import { Texture } from "pixi.js";
import { HEIGHT, WIDTH } from "./paint";
import type { Occluder } from "./scene";

// Half screen resolution. The terrain is smooth, so a finer field buys nothing;
// what it would cost is the march, which samples this texture uSteps times per
// screen pixel.
const HF_SCALE = 2;
const HF_W = Math.round(WIDTH / HF_SCALE);
const HF_H = Math.round(HEIGHT / HF_SCALE);

// World height, in pixels, that a stored 1.0 stands for. The sun's slope is
// converted into the same unit, so this constant is the only place where "how tall
// is a wall" lives.
const H_MAX = 46;

type Heightfield = {
  width: number;
  height: number;
  data: Float32Array;
};

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Plain value noise: lattice values interpolated with a smoothstep. Enough for a
// rolling surface, and it keeps the package dependency-free.
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);

  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o += 1) {
    sum += valueNoise(x * freq, y * freq, seed + o * 101) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}

// Terrain plus stamped occluders. Walls and pillars land in the same buffer as the
// ground relief, which is the whole trick: one march shadows both, and neither one
// is geometry as far as the shader is concerned.
function buildHeightfield(boxes: Occluder[]): Heightfield {
  const data = new Float32Array(HF_W * HF_H);

  const scale = 1 / 42;
  for (let y = 0; y < HF_H; y += 1) {
    for (let x = 0; x < HF_W; x += 1) {
      const n = fbm(x * scale, y * scale, 0x51ede);
      data[y * HF_W + x] = n * 0.3;
    }
  }

  for (const box of boxes) {
    const h = box.elev > 1 ? 1 : 0.62;
    const x0 = Math.round(box.x / HF_SCALE);
    const y0 = Math.round(box.y / HF_SCALE);
    const x1 = Math.round((box.x + box.w) / HF_SCALE);
    const y1 = Math.round((box.y + box.h) / HF_SCALE);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (x < 0 || y < 0 || x >= HF_W || y >= HF_H) {
          continue;
        }
        data[y * HF_W + x] = h;
      }
    }
  }

  return { width: HF_W, height: HF_H, data };
}

function toCanvas(field: Heightfield, write: (h: number, x: number, y: number, out: Uint8ClampedArray, o: number) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2d context unavailable");
  }
  const image = ctx.createImageData(field.width, field.height);
  for (let y = 0; y < field.height; y += 1) {
    for (let x = 0; x < field.width; x += 1) {
      const i = y * field.width + x;
      write(field.data[i], x, y, image.data, i * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

// Height in R, 8 bits — 1/256 of H_MAX is ~0.18 px of world height, which is below
// what the march can resolve anyway.
function heightTexture(field: Heightfield): Texture {
  return toCanvas(field, (h, _x, _y, out, o) => {
    const v = Math.round(Math.max(0, Math.min(1, h)) * 255);
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  });
}

// The visible ground: colour by height only. Baking a directional shade here would
// fight the march, which is the thing that is supposed to provide direction.
function terrainTexture(field: Heightfield): Texture {
  return toCanvas(field, (h, _x, _y, out, o) => {
    const t = Math.max(0, Math.min(1, h / 0.3));
    out[o] = Math.round(52 + 92 * t);
    out[o + 1] = Math.round(80 + 62 * t);
    out[o + 2] = Math.round(48 + 44 * t);
    out[o + 3] = 255;
  });
}

export { buildHeightfield, heightTexture, HF_H, HF_W, H_MAX, terrainTexture };
export type { Heightfield };
