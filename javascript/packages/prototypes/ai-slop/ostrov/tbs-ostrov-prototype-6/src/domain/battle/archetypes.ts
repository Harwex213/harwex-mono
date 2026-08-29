type TArchetypeId = "warrior" | "spear" | "archer" | "guardian" | "healer" | "rogue";

type TGlyph = "sword" | "spear" | "bow" | "shield" | "cross" | "dagger";

type TArchetype = {
  id: TArchetypeId;
  name: string;
  role: string;
  glyph: TGlyph;
  cost: number;
  maxHp: number;
  damage: number;
  armor: number;
  /** Centre-to-centre distance at which the unit may strike. */
  range: number;
  attackInterval: number;
  speed: number;
  radius: number;
  ranged: boolean;
  /** Healers spend their attack on the most wounded ally in `supportRange`. */
  heal: number;
  supportRange: number;
  blurb: string;
};

const ARCHETYPES: Record<TArchetypeId, TArchetype> = {
  warrior: {
    id: "warrior",
    name: "Ратник",
    role: "Ближний бой",
    glyph: "sword",
    cost: 3,
    maxHp: 130,
    damage: 15,
    armor: 2,
    range: 46,
    attackInterval: 0.9,
    speed: 62,
    radius: 18,
    ranged: false,
    heal: 0,
    supportRange: 0,
    blurb: "Ровный боец: держит удар и бьёт в ответ.",
  },
  spear: {
    id: "spear",
    name: "Копейщик",
    role: "Длинное древко",
    glyph: "spear",
    cost: 3,
    maxHp: 105,
    damage: 18,
    armor: 1,
    range: 80,
    attackInterval: 1.1,
    speed: 56,
    radius: 18,
    ranged: false,
    heal: 0,
    supportRange: 0,
    blurb: "Достаёт из-за спины своих, но хрупок в свалке.",
  },
  archer: {
    id: "archer",
    name: "Лучник",
    role: "Стрелок",
    glyph: "bow",
    cost: 4,
    maxHp: 72,
    damage: 20,
    armor: 0,
    range: 235,
    attackInterval: 1.2,
    speed: 52,
    radius: 16,
    ranged: true,
    heal: 0,
    supportRange: 0,
    blurb: "Бьёт через всё поле, отступает от ближнего боя.",
  },
  guardian: {
    id: "guardian",
    name: "Щитоносец",
    role: "Танк",
    glyph: "shield",
    cost: 4,
    maxHp: 245,
    damage: 9,
    armor: 6,
    range: 50,
    attackInterval: 1.2,
    speed: 44,
    radius: 21,
    ranged: false,
    heal: 0,
    supportRange: 0,
    blurb: "Медленный, зато снимает почти весь урон бронёй.",
  },
  healer: {
    id: "healer",
    name: "Знахарь",
    role: "Поддержка",
    glyph: "cross",
    cost: 5,
    maxHp: 84,
    damage: 7,
    armor: 0,
    range: 170,
    attackInterval: 1.3,
    speed: 54,
    radius: 16,
    ranged: true,
    heal: 30,
    supportRange: 230,
    blurb: "Лечит самого израненного союзника вместо выстрела.",
  },
  rogue: {
    id: "rogue",
    name: "Разбойник",
    role: "Убийца",
    glyph: "dagger",
    cost: 3,
    maxHp: 76,
    damage: 12,
    armor: 0,
    range: 42,
    attackInterval: 0.5,
    speed: 94,
    radius: 16,
    ranged: false,
    heal: 0,
    supportRange: 0,
    blurb: "Быстро добегает до стрелков и режет их частыми ударами.",
  },
};

const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as TArchetypeId[];

const archetypeOf = (id: TArchetypeId): TArchetype => ARCHETYPES[id];

export type { TArchetype, TArchetypeId, TGlyph };
export { ARCHETYPES, ARCHETYPE_IDS, archetypeOf };
