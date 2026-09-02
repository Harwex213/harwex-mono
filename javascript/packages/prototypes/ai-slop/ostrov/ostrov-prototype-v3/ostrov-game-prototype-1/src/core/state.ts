import type { TIslandType, TTerrain } from "@hw/ostrov-island-system";
import type { TRange } from "@hw/ostrov-world-system";

/** The two seats of the co-op. Both belong to the same faction. */
type TPlayerId = "p1" | "p2";

type TFactionKind = "players" | "natives" | "hitech" | "rival";

type TFaction = {
  id: string;
  name: string;
  color: string;
  kind: TFactionKind;
  /** Islands the faction holds at the start. Used by the AI and the factions panel. */
  homeIslandId: string | null;
  /** A faction the players have seen. Unknown ones are shown as "Неизвестная фракция". */
  discovered: boolean;
  alive: boolean;
  motto: string;
};

/**
 * One land hex. Sea cells are not stored. The hex is addressed by a stable id, so an
 * island can move and keep every reference into it valid; only `q` and `r` change.
 */
type TGameTile = {
  id: string;
  islandId: string;
  q: number;
  r: number;
  terrain: TTerrain;
  coastal: boolean;
  /** Remaining fossils. Extraction buildings burn one per turn. */
  deposits: number;
  depositsMax: number;
  buildingId: string | null;
};

type TGameIsland = {
  id: string;
  name: string;
  type: TIslandType;
  tileIds: string[];
  /** The hi-tech island-city. */
  citadel: boolean;
  /** The island the players start on and the only one that can carry an engine. */
  home: boolean;
};

type TUnitType = "settler" | "builders" | "army";

type TSquadType =
  | "militia"
  | "tribesmen"
  | "spearmen"
  | "archers"
  | "swordsmen"
  | "catapult"
  | "riflemen"
  | "plasma"
  | "drone"
  | "mech";

type TSquad = {
  id: string;
  type: TSquadType;
  hp: number;
  hpMax: number;
  /** Deployment slot 0..5 (0..2 front row, 3..5 back row), `null` before deployment. */
  slot: number | null;
};

type TUnit = {
  id: string;
  type: TUnitType;
  factionId: string;
  owner: TPlayerId | null;
  tileId: string;
  movesLeft: number;
  name: string;
  /** Armies only. An army with no squads is removed. */
  squads: TSquad[];
};

type TBuildingType = "power" | "core" | "workshop" | "farm" | "mine" | "housing" | "lab" | "barracks" | "engine" | "camp";

type TBuilding = {
  id: string;
  type: TBuildingType;
  factionId: string;
  owner: TPlayerId | null;
  tileId: string;
  /** Production paid so far. A building works once `progress >= cost`. */
  progress: number;
  cost: number;
  /** The engine is two halves, one per player. Each half is funded on its own. */
  engineHalves: Record<TPlayerId, number> | null;
};

type TPlayerState = {
  id: TPlayerId;
  name: string;
  accent: string;
  production: number;
  food: number;
  metals: number;
  population: number;
  ready: boolean;
  /** The player's Centre of Power, or `null` before the settler founds one. */
  powerBuildingId: string | null;
  /** Set when the player's Centre of Power fell. */
  defeated: boolean;
};

type TResearchState = {
  known: string[];
  current: string | null;
  progress: number;
  /** Science banked while nothing was being researched. */
  banked: number;
};

type TLogEntry = {
  id: number;
  turn: number;
  text: string;
  tone: "info" | "good" | "bad" | "phantom";
};

/** A battle waiting to be fought. The attacker moved onto the defender's hex. */
type TBattleSetup = {
  id: string;
  tileId: string;
  attackerFactionId: string;
  defenderFactionId: string;
  attackerUnitIds: string[];
  defenderUnitIds: string[];
  /** Set when the attacker is one of the players' armies: which player moved. */
  attackerPlayer: TPlayerId | null;
};

type TPhase = "planning" | "curtain" | "battle" | "ended";

type TGameResult = "victory" | "defeat" | null;

type TGame = {
  seedText: string;
  turn: number;
  phase: TPhase;
  result: TGameResult;
  xRange: TRange;
  yRange: TRange;
  factions: TFaction[];
  islands: TGameIsland[];
  tiles: Record<string, TGameTile>;
  /** Hex key `q,r` to tile id. Rebuilt whenever an island moves. */
  posIndex: Record<string, string>;
  units: Record<string, TUnit>;
  buildings: Record<string, TBuilding>;
  players: Record<TPlayerId, TPlayerState>;
  research: TResearchState;
  log: TLogEntry[];
  pendingBattles: TBattleSetup[];
  /** Curtain lines of the last resolved turn. */
  curtainLines: string[];
  /** Island steps the engine still has this turn. */
  islandMovesLeft: number;
  /** Running id counter for units, buildings, squads and log entries. */
  nextId: number;
};

export type {
  TBattleSetup,
  TBuilding,
  TBuildingType,
  TFaction,
  TFactionKind,
  TGame,
  TGameIsland,
  TGameResult,
  TGameTile,
  TLogEntry,
  TPhase,
  TPlayerId,
  TPlayerState,
  TResearchState,
  TSquad,
  TSquadType,
  TUnit,
  TUnitType,
};
