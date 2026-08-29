import { BUILDING_DEFS } from "./buildings";
import { RESOURCE_KINDS } from "./types";
import type { TGameSnapshot, TLogEntry, TPlacedBuilding, TResourceKind, TResources } from "./types";

/** Two colonists sleep in the starting camp even with no house standing. */
const BASE_HOUSING = 2;
const BASE_STORAGE = 60;
/** Food spent to raise one new colonist. */
const GROWTH_FOOD_COST = 10;
const VICTORY_POPULATION = 15;

type TLogDraft = Omit<TLogEntry, "id">;

type TEconomySummary = {
  housing: number;
  storage: number;
  /** Workers every finished building would like to have. */
  jobs: number;
  workersUsed: number;
  freeWorkers: number;
  production: TResources;
  upkeep: number;
  net: TResources;
  /** Tiles whose building is finished and fully staffed. */
  working: ReadonlySet<number>;
  /** Tiles whose building is finished but stands idle for want of colonists. */
  idle: ReadonlySet<number>;
  underConstruction: number;
};

const emptyResources = (): TResources => ({ food: 0, wood: 0, stone: 0 });

const addResources = (target: TResources, delta: Partial<TResources>): void => {
  for (const [resource, amount] of Object.entries(delta) as [TResourceKind, number][]) {
    target[resource] += amount;
  }
};

const subtractResources = (target: TResources, delta: Partial<TResources>): void => {
  for (const [resource, amount] of Object.entries(delta) as [TResourceKind, number][]) {
    target[resource] -= amount;
  }
};

const finishedBuildings = (buildings: readonly (TPlacedBuilding | null)[]): TPlacedBuilding[] => {
  const result: TPlacedBuilding[] = [];

  for (const building of buildings) {
    if (!building || building.remaining > 0) {
      continue;
    }
    result.push(building);
  }
  result.sort((first, second) => first.order - second.order);

  return result;
};

/**
 * Reads the colony without changing it: what it houses, what it stores, and what
 * next turn would produce. Workers go to the oldest buildings first, and a
 * building that cannot be fully staffed produces nothing at all. The pass does
 * not stop at the first building it cannot staff, so a cheap sawmill still runs
 * while an expensive mine waits for a second colonist.
 */
const summariseEconomy = (snapshot: TGameSnapshot): TEconomySummary => {
  const production = emptyResources();
  const working = new Set<number>();
  const idle = new Set<number>();
  let housing = BASE_HOUSING;
  let storage = BASE_STORAGE;
  let jobs = 0;
  let workersUsed = 0;
  let underConstruction = 0;

  for (const building of snapshot.buildings) {
    if (building && building.remaining > 0) {
      underConstruction += 1;
    }
  }

  for (const building of finishedBuildings(snapshot.buildings)) {
    const definition = BUILDING_DEFS[building.kind];
    housing += definition.housing;
    storage += definition.storage;
    jobs += definition.workers;

    if (definition.workers === 0) {
      working.add(building.tileIndex);
      addResources(production, definition.yields);

      continue;
    }

    if (workersUsed + definition.workers > snapshot.population) {
      idle.add(building.tileIndex);

      continue;
    }

    workersUsed += definition.workers;
    working.add(building.tileIndex);
    addResources(production, definition.yields);
  }

  const upkeep = snapshot.population;
  const net = { ...production, food: production.food - upkeep };

  return {
    housing,
    storage,
    jobs,
    workersUsed,
    freeWorkers: snapshot.population - workersUsed,
    production,
    upkeep,
    net,
    working,
    idle,
    underConstruction,
  };
};

const clampToStorage = (resources: TResources, storage: number): void => {
  for (const resource of RESOURCE_KINDS) {
    resources[resource] = Math.max(0, Math.min(storage, Math.round(resources[resource])));
  }
};

type TTurnOutcome = {
  snapshot: TGameSnapshot;
  entries: TLogDraft[];
  victory: boolean;
};

/**
 * Resolves one turn in a fixed order: sites finish first, then the finished
 * buildings produce, then the colony eats, and only what is left over feeds
 * growth. Building first means a site ordered last turn pays off this turn.
 */
const resolveTurn = (snapshot: TGameSnapshot): TTurnOutcome => {
  const turn = snapshot.turn;
  const entries: TLogDraft[] = [];
  const buildings = snapshot.buildings.map((building) => {
    if (!building || building.remaining === 0) {
      return building;
    }

    return { ...building, remaining: building.remaining - 1 };
  });

  for (let index = 0; index < buildings.length; index += 1) {
    const before = snapshot.buildings[index];
    const after = buildings[index];
    if (!before || !after || before.remaining === 0 || after.remaining > 0) {
      continue;
    }
    entries.push({ turn, tone: "good", text: `${BUILDING_DEFS[after.kind].label} достроена.` });
  }

  const advanced: TGameSnapshot = { ...snapshot, buildings };
  const summary = summariseEconomy(advanced);
  const resources = { ...snapshot.resources };
  addResources(resources, summary.production);
  clampToStorage(resources, summary.storage);

  let population = snapshot.population;
  const eaten = Math.min(resources.food, summary.upkeep);
  const shortfall = summary.upkeep - eaten;
  resources.food -= eaten;

  if (shortfall > 0 && population > 1) {
    population -= 1;
    entries.push({ turn, tone: "warn", text: `Голод: не хватило ${shortfall} еды, колонистов стало ${population}.` });
  } else if (shortfall > 0) {
    entries.push({ turn, tone: "warn", text: "Голод: последний колонист держится из последних сил." });
  }

  if (summary.idle.size > 0) {
    entries.push({ turn, tone: "warn", text: `Без работников простаивает построек: ${summary.idle.size}.` });
  }

  if (resources.food >= GROWTH_FOOD_COST && population < summary.housing) {
    resources.food -= GROWTH_FOOD_COST;
    population += 1;
    entries.push({ turn, tone: "good", text: `Прибавление: колонистов стало ${population}.` });
  } else if (population >= summary.housing && summary.housing > 0) {
    entries.push({ turn, tone: "info", text: "Жильё заполнено, население не растёт." });
  }

  const victory = population >= VICTORY_POPULATION;
  if (victory) {
    entries.push({ turn: turn + 1, tone: "good", text: `Остров процветает: ${population} колонистов!` });
  }

  return {
    snapshot: { turn: turn + 1, resources, population, buildings },
    entries,
    victory,
  };
};

export type { TEconomySummary, TLogDraft, TTurnOutcome };
export {
  BASE_HOUSING,
  BASE_STORAGE,
  GROWTH_FOOD_COST,
  VICTORY_POPULATION,
  addResources,
  emptyResources,
  resolveTurn,
  subtractResources,
  summariseEconomy,
};
