import { getPixelHex } from "./utils";

export function buildHighlight(
  imageData: ImageData,
  color: string,
  dilatedMask: Uint8Array,
): OffscreenCanvas {
  const { data, width, height } = imageData;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const hlData = ctx.createImageData(width, height);
  const hd = hlData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (dilatedMask[idx]) {
        continue;
      }

      if (getPixelHex(data, x, y, width) === color) {
        // TODO: refactor magic numbers
        const i = idx * 4;
        hd[i] = 255;
        hd[i + 1] = 220;
        hd[i + 2] = 80;
        hd[i + 3] = 89; // ~0.35 opacity
      }
    }
  }

  ctx.putImageData(hlData, 0, 0);

  return canvas;
}
