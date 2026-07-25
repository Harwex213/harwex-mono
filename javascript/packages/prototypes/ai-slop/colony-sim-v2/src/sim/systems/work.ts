import type { World } from "@/sim/world";

const HARVEST_TICKS = 30;

// MVP stub for the harvest → haul loop. Wired into the pipeline and typed
// against the real components; the behaviour is intentionally minimal until the
// job-queue in job-assign.ts starts emitting HarvestTree / Haul jobs.
//
// TODO:
//   HarvestTree: on arrival at targetId tree, accumulate progress up to
//     HARVEST_TICKS, then remove the tree, +wood to inventory, switch to Haul.
//   Haul: path to stockpile, on arrival move inventory.wood → world.storedWood.
function workSystem(_world: World): void {
  void HARVEST_TICKS;
}

export { workSystem };
