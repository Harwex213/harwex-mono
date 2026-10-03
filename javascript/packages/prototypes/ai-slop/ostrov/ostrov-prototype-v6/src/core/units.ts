import { ICONS } from "./icons";
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

/** What a ranged attacker throws. It only changes how the shot is drawn and how fast it flies. */
type TProjectile = "stone" | "arrow" | "bullet" | "hex" | "bolt";

/**
 * Combat stats of the cleanup phase. Distances are in hex steps and speeds in
 * hex steps per second, so the numbers read the same at any zoom. One hex step
 * is the distance between two neighbouring hex centres.
 */
type TCombatant = {
  readonly label: string;
  readonly icon: string;
  readonly hp: number;
  /** Damage of one hit, before the ±15% roll. */
  readonly damage: number;
  /** Seconds between two hits. */
  readonly cooldown: number;
  /** Reach in hex steps. Melee is 1: it hits the same or a neighbouring hex. */
  readonly range: number;
  /** Hex steps per second. */
  readonly speed: number;
  /** A flyer crosses open water and ignores hex paths. */
  readonly flying: boolean;
  /** `null` for melee. */
  readonly projectile: TProjectile | null;
};

type TUnit = TCombatant & {
  readonly id: TUnitId;
  readonly unitClass: TUnitClass;
  /** How many people the unit costs to field. */
  readonly upkeep: number;
};

type TEnemy = TCombatant & {
  readonly id: TEnemyId;
};

const MELEE = { range: 1, flying: false, projectile: null } as const;
const AIR = { range: 1, flying: true, projectile: null } as const;

/* The table is wide on purpose: one row is one unit, so rows compare at a glance. */
const UNITS: readonly TUnit[] = [
  { id: "militia", label: "Ополченец", icon: ICONS.militia, unitClass: "melee", hp: 30, damage: 6, cooldown: 1, speed: 1.1, upkeep: 1, ...MELEE },
  { id: "spearman", label: "Копейщик", icon: ICONS.spearman, unitClass: "melee", hp: 42, damage: 8, cooldown: 0.9, speed: 1.1, upkeep: 1, ...MELEE },
  { id: "swordsman", label: "Мечник", icon: ICONS.swordsman, unitClass: "melee", hp: 60, damage: 12, cooldown: 0.9, speed: 1.1, upkeep: 2, ...MELEE },
  { id: "halberdier", label: "Алебардист", icon: ICONS.halberdier, unitClass: "melee", hp: 74, damage: 17, cooldown: 1.1, speed: 1, upkeep: 2, ...MELEE },
  { id: "knight", label: "Рыцарь", icon: ICONS.knight, unitClass: "melee", hp: 110, damage: 22, cooldown: 1, speed: 1.2, upkeep: 3, ...MELEE },
  { id: "slinger", label: "Пращник", icon: ICONS.slinger, unitClass: "ranged", hp: 24, damage: 5, cooldown: 1.1, range: 2.2, speed: 1, upkeep: 1, flying: false, projectile: "stone" },
  { id: "archer", label: "Лучник", icon: ICONS.archer, unitClass: "ranged", hp: 28, damage: 7, cooldown: 1.2, range: 3, speed: 1, upkeep: 1, flying: false, projectile: "arrow" },
  { id: "longbowman", label: "Длинный лучник", icon: ICONS.longbowman, unitClass: "ranged", hp: 32, damage: 10, cooldown: 1.4, range: 4, speed: 0.95, upkeep: 2, flying: false, projectile: "arrow" },
  { id: "musketeer", label: "Мушкетёр", icon: ICONS.musketeer, unitClass: "ranged", hp: 36, damage: 19, cooldown: 2.2, range: 3.5, speed: 0.9, upkeep: 3, flying: false, projectile: "bullet" },
  { id: "cavalry_slinger", label: "Пращник (кавалерия)", icon: ICONS.cavalry, unitClass: "cavalry", hp: 44, damage: 6, cooldown: 1.1, range: 2.2, speed: 2, upkeep: 2, flying: false, projectile: "stone" },
  { id: "cavalry_archer", label: "Лучник (кавалерия)", icon: ICONS.cavalry, unitClass: "cavalry", hp: 50, damage: 8, cooldown: 1.2, range: 3, speed: 2, upkeep: 2, flying: false, projectile: "arrow" },
  { id: "cavalry_longbowman", label: "Длинный лучник (кавалерия)", icon: ICONS.cavalry, unitClass: "cavalry", hp: 56, damage: 11, cooldown: 1.4, range: 4, speed: 1.9, upkeep: 3, flying: false, projectile: "arrow" },
  { id: "cavalry_musketeer", label: "Мушкетёр (кавалерия)", icon: ICONS.cavalry, unitClass: "cavalry", hp: 62, damage: 20, cooldown: 2.2, range: 3.5, speed: 1.9, upkeep: 4, flying: false, projectile: "bullet" },
  { id: "crow", label: "Ворона", icon: ICONS.crow, unitClass: "air", hp: 26, damage: 6, cooldown: 0.8, speed: 2.6, upkeep: 1, ...AIR },
  { id: "great_eagle", label: "Великий орёл", icon: ICONS.greatEagle, unitClass: "air", hp: 54, damage: 12, cooldown: 0.9, speed: 2.8, upkeep: 3, ...AIR },
  { id: "griffin", label: "Грифон", icon: ICONS.griffin, unitClass: "air", hp: 96, damage: 20, cooldown: 1, speed: 2.5, upkeep: 4, ...AIR },
];

const ENEMIES: readonly TEnemy[] = [
  { id: "wolf", label: "Волк", icon: ICONS.wolf, hp: 32, damage: 7, cooldown: 0.8, speed: 1.6, ...MELEE },
  { id: "spider", label: "Паук", icon: ICONS.spider, hp: 26, damage: 6, cooldown: 0.8, speed: 1.3, ...MELEE },
  { id: "leech", label: "Пиявка", icon: ICONS.leech, hp: 40, damage: 5, cooldown: 0.7, speed: 0.7, ...MELEE },
  { id: "skeleton", label: "Скелет", icon: ICONS.skeleton, hp: 44, damage: 9, cooldown: 1, speed: 1, ...MELEE },
  { id: "zombie", label: "Зомби", icon: ICONS.zombie, hp: 62, damage: 9, cooldown: 1.2, speed: 0.6, ...MELEE },
  { id: "ogre", label: "Огр", icon: ICONS.ogre, hp: 120, damage: 24, cooldown: 1.6, speed: 0.8, ...MELEE },
  { id: "witch", label: "Ведьма", icon: ICONS.witch, hp: 46, damage: 12, cooldown: 1.6, range: 3, speed: 0.9, flying: false, projectile: "hex" },
  { id: "vampire", label: "Вампир", icon: ICONS.vampire, hp: 88, damage: 16, cooldown: 0.9, speed: 1.4, ...MELEE },
  { id: "moth", label: "Моль", icon: ICONS.moth, hp: 30, damage: 7, cooldown: 0.9, speed: 2.2, ...AIR },
  { id: "bat", label: "Летучая мышь", icon: ICONS.bat, hp: 24, damage: 5, cooldown: 0.7, speed: 2.6, ...AIR },
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

export type { TCombatant, TEnemy, TEnemyId, TProjectile, TUnit, TUnitClass, TUnitId };
export { buildRoster, ENEMIES, getEnemy, getUnit, UNITS };
