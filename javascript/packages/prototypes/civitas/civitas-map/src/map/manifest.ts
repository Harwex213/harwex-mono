import { alphaOf, toHex, unpack } from "./colors";
import type { ProvinceLayer } from "./province-layer";

// Province geometry is derived from the layer, not tracked while painting. One
// pass over the mirror at export time cannot drift out of sync with the pixels,
// and per-stroke bookkeeping can.

type ProvinceKind = "land" | "sea" | "lake";

type ProvinceRecord = {
  id: number;
  name: string;
  kind: ProvinceKind;
  color: number;
};

type ColorStats = {
  color: number;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
};

type ProvinceEntry = {
  id: number;
  name: string;
  kind: ProvinceKind;
  hex: string;
  rgb: [number, number, number];
  pixelCount: number;
  bounds: { x: number; y: number; width: number; height: number };
  centroid: { x: number; y: number };
};

type Manifest = {
  format: string;
  version: number;
  map: {
    source: string;
    width: number;
    height: number;
  };
  provinces: ProvinceEntry[];
  painted: {
    pixelCount: number;
    coverage: number;
    unregisteredColors: string[];
  };
};

const FORMAT = "civitas.province-map";
const VERSION = 1;

function scanColors(layer: ProvinceLayer): Map<number, ColorStats> {
  const pixels = layer.readPixels();
  const stats = new Map<number, ColorStats>();

  for (let y = 0; y < layer.height; y += 1) {
    const row = y * layer.width;

    for (let x = 0; x < layer.width; x += 1) {
      const color = pixels[row + x];

      if (alphaOf(color) === 0) {
        continue;
      }

      const found = stats.get(color);

      if (!found) {
        stats.set(color, {
          color,
          pixelCount: 1,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
          sumX: x,
          sumY: y,
        });

        continue;
      }

      found.pixelCount += 1;
      found.minX = Math.min(found.minX, x);
      found.minY = Math.min(found.minY, y);
      found.maxX = Math.max(found.maxX, x);
      found.maxY = Math.max(found.maxY, y);
      found.sumX += x;
      found.sumY += y;
    }
  }

  return stats;
}

function buildManifest(
  layer: ProvinceLayer,
  provinces: readonly ProvinceRecord[],
  source: string,
): Manifest {
  const stats = scanColors(layer);
  const entries: ProvinceEntry[] = [];
  let paintedPixels = 0;

  for (const province of provinces) {
    const found = stats.get(province.color);
    const rgb = unpack(province.color);

    stats.delete(province.color);
    paintedPixels += found?.pixelCount ?? 0;

    entries.push({
      id: province.id,
      name: province.name,
      kind: province.kind,
      hex: toHex(rgb),
      rgb: [rgb.r, rgb.g, rgb.b],
      pixelCount: found?.pixelCount ?? 0,
      bounds: found
        ? {
            x: found.minX,
            y: found.minY,
            width: found.maxX - found.minX + 1,
            height: found.maxY - found.minY + 1,
          }
        : { x: 0, y: 0, width: 0, height: 0 },
      // Centre of mass, not centre of the bounding box: on a crescent-shaped
      // province the box centre can land outside the province entirely, and this
      // point is what a label or a unit marker would be placed on.
      centroid: found
        ? {
            x: Math.round(found.sumX / found.pixelCount),
            y: Math.round(found.sumY / found.pixelCount),
          }
        : { x: 0, y: 0 },
    });
  }

  // Anything left over is paint whose province was removed from the registry.
  // Reported instead of dropped, so a mismatch is visible in the export.
  const unregisteredColors: string[] = [];

  for (const leftover of stats.values()) {
    paintedPixels += leftover.pixelCount;
    unregisteredColors.push(toHex(unpack(leftover.color)));
  }

  return {
    format: FORMAT,
    version: VERSION,
    map: {
      source,
      width: layer.width,
      height: layer.height,
    },
    provinces: entries,
    painted: {
      pixelCount: paintedPixels,
      coverage: Number((paintedPixels / (layer.width * layer.height)).toFixed(6)),
      unregisteredColors,
    },
  };
}

export {
  buildManifest,
  scanColors,
  type ColorStats,
  type Manifest,
  type ProvinceEntry,
  type ProvinceKind,
  type ProvinceRecord,
};
