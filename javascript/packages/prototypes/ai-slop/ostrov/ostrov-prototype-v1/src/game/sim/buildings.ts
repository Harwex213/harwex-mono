import { ACTOR_BY_ID, BUILDING_BY_ID, CELL, COMBAT } from "../config";
import type { Building, TargetRef } from "../types";
import type { World } from "../world";
import { addLog, recomputePopCap, spawnActor } from "../world";
import { spawnProjectile } from "./projectiles";

function updateBuildings(world: World, dt: number): void {
  for (const building of world.buildings) {
    if (building.dead) {
      continue;
    }
    const def = BUILDING_BY_ID.get(building.defId)!;
    building.hitFlash = Math.max(0, building.hitFlash - dt);

    if (building.build < 1) {
      building.build = Math.min(1, building.build + dt / def.buildTime);
      if (building.build >= 1) {
        recomputePopCap(world);
        addLog(world, `Построено: ${def.name}.`, "good");
      }
      continue;
    }

    trainQueue(world, building, dt);

    if (!def.weapon) {
      continue;
    }
    building.cooldown = Math.max(0, building.cooldown - dt);
    if (building.cooldown > 0) {
      continue;
    }
    const target = nearestEnemy(world, building.x, building.y, def.weapon.range);
    if (!target) {
      continue;
    }
    const haste = world.fury > 0 ? 1 + COMBAT.furyBonus : 1;
    building.cooldown = def.weapon.cooldown / haste;
    building.target = target;
    spawnProjectile(world, building.x, building.y - 6, target, def.weapon, def.weapon.damage, "island");
  }
}

function trainQueue(world: World, building: Building, dt: number): void {
  const order = building.queue[0];
  if (!order) {
    return;
  }
  order.left -= dt;
  if (order.left > 0) {
    return;
  }
  building.queue.shift();
  const def = ACTOR_BY_ID.get(order.defId)!;
  const angle = world.rng() * Math.PI * 2;
  spawnActor(
    world,
    def,
    building.x + Math.cos(angle) * CELL * 1.6,
    building.y + Math.sin(angle) * CELL * 1.6,
    "field",
  );
}

function nearestEnemy(world: World, x: number, y: number, range: number): TargetRef | null {
  let best: TargetRef | null = null;
  let bestDist = range;
  for (const actor of world.actors) {
    if (actor.dead || actor.team !== "sea") {
      continue;
    }
    const dist = Math.hypot(actor.x - x, actor.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { kind: "actor", id: actor.id };
    }
  }
  return best;
}

export { updateBuildings };
