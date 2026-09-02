import type { TBuildingType, TResearchState, TSquadType } from "./state";

type TTechDef = {
  id: string;
  name: string;
  cost: number;
  requires: readonly string[];
  unlocksBuildings: readonly TBuildingType[];
  unlocksSquads: readonly TSquadType[];
  /** Free-form effects the rules read by tech id. */
  effect: string;
  /** Column of the tech tree drawing, from the tribal start to sci-fi. */
  tier: number;
};

/**
 * The shared tree. Both players research the same list, and the whole union
 * benefits from every tech. Tiers walk from the tribal start to plasma weapons.
 */
const TECH_DEFS: readonly TTechDef[] = [
  {
    id: "tribe",
    name: "Племенной уклад",
    cost: 0,
    requires: [],
    unlocksBuildings: ["power", "housing"],
    unlocksSquads: ["militia"],
    effect: "Центр Власти, поселения и ополчение",
    tier: 0,
  },
  {
    id: "farming",
    name: "Земледелие",
    cost: 8,
    requires: ["tribe"],
    unlocksBuildings: ["farm"],
    unlocksSquads: [],
    effect: "Фермы на равнине и лугах",
    tier: 1,
  },
  {
    id: "crafts",
    name: "Ремесло",
    cost: 8,
    requires: ["tribe"],
    unlocksBuildings: ["workshop"],
    unlocksSquads: [],
    effect: "Мастерские",
    tier: 1,
  },
  {
    id: "warfare",
    name: "Военное дело",
    cost: 10,
    requires: ["tribe"],
    unlocksBuildings: ["barracks"],
    unlocksSquads: ["spearmen"],
    effect: "Казармы, копейщики и навык «Боевой дух»",
    tier: 1,
  },
  {
    id: "mining",
    name: "Горное дело",
    cost: 10,
    requires: ["crafts"],
    unlocksBuildings: ["mine"],
    unlocksSquads: [],
    effect: "Рудники на холмах и в горах",
    tier: 2,
  },
  {
    id: "writing",
    name: "Письменность",
    cost: 12,
    requires: ["farming"],
    unlocksBuildings: ["lab"],
    unlocksSquads: [],
    effect: "Лаборатории",
    tier: 2,
  },
  {
    id: "rafts",
    name: "Плоты",
    cost: 12,
    requires: ["crafts"],
    unlocksBuildings: [],
    unlocksSquads: [],
    effect: "Юниты перепрыгивают один гекс моря",
    tier: 2,
  },
  {
    id: "bows",
    name: "Луки",
    cost: 10,
    requires: ["warfare"],
    unlocksBuildings: [],
    unlocksSquads: ["archers"],
    effect: "Лучники бьют через первый ряд",
    tier: 2,
  },
  {
    id: "metallurgy",
    name: "Металлургия",
    cost: 16,
    requires: ["mining", "warfare"],
    unlocksBuildings: [],
    unlocksSquads: ["swordsmen"],
    effect: "Мечники; рудники дают +1 металла",
    tier: 3,
  },
  {
    id: "engineering",
    name: "Инженерия",
    cost: 20,
    requires: ["writing", "crafts"],
    unlocksBuildings: ["engine"],
    unlocksSquads: [],
    effect: "Двигатель острова; мастерские дают +1 производства",
    tier: 3,
  },
  {
    id: "ballistics",
    name: "Баллистика",
    cost: 20,
    requires: ["engineering", "bows"],
    unlocksBuildings: [],
    unlocksSquads: ["catapult"],
    effect: "Катапульты бьют по всему ряду",
    tier: 4,
  },
  {
    id: "gunpowder",
    name: "Порох",
    cost: 28,
    requires: ["metallurgy", "ballistics"],
    unlocksBuildings: [],
    unlocksSquads: ["riflemen"],
    effect: "Стрелки",
    tier: 5,
  },
  {
    id: "electricity",
    name: "Электричество",
    cost: 30,
    requires: ["engineering"],
    unlocksBuildings: [],
    unlocksSquads: [],
    effect: "Лаборатории дают +2 науки; двигатель делает два шага за ход",
    tier: 5,
  },
  {
    id: "plasma",
    name: "Плазменное оружие",
    cost: 45,
    requires: ["gunpowder", "electricity"],
    unlocksBuildings: [],
    unlocksSquads: ["plasma"],
    effect: "Плазменная гвардия — ровня стражам Нексуса",
    tier: 6,
  },
];

const TECH_BY_ID: Record<string, TTechDef> = TECH_DEFS.reduce((map, tech) => {
  map[tech.id] = tech;

  return map;
}, {} as Record<string, TTechDef>);

const isKnown = (research: TResearchState, techId: string) => research.known.includes(techId);

/** A tech every prerequisite of which is known, and which is not known itself. */
const isResearchable = (research: TResearchState, techId: string) => {
  const tech = TECH_BY_ID[techId];

  if (tech === undefined || isKnown(research, techId)) {
    return false;
  }

  return tech.requires.every((required) => isKnown(research, required));
};

const isBuildingUnlocked = (research: TResearchState, type: TBuildingType) => {
  return research.known.some((techId) => TECH_BY_ID[techId]?.unlocksBuildings.includes(type));
};

const isSquadUnlocked = (research: TResearchState, type: TSquadType) => {
  return research.known.some((techId) => TECH_BY_ID[techId]?.unlocksSquads.includes(type));
};

const createResearchState = (): TResearchState => ({
  known: ["tribe"],
  current: null,
  progress: 0,
  banked: 0,
});

export type { TTechDef };
export { TECH_BY_ID, TECH_DEFS, createResearchState, isBuildingUnlocked, isKnown, isResearchable, isSquadUnlocked };
