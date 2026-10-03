import type { Cost } from "./resource";

type UnitRole = "melee" | "ranged" | "cavalry" | "air";

type UnitKind = {
  id: string;
  title: string;
  role: UnitRole;
  attack: number;
  health: number;
  cost: Cost;
};

type EnemyKind = {
  id: string;
  title: string;
  role: UnitRole;
  attack: number;
  health: number;
  tier: number;
};

const unitKinds: readonly UnitKind[] = [
  { id: "militia", title: "ополченец", role: "melee", attack: 2, health: 6, cost: { population: 1 } },
  { id: "spearman", title: "копейщик", role: "melee", attack: 3, health: 8, cost: { population: 1, wood: 2 } },
  { id: "swordsman", title: "мечник", role: "melee", attack: 5, health: 10, cost: { population: 1, stone: 2, hammers: 1 } },
  { id: "halberdier", title: "алебардист", role: "melee", attack: 7, health: 11, cost: { population: 1, hammers: 2 } },
  { id: "knight", title: "рыцарь", role: "melee", attack: 9, health: 14, cost: { population: 2, hammers: 3 } },
  { id: "slinger", title: "пращник", role: "ranged", attack: 2, health: 4, cost: { population: 1 } },
  { id: "archer", title: "лучник", role: "ranged", attack: 4, health: 5, cost: { population: 1, wood: 2 } },
  { id: "longbowman", title: "длинный лучник", role: "ranged", attack: 6, health: 6, cost: { population: 1, wood: 3 } },
  { id: "musketeer", title: "мушкетер", role: "ranged", attack: 9, health: 7, cost: { population: 1, hammers: 3 } },
  { id: "horse_slinger", title: "конный пращник", role: "cavalry", attack: 3, health: 7, cost: { population: 2 } },
  { id: "horse_archer", title: "конный лучник", role: "cavalry", attack: 5, health: 8, cost: { population: 2, wood: 2 } },
  { id: "horse_longbowman", title: "конный длинный лучник", role: "cavalry", attack: 7, health: 9, cost: { population: 2, wood: 3 } },
  { id: "dragoon", title: "конный мушкетер", role: "cavalry", attack: 10, health: 10, cost: { population: 2, hammers: 3 } },
  { id: "crow", title: "ворона", role: "air", attack: 2, health: 3, cost: { population: 1, mana: 1 } },
  { id: "eagle", title: "великий орёл", role: "air", attack: 6, health: 8, cost: { population: 1, mana: 3 } },
  { id: "griffin", title: "грифон", role: "air", attack: 9, health: 12, cost: { population: 2, mana: 5 } },
];

const enemyKinds: readonly EnemyKind[] = [
  { id: "wolf", title: "волк", role: "melee", attack: 3, health: 5, tier: 1 },
  { id: "spider", title: "паук", role: "melee", attack: 2, health: 4, tier: 1 },
  { id: "leech", title: "пиявка", role: "melee", attack: 2, health: 6, tier: 1 },
  { id: "skeleton", title: "скелет", role: "melee", attack: 4, health: 6, tier: 2 },
  { id: "zombie", title: "зомби", role: "melee", attack: 3, health: 9, tier: 2 },
  { id: "ogre", title: "огр", role: "melee", attack: 8, health: 16, tier: 3 },
  { id: "witch", title: "ведьма", role: "ranged", attack: 7, health: 7, tier: 3 },
  { id: "vampire", title: "вампир", role: "melee", attack: 9, health: 13, tier: 4 },
  { id: "moth", title: "моль", role: "air", attack: 3, health: 4, tier: 1 },
  { id: "bat", title: "летучая мышь", role: "air", attack: 4, health: 5, tier: 2 },
];

export { enemyKinds, unitKinds };
export type { EnemyKind, UnitKind, UnitRole };
