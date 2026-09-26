import { pick } from "./rng";
import type { TRng } from "./rng";

/**
 * The rosters of the spec. Melee, ranged, cavalry and air are the player's;
 * the ten creatures are what sits on an uncleared island.
 *
 * The spec writes the cavalry list with the same four names as the ranged one.
 * That is kept as written: the ids differ, the labels say which is which.
 */

type TUnitClass = "melee" | "ranged" | "cavalry" | "air";

type TUnitId =
  | "militia"
  | "spearman"
  | "swordsman"
  | "halberdier"
  | "knight"
  | "slinger"
  | "archer"
  | "longbowman"
  | "musketeer"
  | "cavalry_slinger"
  | "cavalry_archer"
  | "cavalry_longbowman"
  | "cavalry_musketeer"
  | "crow"
  | "great_eagle"
  | "griffin";

type TEnemyId =
  | "wolf"
  | "spider"
  | "leech"
  | "skeleton"
  | "zombie"
  | "ogre"
  | "witch"
  | "vampire"
  | "moth"
  | "bat";

type TCombatant = {
  readonly label: string;
  readonly emoji: string;
  readonly hp: number;
  /** Damage per second while a target is in range. */
  readonly damage: number;
  /** Pixels of the arena. Melee is short, ranged reaches across a gap. */
  readonly range: number;
  /** Pixels per second. */
  readonly speed: number;
};

type TUnit = TCombatant & {
  readonly id: TUnitId;
  readonly unitClass: TUnitClass;
  /** How many people the unit costs to field. */
  readonly upkeep: number;
};

type TEnemy = TCombatant & {
  readonly id: TEnemyId;
  readonly flying: boolean;
};

const UNITS: readonly TUnit[] = [
  { id: "militia", label: "Ополченец", emoji: "🧑‍🌾", unitClass: "melee", hp: 30, damage: 6, range: 16, speed: 42, upkeep: 1 },
  { id: "spearman", label: "Копейщик", emoji: "🔱", unitClass: "melee", hp: 42, damage: 9, range: 22, speed: 42, upkeep: 1 },
  { id: "swordsman", label: "Мечник", emoji: "🗡️", unitClass: "melee", hp: 60, damage: 13, range: 16, speed: 44, upkeep: 2 },
  { id: "halberdier", label: "Алебардист", emoji: "⚔️", unitClass: "melee", hp: 74, damage: 17, range: 24, speed: 40, upkeep: 2 },
  { id: "knight", label: "Рыцарь", emoji: "🛡️", unitClass: "melee", hp: 110, damage: 22, range: 18, speed: 46, upkeep: 3 },
  { id: "slinger", label: "Пращник", emoji: "🪨", unitClass: "ranged", hp: 24, damage: 5, range: 70, speed: 38, upkeep: 1 },
  { id: "archer", label: "Лучник", emoji: "🏹", unitClass: "ranged", hp: 28, damage: 8, range: 90, speed: 38, upkeep: 1 },
  { id: "longbowman", label: "Длинный лучник", emoji: "🎯", unitClass: "ranged", hp: 32, damage: 11, range: 120, speed: 36, upkeep: 2 },
  { id: "musketeer", label: "Мушкетёр", emoji: "🔫", unitClass: "ranged", hp: 36, damage: 16, range: 110, speed: 36, upkeep: 3 },
  { id: "cavalry_slinger", label: "Пращник (кавалерия)", emoji: "🐎", unitClass: "cavalry", hp: 44, damage: 6, range: 70, speed: 78, upkeep: 2 },
  { id: "cavalry_archer", label: "Лучник (кавалерия)", emoji: "🐎", unitClass: "cavalry", hp: 50, damage: 9, range: 90, speed: 78, upkeep: 2 },
  { id: "cavalry_longbowman", label: "Длинный лучник (кавалерия)", emoji: "🐎", unitClass: "cavalry", hp: 56, damage: 12, range: 120, speed: 76, upkeep: 3 },
  { id: "cavalry_musketeer", label: "Мушкетёр (кавалерия)", emoji: "🐎", unitClass: "cavalry", hp: 62, damage: 17, range: 110, speed: 76, upkeep: 4 },
  { id: "crow", label: "Ворона", emoji: "🐦‍⬛", unitClass: "air", hp: 26, damage: 7, range: 20, speed: 96, upkeep: 1 },
  { id: "great_eagle", label: "Великий орёл", emoji: "🦅", unitClass: "air", hp: 54, damage: 14, range: 20, speed: 104, upkeep: 3 },
  { id: "griffin", label: "Грифон", emoji: "🦁", unitClass: "air", hp: 96, damage: 21, range: 22, speed: 92, upkeep: 4 },
];

const ENEMIES: readonly TEnemy[] = [
  { id: "wolf", label: "Волк", emoji: "🐺", hp: 32, damage: 8, range: 16, speed: 62, flying: false },
  { id: "spider", label: "Паук", emoji: "🕷️", hp: 26, damage: 7, range: 18, speed: 54, flying: false },
  { id: "leech", label: "Пиявка", emoji: "🪱", hp: 40, damage: 6, range: 14, speed: 30, flying: false },
  { id: "skeleton", label: "Скелет", emoji: "💀", hp: 44, damage: 10, range: 16, speed: 40, flying: false },
  { id: "zombie", label: "Зомби", emoji: "🧟", hp: 62, damage: 9, range: 14, speed: 26, flying: false },
  { id: "ogre", label: "Огр", emoji: "👹", hp: 120, damage: 20, range: 20, speed: 32, flying: false },
  { id: "witch", label: "Ведьма", emoji: "🧙", hp: 46, damage: 14, range: 95, speed: 34, flying: false },
  { id: "vampire", label: "Вампир", emoji: "🧛", hp: 88, damage: 18, range: 18, speed: 56, flying: false },
  { id: "moth", label: "Моль", emoji: "🦋", hp: 30, damage: 8, range: 16, speed: 88, flying: true },
  { id: "bat", label: "Летучая мышь", emoji: "🦇", hp: 24, damage: 6, range: 14, speed: 100, flying: true },
];

const UNIT_BY_ID = new Map(UNITS.map((unit) => [unit.id, unit]));
const ENEMY_BY_ID = new Map(ENEMIES.map((enemy) => [enemy.id, enemy]));

const getUnit = (id: TUnitId) => {
  const unit = UNIT_BY_ID.get(id);
  if (!unit) {
    throw new Error(`Unknown unit: ${id}`);
  }

  return unit;
};

const getEnemy = (id: TEnemyId) => {
  const enemy = ENEMY_BY_ID.get(id);
  if (!enemy) {
    throw new Error(`Unknown enemy: ${id}`);
  }

  return enemy;
};

/**
 * Who goes to the clearing phase. The spec never names a military building, so
 * the army is levied from the population: each unit costs people, and only
 * researched units can be fielded. The militia needs no research.
 */
const buildRoster = (population: number, unlocked: readonly TUnitId[], rng: TRng): readonly TUnitId[] => {
  const pool = UNITS.filter((unit) => unlocked.includes(unit.id));
  const roster: TUnitId[] = [];
  let budget = population;

  while (budget > 0) {
    const affordable = pool.filter((unit) => unit.upkeep <= budget);
    if (affordable.length === 0) {
      break;
    }

    const unit = pick(rng, affordable);
    roster.push(unit.id);
    budget -= unit.upkeep;
  }

  return roster;
};

export type { TCombatant, TEnemy, TEnemyId, TUnit, TUnitClass, TUnitId };
export { buildRoster, ENEMIES, getEnemy, getUnit, UNITS };
