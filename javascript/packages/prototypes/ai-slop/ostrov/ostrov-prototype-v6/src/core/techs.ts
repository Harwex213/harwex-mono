import type { TUnitId } from "./units";

/**
 * The spec leaves the technology screen blank, so this tree is invented. It is
 * built to pay out into the three phases that already exist: science unlocks
 * the units the clearing phase fields, cheapens the build phase and slows the
 * toxicity the tax phase produces.
 */

type TTechBranch = "military" | "economy" | "ecology";

type TTechId =
  | "spears"
  | "swords"
  | "halberds"
  | "knighthood"
  | "slings"
  | "archery"
  | "longbow"
  | "gunpowder"
  | "stables"
  | "heavy_stables"
  | "falconry"
  | "griffin_roost"
  | "masonry"
  | "irrigation"
  | "filters"
  | "asylums";

type TTech = {
  readonly id: TTechId;
  readonly label: string;
  readonly branch: TTechBranch;
  readonly cost: number;
  readonly requires: readonly TTechId[];
  readonly description: string;
  readonly unlocks: readonly TUnitId[];
};

const TECHS: readonly TTech[] = [
  {
    id: "spears",
    label: "Копья",
    branch: "military",
    cost: 8,
    requires: [],
    description: "Копейщик достаёт врага раньше, чем тот дотянется до него.",
    unlocks: ["spearman"],
  },
  {
    id: "swords",
    label: "Мечи",
    branch: "military",
    cost: 18,
    requires: ["spears"],
    description: "Мечник — прочная середина строя.",
    unlocks: ["swordsman"],
  },
  {
    id: "halberds",
    label: "Алебарды",
    branch: "military",
    cost: 30,
    requires: ["swords"],
    description: "Алебардист бьёт дальше мечника и держит удар.",
    unlocks: ["halberdier"],
  },
  {
    id: "knighthood",
    label: "Рыцарство",
    branch: "military",
    cost: 48,
    requires: ["halberds"],
    description: "Рыцарь переживает то, что убивает всех остальных.",
    unlocks: ["knight"],
  },
  {
    id: "slings",
    label: "Пращи",
    branch: "military",
    cost: 8,
    requires: [],
    description: "Пращник — первый, кто бьёт на расстоянии.",
    unlocks: ["slinger"],
  },
  {
    id: "archery",
    label: "Стрельба из лука",
    branch: "military",
    cost: 20,
    requires: ["slings"],
    description: "Лучник бьёт вдвое дальше пращника.",
    unlocks: ["archer"],
  },
  {
    id: "longbow",
    label: "Длинный лук",
    branch: "military",
    cost: 34,
    requires: ["archery"],
    description: "Длинный лучник достаёт врага через весь разрыв между островами.",
    unlocks: ["longbowman"],
  },
  {
    id: "gunpowder",
    label: "Порох",
    branch: "military",
    cost: 52,
    requires: ["longbow"],
    description: "Мушкетёр бьёт сильнее всех стрелков.",
    unlocks: ["musketeer"],
  },
  {
    id: "stables",
    label: "Конюшни",
    branch: "military",
    cost: 24,
    requires: ["slings"],
    description: "Кавалерия быстрее пехоты вдвое и живёт дольше стрелков.",
    unlocks: ["cavalry_slinger", "cavalry_archer"],
  },
  {
    id: "heavy_stables",
    label: "Тяжёлая кавалерия",
    branch: "military",
    cost: 44,
    requires: ["stables", "longbow"],
    description: "Длинный лучник и мушкетёр в седле.",
    unlocks: ["cavalry_longbowman", "cavalry_musketeer"],
  },
  {
    id: "falconry",
    label: "Соколиная охота",
    branch: "military",
    cost: 26,
    requires: [],
    description: "Ворона и великий орёл достают воздушных врагов.",
    unlocks: ["crow", "great_eagle"],
  },
  {
    id: "griffin_roost",
    label: "Гнездо грифонов",
    branch: "military",
    cost: 56,
    requires: ["falconry", "knighthood"],
    description: "Грифон — самое живучее, что есть у острова.",
    unlocks: ["griffin"],
  },
  {
    id: "masonry",
    label: "Каменная кладка",
    branch: "economy",
    cost: 14,
    requires: [],
    description: "Каждое здание обходится на 1 🪨 дешевле.",
    unlocks: [],
  },
  {
    id: "irrigation",
    label: "Ирригация",
    branch: "economy",
    cost: 16,
    requires: [],
    description: "Каждый бросок, который даёт еду, даёт на 1 🍗 больше.",
    unlocks: [],
  },
  {
    id: "filters",
    label: "Фильтры",
    branch: "ecology",
    cost: 22,
    requires: [],
    description: "Здания пачкают свой гекс на четверть меньше.",
    unlocks: [],
  },
  {
    id: "asylums",
    label: "Лечебницы",
    branch: "ecology",
    cost: 30,
    requires: ["filters"],
    description: "Каждый ход один сумасшедший возвращается к работе.",
    unlocks: [],
  },
];

const TECH_BY_ID = new Map(TECHS.map((tech) => [tech.id, tech]));

const getTech = (id: TTechId) => {
  const tech = TECH_BY_ID.get(id);
  if (!tech) {
    throw new Error(`Unknown tech: ${id}`);
  }

  return tech;
};

/** Everything the researched set changes, gathered in one place. */
type TTechEffects = {
  readonly unlockedUnits: readonly TUnitId[];
  readonly stoneDiscount: number;
  readonly foodBonus: number;
  readonly toxicityMultiplier: number;
  readonly madCuredPerTurn: number;
};

const FILTERS_TOXICITY_MULTIPLIER = 0.75;

const techEffects = (researched: readonly TTechId[]): TTechEffects => {
  const owned = new Set(researched);

  return {
    // The militia needs no research: an island can always arm its farmers.
    unlockedUnits: ["militia", ...TECHS.filter((tech) => owned.has(tech.id)).flatMap((tech) => tech.unlocks)],
    stoneDiscount: owned.has("masonry") ? 1 : 0,
    foodBonus: owned.has("irrigation") ? 1 : 0,
    toxicityMultiplier: owned.has("filters") ? FILTERS_TOXICITY_MULTIPLIER : 1,
    madCuredPerTurn: owned.has("asylums") ? 1 : 0,
  };
};

const isAvailable = (tech: TTech, researched: readonly TTechId[]) => {
  const owned = new Set(researched);

  return !owned.has(tech.id) && tech.requires.every((required) => owned.has(required));
};

export type { TTech, TTechBranch, TTechEffects, TTechId };
export { getTech, isAvailable, TECHS, techEffects };
