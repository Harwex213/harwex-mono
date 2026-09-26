import type { TResourceId, TResourcePool } from "./types";

/**
 * The resource table of the spec: three basic resources, five special ones and
 * two negative ones. The emoji are the ones the spec writes.
 */

type TResourceKind = "basic" | "special" | "negative";

type TResource = {
  readonly id: TResourceId;
  readonly emoji: string;
  readonly label: string;
  readonly kind: TResourceKind;
  /** What the resource is spent on, shown in the resources panel tooltip. */
  readonly feeds: string;
};

const RESOURCES: readonly TResource[] = [
  { id: "food", emoji: "🍗", label: "Еда", kind: "basic", feeds: "даёт население" },
  { id: "stone", emoji: "🪨", label: "Камень", kind: "basic", feeds: "даёт здания" },
  { id: "wood", emoji: "🪵", label: "Дерево", kind: "basic", feeds: "даёт здания" },
  { id: "population", emoji: "🧍", label: "Население", kind: "special", feeds: "даёт армию" },
  { id: "hammers", emoji: "⚒️", label: "Молотки", kind: "special", feeds: "даёт здания" },
  { id: "science", emoji: "📖", label: "Наука", kind: "special", feeds: "даёт технологии" },
  { id: "scouting", emoji: "🔭", label: "Разведка", kind: "special", feeds: "даёт разведку" },
  { id: "mana", emoji: "💠", label: "Мана", kind: "special", feeds: "даёт активные скиллы" },
  { id: "toxicity", emoji: "☣️", label: "Токсичность", kind: "negative", feeds: "травит остров" },
  { id: "mad", emoji: "🤖", label: "Сумасшедшие", kind: "negative", feeds: "съедает население" },
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
  toxicity: 0,
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
