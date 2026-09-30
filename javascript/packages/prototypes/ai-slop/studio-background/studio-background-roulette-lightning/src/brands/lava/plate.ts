// The lava hall (src/brands/lava/assets/plate.jpg, from art/references/lava-hall.png, 2000x1131).
// Black faceted stone split by glowing lava cracks, orange neon lamps on the columns and a
// polished black floor with orange inlay lines. The glass is a plain black rectangle.

import plateUrl from "./assets/plate.jpg";
import { calibrate } from "../../core/calibration";
import type { Calibration, PlateSpec } from "../../core/calibration";
import { createLayers, lampColumns, packMasks, readPixels, smoothstep } from "../../core/masks";
import type { PlateMasks } from "../../core/masks";
import { traceLines } from "./lines";
import type { LineMap } from "./lines";

const spec: PlateSpec = {
  width: 2000,
  height: 1131,
  // Pixel edges of the black glass, inside the thin grey bezel.
  glass: { left: 568, right: 1433, top: 198, bottom: 686 },
  notch: [0, 0],
  // The orange line of the back step.
  mirrorY: 748,
  floorY: 752,
  // The diagonal floor lines meet on the horizon at this point; the room is centred on it.
  vanish: [1000, 696],
  // The neon lamps, from the outer thin tubes to the short lamps beside the screen.
  lamps: [
    { box: [124, 85, 134, 612], base: 738 },
    { box: [258, 192, 286, 606], base: 736 },
    { box: [465, 312, 498, 596], base: 737 },
    { box: [1502, 312, 1537, 596], base: 737 },
    { box: [1705, 192, 1744, 607], base: 736 },
    { box: [1868, 85, 1878, 612], base: 738 },
  ],
};

// The ceiling coves and the downlights sit above this row; the floor and the back step below FLOOR_TOP.
// Rows in plate pixels.
const CEILING_Y = 160;
const FLOOR_TOP = 738;

type LavaPlate = {
  masks: PlateMasks;
  lines: LineMap;
};

function buildPlate(plate: HTMLImageElement, calibration: Calibration): LavaPlate {
  const { src, width, height } = readPixels(plate);
  const columns = lampColumns(calibration.lamps, width, 4 / spec.width);
  const scaleY = height / spec.height;
  const ceiling = CEILING_Y * scaleY;
  const floor = FLOOR_TOP * scaleY;
  const count = width * height;
  const layers = createLayers(count);
  // Inlay lines burn bright orange; the lava cracks are darker red.
  const isLine = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const warmth = r - b;
    const inLamp = columns[x] === 1;
    const inRoom = y > floor || y < ceiling;
    if (inLamp) {
      // The neon glass and its orange rim.
      layers.emit[i] = smoothstep(110, 210, lum);
    } else if (y < ceiling) {
      // Downlights in the ceiling are near white.
      layers.emit[i] = smoothstep(190, 240, lum) * smoothstep(100, 180, b);
    }
    if (!inLamp && inRoom && r > 140 && warmth > 90 && layers.emit[i] === 0) {
      isLine[i] = 1;
    }
  }
  const lines = traceLines(isLine, width, height);
  for (let i = 0; i < count; i++) {
    const y = Math.floor(i / width);
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const warmth = r - b;
    const emit = layers.emit[i] ?? 0;
    // Every ceiling line is an LED. On the floor only the traced lines are: the rest of the bright
    // floor is the reflection of the lamps and the step, and it stays as the plate shows it.
    const strip = (y < ceiling && isLine[i] === 1) || lines.onLine[i] === 1 ? 1 : 0;
    layers.led[i] = strip;
    // Lava: saturated red-orange light that is not a lamp or an LED line.
    const saturated = smoothstep(0.75, 0.45, g / Math.max(r, 1));
    const reflected = isLine[i] === 1 && strip === 0 ? 1 : 0;
    const magma = smoothstep(35, 120, r) * smoothstep(30, 90, warmth) * saturated * (1 - strip) * (1 - emit) * (1 - reflected);
    layers.magma[i] = magma;
    // Polished black stone: the lit facets throw light back, the lights themselves do not.
    layers.sheen[i] = 0.8 * smoothstep(8, 90, lum) * (1 - emit) * (1 - strip) * (1 - 0.8 * magma);
  }
  return { masks: packMasks(layers, width, height), lines };
}

const calibration = calibrate(spec);

export type { LavaPlate };

export { CEILING_Y, buildPlate, calibration, plateUrl };
