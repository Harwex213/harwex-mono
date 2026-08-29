import type { TGameSnapshot, TPlacedBuilding, TResources } from "./types";
import type { TWorld } from "../world/types";

const STARTING_RESOURCES: TResources = { food: 12, wood: 26, stone: 8 };
const STARTING_POPULATION = 3;

/**
 * A new game opens with one finished house on the start tile. Without it the
 * first turns would be spent staring at a colony that cannot grow, and the
 * player would have no example of a working building to read.
 */
const createInitialGame = (world: TWorld): TGameSnapshot => {
  const buildings: (TPlacedBuilding | null)[] = new Array(world.tiles.length).fill(null);
  buildings[world.startIndex] = {
    kind: "house",
    tileIndex: world.startIndex,
    remaining: 0,
    order: 0,
  };

  return {
    turn: 1,
    resources: { ...STARTING_RESOURCES },
    population: STARTING_POPULATION,
    buildings,
  };
};

export { STARTING_POPULATION, STARTING_RESOURCES, createInitialGame };
