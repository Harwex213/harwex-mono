type ResourceKind = "gold" | "wood" | "crystal";

type Resources = {
  gold: number;
  wood: number;
  crystal: number;
};

type Cost = Partial<Resources>;

type TerrainKind = "barren" | "forest" | "crystal" | "ruins" | "boss";

type SectorState = "locked" | "contested" | "owned";

type Sector = {
  index: number;
  col: number;
  row: number;
  terrain: TerrainKind;
  state: SectorState;
  /** 0..1 — how far the island has drifted onto a cleared sector. */
  attach: number;
  /** Decor blocking the build grid, as world cell indices. */
  blocked: Set<number>;
  /** Decor drawn on the land layer: rocks, trees, crystal spikes, rubble. */
  decor: Decor[];
};

type Decor = {
  x: number;
  y: number;
  size: number;
  variant: number;
};

type ProjectileKind = "arrow" | "bolt" | "harpoon" | "spell";

type Weapon = {
  damage: number;
  range: number;
  cooldown: number;
  projectile?: ProjectileKind;
  projectileSpeed?: number;
  splash?: number;
};

type BuildingId =
  | "core"
  | "house"
  | "sawmill"
  | "market"
  | "mine"
  | "barracks"
  | "range"
  | "forge"
  | "tower"
  | "engine"
  | "altar"
  | "obelisk";

type BuildingDef = {
  id: BuildingId;
  name: string;
  desc: string;
  cost: Cost;
  /** Footprint side, in cells. */
  cells: number;
  hp: number;
  buildTime: number;
  requires: BuildingId[];
  /** Terrain the building may only stand on. */
  terrain?: TerrainKind[];
  unique?: boolean;
  /** Buildable from the panel. The core is placed by the world generator. */
  panel?: boolean;
  income?: Cost;
  popCap?: number;
  weapon?: Weapon;
};

type ActorDefId =
  | "sword"
  | "archer"
  | "knight"
  | "golem"
  | "crab"
  | "drowned"
  | "harpooner"
  | "brute"
  | "guardian"
  | "leviathan";

type Team = "island" | "sea";

type ActorDef = {
  id: ActorDefId;
  name: string;
  desc: string;
  team: Team;
  hp: number;
  speed: number;
  radius: number;
  weapon: Weapon;
  /** Army slots taken. */
  pop?: number;
  cost?: Cost;
  trainTime?: number;
  producer?: BuildingId;
  requires?: BuildingId[];
  /** Gold paid out on death. */
  bounty?: number;
  /** Wave budget weight. */
  threat?: number;
};

type TargetRef = {
  kind: "actor" | "building";
  id: number;
};

type TrainOrder = {
  defId: ActorDefId;
  left: number;
  total: number;
};

type Building = {
  id: number;
  defId: BuildingId;
  /** Top-left cell of the footprint. */
  cx: number;
  cy: number;
  x: number;
  y: number;
  sector: number;
  hp: number;
  maxHp: number;
  /** 0..1 construction progress; the building is inert until it reaches 1. */
  build: number;
  cooldown: number;
  target: TargetRef | null;
  queue: TrainOrder[];
  hitFlash: number;
  dead: boolean;
};

/** `field` walks to the rally point, `guard` holds a sector, `boss` never moves. */
type ActorRole = "field" | "guard" | "boss";

type Actor = {
  id: number;
  defId: ActorDefId;
  team: Team;
  role: ActorRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  damage: number;
  cooldown: number;
  target: TargetRef | null;
  homeX: number;
  homeY: number;
  facing: number;
  hitFlash: number;
  dead: boolean;
  /** Walk animation phase, advanced by distance covered. */
  step: number;
};

type Projectile = {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  tx: number;
  ty: number;
  speed: number;
  damage: number;
  splash: number;
  team: Team;
  kind: ProjectileKind;
  target: TargetRef | null;
  dead: boolean;
};

type EffectKind = "blast" | "ring" | "spark" | "text";

type Effect = {
  kind: EffectKind;
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
  text?: string;
};

type SkillId = "volley" | "fury" | "ward";

type SkillDef = {
  id: SkillId;
  name: string;
  desc: string;
  cooldown: number;
  /** Skill needs a point on the map before it fires. */
  targeted: boolean;
  radius?: number;
  damage?: number;
  duration?: number;
};

type Phase = "play" | "won" | "lost";

type LogEntry = {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
};

export type {
  Actor,
  ActorDef,
  ActorDefId,
  ActorRole,
  Building,
  BuildingDef,
  BuildingId,
  Cost,
  Decor,
  Effect,
  EffectKind,
  LogEntry,
  Phase,
  Projectile,
  ProjectileKind,
  ResourceKind,
  Resources,
  Sector,
  SectorState,
  SkillDef,
  SkillId,
  TargetRef,
  Team,
  TerrainKind,
  TrainOrder,
  Weapon,
};
