import { resources } from "./resources";
import type { TBuildingDef, TBuildingKind } from "./building-def";

const LOWLAND = ["plains", "meadow"] as const;
const HIGHLAND = ["hills", "mountain"] as const;
const BUILDABLE = ["plains", "meadow", "forest", "hills"] as const;

/**
 * The default set of buildings. The order is the order of the cards in the
 * app: the town hall first, then food and materials, then what spends them.
 */
const BUILDING_CATALOG: readonly TBuildingDef[] = [
  {
    id: "townhall",
    label: "Ратуша",
    description: "Сердце поселения. Первая постройка на острове.",
    cost: resources(),
    // The materials trickle matters: materials are the only thing that buys
    // materials, so without it a player who spends the last plank has no way back.
    produces: resources({ food: 2, materials: 1 }),
    science: 1,
    housing: 5,
    buildTurns: 0,
    maxLevel: 3,
    placement: { terrains: BUILDABLE },
    unique: true,
  },
  {
    id: "farm",
    label: "Ферма",
    description: "Пашня на ровной земле.",
    cost: resources({ materials: 6 }),
    produces: resources({ food: 3 }),
    science: 0,
    housing: 0,
    buildTurns: 1,
    maxLevel: 3,
    placement: { terrains: LOWLAND, adjacent: true },
  },
  {
    id: "fishing_hut",
    label: "Рыбацкая хижина",
    description: "Только на берегу.",
    cost: resources({ materials: 4 }),
    produces: resources({ food: 2 }),
    science: 0,
    housing: 0,
    buildTurns: 1,
    maxLevel: 2,
    placement: { terrains: BUILDABLE, coastal: true, adjacent: true },
  },
  {
    id: "lumber_camp",
    label: "Лесопилка",
    description: "Рубит лес на клетке.",
    cost: resources({ materials: 5 }),
    produces: resources({ materials: 3 }),
    science: 0,
    housing: 0,
    buildTurns: 1,
    maxLevel: 3,
    placement: { terrains: ["forest"], adjacent: true },
  },
  {
    id: "quarry",
    label: "Каменоломня",
    description: "Камень с холмов и гор.",
    cost: resources({ materials: 8 }),
    produces: resources({ materials: 4 }),
    science: 0,
    housing: 0,
    buildTurns: 2,
    maxLevel: 3,
    placement: { terrains: HIGHLAND, adjacent: true },
  },
  {
    id: "mine",
    label: "Шахта",
    description: "Руда из горы. Долго строится.",
    cost: resources({ materials: 10 }),
    produces: resources({ metal: 2 }),
    science: 0,
    housing: 0,
    buildTurns: 3,
    maxLevel: 3,
    placement: { terrains: ["mountain"], adjacent: true },
    requires: "quarry",
  },
  {
    id: "house",
    label: "Дом",
    description: "Место для новых жителей.",
    cost: resources({ materials: 6 }),
    produces: resources(),
    science: 0,
    housing: 3,
    buildTurns: 1,
    maxLevel: 3,
    placement: { terrains: ["plains", "meadow", "hills"], adjacent: true },
  },
  {
    id: "library",
    label: "Библиотека",
    description: "Очки науки. Нужен хотя бы один дом.",
    cost: resources({ materials: 10, metal: 2 }),
    produces: resources(),
    science: 3,
    housing: 0,
    buildTurns: 2,
    maxLevel: 2,
    placement: { terrains: LOWLAND, adjacent: true },
    requires: "house",
  },
];

const CATALOG_BY_ID: ReadonlyMap<TBuildingKind, TBuildingDef> = new Map(BUILDING_CATALOG.map((def) => [def.id, def]));

const buildingDef = (kind: TBuildingKind): TBuildingDef => {
  const def = CATALOG_BY_ID.get(kind);
  if (!def) {
    throw new Error(`Unknown building kind: ${kind}`);
  }

  return def;
};

export { BUILDING_CATALOG, buildingDef };
