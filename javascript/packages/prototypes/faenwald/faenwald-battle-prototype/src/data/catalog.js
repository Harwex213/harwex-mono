const MAPS = [
  { id: "plains", name: "Plains", image: "./assets/plains-1.png" },
  { id: "water", name: "Water", image: "./assets/water-1.png" },
  { id: "hills", name: "Hills", image: "./assets/hills-1.png" },
];

const UNIT_TYPES = [
  { id: "spearman", name: "spearman", hp: 80, attack: 12, morale: 70 },
  { id: "archer", name: "archer", hp: 55, attack: 15, morale: 60 },
  { id: "knight", name: "knight", hp: 120, attack: 18, morale: 80 },
  { id: "militia", name: "militia", hp: 60, attack: 8, morale: 40 },
];

// stat identity + presentation in one place; consumed by the stat pickers,
// the modifiers editor, and the stat readouts on the battle screens
const STAT_META = [
  { id: "hp", label: "hp", emoji: "❤️" },
  { id: "attack", label: "attack", emoji: "⚔️" },
  { id: "morale", label: "morale", emoji: "🏆" },
];

const MODIFIERS = [
  { id: "veteran", name: "veteran", description: "+25% attack", flat: {}, percent: { attack: 0.25 } },
  { id: "fortified", name: "fortified", description: "+30 HP", flat: { hp: 30 }, percent: {} },
  { id: "inspired", name: "inspired", description: "+20 morale", flat: { morale: 20 }, percent: {} },
  { id: "poisoned", name: "poisoned", description: "-15% HP", flat: {}, percent: { hp: -0.15 } },
  { id: "shieldwall", name: "shieldwall", description: "+15 HP, -10% attack", flat: { hp: 15 }, percent: { attack: -0.1 } },
  { id: "berserk", name: "berserk", description: "+40% attack, -20 morale", flat: { morale: -20 }, percent: { attack: 0.4 } },
];

export { MAPS, UNIT_TYPES, MODIFIERS, STAT_META }
