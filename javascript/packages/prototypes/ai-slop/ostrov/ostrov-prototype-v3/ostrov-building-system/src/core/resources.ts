/** The three things a settlement collects and spends. */
type TResourceKind = "food" | "materials" | "metal";

type TResources = Record<TResourceKind, number>;

const RESOURCE_LIST: readonly TResourceKind[] = ["food", "materials", "metal"];

const RESOURCE_LABELS: Record<TResourceKind, string> = {
  food: "Еда",
  materials: "Строительные материалы",
  metal: "Металлы",
};

/** What each resource is for; shown as the tooltip. */
const RESOURCE_PURPOSES: Record<TResourceKind, string> = {
  food: "Население",
  materials: "Здания",
  metal: "Армия",
};

const EMPTY_RESOURCES: TResources = { food: 0, materials: 0, metal: 0 };

/** Fills the missing kinds of a partial bundle with zero. */
const resources = (partial: Partial<TResources> = {}): TResources => ({ ...EMPTY_RESOURCES, ...partial });

const mapResources = (a: TResources, f: (value: number, kind: TResourceKind) => number): TResources => ({
  food: f(a.food, "food"),
  materials: f(a.materials, "materials"),
  metal: f(a.metal, "metal"),
});

const addResources = (a: TResources, b: TResources) => mapResources(a, (value, kind) => value + b[kind]);

const subtractResources = (a: TResources, b: TResources) => mapResources(a, (value, kind) => value - b[kind]);

const scaleResources = (a: TResources, factor: number) => mapResources(a, (value) => value * factor);

/** True when every kind of `have` covers `cost`. */
const canAfford = (have: TResources, cost: TResources) => {
  return RESOURCE_LIST.every((kind) => have[kind] >= cost[kind]);
};

/** The kinds that fall short, for an error message. */
const missingResources = (have: TResources, cost: TResources): TResourceKind[] => {
  return RESOURCE_LIST.filter((kind) => have[kind] < cost[kind]);
};

/** Storage never goes below zero; a starving settlement just sits at zero. */
const clampResources = (a: TResources) => mapResources(a, (value) => Math.max(0, value));

const isEmptyResources = (a: TResources) => RESOURCE_LIST.every((kind) => a[kind] === 0);

export type { TResourceKind, TResources };
export {
  EMPTY_RESOURCES,
  RESOURCE_LABELS,
  RESOURCE_LIST,
  RESOURCE_PURPOSES,
  addResources,
  canAfford,
  clampResources,
  isEmptyResources,
  missingResources,
  resources,
  scaleResources,
  subtractResources,
};
