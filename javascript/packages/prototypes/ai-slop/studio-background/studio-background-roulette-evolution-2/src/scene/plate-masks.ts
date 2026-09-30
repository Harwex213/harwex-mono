// Light masks derived from the studio plate, so the shader can light the room with the wall.
//   R: the lit gold coves and hot highlights, i.e. the light sources of the plate
//   G: polished gold metal (pillar rings, wall inlays, floor lines, frame); it mirrors light
//   B: the ceiling LED strips alone, the part of R that really emits light
//   A: unused

import { DOWNLIGHTS, LED_ZONES } from "./calibration";

type PlateMasks = {
  data: Uint8Array;
  width: number;
  height: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Returns raw bytes, not a canvas: a 2D canvas premultiplies alpha and would wipe RGB where A is 0.
function buildPlateMasks(image: HTMLImageElement): PlateMasks {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(image, 0, 0);
  const src = ctx.getImageData(0, 0, width, height).data;
  const count = width * height;
  const data = new Uint8Array(count * 4);
  const zones = LED_ZONES.map(([x0, y0, x1, y1]) => [x0 * width, y0 * height, x1 * width, y1 * height]);
  // The downlights get their own treatment in the shader; keep them out of the strip mask.
  const lamps = DOWNLIGHTS.map(([x, y]) => [x * width, y * height]);
  const isLed = (x: number, y: number): boolean => {
    const inZone = zones.some(([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    const nearLamp = lamps.some(([lx = 0, ly = 0]) => Math.hypot(x - lx, y - ly) < 12);
    return inZone && !nearLamp;
  };
  for (let i = 0; i < count; i++) {
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const source = smoothstep(170, 235, lum);
    const gold = smoothstep(15, 60, r - b) * smoothstep(35, 110, lum) * (1 - source);
    data[i * 4] = source * 255;
    data[i * 4 + 1] = gold * 255;
    if (source > 0) {
      data[i * 4 + 2] = isLed(i % width, Math.floor(i / width)) ? source * 255 : 0;
    }
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

export { buildPlateMasks };
export type { PlateMasks };
