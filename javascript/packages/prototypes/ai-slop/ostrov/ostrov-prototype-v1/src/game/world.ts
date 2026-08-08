import {
  ACTOR_BY_ID,
  BUILDING_BY_ID,
  CELL,
  SECTOR_CELLS,
  SECTOR_COLS,
  SECTOR_ROWS,
  SECTOR_SIZE,
  START_RESOURCES,
  START_SECTOR,
  TERRAIN_ROWS,
  WAVE,
  WORLD_CELLS_X,
  WORLD_CELLS_Y,
} from "./config";
import { mulberry32, range } from "./rng";
import type {
  Actor,
  ActorDef,
  ActorDefId,
  ActorRole,
  Building,
  BuildingDef,
  BuildingId,
  Cost,
  Effect,
  LogEntry,
  Phase,
  Projectile,
  Resources,
  Sector,
  SkillId,
  TargetRef,
  TerrainKind,
} from "./types";

type Expansion = {
  sector: number;
  /** Guardians still standing on the target sector. */
  guards: number;
};

type World = {
  seed: number;
  time: number;
  phase: Phase;
  sectors: Sector[];
  buildings: Building[];
  actors: Actor[];
  projectiles: Projectile[];
  effects: Effect[];
  /** Building id + 1 per world cell; 0 means the cell is free. */
  occupancy: Int32Array;
  resources: Resources;
  pop: number;
  popCap: number;
  rally: { x: number; y: number };
  wave: number;
  waveTimer: number;
  waveRunning: boolean;
  /** Enemies of the current wave still to be spawned. */
  spawnQueue: { defId: ActorDefId; hp: number; damage: number; delay: number; x: number; y: number }[];
  /** Bounty multiplier of the running wave; a wave called in early pays more. */
  waveBounty: number;
  expansion: Expansion | null;
  skills: Record<SkillId, number>;
  fury: number;
  ward: number;
  assault: boolean;
  bossAlive: boolean;
  killed: number;
  goldFromKills: number;
  log: LogEntry[];
  landDirty: boolean;
  nextId: number;
  nextLogId: number;
  rng: () => number;
};

const TERRAIN_LETTERS: Record<string, TerrainKind> = {
  X: "barren",
  F: "forest",
  C: "crystal",
  R: "ruins",
  B: "boss",
};

const DECOR_COUNT: Record<TerrainKind, number> = {
  barren: 5,
  forest: 16,
  crystal: 9,
  ruins: 11,
  boss: 10,
};

function sectorIndex(col: number, row: number): number {
  return row * SECTOR_COLS + col;
}

function cellIndex(cx: number, cy: number): number {
  return cy * WORLD_CELLS_X + cx;
}

function cellCentre(cx: number, cy: number, cells: number): { x: number; y: number } {
  return { x: (cx + cells / 2) * CELL, y: (cy + cells / 2) * CELL };
}

function worldToCell(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CELL), cy: Math.floor(y / CELL) };
}

function sectorOfCell(cx: number, cy: number): number | null {
  const col = Math.floor(cx / SECTOR_CELLS);
  const row = Math.floor(cy / SECTOR_CELLS);
  if (col < 0 || row < 0 || col >= SECTOR_COLS || row >= SECTOR_ROWS) {
    return null;
  }
  return sectorIndex(col, row);
}

function sectorCentre(sector: Sector): { x: number; y: number } {
  return {
    x: sector.col * SECTOR_SIZE + SECTOR_SIZE / 2,
    y: sector.row * SECTOR_SIZE + SECTOR_SIZE / 2,
  };
}

function sectorDistance(a: Sector, b: { col: number; row: number }): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function neighbours(world: World, sector: Sector): Sector[] {
  const around = [
    { col: sector.col - 1, row: sector.row },
    { col: sector.col + 1, row: sector.row },
    { col: sector.col, row: sector.row - 1 },
    { col: sector.col, row: sector.row + 1 },
  ];
  const found: Sector[] = [];
  for (const cell of around) {
    if (cell.col < 0 || cell.row < 0 || cell.col >= SECTOR_COLS || cell.row >= SECTOR_ROWS) {
      continue;
    }
    found.push(world.sectors[sectorIndex(cell.col, cell.row)]);
  }
  return found;
}

/** A sector is reachable when the island already touches it. */
function isAdjacentToIsland(world: World, sector: Sector): boolean {
  return neighbours(world, sector).some((other) => other.state === "owned");
}

function ownedCount(world: World): number {
  return world.sectors.filter((sector) => sector.state === "owned").length;
}

function makeSector(index: number, col: number, row: number, terrain: TerrainKind, rng: () => number): Sector {
  const sector: Sector = {
    index,
    col,
    row,
    terrain,
    state: "locked",
    attach: 0,
    blocked: new Set<number>(),
    decor: [],
  };
  const count = DECOR_COUNT[terrain];
  for (let i = 0; i < count; i += 1) {
    const cx = col * SECTOR_CELLS + Math.floor(rng() * SECTOR_CELLS);
    const cy = row * SECTOR_CELLS + Math.floor(rng() * SECTOR_CELLS);
    sector.blocked.add(cellIndex(cx, cy));
    sector.decor.push({
      x: cx * CELL + range(rng, 6, CELL - 6),
      y: cy * CELL + range(rng, 6, CELL - 6),
      size: range(rng, 0.75, 1.35),
      variant: Math.floor(rng() * 4),
    });
  }
  return sector;
}

function createWorld(seed: number): World {
  const rng = mulberry32(seed);
  const sectors: Sector[] = [];
  for (let row = 0; row < SECTOR_ROWS; row += 1) {
    for (let col = 0; col < SECTOR_COLS; col += 1) {
      const letter = TERRAIN_ROWS[row][col];
      sectors.push(makeSector(sectorIndex(col, row), col, row, TERRAIN_LETTERS[letter], rng));
    }
  }

  const start = sectors[sectorIndex(START_SECTOR.col, START_SECTOR.row)];
  start.state = "owned";
  start.attach = 1;

  const world: World = {
    seed,
    time: 0,
    phase: "play",
    sectors,
    buildings: [],
    actors: [],
    projectiles: [],
    effects: [],
    occupancy: new Int32Array(WORLD_CELLS_X * WORLD_CELLS_Y),
    resources: { ...START_RESOURCES },
    pop: 0,
    popCap: 0,
    rally: { x: 0, y: 0 },
    wave: 0,
    waveTimer: WAVE.firstDelay,
    waveRunning: false,
    spawnQueue: [],
    waveBounty: 1,
    expansion: null,
    skills: { volley: 0, fury: 0, ward: 0 },
    fury: 0,
    ward: 0,
    assault: false,
    bossAlive: true,
    killed: 0,
    goldFromKills: 0,
    log: [],
    landDirty: true,
    nextId: 1,
    nextLogId: 1,
    rng,
  };

  // The core sits in the middle of the starting sector; clear the decor there.
  const coreCx = START_SECTOR.col * SECTOR_CELLS + 4;
  const coreCy = START_SECTOR.row * SECTOR_CELLS + 4;
  clearArea(world, coreCx - 1, coreCy - 1, 4);
  placeBuilding(world, "core", coreCx, coreCy);

  const centre = cellCentre(coreCx, coreCy, 2);
  world.rally = { x: centre.x, y: centre.y - 96 };
  recomputePopCap(world);
  return world;
}

function clearArea(world: World, cx: number, cy: number, size: number): void {
  for (const sector of world.sectors) {
    for (let y = cy; y < cy + size; y += 1) {
      for (let x = cx; x < cx + size; x += 1) {
        sector.blocked.delete(cellIndex(x, y));
      }
    }
    sector.decor = sector.decor.filter((item) => {
      const cell = worldToCell(item.x, item.y);
      const inside = cell.cx >= cx && cell.cx < cx + size && cell.cy >= cy && cell.cy < cy + size;
      return !inside;
    });
  }
}

function placeBuilding(world: World, defId: BuildingId, cx: number, cy: number): Building {
  const def = BUILDING_BY_ID.get(defId)!;
  const centre = cellCentre(cx, cy, def.cells);
  const building: Building = {
    id: world.nextId,
    defId,
    cx,
    cy,
    x: centre.x,
    y: centre.y,
    sector: sectorOfCell(cx, cy) ?? 0,
    hp: def.hp,
    maxHp: def.hp,
    build: def.buildTime > 0 ? 0 : 1,
    cooldown: 0,
    target: null,
    queue: [],
    hitFlash: 0,
    dead: false,
  };
  world.nextId += 1;
  world.buildings.push(building);
  for (let y = cy; y < cy + def.cells; y += 1) {
    for (let x = cx; x < cx + def.cells; x += 1) {
      world.occupancy[cellIndex(x, y)] = building.id;
    }
  }
  world.landDirty = true;
  return building;
}

function removeBuilding(world: World, building: Building): void {
  const def = BUILDING_BY_ID.get(building.defId)!;
  for (let y = building.cy; y < building.cy + def.cells; y += 1) {
    for (let x = building.cx; x < building.cx + def.cells; x += 1) {
      if (world.occupancy[cellIndex(x, y)] === building.id) {
        world.occupancy[cellIndex(x, y)] = 0;
      }
    }
  }
  world.landDirty = true;
}

/** Why the footprint cannot be built here, or `null` when it can. */
function placementError(world: World, def: BuildingDef, cx: number, cy: number): string | null {
  if (def.unique && world.buildings.some((item) => item.defId === def.id && !item.dead)) {
    return "Уже построено";
  }
  for (const required of def.requires) {
    if (!hasBuilding(world, required)) {
      return `Нужно: ${BUILDING_BY_ID.get(required)!.name}`;
    }
  }
  let sector: Sector | null = null;
  for (let y = cy; y < cy + def.cells; y += 1) {
    for (let x = cx; x < cx + def.cells; x += 1) {
      if (x < 0 || y < 0 || x >= WORLD_CELLS_X || y >= WORLD_CELLS_Y) {
        return "За краем мира";
      }
      const index = sectorOfCell(x, y);
      if (index === null) {
        return "За краем мира";
      }
      const cellSector = world.sectors[index];
      if (cellSector.state !== "owned") {
        return "Сектор не наш";
      }
      if (sector && sector.index !== cellSector.index) {
        return "Здание не может стоять на двух секторах";
      }
      sector = cellSector;
      if (world.occupancy[cellIndex(x, y)] !== 0) {
        return "Занято";
      }
      if (cellSector.blocked.has(cellIndex(x, y))) {
        return "Мешает порода";
      }
    }
  }
  if (!sector) {
    return "За краем мира";
  }
  if (def.terrain && !def.terrain.includes(sector.terrain)) {
    return `Только на: ${def.terrain.join(", ")}`;
  }
  if (!canAfford(world, def.cost)) {
    return "Не хватает ресурсов";
  }
  return null;
}

function hasBuilding(world: World, defId: BuildingId): boolean {
  return world.buildings.some((item) => item.defId === defId && !item.dead && item.build >= 1);
}

function canAfford(world: World, cost: Cost): boolean {
  return (
    world.resources.gold >= (cost.gold ?? 0) &&
    world.resources.wood >= (cost.wood ?? 0) &&
    world.resources.crystal >= (cost.crystal ?? 0)
  );
}

function spend(world: World, cost: Cost): void {
  world.resources.gold -= cost.gold ?? 0;
  world.resources.wood -= cost.wood ?? 0;
  world.resources.crystal -= cost.crystal ?? 0;
}

function recomputePopCap(world: World): void {
  let cap = 0;
  for (const building of world.buildings) {
    if (building.dead || building.build < 1) {
      continue;
    }
    cap += BUILDING_BY_ID.get(building.defId)!.popCap ?? 0;
  }
  world.popCap = cap;
}

function spawnActor(
  world: World,
  def: ActorDef,
  x: number,
  y: number,
  role: ActorRole,
  overrides?: { hp?: number; damage?: number },
): Actor {
  const hp = overrides?.hp ?? def.hp;
  const actor: Actor = {
    id: world.nextId,
    defId: def.id,
    team: def.team,
    role,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    damage: overrides?.damage ?? def.weapon.damage,
    cooldown: 0,
    target: null,
    homeX: x,
    homeY: y,
    facing: 0,
    hitFlash: 0,
    dead: false,
    step: 0,
  };
  world.nextId += 1;
  world.actors.push(actor);
  return actor;
}

function findActor(world: World, id: number): Actor | null {
  for (const actor of world.actors) {
    if (actor.id === id) {
      return actor.dead ? null : actor;
    }
  }
  return null;
}

function findBuilding(world: World, id: number): Building | null {
  for (const building of world.buildings) {
    if (building.id === id) {
      return building.dead ? null : building;
    }
  }
  return null;
}

function targetPosition(world: World, ref: TargetRef): { x: number; y: number; radius: number } | null {
  if (ref.kind === "actor") {
    const actor = findActor(world, ref.id);
    if (!actor) {
      return null;
    }
    // The body radius has to come from the def: separation keeps attackers at
    // least `radius + radius` away, so a fixed value leaves melee units unable
    // to ever reach anything bulky — the boss above all.
    return { x: actor.x, y: actor.y, radius: ACTOR_BY_ID.get(actor.defId)!.radius };
  }
  const building = findBuilding(world, ref.id);
  if (!building) {
    return null;
  }
  const def = BUILDING_BY_ID.get(building.defId)!;
  return { x: building.x, y: building.y, radius: (def.cells * CELL) / 2 };
}

function addEffect(world: World, effect: Effect): void {
  world.effects.push(effect);
  if (world.effects.length > 240) {
    world.effects.splice(0, world.effects.length - 240);
  }
}

function addLog(world: World, text: string, tone: LogEntry["tone"] = "info"): void {
  world.log.push({ id: world.nextLogId, text, tone });
  world.nextLogId += 1;
  if (world.log.length > 60) {
    world.log.splice(0, world.log.length - 60);
  }
}

function coreBuilding(world: World): Building | null {
  return world.buildings.find((item) => item.defId === "core" && !item.dead) ?? null;
}

function bossSector(world: World): Sector {
  return world.sectors.find((sector) => sector.terrain === "boss")!;
}

export type { World };
export {
  addEffect,
  addLog,
  bossSector,
  canAfford,
  cellCentre,
  cellIndex,
  coreBuilding,
  createWorld,
  findActor,
  findBuilding,
  hasBuilding,
  isAdjacentToIsland,
  neighbours,
  ownedCount,
  placeBuilding,
  placementError,
  recomputePopCap,
  removeBuilding,
  sectorCentre,
  sectorDistance,
  sectorIndex,
  sectorOfCell,
  spawnActor,
  spend,
  targetPosition,
  worldToCell,
};
