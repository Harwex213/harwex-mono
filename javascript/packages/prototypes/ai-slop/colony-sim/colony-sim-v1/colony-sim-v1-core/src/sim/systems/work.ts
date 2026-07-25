import type { World } from "../world";

// MVP stub for the harvest → haul loop. Wired into the pipeline and typed
// against the real components; the behaviour is intentionally minimal until the
// job-queue in job-assign.ts starts emitting HarvestTree / Haul jobs.
//
// The two halves of the loop are already there to be called: `destroyObject`
// turns a tree or boulder into the stack it drops (harvestTicks per object lives
// in RESOURCE_DEFS), and `world.items` is where that stack waits.
//
// TODO:
//   HarvestTree: on arrival at targetId, accumulate progress up to the def's
//     harvestTicks, then destroyObject(world, targetId) and take the Haul job for
//     the stack it returns.
//   Haul: pick up world.items.get(targetId) into the inventory, path to the
//     stockpile, on arrival move the carried amount into world.stock.
function workSystem(_world: World): void {}

export { workSystem };
