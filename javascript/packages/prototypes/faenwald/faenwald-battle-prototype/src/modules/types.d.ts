/** localStorage-shaped persistence adapter, injected by model.js */
type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type BattleConfigUnitModifier = {
  collectionId: string;
  modifierId: string;
};

type BattleConfigSide = "attacker" | "defender";

type BattleConfigUnit = {
  id: number;
  typeId: string | null;
  modifiers: BattleConfigUnitModifier[];
};

type BattleConfig = {
  mapId: string | null;
  attacker: BattleConfigUnit[];
  defender: BattleConfigUnit[];
  nextUnitId: number;
};

type StatId = "hp" | "attack" | "morale";

type UnitStats = Record<StatId, number>;

type ModifierEntry = {
  id: number;
  stat: StatId;
  value: number;
};

type Modifier = {
  id: string;
  name: string;
  description: string;
  flat: ModifierEntry[];
  percent: ModifierEntry[];
};

type ModifierCollection = {
  id: number;
  name: string;
  modifiers: Modifier[];
};

type ModifiersState = {
  storage: StorageAdapter;
  collections: ModifierCollection[];
  /** derived from the data on hydrate, never persisted */
  nextEntryId: number;
};

type HexMap = {
  id: number;
  name: string;
  width: number;
  height: number;
  /** cells[row][col] is a terrain id — pointy-top hexes, odd-r offset rows */
  cells: string[][];
  image?: string;
};

type MapsState = {
  storage: StorageAdapter;
  maps: HexMap[];
};

type BattlePhase = "disposition" | "active" | "finished";

type ActiveBattleUnit = {
  id: number;
  side: BattleConfigSide;
  type: string;
  name: string;
  hp: number;
  attack: number;
  morale: number;
  speed: number;
  position: { row: number; col: number } | null;
};

type ActiveBattle = {
  phase: BattlePhase | null;
  mapId: string | null;
  units: ActiveBattleUnit[];
  nextUnitId: number;
};
