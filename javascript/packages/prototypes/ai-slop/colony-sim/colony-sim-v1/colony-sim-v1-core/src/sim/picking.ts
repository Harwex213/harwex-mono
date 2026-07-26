import type { EntityId } from "./components";
import { dist2 } from "./math";
import type { World } from "./world";

// Click tolerance around the cursor, in tiles. Sprites are about one tile wide,
// so half a tile keeps a neighbour from stealing the click.
const PICK_RADIUS = 0.6;

// Rank, not a boolean: scenery covers a large share of the map, so nearest-wins
// alone would let a boulder steal the click from a colonist standing in front of
// it. Each rank is only picked when nothing above it is within reach — and a
// dropped stack is the lowest of the three because it lies *under* whatever is
// standing on its tile.
const enum PickRank {
  None = 0,
  Item = 1, // dropped resource stacks
  Object = 2, // trees, rocks — static and harvestable
  Actor = 3, // colonists and animals
}

function rankOf(world: World, id: EntityId): PickRank {
  if (world.needs.has(id) || world.animals.has(id)) {
    return PickRank.Actor;
  }
  if (world.trees.has(id) || world.rocks.has(id)) {
    return PickRank.Object;
  }
  if (world.items.has(id)) {
    return PickRank.Item;
  }
  return PickRank.None;
}

// The building whose tile the point falls in. A building is hit by containment
// rather than by distance, because it fills its tile instead of standing at a point
// in it: measured from the tile's corner — where its position is — the far side of
// its own roof is already out of every sane radius.
function buildingAt(world: World, x: number, y: number): EntityId | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (const id of world.buildings.keys()) {
    const pos = world.positions.get(id);
    if (pos && Math.floor(pos.x) === tx && Math.floor(pos.y) === ty) {
      return id;
    }
  }
  return null;
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
    const distance = dist2(pos.x, pos.y, x, y);
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
  // An actor keeps the click it won — a colonist standing against a wall must stay
  // clickable, and its sprite overhangs the tile behind it. Below that, the building
  // under the cursor wins: nothing else can be on its tile anyway, so this only
  // decides against a neighbour's sprite leaning over the roof.
  if (bestRank === PickRank.Actor) {
    return best;
  }
  return buildingAt(world, x, y) ?? best;
}

export { pickEntity };
