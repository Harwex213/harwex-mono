import type { Rng } from "../rng";
import type { World } from "../world";
import { needsSystem } from "./needs";
import { jobAssignSystem } from "./job-assign";
import { animalWanderSystem } from "./animal-wander";
import { pathFollowSystem } from "./path-follow";
import { workSystem } from "./work";

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
