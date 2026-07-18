// Terrain catalog for hex maps: identity + presentation only. Gameplay
// effects (speed cost, cover, damage multipliers from the памятка) join
// once the battle system consumes them.
// `color` is a semantic token name from tokens.css — pages build swatch/fill
// CSS from it, and the canvas renderer resolves it via getComputedStyle.
const TERRAINS = [
  { id: "plain", name: "Равнина", color: "--terrain-plain" },
  { id: "mud", name: "Грязь", color: "--terrain-mud" },
  { id: "thicket", name: "Заросли", color: "--terrain-thicket" },
  { id: "forest", name: "Лес", color: "--terrain-forest" },
  { id: "foothills", name: "Предхолмье", color: "--terrain-foothills" },
  { id: "hills", name: "Холм", color: "--terrain-hills" },
  { id: "mountain", name: "Гора", color: "--terrain-mountain" },
  { id: "water", name: "Вода", color: "--terrain-water" },
  { id: "swamp", name: "Топь", color: "--terrain-swamp" },
  { id: "ice", name: "Лёд", color: "--terrain-ice" },
  { id: "road", name: "Дорога", color: "--terrain-road" },
  { id: "settlement", name: "Поселение", color: "--terrain-settlement" },
];

const TERRAIN_CODE_TO_ID = {
  0: "plain",
  1: "mud",
  2: "thicket",
  3: "forest",
  4: "foothills",
  5: "hills",
  6: "mountain",
  7: "water",
  8: "swamp",
  9: "ice",
  10: "road",
  11: "settlement",
};

const DEFAULT_TERRAIN_ID = "plain";

export { TERRAINS, DEFAULT_TERRAIN_ID, TERRAIN_CODE_TO_ID };
