// The gold studio (src/brands/gold/assets/plate.jpg, from art/references/reference-2.png, 2688x1520).
// Measured on the pixels: the glass is dark blue marble, axis-aligned, inside a gold frame whose
// inner line steps into each corner. The screen replaces the glass pixels; the steps stay.

import plateUrl from "./assets/plate.jpg";
import { calibrate } from "../../core/calibration";
import type { Calibration, PlateSpec } from "../../core/calibration";
import { createLayers, lampColumns, packMasks, readPixels, smoothstep } from "../../core/masks";
import type { PlateMasks } from "../../core/masks";

const spec: PlateSpec = {
  width: 2688,
  height: 1520,
  // Pixel edges inside the dark groove that runs along the gold line.
  glass: { left: 757, right: 1903, top: 361, bottom: 1015 },
  notch: [9, 12],
  mirrorY: 1116,
  floorY: 1118,
  // Fitted to the gold inlay lines and the skirting LEDs.
  vanish: [1332, 928],
  // The four tall frosted lamps on the columns.
  lamps: [
    { box: [108, 280, 162, 910], base: 1044 },
    { box: [612, 455, 680, 950], base: 1046 },
    { box: [1984, 455, 2052, 950], base: 1046 },
    { box: [2500, 280, 2554, 910], base: 1044 },
  ],
};

// LED strips run along the base of the walls and the back step (this band of rows), and along
// the ceiling coves (above CEILING_Y). Rows in plate pixels.
const LED_BAND: [number, number] = [1035, 1330];
const CEILING_Y = 330;

function buildMasks(plate: HTMLImageElement, calibration: Calibration): PlateMasks {
  const { src, width, height } = readPixels(plate);
  const columns = lampColumns(calibration.lamps, width, 6 / spec.width);
  const scaleY = height / spec.height;
  const bandTop = LED_BAND[0] * scaleY;
  const bandBottom = LED_BAND[1] * scaleY;
  const ceiling = CEILING_Y * scaleY;
  const count = width * height;
  const layers = createLayers(count);
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
    const inBand = y > bandTop && y < bandBottom && columns[x] === 0 ? 1 : 0;
    const inCeiling = y < ceiling ? smoothstep(90, 140, warmth) : 0;
    const strip = bright * Math.max(inBand, inCeiling);
    let hot = smoothstep(190, 245, lum) * (1 - strip);
    if (y < ceiling) {
      hot *= smoothstep(110, 60, warmth);
    }
    layers.led[i] = strip;
    layers.emit[i] = hot;
    // Polished gold throws back the most light.
    layers.sheen[i] = smoothstep(30, 170, lum) * smoothstep(8, 60, warmth) * (1 - hot * 0.7) * (1 - strip);
  }
  return packMasks(layers, width, height);
}

const calibration = calibrate(spec);

export { buildMasks, calibration, plateUrl };
