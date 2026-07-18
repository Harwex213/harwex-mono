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

const DEFAULT_TERRAIN_ID = "plain";

export { TERRAINS, DEFAULT_TERRAIN_ID };
