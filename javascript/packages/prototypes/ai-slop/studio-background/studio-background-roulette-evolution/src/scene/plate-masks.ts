// Light masks derived from the studio plate, so the shader can bring its fixtures to life.
//   R: lamps: the gold cove light of the ceiling and the warm halo around the glass
//   G: polished gold metal (columns, wall reliefs, trims, floor inlay)
//   B: the hot emitters: the bright core of the LED coves and the downlight bulbs
//   A: unused

import { COVE_BOTTOM_Y, DOWNLIGHTS, HALO_RECT, SCREEN_CORNERS } from "./calibration";

type PlateMasks = {
  data: Uint8Array;
  width: number;
  height: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The ceiling: above the cove row in the middle, above the coffer edges that climb to the corners.
function ceilingWeight(u: number, v: number): number {
  const side = Math.max(0, Math.max(0.235 - u, u - 0.765));
  const limit = COVE_BOTTOM_Y - side * 1.33;
  return 1 - smoothstep(limit - 0.004, limit + 0.004, v);
}

// A ring around the glass, outside it: the halo light box.
function haloWeight(u: number, v: number): number {
  const [x0, y0, x1, y1] = HALO_RECT;
  const [g0, , g2] = SCREEN_CORNERS;
  const inRing = u > x0 && u < x1 && v > y0 && v < y1;
  const inGlass = u > g0[0] && u < g2[0] && v > g0[1] && v < g2[1];
  return inRing && !inGlass ? 1 : 0;
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
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const u = ((i % width) + 0.5) / width;
    const v = (Math.floor(i / width) + 0.5) / height;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const warmth = smoothstep(15, 70, r - b);
    const lampArea = Math.max(ceilingWeight(u, v), haloWeight(u, v));
    // The halo glow is dimmer than the cove, so it gets a lower threshold.
    const lampFloor = haloWeight(u, v) > 0 ? 35 : 70;
    const lamp = smoothstep(lampFloor, 200, lum) * warmth * lampArea;
    const metal = smoothstep(45, 170, lum) * warmth * (1 - lampArea);
    // A bulb is a few pixels wide; its disc counts as hot wherever it is bright.
    let bulb = 0;
    for (const [bx, by] of DOWNLIGHTS) {
      const dx = (u - bx) * width;
      const dy = (v - by) * height;
      bulb = Math.max(bulb, 1 - smoothstep(4, 9, Math.hypot(dx, dy)));
    }
    const hot = Math.max(smoothstep(150, 235, lum) * warmth * ceilingWeight(u, v), smoothstep(120, 220, lum) * bulb);
    data[i * 4] = lamp * 255;
    data[i * 4 + 1] = metal * 255;
    data[i * 4 + 2] = hot * 255;
  }
  return { data, width, height };
}

export { buildPlateMasks };
export type { PlateMasks };
