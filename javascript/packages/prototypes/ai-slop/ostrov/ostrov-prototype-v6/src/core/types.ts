/**
 * The data model of Toxic Island. Everything here is plain data: the store keeps
 * it inside signals, the domain layer replaces it whole, and nothing in this
 * folder imports React or the store.
 */

/** The 16 hex biomes of the spec, spelled exactly as the spec spells them. */
type TBiomeId =
  | "grassland"
  | "plains"
  | "forrest"
  | "savanna"
  | "rainforest"
  | "taiga"
  | "tundra"
  | "desert"
  | "polar_desert"
  | "swamp"
  | "badlands"
  | "crater"
  | "volcano"
  | "hills"
  | "mountains"
  | "cliffs";

/** Basic resources a building can produce. */
type TYieldResourceId =
  | "food"
  | "stone"
  | "wood"
  | "population"
  | "hammers"
  | "science"
  | "scouting"
  | "mana";

/** Everything the resources panel shows, including the two negative resources. */
type TResourceId = TYieldResourceId | "toxicity" | "mad";

type TResourcePool = Readonly<Record<TResourceId, number>>;

/** The seven buildings of the spec. */
type TBuildingId =
  | "farm"
  | "mine"
  | "sawmill"
  | "village"
  | "masons_guild"
  | "observatory"
  | "university";

/**
 * One face of a building's die. The spec lists buildings as sets of "комбинации
 * ресурсов": a yield paired with the toxicity it leaves on the hex. The tax
 * phase rolls one face; the build phase only shows them.
 */
type TFace = {
  readonly resource: TYieldResourceId;
  readonly amount: number;
  readonly toxicity: number;
};

/** What a building costs to place. Stone, wood and hammers "дают здания". */
type TBuildCost = {
  readonly stone: number;
  readonly wood: number;
  readonly hammers: number;
};

type TBuilding = {
  readonly id: TBuildingId;
  readonly label: string;
  /** The resource this building exists for, shown as its purpose in the UI. */
  readonly yields: TYieldResourceId;
  readonly art: string;
  readonly cost: TBuildCost;
  /** Faces every copy of this building has, whatever it stands on. */
  readonly baseFaces: readonly TFace[];
  /** The extra face a biome adds. A biome missing here cannot host the building. */
  readonly biomeFaces: Readonly<Partial<Record<TBiomeId, TFace>>>;
};

type TBiome = {
  readonly id: TBiomeId;
  readonly label: string;
  readonly description: string;
  /** Fill of the hex on the island canvas. */
  readonly color: string;
  /** Darker rim, drawn as the hex outline. */
  readonly edgeColor: string;
};

type THex = {
  /** `q,r` as a string, so it can key a map and a React list. */
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly biome: TBiomeId;
  readonly building: TBuildingId | null;
  /** Accumulated toxicity of the hex, in percent, 0..100. */
  readonly toxicity: number;
};

type TIsland = {
  readonly hexes: readonly THex[];
};

type TPlayer = {
  readonly id: string;
  readonly nickname: string;
  /** Banner colour in the players panel. */
  readonly color: string;
  readonly isHuman: boolean;
  readonly island: TIsland;
  readonly resources: TResourcePool;
  readonly army: number;
  readonly techs: number;
  /** The world cell the island is flying over. */
  readonly cellId: string;
};

/** The four phases of the core loop. Only `build` is implemented so far. */
type TPhase = "build" | "tax" | "scout" | "clear";

export type {
  TBiome,
  TBiomeId,
  TBuildCost,
  TBuilding,
  TBuildingId,
  TFace,
  THex,
  TIsland,
  TPhase,
  TPlayer,
  TResourceId,
  TResourcePool,
  TYieldResourceId,
};
