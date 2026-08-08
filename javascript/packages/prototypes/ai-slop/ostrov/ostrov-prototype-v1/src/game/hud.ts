import { signal } from "@preact/signals-react";
import { ACTOR_BY_ID, EXPANSION, TERRAIN_NAMES } from "./config";
import { incomeRate } from "./sim/economy";
import type { BuildingId, LogEntry, Phase, SectorState, SkillId, TerrainKind } from "./types";
import type { World } from "./world";
import { coreBuilding, ownedCount } from "./world";

type SectorView = {
  index: number;
  col: number;
  row: number;
  terrain: TerrainKind;
  terrainName: string;
  state: SectorState;
  attach: number;
};

type QueueView = {
  building: number;
  name: string;
  left: number;
  total: number;
};

type ExpansionView = {
  sector: number;
  name: string;
  guards: number;
  attach: number;
};

/** What the mouse does on the map right now. */
type MapMode =
  | { kind: "idle" }
  | { kind: "build"; id: BuildingId }
  | { kind: "skill"; id: SkillId }
  | { kind: "rally" };

const gold = signal(0);
const wood = signal(0);
const crystal = signal(0);
const goldRate = signal(0);
const woodRate = signal(0);
const crystalRate = signal(0);

const pop = signal(0);
const popCap = signal(0);

const wave = signal(0);
const waveTimer = signal(0);
const waveRunning = signal(false);
const enemyCount = signal(0);

const coreHp = signal(0);
const coreMaxHp = signal(1);
const bossHp = signal(0);
const bossMaxHp = signal(1);

const phase = signal<Phase>("play");
const speed = signal(1);
const assault = signal(false);
const furyLeft = signal(0);
const wardLeft = signal(0);
const skillCooldowns = signal<Record<SkillId, number>>({ volley: 0, fury: 0, ward: 0 });

const built = signal<BuildingId[]>([]);
const queues = signal<QueueView[]>([]);
const sectors = signal<SectorView[]>([]);
const expansion = signal<ExpansionView | null>(null);
const expansionCost = signal({ gold: 0, wood: 0 });
const logEntries = signal<LogEntry[]>([]);

const killed = signal(0);
const earnedFromKills = signal(0);
const ownedSectors = signal(1);
const elapsed = signal(0);

/** UI-only state: what a click on the map means, and the sector card. */
const mapMode = signal<MapMode>({ kind: "idle" });
const selectedSector = signal<number | null>(null);
const toast = signal<{ id: number; text: string } | null>(null);

let toastId = 1;

function showToast(text: string): void {
  toast.value = { id: toastId, text };
  toastId += 1;
}

function publishHud(world: World): void {
  gold.value = Math.floor(world.resources.gold);
  wood.value = Math.floor(world.resources.wood);
  crystal.value = Math.floor(world.resources.crystal);
  const rate = incomeRate(world);
  goldRate.value = rate.gold;
  woodRate.value = rate.wood;
  crystalRate.value = rate.crystal;

  pop.value = world.pop;
  popCap.value = world.popCap;

  wave.value = world.wave;
  waveTimer.value = Math.max(0, world.waveTimer);
  waveRunning.value = world.waveRunning;
  enemyCount.value = world.actors.filter((actor) => actor.team === "sea" && actor.role === "field").length;

  const core = coreBuilding(world);
  coreHp.value = core ? Math.max(0, Math.round(core.hp)) : 0;
  coreMaxHp.value = core ? core.maxHp : 1;

  const boss = world.actors.find((actor) => actor.defId === "leviathan");
  bossHp.value = boss ? Math.max(0, Math.round(boss.hp)) : 0;
  bossMaxHp.value = boss ? boss.maxHp : 1;

  phase.value = world.phase;
  assault.value = world.assault;
  furyLeft.value = world.fury;
  wardLeft.value = world.ward;
  setIfChanged(skillCooldowns, { volley: world.skills.volley, fury: world.skills.fury, ward: world.skills.ward });

  const readyIds = world.buildings
    .filter((building) => !building.dead && building.build >= 1)
    .map((building) => building.defId);
  setIfChanged(built, Array.from(new Set(readyIds)));

  const queueViews: QueueView[] = [];
  for (const building of world.buildings) {
    for (const order of building.queue) {
      queueViews.push({
        building: building.id,
        name: ACTOR_BY_ID.get(order.defId)!.name,
        left: order.left,
        total: order.total,
      });
    }
  }
  queues.value = queueViews;

  setIfChanged(
    sectors,
    world.sectors.map((sector) => ({
      index: sector.index,
      col: sector.col,
      row: sector.row,
      terrain: sector.terrain,
      terrainName: TERRAIN_NAMES[sector.terrain],
      state: sector.state,
      attach: Math.round(sector.attach * 20) / 20,
    })),
  );

  const owned = ownedCount(world);
  ownedSectors.value = owned;
  expansionCost.value = EXPANSION.cost(owned);
  if (world.expansion) {
    const sector = world.sectors[world.expansion.sector];
    setIfChanged(expansion, {
      sector: sector.index,
      name: TERRAIN_NAMES[sector.terrain],
      guards: world.expansion.guards,
      attach: Math.round(sector.attach * 20) / 20,
    });
  } else if (expansion.value !== null) {
    expansion.value = null;
  }

  if (logEntries.value.length !== world.log.length || lastId(logEntries.value) !== lastId(world.log)) {
    logEntries.value = world.log.slice(-9);
  }

  killed.value = world.killed;
  earnedFromKills.value = world.goldFromKills;
  elapsed.value = Math.floor(world.time);
}

function lastId(entries: LogEntry[]): number {
  return entries.length > 0 ? entries[entries.length - 1].id : 0;
}

/** Assigns only when the shallow shape actually differs, to spare a re-render. */
function setIfChanged<T>(target: { value: T }, next: T): void {
  if (JSON.stringify(target.value) === JSON.stringify(next)) {
    return;
  }
  target.value = next;
}

export type { ExpansionView, MapMode, QueueView, SectorView };
export {
  assault,
  bossHp,
  bossMaxHp,
  built,
  coreHp,
  coreMaxHp,
  crystal,
  crystalRate,
  earnedFromKills,
  elapsed,
  enemyCount,
  expansion,
  expansionCost,
  furyLeft,
  gold,
  goldRate,
  killed,
  logEntries,
  mapMode,
  ownedSectors,
  phase,
  pop,
  popCap,
  publishHud,
  queues,
  sectors,
  selectedSector,
  showToast,
  skillCooldowns,
  speed,
  toast,
  wardLeft,
  wave,
  waveRunning,
  waveTimer,
  wood,
  woodRate,
};
