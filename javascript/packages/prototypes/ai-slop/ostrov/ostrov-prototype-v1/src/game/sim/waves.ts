import { ACTOR_BY_ID, OCEAN, WAVE, WORLD_H, WORLD_W } from "../config";
import type { ActorDefId } from "../types";
import type { World } from "../world";
import { addLog, spawnActor } from "../world";

const SIDE_NAMES = ["с севера", "с востока", "с юга", "с запада"];

function updateWaves(world: World, dt: number): void {
  for (const pending of world.spawnQueue) {
    pending.delay -= dt;
  }
  while (world.spawnQueue.length > 0 && world.spawnQueue[0].delay <= 0) {
    const pending = world.spawnQueue.shift()!;
    const def = ACTOR_BY_ID.get(pending.defId)!;
    spawnActor(world, def, pending.x, pending.y, "field", { hp: pending.hp, damage: pending.damage });
  }

  if (world.waveRunning && world.spawnQueue.length === 0 && !hasRaiders(world)) {
    world.waveRunning = false;
    addLog(world, `Волна ${world.wave} отражена.`, "good");
  }

  world.waveTimer -= dt;
  if (world.waveTimer <= 0) {
    startWave(world, false);
  }
}

function hasRaiders(world: World): boolean {
  return world.actors.some((actor) => actor.team === "sea" && actor.role === "field" && !actor.dead);
}

function startWave(world: World, early: boolean): void {
  world.wave += 1;
  world.waveRunning = true;
  world.waveBounty = early ? 1 + WAVE.earlyBonus : 1;
  world.waveTimer = WAVE.interval(world.wave);

  const pool = WAVE.pool(world.wave);
  const hpScale = WAVE.hpScale(world.wave);
  const damageScale = WAVE.damageScale(world.wave);
  const side = Math.floor(world.rng() * 4) % 4;
  const origin = sideOrigin(world, side);

  let budget = WAVE.budget(world.wave);
  let index = 0;
  let guard = 0;
  while (budget > 0 && guard < 200) {
    guard += 1;
    const affordable = pool.filter((id) => (ACTOR_BY_ID.get(id)!.threat ?? 1) <= budget);
    if (affordable.length === 0) {
      break;
    }
    const defId: ActorDefId = affordable[Math.floor(world.rng() * affordable.length) % affordable.length];
    const def = ACTOR_BY_ID.get(defId)!;
    budget -= def.threat ?? 1;
    world.spawnQueue.push({
      defId,
      hp: Math.round(def.hp * hpScale),
      damage: def.weapon.damage * damageScale,
      delay: index * 0.32 + world.rng() * 0.5,
      x: origin.x + (world.rng() - 0.5) * origin.spreadX,
      y: origin.y + (world.rng() - 0.5) * origin.spreadY,
    });
    index += 1;
  }
  world.spawnQueue.sort((a, b) => a.delay - b.delay);
  const bonus = early ? " Ранний вызов: награда больше." : "";
  addLog(world, `Волна ${world.wave} идёт ${SIDE_NAMES[side]}.${bonus}`, "bad");
}

function sideOrigin(world: World, side: number): { x: number; y: number; spreadX: number; spreadY: number } {
  const along = world.rng();
  const depth = OCEAN * 0.55;
  if (side === 0) {
    return { x: WORLD_W * (0.15 + along * 0.7), y: -depth, spreadX: 220, spreadY: 80 };
  }
  if (side === 1) {
    return { x: WORLD_W + depth, y: WORLD_H * (0.15 + along * 0.7), spreadX: 80, spreadY: 220 };
  }
  if (side === 2) {
    return { x: WORLD_W * (0.15 + along * 0.7), y: WORLD_H + depth, spreadX: 220, spreadY: 80 };
  }
  return { x: -depth, y: WORLD_H * (0.15 + along * 0.7), spreadX: 80, spreadY: 220 };
}

export { startWave, updateWaves };
