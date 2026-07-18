const MAPS = [
  { id: "plains", name: "Plains", image: "./assets/plains-1.png" },
  { id: "water", name: "Water", image: "./assets/water-1.png" },
  { id: "hills", name: "Hills", image: "./assets/hills-1.png" },
];

const UNIT_TYPES = [
  {
    id: "light-spearman",
    name: "Легкий копейщик",
    hp: 80,
    attack: 12,
    morale: 70,
    speed: 3,
  },
  {
    id: "medium-spearman",
    name: "Средний копейщик",
    hp: 120,
    attack: 15,
    morale: 85,
    speed: 2,
  },
  {
    id: "heavy-spearman",
    name: "Тяжелый копейщик",
    hp: 160,
    attack: 18,
    morale: 110,
    speed: 1,
  },
  {
    id: "light-infantry",
    name: "Легкий пехотинец",
    hp: 60,
    attack: 20,
    morale: 70,
    speed: 3,
  },
  {
    id: "medium-infantry",
    name: "Средний пехотинец",
    hp: 90,
    attack: 25,
    morale: 85,
    speed: 2,
  },
  {
    id: "heavy-infantry",
    name: "Тяжелый пехотинец",
    hp: 120,
    attack: 30,
    morale: 100,
    speed: 1,
  },
  {
    id: "light-cavalry",
    name: "Легкая кавалерия",
    hp: 70,
    attack: 10,
    morale: 80,
    speed: 5,
  },
  {
    id: "medium-cavalry",
    name: "Средняя кавалерия",
    hp: 95,
    attack: 15,
    morale: 90,
    speed: 4,
  },
  {
    id: "heavy-cavalry",
    name: "Тяжелая кавалерия",
    hp: 120,
    attack: 25,
    morale: 100,
    speed: 3,
  },
  {
    id: "archer",
    name: "Лучник",
    hp: 50,
    attack: 6,
    morale: 70,
    speed: 3,
  },
  {
    id: "horse-archer",
    name: "Конный лучник",
    hp: 80,
    attack: 6,
    morale: 80,
    speed: 5,
  },
  {
    id: "longbowman",
    name: "Лонгбоумен",
    hp: 60,
    attack: 10,
    morale: 80,
    speed: 3,
  },
  {
    id: "crossbowman",
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

export { MAPS, UNIT_TYPES, RANK_MODIFIERS, STAT_META }
