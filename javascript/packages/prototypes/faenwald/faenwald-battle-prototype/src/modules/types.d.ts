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

/** `BATTLE_CONFIG_MODULE.validate()` result row — a code plus its params, no copy */
type BattleConfigProblem =
  | { code: "NO_MAP" }
  | { code: "EMPTY_SIDE"; side: BattleConfigSide }
  | { code: "UNTYPED_UNIT" };

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

type TerrainByClass = { base?: number; infantry?: number; cavalry?: number };

type TerrainDef = {
  id: string;
  name: string;
  color: string; // tokens.css semantic token name
  description?: string;
  elevation?: 0 | 1 | 2; // default 0; foothills 1, hills 2
  impassable?: boolean; // mountain, water; also ⇒ flank cover
  occupantMoveCostMult?: number; // exit-side: mud 2, swamp 3, road 0.5
  entryCost?: number | TerrainByClass; // thicket { base: 1, cavalry: 2 }
  speedCap?: TerrainByClass; // forest { cavalry: 1 }
  speedDelta?: TerrainByClass; // settlement { cavalry: -2 }
  rangedDamageTakenMult?: number; // thicket 0.75, forest 0.5
  blocksDirectLos?: boolean; // forest, mountain
  blocksArcFire?: boolean; // mountain
  noArcTarget?: boolean; // settlement
  specialRules?: string[]; // coded-rule tags (unused this iteration)
};

type TerrainClass = "infantry" | "cavalry";

type RangedMode = { range: number; mult: number };

type UnitRanged = {
  arc: RangedMode | null; // null ⇒ cannot arc (crossbow)
  direct: RangedMode;
  meleeMult: number; // in-melee fire penalty (0.5; crossbow 0.75)
  shots: number; // per-battle ammo (8)
  cooldown?: number; // fire every Nth turn (crossbow 2)
};

type UnitType = {
  id: string;
  type: string;
  name: string;
  hp: number;
  attack: number;
  morale: number;
  speed: number;
  terrainClass: TerrainClass;
  heavy?: boolean; // free rotation/turn (M3)
  ranged?: UnitRanged; // present on ranged types only
  ramModifier?: number; // charge ram %: 8/16/24
  maneuverable?: boolean; // move after attack
  noElevationBonus?: boolean; // horse archer: hills grant no range/damage bonus
};

type MapsState = {
  storage: StorageAdapter;
  maps: HexMap[];
};

type BattlePhase = "disposition" | "active" | "finished";

/** `ACTIVE_UNIT_GROUP_TYPE` value */
type ActiveUnitGroup = { side: "attacker" | "defender"; type: string };

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
  facing: number; // 0-5 vertex orientation
  movePoints: number; // remaining MP this activation
  mpCarry: number; // fractional MP carried into the next activation
  hasAttacked: boolean; // M4: blocks further movement once attacked
  accelerated: boolean; // once-per-activation MP doubling used
  freeRotationUsed: boolean; // heavy types get one free rotation per activation
  ammo: number; // remaining ranged shots
  cooldown: number; // turns until next shot allowed; ticks down by 1 on every beginActivation
  routed: boolean; // fled the battle, skipped in activation order
  isRulerUnit: boolean; // at most one per side; morale-check anchor (M5+)
  maxHp: number; // full HP at battle start; half-damage rule anchor
  destroyed: boolean; // hp<=0 this battle; kept off-field for M8 loss math
  chargeHexes: number; // consecutive front-hex advances this activation (M6 charge; reset by rotation / non-front move / new activation)
  attackedRound: number | null; // M7 round in which this unit last dealt an attack (normal or reaction); blocks reacting twice / after acting
  reactedRound: number | null; // M7 round in which this unit made an opportunity reaction; its own slot that round is rotate-only
};

type ActiveBattle = {
  phase: BattlePhase | null;
  mapId: string | null;
  units: ActiveBattleUnit[];
  nextUnitId: number;
  round: number;
  activeGroup: ActiveUnitGroup | null;
  activeUnitId: number | null;
  actedUnitIds: number[]; // units that finished their activation this group cycle
  log: string[];
  winner: BattleConfigSide | "draw" | null; // set when phase becomes "finished"
  pendingBreakthrough: { attackerId: number; targetId: number; pushDir: number } | null; // M6 shock-infantry push awaiting player choice
  pendingOpportunity: { queue: number[]; targetId: number } | null; // M7 provoked-reaction interrupt: opportuner ids (asc) awaiting resolution against the moving unit
};

type UnitLossStatus = "survivor" | "routed" | "destroyed";

type UnitLossRow = {
  unitId: number; // ActiveBattleUnit.id
  name: string; // ActiveBattleUnit.name
  side: BattleConfigSide; // ActiveBattleUnit.side
  type: string; // ActiveBattleUnit.type
  status: UnitLossStatus; // classification the row was aggregated under
  maxHp: number; // ActiveBattleUnit.maxHp
  hp: number; // ActiveBattleUnit.hp, clamped to 0
  morale: number; // ActiveBattleUnit.morale, clamped to 0
  hpLost: number; // maxHp - hp, clamped to 0
  casualties: number; // HP counted as lost for the side total
  prisoners: number; // HP captured by the enemy (destroyed rows only)
};

type SideLosses = {
  survivors: UnitLossRow[]; // status "survivor"
  routed: UnitLossRow[]; // status "routed"
  destroyed: UnitLossRow[]; // status "destroyed"
  casualties: number; // sum of casualties across all three groups
  prisonersTaken: number; // sum of the opposing side's destroyed rows' prisoners
};
