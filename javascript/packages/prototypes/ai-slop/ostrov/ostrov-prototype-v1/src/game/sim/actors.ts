import { ACTOR_BY_ID, CELL, COMBAT, SECTOR_SIZE, WORLD_CELLS_X, WORLD_CELLS_Y } from "../config";
import type { Actor, ActorDef, TargetRef } from "../types";
import type { World } from "../world";
import { addEffect, bossSector, cellIndex, coreBuilding, sectorCentre, targetPosition, worldToCell } from "../world";
import { dealDamage, dealSplash, outgoingDamage } from "./damage";
import { spawnProjectile } from "./projectiles";
import type { Grid } from "./grid";
import { buildGrid, queryGrid } from "./grid";

const scratch: number[] = [];

function updateActors(world: World, dt: number): void {
  const grid = buildGrid(world.actors);
  const core = coreBuilding(world);
  const boss = sectorCentre(bossSector(world));
  const seaGoal = core ? { x: core.x, y: core.y } : { x: world.rally.x, y: world.rally.y };

  for (const actor of world.actors) {
    if (actor.dead) {
      continue;
    }
    const def = ACTOR_BY_ID.get(actor.defId)!;
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    actor.hitFlash = Math.max(0, actor.hitFlash - dt);

    actor.target = keepTarget(world, actor, def) ?? acquireTarget(world, actor, def, grid);

    const pos = actor.target ? targetPosition(world, actor.target) : null;
    if (actor.target && pos) {
      const dist = Math.hypot(pos.x - actor.x, pos.y - actor.y);
      actor.facing = Math.atan2(pos.y - actor.y, pos.x - actor.x);
      if (dist <= def.weapon.range + pos.radius) {
        attack(world, actor, def, actor.target);
      } else {
        step(actor, def, pos.x, pos.y, dt);
      }
    } else if (actor.role !== "boss") {
      const goal = goalOf(world, actor, def, seaGoal, boss);
      step(actor, def, goal.x, goal.y, dt);
    }
    separate(world, actor, def, grid, dt);
  }

  if (world.actors.some((actor) => actor.dead)) {
    world.actors = world.actors.filter((actor) => !actor.dead);
  }
}

function goalOf(
  world: World,
  actor: Actor,
  def: ActorDef,
  seaGoal: { x: number; y: number },
  boss: { x: number; y: number },
): { x: number; y: number } {
  if (actor.role === "guard") {
    return { x: actor.homeX, y: actor.homeY };
  }
  if (def.team === "sea") {
    return seaGoal;
  }
  if (world.assault) {
    return spread(actor, boss.x, boss.y);
  }
  return spread(actor, world.rally.x, world.rally.y);
}

/** Fans the army out around its rally point instead of piling it on one pixel. */
function spread(actor: Actor, x: number, y: number): { x: number; y: number } {
  const angle = actor.id * 2.39996;
  const ring = 20 + (actor.id % 6) * 14;
  return { x: x + Math.cos(angle) * ring, y: y + Math.sin(angle) * ring };
}

function aggroOf(actor: Actor, def: ActorDef): number {
  if (actor.role === "guard") {
    return COMBAT.guardAggro;
  }
  if (actor.role === "boss") {
    return def.weapon.range + 60;
  }
  return Math.max(COMBAT.aggro, def.weapon.range + 40);
}

/** Keeps the current target while it is alive and has not run too far off. */
function keepTarget(world: World, actor: Actor, def: ActorDef): TargetRef | null {
  if (!actor.target) {
    return null;
  }
  const pos = targetPosition(world, actor.target);
  if (!pos) {
    return null;
  }
  const leash = aggroOf(actor, def) * 1.7;
  const anchorX = actor.role === "field" ? actor.x : actor.homeX;
  const anchorY = actor.role === "field" ? actor.y : actor.homeY;
  if (Math.hypot(pos.x - anchorX, pos.y - anchorY) > leash) {
    return null;
  }
  return actor.target;
}

function acquireTarget(world: World, actor: Actor, def: ActorDef, grid: Grid): TargetRef | null {
  const aggro = aggroOf(actor, def);
  const anchorX = actor.role === "field" ? actor.x : actor.homeX;
  const anchorY = actor.role === "field" ? actor.y : actor.homeY;
  let best: TargetRef | null = null;
  let bestDist = aggro;

  queryGrid(grid, anchorX, anchorY, aggro, scratch);
  for (const index of scratch) {
    const other = world.actors[index];
    if (!other || other.dead || other.team === actor.team) {
      continue;
    }
    const dist = Math.hypot(other.x - anchorX, other.y - anchorY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { kind: "actor", id: other.id };
    }
  }

  if (actor.team !== "sea") {
    return best;
  }
  for (const building of world.buildings) {
    if (building.dead) {
      continue;
    }
    const dist = Math.hypot(building.x - anchorX, building.y - anchorY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { kind: "building", id: building.id };
    }
  }
  if (!best && actor.role === "field") {
    // Nothing within reach: chew through whatever stands in the way instead of
    // sliding straight over the island's buildings.
    const blocker = buildingAhead(world, actor);
    if (blocker !== null) {
      best = { kind: "building", id: blocker };
    }
  }
  return best;
}

function buildingAhead(world: World, actor: Actor): number | null {
  const core = coreBuilding(world);
  if (!core) {
    return null;
  }
  const dx = core.x - actor.x;
  const dy = core.y - actor.y;
  const dist = Math.hypot(dx, dy) || 1;
  const cell = worldToCell(actor.x + (dx / dist) * CELL, actor.y + (dy / dist) * CELL);
  if (cell.cx < 0 || cell.cy < 0 || cell.cx >= WORLD_CELLS_X || cell.cy >= WORLD_CELLS_Y) {
    return null;
  }
  const id = world.occupancy[cellIndex(cell.cx, cell.cy)];
  return id > 0 ? id : null;
}

function attack(world: World, actor: Actor, def: ActorDef, target: TargetRef): void {
  if (actor.cooldown > 0) {
    return;
  }
  const haste = actor.team === "island" && world.fury > 0 ? 1 + COMBAT.furyBonus : 1;
  actor.cooldown = def.weapon.cooldown / haste;
  const damage = outgoingDamage(world, actor);
  const pos = targetPosition(world, target);
  if (!pos) {
    return;
  }
  if (def.weapon.projectile) {
    spawnProjectile(world, actor.x, actor.y, target, def.weapon, damage, actor.team);
    return;
  }
  if (def.weapon.splash) {
    dealSplash(world, pos.x, pos.y, def.weapon.splash, damage, actor.team);
  } else {
    dealDamage(world, target, damage);
  }
  addEffect(world, {
    kind: "spark",
    x: (actor.x + pos.x) / 2,
    y: (actor.y + pos.y) / 2,
    radius: 8,
    life: 0.14,
    maxLife: 0.14,
    color: actor.team === "island" ? "#ffe6a8" : "#8ce8ff",
  });
}

function step(actor: Actor, def: ActorDef, goalX: number, goalY: number, dt: number): void {
  if (def.speed <= 0) {
    return;
  }
  const dx = goalX - actor.x;
  const dy = goalY - actor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 3) {
    return;
  }
  const travel = Math.min(dist, def.speed * dt);
  actor.x += (dx / dist) * travel;
  actor.y += (dy / dist) * travel;
  actor.facing = Math.atan2(dy, dx);
  actor.step += travel;
  if (actor.role !== "guard") {
    return;
  }
  // Guards defend their sector but never chase the army across the map.
  const offX = actor.x - actor.homeX;
  const offY = actor.y - actor.homeY;
  const off = Math.hypot(offX, offY);
  if (off > SECTOR_SIZE * 0.6) {
    actor.x = actor.homeX + (offX / off) * SECTOR_SIZE * 0.6;
    actor.y = actor.homeY + (offY / off) * SECTOR_SIZE * 0.6;
  }
}

function separate(world: World, actor: Actor, def: ActorDef, grid: Grid, dt: number): void {
  if (def.speed <= 0) {
    return;
  }
  queryGrid(grid, actor.x, actor.y, def.radius * 3, scratch);
  let pushX = 0;
  let pushY = 0;
  for (const index of scratch) {
    const other = world.actors[index];
    if (!other || other.dead || other.id === actor.id) {
      continue;
    }
    const otherDef = ACTOR_BY_ID.get(other.defId)!;
    const want = def.radius + otherDef.radius;
    const dx = actor.x - other.x;
    const dy = actor.y - other.y;
    const dist = Math.hypot(dx, dy);
    if (dist > want || dist === 0) {
      continue;
    }
    const push = (want - dist) / want;
    pushX += (dx / dist) * push;
    pushY += (dy / dist) * push;
  }
  if (pushX === 0 && pushY === 0) {
    return;
  }
  actor.x += pushX * def.speed * COMBAT.separation * dt;
  actor.y += pushY * def.speed * COMBAT.separation * dt;
}

export { updateActors };
