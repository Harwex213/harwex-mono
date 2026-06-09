import { createNoise2D } from "simplex-noise";
import { MAP_CONFIG } from "@/config/map";
import { TileType, ObjectType } from "@/core/types";
import type { GameMap } from "@/core/types";

function makeSeededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function octaveNoise(
  noise: (x: number, y: number) => number,
  nx: number,
  ny: number,
): number {
  let value =
    1.0 * noise(1 * nx, 1 * ny) +
    0.5 * noise(2 * nx, 2 * ny) +
    0.25 * noise(4 * nx, 4 * ny);
  value = value / (1.0 + 0.5 + 0.25);
  // Normalize from [-1, 1] to [0, 1]
  value = (value + 1) / 2;
  return value;
}

function generateMap(seed?: number): GameMap {
  const { width, height, mountainThreshold, treeThreshold, stoneThreshold } =
    MAP_CONFIG;

  const resolvedSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const rng1 = makeSeededRandom(resolvedSeed);
  const rng2 = makeSeededRandom(resolvedSeed + 1);
  const rng3 = makeSeededRandom(resolvedSeed + 2);
  const rng4 = makeSeededRandom(resolvedSeed + 3);

  const elevationNoise = createNoise2D(rng1);
  const moistureNoise = createNoise2D(rng2);
  const ridgeNoise = createNoise2D(rng3);
  const warpNoise = createNoise2D(rng4);

  const scale = 0.03;
  const ridgeScale = 0.04;
  const warpScale = 0.02;
  const warpStrength = 30;
  const exponent = 1.2;

  const map: GameMap = [];

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const nx = x * scale;
      const ny = y * scale;

      // Base elevation — large terrain features
      let elevation = octaveNoise(elevationNoise, nx, ny);

      // Domain warping — distorts ridge coordinates to break closed loops
      const warpX = octaveNoise(warpNoise, x * warpScale, y * warpScale) * warpStrength;
      const warpY = octaveNoise(warpNoise, x * warpScale + 100, y * warpScale + 100) * warpStrength;

      // Ridge noise — creates mountain chains with natural passes
      const rnx = (x + warpX) * ridgeScale;
      const rny = (y + warpY) * ridgeScale;
      let ridge = octaveNoise(ridgeNoise, rnx, rny);
      ridge = 1 - Math.abs(ridge * 2 - 1);
      ridge = Math.pow(ridge, 2.5);

      // Blend: base terrain shapes + ridge chains
      elevation = elevation * 0.6 + ridge * 0.4;
      elevation = Math.pow(elevation, exponent);

      const moisture = octaveNoise(moistureNoise, nx, ny);

      const type =
        elevation >= mountainThreshold ? TileType.Mountain : TileType.FertileLand;

      let object = null;
      if (type === TileType.FertileLand && moisture > treeThreshold) {
        object = ObjectType.Tree;
      } else if (type === TileType.Mountain && moisture < stoneThreshold) {
        object = ObjectType.Stone;
      }

      row.push({ type, object });
    }
    map.push(row);
  }

  return map;
}

export { generateMap };
