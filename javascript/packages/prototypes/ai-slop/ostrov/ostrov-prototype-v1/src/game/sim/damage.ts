import { ACTOR_BY_ID, BUILDING_BY_ID, COMBAT } from "../config";
import type { World } from "../world";
import { addEffect, addLog, findActor, findBuilding, recomputePopCap, removeBuilding } from "../world";
import type { Actor, Building, TargetRef, Team } from "../types";

function damageActor(world: World, actor: Actor, amount: number): void {
  if (actor.dead) {
    return;
  }
  actor.hp -= amount;
  actor.hitFlash = 0.18;
  if (actor.hp > 0) {
    return;
  }
  killActor(world, actor);
}

function killActor(world: World, actor: Actor): void {
  actor.dead = true;
  const def = ACTOR_BY_ID.get(actor.defId)!;
  addEffect(world, {
    kind: "blast",
    x: actor.x,
    y: actor.y,
    radius: def.radius * 2.2,
    life: 0.35,
    maxLife: 0.35,
    color: actor.team === "sea" ? "#7ce0c8" : "#ffb36b",
  });
  if (actor.team !== "sea") {
    return;
  }
  world.killed += 1;
  const bounty = Math.round((def.bounty ?? 0) * world.waveBounty);
  if (bounty > 0) {
    world.resources.gold += bounty;
    world.goldFromKills += bounty;
    addEffect(world, {
      kind: "text",
      x: actor.x,
      y: actor.y,
      radius: 0,
      life: 0.9,
      maxLife: 0.9,
      color: "#ffd479",
      text: `+${bounty}`,
    });
  }
  if (actor.defId === "leviathan") {
    world.bossAlive = false;
    world.phase = "won";
    addLog(world, "Левиафан повержен. Море принадлежит острову.", "good");
  }
}

function damageBuilding(world: World, building: Building, amount: number): void {
  if (building.dead) {
    return;
  }
  const reduced = world.ward > 0 ? amount * (1 - COMBAT.wardReduction) : amount;
  building.hp -= reduced;
  building.hitFlash = 0.18;
  if (building.hp > 0) {
    return;
  }
  building.dead = true;
  const def = BUILDING_BY_ID.get(building.defId)!;
  removeBuilding(world, building);
  recomputePopCap(world);
  addEffect(world, {
    kind: "blast",
    x: building.x,
    y: building.y,
    radius: def.cells * 26,
    life: 0.5,
    maxLife: 0.5,
    color: "#ff7a59",
  });
  if (building.defId === "core") {
    world.phase = "lost";
    addLog(world, "Ядро острова разрушено.", "bad");
    return;
  }
  addLog(world, `Разрушено: ${def.name}.`, "bad");
}

function dealDamage(world: World, ref: TargetRef, amount: number): void {
  if (ref.kind === "actor") {
    const actor = findActor(world, ref.id);
    if (actor) {
      damageActor(world, actor, amount);
    }
    return;
  }
  const building = findBuilding(world, ref.id);
  if (building) {
    damageBuilding(world, building, amount);
  }
}

/** Splash hits everything of the opposing team inside the radius. */
function dealSplash(world: World, x: number, y: number, radius: number, amount: number, from: Team): void {
  const radiusSq = radius * radius;
  for (const actor of world.actors) {
    if (actor.dead || actor.team === from) {
      continue;
    }
    const dx = actor.x - x;
    const dy = actor.y - y;
    if (dx * dx + dy * dy <= radiusSq) {
      damageActor(world, actor, amount);
    }
  }
  if (from !== "sea") {
    return;
  }
  for (const building of world.buildings) {
    if (building.dead) {
      continue;
    }
    const dx = building.x - x;
    const dy = building.y - y;
    if (dx * dx + dy * dy <= radiusSq) {
      damageBuilding(world, building, amount);
    }
  }
}

/** Damage an island actor deals, after the forge upgrade. */
function outgoingDamage(world: World, actor: Actor): number {
  if (actor.team !== "island") {
    return actor.damage;
  }
  const forged = world.buildings.some((item) => item.defId === "forge" && !item.dead && item.build >= 1);
  return forged ? actor.damage * (1 + COMBAT.forgeBonus) : actor.damage;
}

export { damageActor, damageBuilding, dealDamage, dealSplash, killActor, outgoingDamage };
