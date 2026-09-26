/**
 * The data model of the whole prototype. Pure types, no runtime code, no React.
 * Everything under `src/core/` and every store slice is built out of these.
 */

type TBiomeId = "grassland" | "plains" | "forrest" | "savanna" | "rainforest" | "taiga" | "tundra"
  | "desert" | "polar_desert" | "swamp" | "badlands" | "crater" | "volcano" | "hills" | "mountains" | "cliffs";

type TBuildingId = "farm" | "mine" | "sawmill" | "village" | "masons_guild" | "observatory" | "university";

type TResourceId = "food" | "stone" | "wood" | "population" | "hammers" | "science" | "scouting" | "mana"
  | "toxicity" | "insane";

type TResources = Record<TResourceId, number>;

type TPhase = "build" | "tax" | "exploration" | "clearing";

/** `id` is `${q}:${r}`; `toxicity` runs 0..100 and 100 means the hex is dead. */
type THex = {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly biome: TBiomeId;
  readonly building: TBuildingId | null;
  readonly toxicity: number;
};

type TIsland = {
  readonly ownerId: string;
  readonly hexes: Readonly<Record<string, THex>>;
};

type TPlayer = {
  readonly id: string;
  readonly nickname: string;
  readonly colour: string;
  readonly isHuman: boolean;
  readonly army: number;
  readonly buildingCount: number;
  readonly techCount: number;
};

type TWorldCell = {
  readonly id: number;
  readonly centre: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
  readonly neighbours: readonly number[];
  readonly revealed: boolean;
  readonly biomeHint: TBiomeId;
  readonly trail: number;
  readonly occupantId: string | null;
};

type TUnit = {
  readonly id: string;
  readonly kind: string;
  readonly side: "player" | "enemy";
  /** The battle island the unit wanders around. Written by `createBattleLevel`. */
  readonly homeIslandId: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly dmg: number;
  readonly range: number;
  readonly speed: number;
  readonly air: boolean;
};

type TTechId = "irrigation" | "scrubbers" | "deep_shafts" | "star_charts" | "asylum" | "conscription"
  | "levitation" | "purge_ritual";

type TBiomeInfo = {
  readonly id: TBiomeId;
  readonly nameRu: string;
  readonly descriptionRu: string;
  readonly colours: readonly [string, string];
  readonly glyph: string;
};

type TBuildingCost = {
  readonly stone: number;
  readonly wood: number;
  readonly hammers: number;
};

type TBuildingYield = {
  readonly amount: number;
  readonly toxicity: number;
};

type TBuildingInfo = {
  readonly id: TBuildingId;
  readonly nameRu: string;
  readonly produces: TResourceId;
  readonly cost: TBuildingCost;
  readonly yields: Readonly<Partial<Record<TBiomeId, TBuildingYield>>>;
};

type TTechInfo = {
  readonly id: TTechId;
  readonly nameRu: string;
  readonly cost: number;
  readonly requires: readonly TTechId[];
  readonly descriptionRu: string;
};

type TYieldEntry = {
  readonly hexId: string;
  readonly resource: TResourceId;
  readonly amount: number;
  readonly toxicity: number;
};

type TTrailEventId = "bandits" | "undead" | "insane_growth" | "garbage_worm" | "empty";

type TTrailEvent = {
  readonly id: TTrailEventId;
  readonly titleRu: string;
  readonly textRu: string;
};

type TRng = {
  readonly next: () => number;
  readonly int: (min: number, max: number) => number;
  readonly pick: <T>(items: readonly T[]) => T;
};

type TBattleIsland = {
  readonly id: string;
  readonly side: "player" | "enemy";
  readonly x: number;
  readonly y: number;
  readonly hexes: readonly THex[];
  readonly absorbed: boolean;
};

type TBattleState = {
  readonly turn: number;
  readonly playerIsland: TBattleIsland;
  readonly enemyIslands: readonly TBattleIsland[];
  readonly units: readonly TUnit[];
  readonly elapsedMs: number;
  readonly finished: boolean;
  /**
   * Hexes of every island absorbed so far. `stepBattle` stays pure and only
   * collects them; the store appends them with `addHexesToIsland`.
   */
  readonly absorbedHexes: readonly THex[];
};

type TBattleInput = {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
};

export type {
  TBattleInput,
  TBattleIsland,
  TBattleState,
  TBiomeId,
  TBiomeInfo,
  TBuildingCost,
  TBuildingId,
  TBuildingInfo,
  TBuildingYield,
  THex,
  TIsland,
  TPhase,
  TPlayer,
  TResourceId,
  TResources,
  TRng,
  TTechId,
  TTechInfo,
  TTrailEvent,
  TTrailEventId,
  TUnit,
  TWorldCell,
  TYieldEntry,
};
