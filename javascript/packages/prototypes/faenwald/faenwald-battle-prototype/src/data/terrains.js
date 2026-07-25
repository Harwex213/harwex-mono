/**
 * `color` is a semantic token name from tokens.css —
 * pages build swatch/fill CSS from it, and the canvas renderer resolves it via getComputedStyle.
 */
const COLOR_PLAIN = "--terrain-plain";
const COLOR_MUD = "--terrain-mud";
const COLOR_THICKET = "--terrain-thicket";
const COLOR_FOREST = "--terrain-forest";
const COLOR_FOOTHILLS = "--terrain-foothills";
const COLOR_HILLS = "--terrain-hills";
const COLOR_MOUNTAIN = "--terrain-mountain";
const COLOR_WATER = "--terrain-water";
const COLOR_SWAMP = "--terrain-swamp";
const COLOR_ICE = "--terrain-ice";
const COLOR_ROAD = "--terrain-road";
const COLOR_SETTLEMENT = "--terrain-settlement";

/**
 * Terrain catalog for hex maps: identity + presentation, plus gameplay attributes:
 * - `impassable: true` - marks hexes units can never occupy (гора/вода per §1.4); also
 *   grants сомкнутый-строй flank cover. Omitted means passable.
 */
const TERRAINS = [
  {
    id: "plain",
    name: "Равнина",
    color: COLOR_PLAIN,
  },
  {
    id: "mud",
    name: "Грязь",
    color: COLOR_MUD,
    occupantMoveCostMult: 2,
  },
  {
    id: "thicket",
    name: "Заросли",
    color: COLOR_THICKET,
    entryCost: { base: 1, cavalry: 2 },
    rangedDamageTakenMult: 0.75,
  },
  {
    id: "forest",
    name: "Лес",
    color: COLOR_FOREST,
    speedCap: { cavalry: 1 },
    rangedDamageTakenMult: 0.5,
    blocksDirectLos: true,
  },
  {
    id: "foothills",
    name: "Предхолмье",
    color: COLOR_FOOTHILLS,
    elevation: 1,
  },
  {
    id: "hills",
    name: "Холм",
    color: COLOR_HILLS,
    elevation: 2,
  },
  {
    id: "mountain",
    name: "Гора",
    color: COLOR_MOUNTAIN,
    impassable: true,
    blocksDirectLos: true,
    blocksArcFire: true,
  },
  {
    id: "water",
    name: "Вода",
    color: COLOR_WATER,
    impassable: true,
  },
  {
    id: "swamp",
    name: "Топь",
    color: COLOR_SWAMP,
    occupantMoveCostMult: 3,
  },
  {
    id: "ice",
    name: "Лёд",
    color: COLOR_ICE
  },
  {
    id: "road",
    name: "Дорога",
    color: COLOR_ROAD,
    occupantMoveCostMult: 0.5,
  },
  {
    id: "settlement",
    name: "Поселение",
    color: COLOR_SETTLEMENT,
    noArcTarget: true,
    speedDelta: { cavalry: -2 },
  },
];

const DEFAULT_TERRAIN_ID = "plain";

export { TERRAINS, DEFAULT_TERRAIN_ID };
