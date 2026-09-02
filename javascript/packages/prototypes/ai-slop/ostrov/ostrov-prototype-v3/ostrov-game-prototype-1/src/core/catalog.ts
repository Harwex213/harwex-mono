import type { TTerrain } from "@hw/ostrov-island-system";
import type { TBuildingType, TSquadType, TUnitType } from "./state";

type TBuildingDef = {
  type: TBuildingType;
  name: string;
  glyph: string;
  cost: number;
  /** Which of the three resources the building makes, if any. */
  yields: "production" | "food" | "metals" | null;
  yieldAmount: number;
  /** Extraction buildings burn one fossil per turn and stop when the hex is empty. */
  burnsDeposits: boolean;
  /** Terrains the building may stand on. Empty means any land. */
  terrains: readonly TTerrain[];
  /** Built by the players through a builders unit. The rest are placed by the map. */
  buildable: boolean;
  summary: string;
};

/**
 * Armour bonus for squads that defend a hex with a working military building.
 * Every point of armour takes a tenth off each hit, up to six tenths.
 */
const PASSIVE_DEFENCE_ARMOR = 3;

const ENGINE_HALF_COST = 40;

const BUILDING_DEFS: Record<TBuildingType, TBuildingDef> = {
  power: {
    type: "power",
    name: "Центр Власти",
    glyph: "★",
    cost: 0,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: false,
    summary: "Сердце игрока: +2 производства, +2 еды, +1 науки. Обучает поселенцев и строй-отряды. Потеря центра — поражение игрока.",
  },
  core: {
    type: "core",
    name: "Ядро Цитадели",
    glyph: "◈",
    cost: 0,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: false,
    summary: "Центр сверхразвитой Цитадели Нексус. Захват ядра — победа в партии.",
  },
  workshop: {
    type: "workshop",
    name: "Мастерская",
    glyph: "⚒",
    cost: 10,
    yields: "production",
    yieldAmount: 3,
    burnsDeposits: true,
    terrains: [],
    buildable: true,
    summary: "Перерабатывает ископаемые гекса в производство: +3 за ход, −1 ископаемое.",
  },
  farm: {
    type: "farm",
    name: "Ферма",
    glyph: "✿",
    cost: 10,
    yields: "food",
    yieldAmount: 3,
    burnsDeposits: true,
    terrains: ["plains", "meadow"],
    buildable: true,
    summary: "Перерабатывает ископаемые в еду: +3 за ход, −1 ископаемое. Только на равнине и лугах.",
  },
  mine: {
    type: "mine",
    name: "Рудник",
    glyph: "⛏",
    cost: 14,
    yields: "metals",
    yieldAmount: 2,
    burnsDeposits: true,
    terrains: ["hills", "mountain"],
    buildable: true,
    summary: "Перерабатывает ископаемые в металлы: +2 за ход, −1 ископаемое. Только на холмах и в горах.",
  },
  housing: {
    type: "housing",
    name: "Поселение",
    glyph: "⌂",
    cost: 12,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: true,
    summary: "Растит население: +1 житель за ход, если есть 3 еды. Каждые 4 жителя дают +1 производства.",
  },
  lab: {
    type: "lab",
    name: "Лаборатория",
    glyph: "✧",
    cost: 16,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: true,
    summary: "Даёт +2 очка науки за ход в общий котёл исследований.",
  },
  barracks: {
    type: "barracks",
    name: "Казармы",
    glyph: "⚔",
    cost: 18,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: true,
    summary: "Формирует и пополняет армии за металлы. Даёт активный навык «Залп» в бою и +3 брони (−30% урона) обороняющимся на этом гексе.",
  },
  engine: {
    type: "engine",
    name: "Двигатель острова",
    glyph: "⚙",
    cost: ENGINE_HALF_COST * 2,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: true,
    summary: "Две половины, по одной на игрока. Каждый вкладывает 40 производства в свою. Готовый двигатель сдвигает весь остров на один гекс за ход.",
  },
  camp: {
    type: "camp",
    name: "Лагерь туземцев",
    glyph: "▲",
    cost: 0,
    yields: null,
    yieldAmount: 0,
    burnsDeposits: false,
    terrains: [],
    buildable: false,
    summary: "Раз в несколько ходов выпускает отряд туземцев. Захват лагеря даёт добычу.",
  },
};

const BUILDABLE_TYPES: readonly TBuildingType[] = (Object.keys(BUILDING_DEFS) as TBuildingType[]).filter((type) => {
  return BUILDING_DEFS[type].buildable;
});

type TUnitDef = {
  type: TUnitType;
  name: string;
  glyph: string;
  moves: number;
  productionCost: number;
  metalsCost: number;
  populationCost: number;
  summary: string;
};

const UNIT_DEFS: Record<TUnitType, TUnitDef> = {
  settler: {
    type: "settler",
    name: "Поселенец",
    glyph: "П",
    moves: 2,
    productionCost: 8,
    metalsCost: 0,
    populationCost: 2,
    summary: "Основывает Центр Власти. Один центр на игрока.",
  },
  builders: {
    type: "builders",
    name: "Строй-отряд",
    glyph: "С",
    moves: 2,
    productionCost: 6,
    metalsCost: 0,
    populationCost: 1,
    summary: "Закладывает здания и строит их, пока стоит на стройке.",
  },
  army: {
    type: "army",
    name: "Армия",
    glyph: "А",
    moves: 2,
    productionCost: 6,
    metalsCost: 4,
    populationCost: 1,
    summary: "Несёт боевые отряды. Столкновение с чужой армией начинает бой.",
  },
};

type TSquadDef = {
  type: TSquadType;
  name: string;
  hp: number;
  attack: number;
  /** 1 hits the front row first, 2 and more reach any row. */
  range: number;
  speed: number;
  armor: number;
  /** Hits every enemy in the target row for a share of the damage. */
  splash: boolean;
  era: string;
};

const SQUAD_DEFS: Record<TSquadType, TSquadDef> = {
  militia: { type: "militia", name: "Ополчение", hp: 20, attack: 4, range: 1, speed: 3, armor: 0, splash: false, era: "Племя" },
  tribesmen: { type: "tribesmen", name: "Воины племени", hp: 22, attack: 5, range: 1, speed: 4, armor: 0, splash: false, era: "Племя" },
  spearmen: { type: "spearmen", name: "Копейщики", hp: 28, attack: 6, range: 1, speed: 3, armor: 1, splash: false, era: "Бронза" },
  archers: { type: "archers", name: "Лучники", hp: 18, attack: 6, range: 2, speed: 5, armor: 0, splash: false, era: "Бронза" },
  swordsmen: { type: "swordsmen", name: "Мечники", hp: 34, attack: 9, range: 1, speed: 4, armor: 2, splash: false, era: "Железо" },
  catapult: { type: "catapult", name: "Катапульта", hp: 22, attack: 12, range: 3, speed: 1, armor: 0, splash: true, era: "Механика" },
  riflemen: { type: "riflemen", name: "Стрелки", hp: 30, attack: 14, range: 2, speed: 4, armor: 1, splash: false, era: "Порох" },
  plasma: { type: "plasma", name: "Плазменная гвардия", hp: 50, attack: 22, range: 2, speed: 5, armor: 3, splash: false, era: "Sci-fi" },
  drone: { type: "drone", name: "Дроны-охотники", hp: 40, attack: 16, range: 2, speed: 7, armor: 1, splash: false, era: "Нексус" },
  mech: { type: "mech", name: "Мех-страж", hp: 90, attack: 24, range: 1, speed: 2, armor: 4, splash: true, era: "Нексус" },
};

/** Squads the players can form, from the weakest up. The best unlocked one is formed. */
const PLAYER_SQUAD_LADDER: readonly TSquadType[] = ["militia", "spearmen", "archers", "swordsmen", "catapult", "riflemen", "plasma"];

const MAX_SQUADS_PER_SIDE = 6;

/** Loot for razing a natives camp. */
const CAMP_LOOT = { production: 8, metals: 6 };

/** Turn distance between two native raids out of a camp. */
const CAMP_SPAWN_EVERY = 5;

export type { TBuildingDef, TSquadDef, TUnitDef };
export {
  BUILDABLE_TYPES,
  BUILDING_DEFS,
  CAMP_LOOT,
  CAMP_SPAWN_EVERY,
  ENGINE_HALF_COST,
  MAX_SQUADS_PER_SIDE,
  PASSIVE_DEFENCE_ARMOR,
  PLAYER_SQUAD_LADDER,
  SQUAD_DEFS,
  UNIT_DEFS,
};
