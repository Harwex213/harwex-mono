import { ACTOR_BY_ID, BUILDING_BY_ID } from "./config";
import * as hud from "./hud";
import { updateActors } from "./sim/actors";
import { updateBuildings } from "./sim/buildings";
import { updateEconomy } from "./sim/economy";
import { expansionError, startExpansion, updateExpansion } from "./sim/expansion";
import { updateProjectiles } from "./sim/projectiles";
import { castSkill, updateSkills } from "./sim/skills";
import { startWave, updateWaves } from "./sim/waves";
import type { ActorDefId, BuildingId, SkillId } from "./types";
import type { World } from "./world";
import {
  addLog,
  bossSector,
  canAfford,
  createWorld,
  hasBuilding,
  placeBuilding,
  placementError,
  sectorCentre,
  spawnActor,
  spend,
} from "./world";

const STEP = 1 / 60;
const HUD_INTERVAL = 0.1;

class Game {
  world: World;
  private accumulator = 0;
  private hudTimer = 0;
  private speed = 1;

  constructor(seed: number) {
    this.world = buildWorld(seed);
    hud.publishHud(this.world);
  }

  restart(seed: number): void {
    this.world = buildWorld(seed);
    this.accumulator = 0;
    hud.mapMode.value = { kind: "idle" };
    hud.selectedSector.value = null;
    hud.publishHud(this.world);
  }

  setSpeed(value: number): void {
    this.speed = value;
    hud.speed.value = value;
  }

  advance(realDt: number): void {
    const world = this.world;
    if (world.phase !== "play") {
      this.publish(realDt);
      return;
    }
    this.accumulator += Math.min(0.25, realDt) * this.speed;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 10) {
      tick(world, STEP);
      this.accumulator -= STEP;
      steps += 1;
    }
    this.publish(realDt);
  }

  private publish(realDt: number): void {
    this.hudTimer -= realDt;
    if (this.hudTimer > 0) {
      return;
    }
    this.hudTimer = HUD_INTERVAL;
    hud.publishHud(this.world);
  }

  build(defId: BuildingId, cx: number, cy: number): void {
    const def = BUILDING_BY_ID.get(defId)!;
    const error = placementError(this.world, def, cx, cy);
    if (error) {
      hud.showToast(error);
      return;
    }
    spend(this.world, def.cost);
    placeBuilding(this.world, defId, cx, cy);
    hud.publishHud(this.world);
  }

  queueUnit(defId: ActorDefId): void {
    const world = this.world;
    const def = ACTOR_BY_ID.get(defId)!;
    for (const required of def.requires ?? []) {
      if (!hasBuilding(world, required)) {
        hud.showToast(`Нужно: ${BUILDING_BY_ID.get(required)!.name}`);
        return;
      }
    }
    const producers = world.buildings.filter(
      (building) => building.defId === def.producer && !building.dead && building.build >= 1,
    );
    if (producers.length === 0) {
      hud.showToast(`Нужно: ${BUILDING_BY_ID.get(def.producer!)!.name}`);
      return;
    }
    if (world.pop + (def.pop ?? 1) > world.popCap) {
      hud.showToast("Не хватает лимита армии — постройте хижины");
      return;
    }
    if (!canAfford(world, def.cost ?? {})) {
      hud.showToast("Не хватает ресурсов");
      return;
    }
    spend(world, def.cost ?? {});
    const target = producers.reduce((best, item) => (item.queue.length < best.queue.length ? item : best));
    target.queue.push({ defId, left: def.trainTime ?? 5, total: def.trainTime ?? 5 });
    hud.publishHud(world);
  }

  setRally(x: number, y: number): void {
    this.world.rally = { x, y };
    if (this.world.assault) {
      this.world.assault = false;
      addLog(this.world, "Штурм отменён, армия возвращается.", "info");
    }
    hud.publishHud(this.world);
  }

  expand(index: number): void {
    const sector = this.world.sectors[index];
    const error = startExpansion(this.world, sector);
    if (error) {
      hud.showToast(error);
      return;
    }
    hud.publishHud(this.world);
  }

  canExpand(index: number): string | null {
    return expansionError(this.world, this.world.sectors[index]);
  }

  cast(id: SkillId, x: number, y: number): void {
    const error = castSkill(this.world, id, x, y);
    if (error) {
      hud.showToast(error);
      return;
    }
    hud.publishHud(this.world);
  }

  callWave(): void {
    if (this.world.waveRunning) {
      hud.showToast("Волна уже здесь");
      return;
    }
    startWave(this.world, true);
    hud.publishHud(this.world);
  }

  toggleAssault(): void {
    const world = this.world;
    if (!world.bossAlive) {
      return;
    }
    world.assault = !world.assault;
    if (world.assault) {
      const centre = sectorCentre(bossSector(world));
      world.rally = { x: centre.x, y: centre.y + 120 };
      addLog(world, "Армия идёт на логово Левиафана. Остров остаётся без защиты.", "bad");
    } else {
      addLog(world, "Штурм отменён, армия возвращается.", "info");
    }
    hud.publishHud(world);
  }
}

function buildWorld(seed: number): World {
  const world = createWorld(seed);
  const centre = sectorCentre(bossSector(world));
  spawnActor(world, ACTOR_BY_ID.get("leviathan")!, centre.x, centre.y, "boss");
  addLog(world, "Остров дрейфует. Стройте, пока море спокойно.", "info");
  return world;
}

function tick(world: World, dt: number): void {
  world.time += dt;
  updateEconomy(world, dt);
  updateBuildings(world, dt);
  updateActors(world, dt);
  updateProjectiles(world, dt);
  updateWaves(world, dt);
  updateExpansion(world, dt);
  updateSkills(world, dt);
  updateEffects(world, dt);
}

function updateEffects(world: World, dt: number): void {
  let alive = false;
  for (const effect of world.effects) {
    effect.life -= dt;
    if (effect.life <= 0) {
      alive = true;
    }
  }
  if (alive) {
    world.effects = world.effects.filter((effect) => effect.life > 0);
  }
}

export { Game };
