import { SKILL_BY_ID } from "../config";
import type { SkillId } from "../types";
import type { World } from "../world";
import { addEffect, addLog, hasBuilding } from "../world";
import { dealSplash } from "./damage";

function updateSkills(world: World, dt: number): void {
  for (const id of Object.keys(world.skills) as SkillId[]) {
    world.skills[id] = Math.max(0, world.skills[id] - dt);
  }
  world.fury = Math.max(0, world.fury - dt);
  world.ward = Math.max(0, world.ward - dt);
}

function skillError(world: World, id: SkillId): string | null {
  if (!hasBuilding(world, "altar")) {
    return "Нужен алтарь";
  }
  if (world.skills[id] > 0) {
    return "Умение ещё не готово";
  }
  return null;
}

function castSkill(world: World, id: SkillId, x: number, y: number): string | null {
  const error = skillError(world, id);
  if (error) {
    return error;
  }
  const def = SKILL_BY_ID.get(id)!;
  world.skills[id] = def.cooldown;

  if (id === "volley") {
    dealSplash(world, x, y, def.radius ?? 100, def.damage ?? 0, "island");
    addEffect(world, {
      kind: "ring",
      x,
      y,
      radius: def.radius ?? 100,
      life: 0.5,
      maxLife: 0.5,
      color: "#ffd479",
    });
    return null;
  }
  if (id === "fury") {
    world.fury = def.duration ?? 10;
    addLog(world, "Ярость: армия бьёт быстрее.", "good");
    return null;
  }
  world.ward = def.duration ?? 10;
  addLog(world, "Оберег: здания держат удар.", "good");
  return null;
}

export { castSkill, skillError, updateSkills };
