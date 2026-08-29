import { ISLAND_RADIUS, SKY_RADIUS, fitsAt, occupancyOf } from "./world";
import { ORIGIN, createGrid } from "../hex/grid";
import { createRng, hashSeed, mixSeed } from "../island/rng";
import { generateIsland } from "../island/generator";
import { hexDistance } from "../hex/coords";
import type { TAxial } from "../hex/coords";
import type { TRng } from "../island/rng";
import type { TTerrainWeights } from "../island/generator";
import type { TWorld, TWorldIsland } from "./world";

const NEUTRAL_COUNT = 6;

/** Neutral islands spawn at least this far from the player, so the first turn has room. */
const NEUTRAL_MIN_DISTANCE = 4;

/** Only the ratios between these matter. */
const PLAYER_WEIGHTS: TTerrainWeights = { plains: 25, meadow: 30, forest: 30, hills: 20, mountain: 12 };

const buildIsland = (rng: TRng, seedText: string, landCount: number) => {
  return generateIsland({
    seedText,
    radius: ISLAND_RADIUS,
    landCount,
    terrainWeights: {
      plains: rng.int(10, 40),
      meadow: rng.int(10, 40),
      forest: rng.int(10, 40),
      hills: rng.int(5, 30),
      mountain: rng.int(5, 20),
    },
  });
};

/**
 * One player island in the middle of the sky and a ring of neutral islands
 * scattered around it. Every neutral island is dropped on the first free
 * spot the dice pick, so no two islands ever share a cell.
 */
const createWorld = (seedText: string): TWorld => {
  const seed = hashSeed(seedText);
  const rng = createRng(mixSeed(seed, 0x5c1));

  const player: TWorldIsland = {
    id: "player",
    owner: "player",
    anchor: ORIGIN,
    island: generateIsland({ seedText, radius: ISLAND_RADIUS, landCount: 10, terrainWeights: PLAYER_WEIGHTS }),
  };

  const islands: TWorldIsland[] = [player];
  // Anchors far enough in that a radius-2 island still fits inside the sky.
  const anchors = createGrid(SKY_RADIUS - ISLAND_RADIUS).filter((cell: TAxial) => {
    return hexDistance(cell, ORIGIN) >= NEUTRAL_MIN_DISTANCE + ISLAND_RADIUS;
  });

  for (let index = 0; index < NEUTRAL_COUNT; index += 1) {
    const candidate: TWorldIsland = {
      id: `neutral-${index}`,
      owner: "neutral",
      anchor: ORIGIN,
      island: buildIsland(rng, `${seedText}-${index}`, rng.int(5, 9)),
    };
    const occupied = occupancyOf(islands);
    const open = anchors.filter((anchor) => fitsAt(candidate, anchor, occupied));

    if (open.length === 0) {
      break;
    }

    islands.push({ ...candidate, anchor: open[rng.int(0, open.length - 1)]! });
  }

  return { seed, islands };
};

export { createWorld };
