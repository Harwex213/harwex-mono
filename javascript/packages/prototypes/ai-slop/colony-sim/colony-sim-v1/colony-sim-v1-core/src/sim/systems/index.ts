import type { Rng } from "../rng";
import type { World } from "../world";
import { needsSystem } from "./needs";
import { produceSystem } from "./produce";
import { jobAssignSystem } from "./job-assign";
import { animalWanderSystem } from "./animal-wander";
import { pathFollowSystem } from "./path-follow";
import { workSystem } from "./work";

// Deterministic per-tick pipeline. Order matters: produce first, so a crop that
// ripened this tick already has a hauler by the end of it; then assign work, then
// move toward it, then perform it — arrival and the work done on arrival land in
// the same tick. Needs decay is independent and runs first.
interface SimContext {
  rng: Rng;
}

function runSystems(world: World, ctx: SimContext): void {
  needsSystem(world);
  produceSystem(world);
  jobAssignSystem(world, ctx.rng);
  animalWanderSystem(world, ctx.rng);
  pathFollowSystem(world);
  workSystem(world);
}

export type { SimContext };
export { runSystems };
