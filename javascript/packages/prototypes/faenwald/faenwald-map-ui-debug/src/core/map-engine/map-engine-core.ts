import { TProvincesMap } from "./map-types";
import { getPixelHex } from "./utils";

const BORDER_HALF_WIDTH = 1;
const DIRS_8 = [-1, 0, 1];

export function buildAllHoverBorders(
  imageData: ImageData,
  provincesMap: TProvincesMap,
): Map<string, OffscreenCanvas> {
  const { data, width, height } = imageData;
  const totalPixels = width * height;

  // Pass 1: find border pixels for ALL provinces in one scan
  // Store the province color for each border pixel (empty string = not a border)
  const borderPixelColor = new Array<string>(totalPixels).fill("");

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = getPixelHex(data, x, y, width);
      if (color === "#ffffff" || !(color in provincesMap)) continue;

      let border = false;
      outer: for (const dy of DIRS_8) {
        for (const dx of DIRS_8) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            border = true;
            break outer;
          }
          if (getPixelHex(data, nx, ny, width) !== color) {
            border = true;
            break outer;
          }
        }
      }

      if (border) borderPixelColor[y * width + x] = color;
    }
  }

  // Pass 2: dilate and collect pixel indices per color
  const colorToPixels = new Map<string, number[]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = borderPixelColor[y * width + x];
      if (!color) continue;

      for (let dy = -BORDER_HALF_WIDTH; dy <= BORDER_HALF_WIDTH; dy++) {
        for (let dx = -BORDER_HALF_WIDTH; dx <= BORDER_HALF_WIDTH; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          let pixels = colorToPixels.get(color);
          if (!pixels) {
            pixels = [];
            colorToPixels.set(color, pixels);
          }
          pixels.push((ny * width + nx) * 4);
        }
      }
    }
  }

  // Pass 3: build one OffscreenCanvas per province color
  const result = new Map<string, OffscreenCanvas>();

  for (const [color, pixels] of colorToPixels) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(width, height);
    const out = imgData.data;

    for (const i of pixels) {
      out[i] = 255;
      out[i + 1] = 220;
      out[i + 2] = 0;
      out[i + 3] = 230;
    }

    ctx.putImageData(imgData, 0, 0);
    result.set(color, canvas);
  }

  return result;
}

export function buildAllHighlights(
  imageData: ImageData,
  provincesMap: TProvincesMap,
  dilatedMask: Uint8Array,
): Map<string, OffscreenCanvas> {
  const { data, width, height } = imageData;

  // Single pass: collect non-border pixel indices per color
  const colorToPixels = new Map<string, number[]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (dilatedMask[idx]) continue;

      const color = getPixelHex(data, x, y, width);
      if (color === "#ffffff" || !(color in provincesMap)) continue;

      let pixels = colorToPixels.get(color);
      if (!pixels) {
        pixels = [];
        colorToPixels.set(color, pixels);
      }
      pixels.push(idx * 4);
    }
  }

  const result = new Map<string, OffscreenCanvas>();

  for (const [color, pixels] of colorToPixels) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    const hlData = ctx.createImageData(width, height);
    const hd = hlData.data;

    for (const i of pixels) {
      hd[i] = 255;
      hd[i + 1] = 220;
      hd[i + 2] = 80;
      hd[i + 3] = 89;
    }

    ctx.putImageData(hlData, 0, 0);
    result.set(color, canvas);
  }

  return result;
}
