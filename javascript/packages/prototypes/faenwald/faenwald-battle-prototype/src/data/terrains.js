// Terrain catalog for hex maps: identity + presentation only. Gameplay
// effects (speed cost, cover, damage multipliers from the памятка) join
// once the battle system consumes them.
// `color` is a semantic token name from tokens.css — pages build swatch/fill
// CSS from it, and the canvas renderer resolves it via getComputedStyle.
const TERRAINS = [
  { id: "plain", name: "plain", color: "--terrain-plain" },
  { id: "mud", name: "mud", color: "--terrain-mud" },
  { id: "thicket", name: "thicket", color: "--terrain-thicket" },
  { id: "forest", name: "forest", color: "--terrain-forest" },
  { id: "foothills", name: "foothills", color: "--terrain-foothills" },
  { id: "hills", name: "hills", color: "--terrain-hills" },
  { id: "mountain", name: "mountain", color: "--terrain-mountain" },
  { id: "water", name: "water", color: "--terrain-water" },
  { id: "swamp", name: "swamp", color: "--terrain-swamp" },
  { id: "ice", name: "ice", color: "--terrain-ice" },
  { id: "road", name: "road", color: "--terrain-road" },
  { id: "settlement", name: "settlement", color: "--terrain-settlement" },
];

const DEFAULT_TERRAIN_ID = "plain";

export { TERRAINS, DEFAULT_TERRAIN_ID }
