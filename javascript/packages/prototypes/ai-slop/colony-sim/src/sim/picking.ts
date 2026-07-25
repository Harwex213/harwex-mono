import type { EntityId } from "@/sim/components";
import type { World } from "@/sim/world";

// Click tolerance around the cursor, in tiles. Sprites are about one tile wide,
// so half a tile keeps a neighbour from stealing the click.
const PICK_RADIUS = 0.6;

// Rank, not a boolean: resources cover a large share of the map, so nearest-wins
// alone would let a boulder steal the click from a colonist standing in front of
// it. A resource is only picked when no actor is within reach.
const enum PickRank {
  None = 0,
  Resource = 1, // trees, rocks — static and harvestable
  Actor = 2, // colonists and animals
}

function rankOf(world: World, id: EntityId): PickRank {
  if (world.needs.has(id) || world.animals.has(id)) {
    return PickRank.Actor;
  }
  if (world.trees.has(id) || world.rocks.has(id)) {
    return PickRank.Resource;
  }
  return PickRank.None;
}

// Best pickable entity near a point in tile coords — highest rank first, nearest
// within that rank — or null when the click landed on bare ground.
function pickEntity(world: World, x: number, y: number): EntityId | null {
  let best: EntityId | null = null;
  let bestRank = PickRank.None;
  let bestDistance = PICK_RADIUS * PICK_RADIUS;
  for (const [id, pos] of world.positions) {
    const rank = rankOf(world, id);
    if (rank === PickRank.None || rank < bestRank) {
      continue;
    }
    const distance = (pos.x - x) ** 2 + (pos.y - y) ** 2;
    // A higher rank restarts the distance race: the nearest tree so far must not
    // rule out a colonist that is further away but still in range.
    if (rank > bestRank) {
      if (distance > PICK_RADIUS * PICK_RADIUS) {
        continue;
      }
    } else if (distance > bestDistance) {
      continue;
    }
    bestRank = rank;
    bestDistance = distance;
    best = id;
  }
  return best;
}

export { pickEntity };
