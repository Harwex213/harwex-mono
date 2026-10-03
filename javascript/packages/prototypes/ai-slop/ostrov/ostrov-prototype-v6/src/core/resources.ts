import { ICONS } from "./icons";
import type { TResourceId, TResourcePool } from "./types";

/**
 * The resource table of the spec: three basic resources, six special ones and
 * one negative one. Toxicity left the table for the meter in `toxic-slot.ts`. The spec writes an emoji for each; the game draws the
 * matching 64x64 icon instead.
 */

type TResourceKind = "basic" | "special" | "negative";

type TResource = {
  readonly id: TResourceId;
  readonly icon: string;
  readonly label: string;
  readonly kind: TResourceKind;
  /** What the resource is spent on, shown in the resources panel tooltip. */
  readonly feeds: string;
};

const RESOURCES: readonly TResource[] = [
  { id: "food", icon: ICONS.food, label: "Еда", kind: "basic", feeds: "даёт население" },
  { id: "stone", icon: ICONS.stone, label: "Камень", kind: "basic", feeds: "даёт здания" },
  { id: "wood", icon: ICONS.wood, label: "Дерево", kind: "basic", feeds: "даёт здания" },
  { id: "population", icon: ICONS.population, label: "Население", kind: "special", feeds: "даёт армию" },
  { id: "hammers", icon: ICONS.hammers, label: "Молотки", kind: "special", feeds: "даёт здания" },
  { id: "science", icon: ICONS.science, label: "Наука", kind: "special", feeds: "даёт технологии" },
  { id: "scouting", icon: ICONS.scouting, label: "Разведка", kind: "special", feeds: "даёт разведку" },
  { id: "mana", icon: ICONS.mana, label: "Мана", kind: "special", feeds: "даёт активные скиллы" },
  { id: "power", icon: ICONS.power, label: "Власть", kind: "special", feeds: "меняет выпавшую грань здания" },
  { id: "mad", icon: ICONS.mad, label: "Сумасшедшие", kind: "negative", feeds: "съедает население" },
];

const RESOURCE_BY_ID = new Map(RESOURCES.map((resource) => [resource.id, resource]));

const getResource = (id: TResourceId) => {
  const resource = RESOURCE_BY_ID.get(id);
  if (!resource) {
    throw new Error(`Unknown resource: ${id}`);
  }

  return resource;
};

const EMPTY_POOL: TResourcePool = {
  food: 0,
  stone: 0,
  wood: 0,
  population: 0,
  hammers: 0,
  science: 0,
  scouting: 0,
  mana: 0,
  power: 0,
  mad: 0,
};

/**
 * What a player starts the first build phase with. Enough stone, wood and
 * hammers for a handful of buildings, so the first turn is a real decision.
 */
const STARTING_POOL: TResourcePool = {
  ...EMPTY_POOL,
  food: 10,
  stone: 12,
  wood: 12,
  population: 6,
  hammers: 6,
  // Enough to scout once before an observatory is standing.
  scouting: 2,
  // Enough for one face change in the first tax phase, or two cheap ones.
  power: 2,
};

const addResources = (pool: TResourcePool, delta: Partial<Record<TResourceId, number>>): TResourcePool => {
  const next = { ...pool } as Record<TResourceId, number>;

  for (const [id, amount] of Object.entries(delta)) {
    next[id as TResourceId] = next[id as TResourceId] + (amount ?? 0);
  }

  return next;
};

export type { TResource, TResourceKind };
export { addResources, EMPTY_POOL, getResource, RESOURCES, STARTING_POOL };
