import type { TTerrainKind } from "./terrain";
import type { TAxial } from "../hex/coords";

type TFactionId = "player" | "enemy";

type TTile = {
  key: string;
  cell: TAxial;
  terrain: TTerrainKind;
  /** 0 at the waterline, 1 at the highest peak. Shading only. */
  elevation: number;
  /** Land tile with at least one sea neighbour, or a sea tile touching land. */
  coastal: boolean;
};

type TWorld = {
  seed: string;
  width: number;
  height: number;
  tiles: ReadonlyMap<string, TTile>;
  /** Row-major order, which is also a correct back-to-front draw order. */
  order: readonly TTile[];
  landKeys: readonly string[];
};

type TStructureKind = "city" | "camp";

type TStructure = {
  id: number;
  kind: TStructureKind;
  owner: TFactionId;
  name: string;
  key: string;
  hp: number;
  maxHp: number;
  /** Strength of the garrison. A structure never attacks, it only holds. */
  defence: number;
  /** Tiles the structure sees, in hex steps. */
  sight: number;
};

type TArmyKind = "scout" | "spearman" | "knight";

type TArmy = {
  id: number;
  owner: TFactionId;
  kind: TArmyKind;
  name: string;
  key: string;
  hp: number;
  maxHp: number;
  attack: number;
  /** Movement points a fresh turn hands the army. */
  movement: number;
  movementLeft: number;
  sight: number;
  /** An army that has attacked is done for the turn, whatever its points say. */
  hasAttacked: boolean;
  /** Turns spent without moving or attacking. Drives healing. */
  restedTurns: number;
};

type TLogTone = "system" | "player" | "enemy" | "combat";

type TLogEntry = {
  id: number;
  turn: number;
  tone: TLogTone;
  text: string;
};

type TFactionState = {
  id: TFactionId;
  name: string;
  gold: number;
  /** The city hires one army per turn, so the board cannot fill up at once. */
  hiredThisTurn: boolean;
};

type TOutcome = "playing" | "won" | "lost";

export type {
  TArmy,
  TArmyKind,
  TFactionId,
  TFactionState,
  TLogEntry,
  TLogTone,
  TOutcome,
  TStructure,
  TStructureKind,
  TTile,
  TWorld,
};
