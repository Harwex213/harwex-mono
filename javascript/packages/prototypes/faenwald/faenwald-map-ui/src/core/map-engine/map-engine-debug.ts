import { getPixelHex } from "./utils";
import type { TProvincesMap } from "./map-types";

export function findUniqueColors(imageData: ImageData): void {
  const { data, width, height } = imageData;
  const colors = new Set<string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      colors.add(getPixelHex(data, x, y, width));
    }
  }

  const result = Array.from(colors);

  const provinces = result.reduce<Record<string, object>>((provincesMap, color, index) => {
    provincesMap[color] = {
      provinceId: self.crypto.randomUUID(),
      provinceName: `Province ${index}`,
      center: null,
    }

    return provincesMap;
  }, {});

  console.log(JSON.stringify(provinces, null, 2));
}

export function findDuplicateAresAndHighlightThem(imageData: ImageData): OffscreenCanvas {
  const { data, width, height } = imageData;
  const totalPixels = width * height;

  // Connected component labeling via flood fill
  const regionLabel = new Int32Array(totalPixels).fill(-1);
  const colorToRegionCount = new Map<string, number>();
  let currentLabel = 0;

  const DIRS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (regionLabel[idx] !== -1) continue;

      const color = getPixelHex(data, x, y, width);
      if (color === "#ffffff") continue;

      // BFS flood fill for this region
      const queue: number[] = [idx];
      regionLabel[idx] = currentLabel;

      let head = 0;
      while (head < queue.length) {
        const ci = queue[head++];
        const cx = ci % width;
        const cy = (ci - cx) / width;

        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (regionLabel[ni] !== -1) continue;
          if (getPixelHex(data, nx, ny, width) !== color) continue;
          regionLabel[ni] = currentLabel;
          queue.push(ni);
        }
      }

      currentLabel++;
      colorToRegionCount.set(color, (colorToRegionCount.get(color) ?? 0) + 1);
    }
  }

  // Collect duplicate colors and assign each a random highlight color
  const duplicateColorToHighlight = new Map<string, [number, number, number]>();
  for (const [color, count] of colorToRegionCount) {
    if (count > 1) {
      duplicateColorToHighlight.set(color, [
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
      ]);
    }
  }

  console.log("Duplicate colors:", Array.from(duplicateColorToHighlight.keys()));

  // Build highlight canvas for duplicate regions
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const hlData = ctx.createImageData(width, height);
  const hd = hlData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = getPixelHex(data, x, y, width);
      const hl = duplicateColorToHighlight.get(color);
      if (hl) {
        const i = (y * width + x) * 4;
        hd[i] = hl[0];
        hd[i + 1] = hl[1];
        hd[i + 2] = hl[2];
        hd[i + 3] = 120;
      }
    }
  }

  ctx.putImageData(hlData, 0, 0);
  return canvas;
}

export function assignProvinceCentroid(imageData: ImageData, provinces: TProvincesMap) {
  const { data, width, height } = imageData;

  const sums = new Map<string, { sumX: number; sumY: number; count: number }>();

  for (const color of Object.keys(provinces)) {
    sums.set(color, { sumX: 0, sumY: 0, count: 0 });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = getPixelHex(data, x, y, width);
      const acc = sums.get(color);
      if (!acc) continue;

      acc.sumX += x;
      acc.sumY += y;
      acc.count++;
    }
  }

  for (const [color, { sumX, sumY, count }] of sums) {
    if (count === 0) continue;
    provinces[color].center = [Math.round(sumX / count), Math.round(sumY / count)];
  }

  console.log(JSON.stringify(provinces, null, 2));
}
