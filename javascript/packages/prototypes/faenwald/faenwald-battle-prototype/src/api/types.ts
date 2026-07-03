/**
 * API layer — transport DTOs.
 *
 * The raw shapes the (mocked) server returns. The Model hydrates these into
 * observable `Board` / `UnitState` objects; the View never touches a DTO.
 *
 * The string/number unions below restate the domain vocabulary as a transport
 * contract so the API layer stays self-contained (it imports nothing from the
 * Model). They are structurally identical to the Model's own unions, so the
 * Model assigns them across without casts.
 */

/** The two belligerents (§1, §6.1). */
export type Side = 'blue' | 'red';

/** Facing toward one of the six vertices (§2.2). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

/** Veterancy rank I–VI (§3.3). */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6;

/** Elevation level: plain / foothill / hill (§10). */
export type Elevation = 0 | 1 | 2;

/** Transient hex state (§10). */
export type HexState = 'mud' | 'frozen';

/** Terrain type (§10). */
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

/** A board tile. `elevation` defaults from `terrain` when omitted. */
export interface HexDTO {
  q: number;
  r: number;
  terrain: TerrainType;
  elevation?: Elevation;
  state?: HexState;
}

/** A unit placement. `defId` keys into the catalog (e.g. `"cavalry.heavy"`). */
export interface UnitDTO {
  id: string;
  defId: string;
  side: Side;
  rank: Rank;
  /** Soldier count, 0..100 (§3.2). */
  count: number;
  q: number;
  r: number;
  facing: Facing;
  name?: string;
  /** Pre-battle strength multiplier (§3.5). */
  strengthMod?: number;
  isRuler?: boolean;
  /** Optional current HP/morale; default to the entering max. */
  hp?: number;
  morale?: number;
}

export interface BattleDTO {
  id: string;
  name: string;
  hexes: HexDTO[];
  units: UnitDTO[];
}

/**
 * A selectable preset battle (showcase item 25). The list endpoint returns these
 * summaries; loading one by `id` returns the full {@link BattleDTO}. The
 * `mechanic` line names the rule the scenario is built to put on screen.
 */
export interface ScenarioSummary {
  id: string;
  name: string;
  /** One-line pitch of the distinct mechanic this scenario demonstrates. */
  mechanic: string;
}
