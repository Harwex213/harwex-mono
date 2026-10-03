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

/**
 * Everything the resources panel shows, including the negative resource, the
 * mad. Power (власть) is not on any die: the stronghold pays it every turn, and
 * the tax phase spends it to change a building's rolled face. Toxicity is not a
 * resource: it lives on the hexes and in the island's meter, `toxicMeter`.
 */
type TResourceId = TYieldResourceId | "power" | "mad";

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
  /** The 64px icon, for panels, tooltips and modals. */
  readonly art: string;
  /** The 256px sprite the island canvas draws on the hex. */
  readonly hexArt: string;
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
  /**
   * Battle damage of what stands on the hex. It names what it belongs to, so
   * a new building on the hex starts at full health. Missing means full health.
   * See `core/structure-hp.ts`.
   */
  readonly damaged?: {
    readonly kind: TBuildingId | "stronghold";
    readonly hp: number;
  };
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
  /** The hex the player's stronghold stands on, or `null` before it is placed. */
  readonly strongholdHexId: string | null;
  /**
   * The island's toxicity meter, 0..1000. The tax phase fills it from the
   * toxicity the buildings leave on their hexes; only a lucky slot spin lowers
   * it. See `core/toxic-slot.ts`.
   */
  readonly toxicMeter: number;
};

/** The four phases of the core loop. Only `build` is implemented so far. */
type TPhase = "build" | "tax" | "scout" | "clear";

/**
 * The life of a session. In `setup` every player places a stronghold and the
 * core loop has not started. `starting` and `entering` are the two steps of the
 * animation after "Начать": the vignette and the start button leave, then the
 * build phase HUD comes in. `play` is the core loop.
 */
type TGameStage = "setup" | "starting" | "entering" | "play";

export type {
  TBiome,
  TBiomeId,
  TBuildCost,
  TBuilding,
  TBuildingId,
  TFace,
  TGameStage,
  THex,
  TIsland,
  TPhase,
  TPlayer,
  TResourceId,
  TResourcePool,
  TYieldResourceId,
};
