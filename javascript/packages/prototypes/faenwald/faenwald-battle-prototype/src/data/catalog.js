const MAPS = [
  { id: "plains", name: "Plains", image: "./assets/plains-1.png" },
  { id: "water", name: "Water", image: "./assets/water-1.png" },
  { id: "hills", name: "Hills", image: "./assets/hills-1.png" },
];

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
  },
  {
    id: UNIT_TYPE_MEDIUM_SPEARMAN,
    type: UNIT_TYPE_MEDIUM_SPEARMAN,
    name: "Средний копейщик",
    hp: 120,
    attack: 15,
    morale: 85,
    speed: 2,
  },
  {
    id: UNIT_TYPE_HEAVY_SPEARMAN,
    type: UNIT_TYPE_HEAVY_SPEARMAN,
    name: "Тяжелый копейщик",
    hp: 160,
    attack: 18,
    morale: 110,
    speed: 1,
  },
  {
    id: UNIT_TYPE_LIGHT_INFANTRY,
    type: UNIT_TYPE_LIGHT_INFANTRY,
    name: "Легкий пехотинец",
    hp: 60,
    attack: 20,
    morale: 70,
    speed: 3,
  },
  {
    id: UNIT_TYPE_MEDIUM_INFANTRY,
    type: UNIT_TYPE_MEDIUM_INFANTRY,
    name: "Средний пехотинец",
    hp: 90,
    attack: 25,
    morale: 85,
    speed: 2,
  },
  {
    id: UNIT_TYPE_HEAVY_INFANTRY,
    type: UNIT_TYPE_HEAVY_INFANTRY,
    name: "Тяжелый пехотинец",
    hp: 120,
    attack: 30,
    morale: 100,
    speed: 1,
  },
  {
    id: UNIT_TYPE_LIGHT_CAVALRY,
    type: UNIT_TYPE_LIGHT_CAVALRY,
    name: "Легкая кавалерия",
    hp: 70,
    attack: 10,
    morale: 80,
    speed: 5,
  },
  {
    id: UNIT_TYPE_MEDIUM_CAVALRY,
    type: UNIT_TYPE_MEDIUM_CAVALRY,
    name: "Средняя кавалерия",
    hp: 95,
    attack: 15,
    morale: 90,
    speed: 4,
  },
  {
    id: UNIT_TYPE_HEAVY_CAVALRY,
    type: UNIT_TYPE_HEAVY_CAVALRY,
    name: "Тяжелая кавалерия",
    hp: 120,
    attack: 25,
    morale: 100,
    speed: 3,
  },
  {
    id: UNIT_TYPE_ARCHER,
    type: UNIT_TYPE_ARCHER,
    name: "Лучник",
    hp: 50,
    attack: 6,
    morale: 70,
    speed: 3,
  },
  {
    id: UNIT_TYPE_HORSE_ARCHER,
    type: UNIT_TYPE_HORSE_ARCHER,
    name: "Конный лучник",
    hp: 80,
    attack: 6,
    morale: 80,
    speed: 5,
  },
  {
    id: UNIT_TYPE_LONGBOWMAN,
    type: UNIT_TYPE_LONGBOWMAN,
    name: "Лонгбоумен",
    hp: 60,
    attack: 10,
    morale: 80,
    speed: 3,
  },
  {
    id: UNIT_TYPE_CROSSBOWMAN,
    type: UNIT_TYPE_CROSSBOWMAN,
    name: "Арбалетчик",
    hp: 60,
    attack: 40, // direct-fire damage; no arcing shot, fires once per 2 turns
    morale: 80,
    speed: 3,
  },
];

// stat identity + presentation in one place; consumed by the stat pickers,
// the modifiers editor, and the stat readouts on the battle screens
const STAT_META = [
  { id: "hp", label: "hp", emoji: "❤️" },
  { id: "attack", label: "attack", emoji: "⚔️" },
  { id: "morale", label: "morale", emoji: "🏆" },
];

const RANK_MODIFIERS = [
  {
    id: "first-rank",
    name: "I Ранг",
    description: "-25% ко всему",
    flat: {},
    percent: { attack: -0.25, hp: -0.25, morale: -0.25 },
  },
  {
    id: "third-rank",
    name: "III Ранг",
    description: "+25% ко всему",
    flat: {},
    percent: { attack: 0.25, hp: 0.25, morale: 0.25 },
  },
  {
    id: "fourth-rank",
    name: "IV Ранг",
    description: "+50% ко всему",
    flat: {},
    percent: { attack: 0.50, hp: 0.50, morale: 0.50 },
  },
  {
    id: "fifth-rank",
    name: "V Ранг",
    description: "+75% ко всему",
    flat: {},
    percent: { attack: 0.75, hp: 0.75, morale: 0.75 },
  },
  {
    id: "sixth-rank",
    name: "VI Ранг",
    description: "+100% ко всему",
    flat: {},
    percent: { attack: 1, hp: 1, morale: 1 },
  },
];

export {
  MAPS,
  UNIT_TYPES,
  RANK_MODIFIERS,
  STAT_META,
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
}
