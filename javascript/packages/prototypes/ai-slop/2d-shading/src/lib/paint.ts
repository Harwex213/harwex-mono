import { Graphics, Texture } from "pixi.js";
import { MAP_H, MAP_W, type Occluder, TILE } from "./scene";

const WIDTH = MAP_W * TILE;
const HEIGHT = MAP_H * TILE;

const GRASS_A = 0x3f5a3a;
const GRASS_B = 0x445f3e;
const WALL_FACE = 0x6a6f7b;
const WALL_TOP = 0x878d9b;
const PILLAR_FACE = 0x7d7466;
const PILLAR_TOP = 0x9c9282;

function paintGround(g: Graphics): void {
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const tint = (x + y) % 2 === 0 ? GRASS_A : GRASS_B;
      g.rect(x * TILE, y * TILE, TILE, TILE).fill(tint);
    }
  }
}

// Occluders are drawn above the shadow layer, so nothing ever shadows the box that
// cast it — the usual self-shadowing artifact is solved by paint order alone.
function paintOccluders(g: Graphics, boxes: Occluder[]): void {
  for (const box of boxes) {
    const tall = box.elev > 1;
    g.rect(box.x, box.y, box.w, box.h).fill(tall ? PILLAR_FACE : WALL_FACE);
    g.rect(box.x, box.y, box.w, Math.min(7, box.h)).fill(tall ? PILLAR_TOP : WALL_TOP);
  }
}

// A radial falloff, built once on a 2D canvas. Pixi has gradient fills, but a
// texture is what the light pass actually wants: one sprite, any radius, and a
// visibility polygon can mask it without touching the gradient itself. Pass
// "255, 255, 255" when the caller tints per light — tinting a warm texture cool
// gives a muddy result, because tint multiplies.
function radialTexture(size: number, rgb = "255, 244, 214"): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2d context unavailable");
  }
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.45, `rgba(${rgb}, 0.62)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export { HEIGHT, paintGround, paintOccluders, radialTexture, WIDTH };
