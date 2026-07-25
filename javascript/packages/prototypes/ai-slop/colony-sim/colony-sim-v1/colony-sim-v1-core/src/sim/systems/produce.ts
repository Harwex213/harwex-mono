import { BUILDING_DEFS } from "../../data/defs";
import type { Position } from "../components";
import { isWalkable } from "../grid";
import { pickEntity } from "../picking";
import { spawnItem, type World } from "../world";

// Tiles a crop may land on, sides before corners: a farm's output should line up
// alongside it rather than appear diagonally off its shoulder.
const AROUND: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Producing buildings turn ticks into a stack on the ground beside them — not into
// the store. Getting it home is a haul job, and the crop waiting for one is the
// half of the loop the player can actually watch. Which buildings produce, how
// often and what, is BUILDING_DEFS' answer: a second producer is a row there.
function produceSystem(world: World): void {
  for (const [id, building] of world.buildings) {
    const def = BUILDING_DEFS[building.kind];
    if (!def.produces || def.produceTicks <= 0) {
      continue;
    }
    if (building.growth < def.produceTicks) {
      building.growth += 1;
      continue;
    }
    const pos = world.positions.get(id);
    const tile = pos ? freeTileAround(world, pos) : null;
    // Hemmed in by its own output: the crop stays ripe rather than being lost, so
    // the farm starts again the moment a hauler frees a tile. Growth is capped at
    // the def's ticks above, so waiting does not bank a burst either.
    if (!tile) {
      continue;
    }
    building.growth = 0;
    spawnItem(world, tile, def.produces, def.produceAmount);
  }
}

// A tile beside the building that a stack can sit on. "Free" is asked of the same
// picker a click uses, so a crop never lands on top of the last one.
function freeTileAround(world: World, pos: Position): Position | null {
  for (const [dx, dy] of AROUND) {
    const x = Math.floor(pos.x) + dx;
    const y = Math.floor(pos.y) + dy;
    if (isWalkable(world.grid, x, y) && pickEntity(world, x, y) === null) {
      return { x, y };
    }
  }
  return null;
}

export { produceSystem };
