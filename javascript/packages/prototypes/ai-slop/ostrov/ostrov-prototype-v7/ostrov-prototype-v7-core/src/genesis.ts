import { biomes } from "./biome";
import type { BiomeId } from "./biome";
import { Hex } from "./hex";
import { Island } from "./island";
import { pick } from "./random";
import type { Random } from "./random";
import { World } from "./world";
import { WorldHex } from "./world-hex";

const ringSizes: readonly number[] = [1, 6, 12];

const biomeIds = (): readonly BiomeId[] => {
  return biomes.map((biome) => {
    return biome.id;
  });
};

const createIsland = (random: Random, size: number = 19): Island => {
  const ids = biomeIds();

  const hexes = Array.from({ length: size }, (_, index) => {
    return new Hex(`hex-${index + 1}`, pick(random, ids));
  });

  return new Island(hexes);
};

const createWorld = (random: Random, size: number = 24): World => {
  const ids = biomeIds();

  const hexes = Array.from({ length: size }, (_, index) => {
    const before = index === 0 ? size - 1 : index - 1;
    const after = (index + 1) % size;
    const across = (index + Math.floor(size / 2)) % size;

    return new WorldHex(`world-${index + 1}`, pick(random, ids), [
      `world-${before + 1}`,
      `world-${after + 1}`,
      `world-${across + 1}`,
    ]);
  });

  return new World(hexes);
};

export { createIsland, createWorld, ringSizes };
