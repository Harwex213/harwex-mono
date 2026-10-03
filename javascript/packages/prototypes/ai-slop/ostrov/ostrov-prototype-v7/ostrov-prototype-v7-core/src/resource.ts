type ResourceKind =
  | "food"
  | "stone"
  | "wood"
  | "population"
  | "hammers"
  | "science"
  | "scouting"
  | "mana";

type Cost = Partial<Record<ResourceKind, number>>;

type Combo = {
  amount: number;
  toxicity: number;
};

type Yield = {
  resource: ResourceKind;
  amount: number;
  toxicity: number;
};

const resourceKinds: readonly ResourceKind[] = [
  "food",
  "stone",
  "wood",
  "population",
  "hammers",
  "science",
  "scouting",
  "mana",
];

const resourceTitles: Record<ResourceKind, string> = {
  food: "🍗 еда",
  stone: "🪨 камень",
  wood: "🪵 дерево",
  population: "🧍 население",
  hammers: "⚒️ молотки",
  science: "📖 наука",
  scouting: "🔭 разведка",
  mana: "💠 мана",
};

export { resourceKinds, resourceTitles };
export type { Combo, Cost, ResourceKind, Yield };
