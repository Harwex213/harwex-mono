/**
 * Model layer — terrain reference (GDD §10).
 *
 * A data table of the nine terrain types plus the two transient hex states
 * (mud, frozen). Phase 1 uses the **structural** facts — passability, the
 * default elevation, whether a tile blocks line of fire — and the rendering
 * hints (colour, glyph). The combat multipliers in §10 are wired into the
 * damage context in a later phase; they live here as `notes` for now.
 */

/** The nine terrain types (§10). */
export type TerrainType =
  | 'plain'
  | 'brush'
  | 'forest'
  | 'foothill'
  | 'hill'
  | 'mountain'
  | 'water'
  | 'bog'
  | 'road'
  | 'settlement';

/** Elevation level: plain (0), foothill (1), hill (2) (§2.1, §10). */
export type Elevation = 0 | 1 | 2;

/** Transient state layered over a hex's terrain (§10): mud or (winter) frozen. */
export type HexState = 'mud' | 'frozen' | null;

/** Static, rendering-relevant facts about a terrain type. */
export interface TerrainInfo {
  type: TerrainType;
  name: string;
  /** Whether units may enter at all (mountain/water are impassable, §10/#6). */
  passable: boolean;
  /** Whether the tile blocks ranged line of fire (mountains, §2.3/§10). */
  blocksLineOfFire: boolean;
  /** Default elevation for the type; a hex may override it (§15.1). */
  elevation: Elevation;
  /** Base fill colour for the SVG grid. */
  color: string;
  /** Short legend glyph/label. */
  glyph: string;
}

/** The terrain table, keyed by {@link TerrainType}. */
export const TERRAIN: Record<TerrainType, TerrainInfo> = {
  plain: {
    type: 'plain',
    name: 'Plain',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#3b4a2c',
    glyph: '·',
  },
  brush: {
    type: 'brush',
    name: 'Brush / Thicket',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#4f5e30',
    glyph: '❦',
  },
  forest: {
    type: 'forest',
    name: 'Forest',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#22361f',
    glyph: '🌲',
  },
  foothill: {
    type: 'foothill',
    name: 'Foothill',
    passable: true,
    blocksLineOfFire: false,
    elevation: 1,
    color: '#6b5734',
    glyph: '◢',
  },
  hill: {
    type: 'hill',
    name: 'Hill',
    passable: true,
    blocksLineOfFire: false,
    elevation: 2,
    color: '#8a6f3f',
    glyph: '▲',
  },
  mountain: {
    type: 'mountain',
    name: 'Mountain',
    passable: false,
    blocksLineOfFire: true,
    elevation: 2,
    color: '#4a453f',
    glyph: '⛰',
  },
  water: {
    type: 'water',
    name: 'Water',
    passable: false,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#23415c',
    glyph: '≈',
  },
  bog: {
    type: 'bog',
    name: 'Bog / Swamp',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#3a3b27',
    glyph: '⌇',
  },
  road: {
    type: 'road',
    name: 'Road',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#5a4f3a',
    glyph: '═',
  },
  settlement: {
    type: 'settlement',
    name: 'Settlement',
    passable: true,
    blocksLineOfFire: false,
    elevation: 0,
    color: '#6a4632',
    glyph: '⌂',
  },
};

/** Look up terrain info by type. */
export function terrainInfo(type: TerrainType): TerrainInfo {
  return TERRAIN[type];
}
