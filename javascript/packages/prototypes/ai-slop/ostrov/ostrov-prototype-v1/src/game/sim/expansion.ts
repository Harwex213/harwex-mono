import { ACTOR_BY_ID, EXPANSION, SECTOR_SIZE, START_SECTOR, TERRAIN_NAMES } from "../config";
import type { Sector } from "../types";
import type { World } from "../world";
import {
  addLog,
  canAfford,
  hasBuilding,
  isAdjacentToIsland,
  ownedCount,
  sectorCentre,
  sectorDistance,
  spawnActor,
  spend,
} from "../world";

/** Why the island cannot drift onto this sector, or `null` when it can. */
function expansionError(world: World, sector: Sector): string | null {
  if (sector.state === "owned") {
    return "Уже наш";
  }
  if (sector.terrain === "boss") {
    return "Логово Левиафана не захватить — его надо штурмовать";
  }
  if (world.expansion) {
    return "Остров уже в движении";
  }
  if (!hasBuilding(world, "engine")) {
    return "Нужен двигатель острова";
  }
  if (!isAdjacentToIsland(world, sector)) {
    return "Не граничит с островом";
  }
  if (!canAfford(world, EXPANSION.cost(ownedCount(world)))) {
    return "Не хватает ресурсов";
  }
  return null;
}

function startExpansion(world: World, sector: Sector): string | null {
  const error = expansionError(world, sector);
  if (error) {
    return error;
  }
  spend(world, EXPANSION.cost(ownedCount(world)));
  sector.state = "contested";
  sector.attach = 0;
  world.landDirty = true;

  const distance = Math.max(1, sectorDistance(sector, START_SECTOR));
  const count = EXPANSION.guards(distance);
  const scale = EXPANSION.guardScale(distance);
  const def = ACTOR_BY_ID.get("guardian")!;
  const centre = sectorCentre(sector);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + world.rng();
    const radius = SECTOR_SIZE * (0.12 + world.rng() * 0.28);
    spawnActor(world, def, centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, "guard", {
      hp: Math.round(def.hp * scale),
      damage: def.weapon.damage * scale,
    });
  }
  world.expansion = { sector: sector.index, guards: count };
  addLog(world, `Остров идёт на сектор «${TERRAIN_NAMES[sector.terrain]}». Стражей: ${count}.`, "info");
  return null;
}

function updateExpansion(world: World, dt: number): void {
  if (!world.expansion) {
    return;
  }
  const sector = world.sectors[world.expansion.sector];
  const guards = world.actors.filter((actor) => actor.role === "guard" && !actor.dead).length;
  world.expansion.guards = guards;
  if (guards > 0) {
    return;
  }
  const before = sector.attach;
  sector.attach = Math.min(1, sector.attach + dt / EXPANSION.attachTime);
  // The land layer is a full-world redraw; refresh it in visible steps only.
  if (Math.floor(before * 10) !== Math.floor(sector.attach * 10)) {
    world.landDirty = true;
  }
  if (sector.attach < 1) {
    return;
  }
  world.landDirty = true;
  sector.state = "owned";
  world.expansion = null;
  addLog(world, `Сектор «${TERRAIN_NAMES[sector.terrain]}» присоединён к острову.`, "good");
}

export { expansionError, startExpansion, updateExpansion };
