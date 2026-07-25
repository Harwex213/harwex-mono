/** Axial hex coordinate. */
type Cell = {
  q: number;
  r: number;
};

type Enemy = {
  id: number;
  /** Key into ENEMIES registry. */
  type: string;
  hp: number;
  maxHp: number;
  /** Reward on kill. */
  coins: number;
  /** Damage dealt to the base on arrival. */
  dmg: number;
  /** Cells per second. */
  speed: number;
  /** Cell the enemy is leaving. */
  cell: Cell;
  /** Cell the enemy is moving toward. */
  next: Cell | null;
  /** 0..1 between cell and next. */
  progress: number;
  dead?: boolean;
};

type Building = {
  /** Key into BUILDINGS registry. */
  type: string;
  /** Attack cooldown remaining (towers). */
  cd?: number;
};

type Projectile = {
  /** World coords (hex size = 1 unit). */
  x: number;
  y: number;
  /** Enemy id. */
  targetId: number;
  damage: number;
  /** World units per second. */
  speed: number;
  dead?: boolean;
};

/** Floating text effect. */
type Popup = {
  x: number;
  y: number;
  text: string;
  color: string;
  /** Seconds remaining. */
  ttl: number;
};

/** Pure JSON-serializable game state. */
type GameState = {
  /** Total sim seconds. */
  time: number;
  /** 1-based day counter. */
  day: number;
  phase: "day" | "night";
  /** Fractional; display floored. */
  coins: number;
  baseHp: number;
  baseMaxHp: number;
  /** Keyed by "q,r". */
  buildings: Record<string, Building>;
  /** Owned count per building type. */
  counts: Record<string, number>;
  enemies: Enemy[];
  projectiles: Projectile[];
  effects: Popup[];
  /** BFS distance-to-base per cell key; derived, recomputed on build/sell. */
  flow: Record<string, number>;
  /** Armed building type from the build menu. */
  selected: string | null;
  /** Sim steps per frame tick (game speed multiplier). */
  speed: number;
  /** Fractional spawn accumulator. */
  spawnAcc: number;
  nextId: number;
  gameOver: boolean;
};

export type { Cell, Enemy, Building, Projectile, Popup, GameState };
