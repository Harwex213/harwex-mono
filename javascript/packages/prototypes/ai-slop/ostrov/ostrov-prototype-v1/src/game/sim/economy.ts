import { ACTOR_BY_ID, BUILDING_BY_ID } from "../config";
import type { World } from "../world";

/** Passive income and the army headcount, both recomputed from scratch each tick. */
function updateEconomy(world: World, dt: number): void {
  for (const building of world.buildings) {
    if (building.dead || building.build < 1) {
      continue;
    }
    const income = BUILDING_BY_ID.get(building.defId)!.income;
    if (!income) {
      continue;
    }
    world.resources.gold += (income.gold ?? 0) * dt;
    world.resources.wood += (income.wood ?? 0) * dt;
    world.resources.crystal += (income.crystal ?? 0) * dt;
  }

  let pop = 0;
  for (const actor of world.actors) {
    if (actor.dead || actor.team !== "island") {
      continue;
    }
    pop += ACTOR_BY_ID.get(actor.defId)!.pop ?? 1;
  }
  for (const building of world.buildings) {
    if (building.dead) {
      continue;
    }
    for (const order of building.queue) {
      pop += ACTOR_BY_ID.get(order.defId)!.pop ?? 1;
    }
  }
  world.pop = pop;
}

/** Passive income per second, for the HUD tooltip. */
function incomeRate(world: World): { gold: number; wood: number; crystal: number } {
  const rate = { gold: 0, wood: 0, crystal: 0 };
  for (const building of world.buildings) {
    if (building.dead || building.build < 1) {
      continue;
    }
    const income = BUILDING_BY_ID.get(building.defId)!.income;
    if (!income) {
      continue;
    }
    rate.gold += income.gold ?? 0;
    rate.wood += income.wood ?? 0;
    rate.crystal += income.crystal ?? 0;
  }
  return rate;
}

export { incomeRate, updateEconomy };
