import type { Rng } from "@/sim/rng";
import type { World } from "@/sim/world";
import { needsSystem } from "@/sim/systems/needs";
import { jobAssignSystem } from "@/sim/systems/job-assign";
import { animalWanderSystem } from "@/sim/systems/animal-wander";
import { pathFollowSystem } from "@/sim/systems/path-follow";
import { workSystem } from "@/sim/systems/work";

// Deterministic per-tick pipeline. Order matters: assign work, then move toward
// it, then perform it. Needs decay is independent and runs first.
interface SimContext {
  rng: Rng;
}

function runSystems(world: World, ctx: SimContext): void {
  needsSystem(world);
  jobAssignSystem(world, ctx.rng);
  animalWanderSystem(world, ctx.rng);
  pathFollowSystem(world);
  workSystem(world);
}

export type { SimContext };
export { runSystems };
