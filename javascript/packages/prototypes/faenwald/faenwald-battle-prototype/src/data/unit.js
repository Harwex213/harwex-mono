const UNIT_TYPE_LIGHT_SPEARMAN = "light-spearman";
const UNIT_TYPE_MEDIUM_SPEARMAN = "medium-spearman";
const UNIT_TYPE_HEAVY_SPEARMAN = "heavy-spearman";
const UNIT_TYPE_LIGHT_INFANTRY = "light-infantry";
const UNIT_TYPE_MEDIUM_INFANTRY = "medium-infantry";
const UNIT_TYPE_HEAVY_INFANTRY = "heavy-infantry";
const UNIT_TYPE_LIGHT_CAVALRY = "light-cavalry";
const UNIT_TYPE_MEDIUM_CAVALRY = "medium-cavalry";
const UNIT_TYPE_HEAVY_CAVALRY = "heavy-cavalry";
const UNIT_TYPE_ARCHER = "archer";
const UNIT_TYPE_HORSE_ARCHER = "horse-archer";
const UNIT_TYPE_LONGBOWMAN = "longbowman";
const UNIT_TYPE_CROSSBOWMAN = "crossbowman";

const UNIT_TYPES = [
  {
    id: UNIT_TYPE_LIGHT_SPEARMAN,
    type: UNIT_TYPE_LIGHT_SPEARMAN,
    name: "Легкий копейщик",
    hp: 80,
    attack: 12,
    morale: 70,
    speed: 3,
    terrainClass: "infantry",
  },
  {
    id: UNIT_TYPE_MEDIUM_SPEARMAN,
    type: UNIT_TYPE_MEDIUM_SPEARMAN,
    name: "Средний копейщик",
    hp: 120,
    attack: 15,
    morale: 85,
    speed: 2,
    terrainClass: "infantry",
  },
  {
    id: UNIT_TYPE_HEAVY_SPEARMAN,
    type: UNIT_TYPE_HEAVY_SPEARMAN,
    name: "Тяжелый копейщик",
    hp: 160,
    attack: 18,
    morale: 110,
    speed: 1,
    terrainClass: "infantry",
    heavy: true,
  },
  {
    id: UNIT_TYPE_LIGHT_INFANTRY,
    type: UNIT_TYPE_LIGHT_INFANTRY,
    name: "Легкий пехотинец",
    hp: 60,
    attack: 20,
    morale: 70,
    speed: 3,
    terrainClass: "infantry",
  },
  {
    id: UNIT_TYPE_MEDIUM_INFANTRY,
    type: UNIT_TYPE_MEDIUM_INFANTRY,
    name: "Средний пехотинец",
    hp: 90,
    attack: 25,
    morale: 85,
    speed: 2,
    terrainClass: "infantry",
  },
  {
    id: UNIT_TYPE_HEAVY_INFANTRY,
    type: UNIT_TYPE_HEAVY_INFANTRY,
    name: "Тяжелый пехотинец",
    hp: 120,
    attack: 30,
    morale: 100,
    speed: 1,
    terrainClass: "infantry",
    heavy: true,
  },
  {
    id: UNIT_TYPE_LIGHT_CAVALRY,
    type: UNIT_TYPE_LIGHT_CAVALRY,
    name: "Легкая кавалерия",
    hp: 70,
    attack: 10,
    morale: 80,
    speed: 5,
    terrainClass: "cavalry",
    ramModifier: 8,
    maneuverable: true,
  },
  {
    id: UNIT_TYPE_MEDIUM_CAVALRY,
    type: UNIT_TYPE_MEDIUM_CAVALRY,
    name: "Средняя кавалерия",
    hp: 95,
    attack: 15,
    morale: 90,
    speed: 4,
    terrainClass: "cavalry",
    ramModifier: 16,
    maneuverable: true,
  },
  {
    id: UNIT_TYPE_HEAVY_CAVALRY,
    type: UNIT_TYPE_HEAVY_CAVALRY,
    name: "Тяжелая кавалерия",
    hp: 120,
    attack: 25,
    morale: 100,
    speed: 3,
    terrainClass: "cavalry",
    heavy: true,
    ramModifier: 24,
    maneuverable: true,
  },
  {
    id: UNIT_TYPE_ARCHER,
    type: UNIT_TYPE_ARCHER,
    name: "Лучник",
    hp: 50,
    attack: 6,
    morale: 70,
    speed: 3,
    terrainClass: "infantry",
    ranged: { arc: { range: 4, mult: 1 }, direct: { range: 2, mult: 2 }, meleeMult: 0.5, shots: 8 },
  },
  {
    id: UNIT_TYPE_HORSE_ARCHER,
    type: UNIT_TYPE_HORSE_ARCHER,
    name: "Конный лучник",
    hp: 80,
    attack: 6,
    morale: 80,
    speed: 5,
    terrainClass: "cavalry",
    maneuverable: true,
    // doc §4: «Не получает никакие бонусы за холм»
    noElevationBonus: true,
    ranged: { arc: { range: 2, mult: 1 }, direct: { range: 1, mult: 2 }, meleeMult: 0.5, shots: 8 },
  },
  {
    id: UNIT_TYPE_LONGBOWMAN,
    type: UNIT_TYPE_LONGBOWMAN,
    name: "Лонгбоумен",
    hp: 60,
    attack: 10,
    morale: 80,
    speed: 3,
    terrainClass: "infantry",
    ranged: { arc: { range: 4, mult: 1 }, direct: { range: 2, mult: 2 }, meleeMult: 0.5, shots: 8 },
  },
  {
    id: UNIT_TYPE_CROSSBOWMAN,
    type: UNIT_TYPE_CROSSBOWMAN,
    name: "Арбалетчик",
    hp: 60,
    // base attack already bakes in the direct-fire x2 multiplier, hence ranged.direct.mult below is 1
    attack: 40,
    morale: 80,
    speed: 3,
    terrainClass: "infantry",
    ranged: { arc: null, direct: { range: 3, mult: 1 }, meleeMult: 0.75, shots: 8, cooldown: 2 },
  },
];

const STAT_META = [
  { id: "hp", label: "hp", emoji: "❤️" },
  { id: "attack", label: "attack", emoji: "⚔️" },
  { id: "morale", label: "morale", emoji: "🏆" },
];

export {
  UNIT_TYPE_LIGHT_SPEARMAN,
  UNIT_TYPE_MEDIUM_SPEARMAN,
  UNIT_TYPE_HEAVY_SPEARMAN,
  UNIT_TYPE_LIGHT_INFANTRY,
  UNIT_TYPE_MEDIUM_INFANTRY,
  UNIT_TYPE_HEAVY_INFANTRY,
  UNIT_TYPE_LIGHT_CAVALRY,
  UNIT_TYPE_MEDIUM_CAVALRY,
  UNIT_TYPE_HEAVY_CAVALRY,
  UNIT_TYPE_ARCHER,
  UNIT_TYPE_HORSE_ARCHER,
  UNIT_TYPE_LONGBOWMAN,
  UNIT_TYPE_CROSSBOWMAN,

  UNIT_TYPES,
  STAT_META,
};
