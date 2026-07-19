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

export { RANK_MODIFIERS };
