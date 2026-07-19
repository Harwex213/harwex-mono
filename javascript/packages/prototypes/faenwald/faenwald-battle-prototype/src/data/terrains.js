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
 * - `passable: false` - marks hexes units can never occupy (гора/вода per the памятка); omitted means passable.
 */
const TERRAINS = [
  { id: "plain", name: "Равнина", color: COLOR_PLAIN },
  { id: "mud", name: "Грязь", color: COLOR_MUD },
  { id: "thicket", name: "Заросли", color: COLOR_THICKET },
  { id: "forest", name: "Лес", color: COLOR_FOREST },
  { id: "foothills", name: "Предхолмье", color: COLOR_FOOTHILLS },
  { id: "hills", name: "Холм", color: COLOR_HILLS },
  { id: "mountain", name: "Гора", color: COLOR_MOUNTAIN, passable: false },
  { id: "water", name: "Вода", color: COLOR_WATER, passable: false },
  { id: "swamp", name: "Топь", color: COLOR_SWAMP },
  { id: "ice", name: "Лёд", color: COLOR_ICE },
  { id: "road", name: "Дорога", color: COLOR_ROAD },
  { id: "settlement", name: "Поселение", color: COLOR_SETTLEMENT },
];

const DEFAULT_TERRAIN_ID = "plain";

export { TERRAINS, DEFAULT_TERRAIN_ID };
