import type { ActorDef, ActorDefId, BuildingDef, BuildingId, SkillDef } from "./types";

/** Build grid step, in world pixels. */
const CELL = 32;
/** A sector is a square block of cells; it is the unit of territory. */
const SECTOR_CELLS = 10;
const SECTOR_SIZE = CELL * SECTOR_CELLS;
const SECTOR_COLS = 5;
const SECTOR_ROWS = 4;
const WORLD_CELLS_X = SECTOR_COLS * SECTOR_CELLS;
const WORLD_CELLS_Y = SECTOR_ROWS * SECTOR_CELLS;
const WORLD_W = SECTOR_COLS * SECTOR_SIZE;
const WORLD_H = SECTOR_ROWS * SECTOR_SIZE;
/** Open water around the sector grid. Waves come in across it. */
const OCEAN = 300;

const START_SECTOR = { col: 2, row: 3 };

// F — лес, C — кристаллы, R — руины, X — пустошь, B — логово босса.
// Нижний ряд — домашний и лесной: стартовый сектор обязан быть лесом, иначе
// дерево неоткуда взять. Лесопилка стоит только в лесу, лес добывается только
// экспансией, а экспансия стоит дерева — стартуй на пустоши, и остров заперт.
const TERRAIN_ROWS = [
  "FCBCF",
  "XRXRX",
  "FXCXF",
  "XFFFX",
];

const TERRAIN_NAMES: Record<string, string> = {
  barren: "Пустошь",
  forest: "Лес",
  crystal: "Кристаллы",
  ruins: "Руины",
  boss: "Логово Левиафана",
};

const START_RESOURCES = { gold: 320, wood: 220, crystal: 0 };

const BUILDING_DEFS: BuildingDef[] = [
  {
    id: "core",
    name: "Ядро острова",
    desc: "Сердце острова. Падёт ядро — игра проиграна.",
    cost: {},
    cells: 2,
    hp: 2400,
    buildTime: 0,
    requires: [],
    // Дерево с ядра — страховка: если волна снесёт все лесопилки при нуле на
    // складе, отстроить их будет не на что, и партия закончится без боя.
    income: { gold: 2, wood: 0.5 },
    popCap: 6,
    weapon: { damage: 14, range: 190, cooldown: 1.3, projectile: "bolt", projectileSpeed: 420 },
  },
  {
    id: "house",
    name: "Хижины",
    desc: "+6 к лимиту армии.",
    cost: { gold: 60, wood: 40 },
    cells: 1,
    hp: 260,
    buildTime: 4,
    requires: [],
    panel: true,
    popCap: 6,
  },
  {
    id: "sawmill",
    name: "Лесопилка",
    desc: "+3 дерева в секунду. Ставится только в лесу.",
    cost: { gold: 90, wood: 20 },
    cells: 2,
    hp: 320,
    buildTime: 6,
    requires: [],
    terrain: ["forest"],
    panel: true,
    income: { wood: 3 },
  },
  {
    id: "market",
    name: "Рынок",
    desc: "+4 золота в секунду.",
    cost: { gold: 140, wood: 70 },
    cells: 2,
    hp: 340,
    buildTime: 8,
    requires: ["house"],
    panel: true,
    income: { gold: 4 },
  },
  {
    id: "barracks",
    name: "Казарма",
    desc: "Нанимает мечников, а с кузницей — рыцарей.",
    cost: { gold: 150, wood: 80 },
    cells: 2,
    hp: 460,
    buildTime: 8,
    requires: [],
    panel: true,
  },
  {
    id: "tower",
    name: "Башня",
    desc: "Стреляет по всему, что подходит близко.",
    cost: { gold: 130, wood: 90 },
    cells: 1,
    hp: 520,
    buildTime: 6,
    requires: [],
    panel: true,
    weapon: { damage: 18, range: 215, cooldown: 0.85, projectile: "bolt", projectileSpeed: 460 },
  },
  {
    id: "range",
    name: "Стрельбище",
    desc: "Нанимает лучников.",
    cost: { gold: 180, wood: 110 },
    cells: 2,
    hp: 380,
    buildTime: 9,
    requires: ["barracks"],
    panel: true,
  },
  {
    id: "engine",
    name: "Двигатель острова",
    desc: "Позволяет двигать остров и захватывать соседние секторы.",
    cost: { gold: 200, wood: 160 },
    cells: 2,
    hp: 600,
    buildTime: 10,
    requires: ["market"],
    unique: true,
    panel: true,
  },
  {
    id: "forge",
    name: "Кузница",
    desc: "+25% урона всей армии. Открывает найм рыцарей.",
    cost: { gold: 260, wood: 160 },
    cells: 2,
    hp: 520,
    buildTime: 12,
    requires: ["range"],
    unique: true,
    panel: true,
  },
  {
    id: "mine",
    name: "Шахта кристаллов",
    desc: "+0.4 кристалла в секунду. Только на жиле кристаллов.",
    cost: { gold: 220, wood: 130 },
    cells: 2,
    hp: 400,
    buildTime: 10,
    requires: [],
    terrain: ["crystal"],
    panel: true,
    income: { crystal: 0.4 },
  },
  {
    id: "altar",
    name: "Алтарь",
    desc: "Уникальное здание руин. Открывает активные умения.",
    cost: { gold: 300, wood: 120, crystal: 40 },
    cells: 2,
    hp: 460,
    buildTime: 12,
    requires: ["forge"],
    terrain: ["ruins"],
    unique: true,
    panel: true,
  },
  {
    id: "obelisk",
    name: "Обелиск",
    desc: "Уникальное здание жилы. Открывает найм големов.",
    cost: { gold: 380, wood: 220, crystal: 70 },
    cells: 2,
    hp: 700,
    buildTime: 14,
    requires: ["mine"],
    terrain: ["crystal"],
    unique: true,
    panel: true,
  },
];

const BUILDING_BY_ID = new Map<BuildingId, BuildingDef>(BUILDING_DEFS.map((def) => [def.id, def]));

const ACTOR_DEFS: ActorDef[] = [
  {
    id: "sword",
    name: "Мечник",
    desc: "Дешёвое мясо ближнего боя.",
    team: "island",
    hp: 140,
    speed: 64,
    radius: 9,
    weapon: { damage: 13, range: 26, cooldown: 0.85 },
    pop: 1,
    cost: { gold: 60, wood: 15 },
    trainTime: 4,
    producer: "barracks",
  },
  {
    id: "archer",
    name: "Лучник",
    desc: "Бьёт издалека, умирает от одного удара по себе.",
    team: "island",
    hp: 85,
    speed: 68,
    radius: 8,
    weapon: { damage: 16, range: 170, cooldown: 1.1, projectile: "arrow", projectileSpeed: 380 },
    pop: 1,
    cost: { gold: 85, wood: 35 },
    trainTime: 5,
    producer: "range",
  },
  {
    id: "knight",
    name: "Рыцарь",
    desc: "Держит удар и держит линию.",
    team: "island",
    hp: 320,
    speed: 56,
    radius: 11,
    weapon: { damage: 30, range: 30, cooldown: 1 },
    pop: 2,
    cost: { gold: 170, wood: 55 },
    trainTime: 9,
    producer: "barracks",
    requires: ["forge"],
  },
  {
    id: "golem",
    name: "Голем",
    desc: "Медленный таран из кристалла.",
    team: "island",
    hp: 760,
    speed: 40,
    radius: 14,
    weapon: { damage: 56, range: 36, cooldown: 1.5, splash: 44 },
    pop: 3,
    cost: { gold: 260, wood: 60, crystal: 70 },
    trainTime: 13,
    producer: "obelisk",
  },
  {
    id: "crab",
    name: "Краб",
    desc: "",
    team: "sea",
    hp: 70,
    speed: 50,
    radius: 9,
    weapon: { damage: 9, range: 24, cooldown: 0.9 },
    bounty: 16,
    threat: 1,
  },
  {
    id: "drowned",
    name: "Утопленник",
    desc: "",
    team: "sea",
    hp: 165,
    speed: 45,
    radius: 10,
    weapon: { damage: 17, range: 26, cooldown: 1 },
    bounty: 32,
    threat: 2,
  },
  {
    id: "harpooner",
    name: "Гарпунёр",
    desc: "",
    team: "sea",
    hp: 95,
    speed: 47,
    radius: 9,
    weapon: { damage: 20, range: 155, cooldown: 1.4, projectile: "harpoon", projectileSpeed: 340 },
    bounty: 38,
    threat: 2,
  },
  {
    id: "brute",
    name: "Отродье",
    desc: "",
    team: "sea",
    hp: 480,
    speed: 36,
    radius: 14,
    weapon: { damage: 42, range: 32, cooldown: 1.3, splash: 40 },
    bounty: 85,
    threat: 5,
  },
  {
    id: "guardian",
    name: "Страж",
    desc: "",
    team: "sea",
    hp: 240,
    speed: 44,
    radius: 11,
    weapon: { damage: 24, range: 28, cooldown: 1 },
    bounty: 60,
  },
  {
    id: "leviathan",
    name: "Левиафан",
    desc: "",
    team: "sea",
    hp: 6000,
    speed: 0,
    radius: 34,
    // Damage stays under a swordsman's health on purpose: a volley that
    // one-shots the whole army makes the boss a wall rather than a fight.
    weapon: { damage: 75, range: 210, cooldown: 2.6, projectile: "spell", projectileSpeed: 260, splash: 46 },
    bounty: 0,
  },
];

const ACTOR_BY_ID = new Map<ActorDefId, ActorDef>(ACTOR_DEFS.map((def) => [def.id, def]));

const WAVE = {
  /** Calm before the first wave. */
  firstDelay: 70,
  /** Seconds between waves; shrinks as the game goes on. */
  interval: (wave: number): number => Math.max(30, 55 - (wave - 1) * 1.4),
  /** Threat points spent on one wave. */
  budget: (wave: number): number => 2 + Math.round(1.8 * Math.pow(1.24, wave - 1)),
  hpScale: (wave: number): number => 1 + 0.07 * (wave - 1),
  damageScale: (wave: number): number => 1 + 0.05 * (wave - 1),
  /** Which sea creatures the wave may contain. */
  pool: (wave: number): ActorDefId[] => {
    const pool: ActorDefId[] = ["crab"];
    if (wave >= 3) {
      pool.push("drowned");
    }
    if (wave >= 5) {
      pool.push("harpooner");
    }
    if (wave >= 8) {
      pool.push("brute");
    }
    return pool;
  },
  /** Bonus on the bounty of a wave the player called in early. */
  earlyBonus: 0.4,
};

const EXPANSION = {
  /** Cost grows with every sector already taken. */
  cost: (owned: number): { gold: number; wood: number } => ({
    gold: 120 + 90 * owned,
    wood: 60 + 50 * owned,
  }),
  /** Guardians standing on a sector, by distance from the starting one. */
  guards: (distance: number): number => 2 + distance,
  guardScale: (distance: number): number => 1 + 0.4 * (distance - 1),
  /** Seconds the island needs to drift onto a cleared sector. */
  attachTime: 6,
};

const SKILL_DEFS: SkillDef[] = [
  {
    id: "volley",
    name: "Залп",
    desc: "150 урона по площади в выбранной точке.",
    cooldown: 30,
    targeted: true,
    radius: 110,
    damage: 150,
  },
  {
    id: "fury",
    name: "Ярость",
    desc: "+60% скорости атаки армии на 12 секунд.",
    cooldown: 45,
    targeted: false,
    duration: 12,
  },
  {
    id: "ward",
    name: "Оберег",
    desc: "Здания получают на 70% меньше урона 12 секунд.",
    cooldown: 60,
    targeted: false,
    duration: 12,
  },
];

const SKILL_BY_ID = new Map(SKILL_DEFS.map((def) => [def.id, def]));

const COMBAT = {
  /** How far an actor looks for a target on its own. */
  aggro: 210,
  /** Extra reach guardians get so a sector defends itself as a whole. */
  guardAggro: 260,
  /** Damage bonus the forge gives to every island actor. */
  forgeBonus: 0.25,
  furyBonus: 0.6,
  wardReduction: 0.7,
  separation: 0.55,
};

export {
  ACTOR_BY_ID,
  ACTOR_DEFS,
  BUILDING_BY_ID,
  BUILDING_DEFS,
  CELL,
  COMBAT,
  EXPANSION,
  OCEAN,
  SECTOR_CELLS,
  SECTOR_COLS,
  SECTOR_ROWS,
  SECTOR_SIZE,
  SKILL_BY_ID,
  SKILL_DEFS,
  START_RESOURCES,
  START_SECTOR,
  TERRAIN_NAMES,
  TERRAIN_ROWS,
  WAVE,
  WORLD_CELLS_X,
  WORLD_CELLS_Y,
  WORLD_H,
  WORLD_W,
};
