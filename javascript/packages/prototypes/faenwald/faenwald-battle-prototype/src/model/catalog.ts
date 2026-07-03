/**
 * Model layer — the unit catalog (GDD §4).
 *
 * A typed data table of {@link UnitDef}s. Every stat is **per 100 soldiers at
 * rank II (base)**; the engine applies rank → count → degradation (§3.2–3.4) to
 * derive combat values. Keeping the numbers in data (not branching code) lets
 * subtypes, custom templates (§4.6) and terrain rules compose later (§15.1).
 */

/** The five unit categories (§3.6). The first four fight; `special` does not. */
export type Category = 'spear' | 'shock' | 'cavalry' | 'ranged' | 'special';

/** Subtype label within a category (§3.6, §4.4). */
export type Subtype =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'archer'
  | 'horseArcher'
  | 'longbow'
  | 'crossbow'
  | 'engineer'
  | 'medic';

/** Data-driven ability ids (§5). Mechanics are wired in later phases. */
export type AbilityId =
  | 'closeFormation'
  | 'breakthrough'
  | 'ramStrike'
  | 'maneuverability'
  | 'dismount'
  | 'rangedAttack';

/** Veterancy I–VI; rank II is the catalog baseline (§3.3). */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Data-driven matchup modifiers drawn from the catalog's "perks" columns.
 * Numeric fields are physical-channel multipliers unless noted; textual rules
 * not yet mechanised live in {@link UnitPerks.notes} verbatim.
 */
export interface UnitPerks {
  /** Incoming multiplier vs ranged attacks (§4.1–4.4). */
  takesFromRanged?: number;
  /** Incoming multiplier vs a cavalry charge (§4.1–4.3). */
  takesFromCharge?: number;
  /** Outgoing multiplier this unit deals into a defender's rear (cavalry; stacks). */
  dealsToRear?: number;
  /** Outgoing multiplier this unit deals to ranged soldiers (light cavalry §4.3). */
  dealsToRanged?: number;
  /** Shock infantry treat rear hits as flank hits for the morale multiplier (§4.2). */
  rearActsAsFlank?: boolean;
  /**
   * Crossbow "full damage to heavy" (§4.4, 🔴 §14.4): when firing, the defender's
   * anti-ranged **reduction** (a `takesFromRanged` below 1, e.g. heavy ×0.5) does
   * not apply. Vulnerabilities (≥1, e.g. light ×1.5) still do.
   */
  ignoresAntiRangedReduction?: boolean;
  /** Source rules carried as text until a later phase mechanises them. */
  notes?: string[];
}

/** A catalog entry: per-100, rank-II base stats plus data-driven abilities/perks. */
export interface UnitDef {
  /** Stable key, e.g. `'spear.heavy'`. */
  id: string;
  name: string;
  category: Category;
  subtype: Subtype;
  /** Per-100 @ rank II base stats (§3.1, §4). */
  baseHp: number;
  baseAtk: number;
  baseMorale: number;
  /** Movement hexes per turn; does **not** scale with rank or count (§3.2–3.3). */
  speed: number;
  /** Charge accumulation per consecutive hex, % (cavalry only, §4.3, §5.3). */
  ramMod?: number;
  /** Shots per battle for ranged units (§4.4); `undefined` for non-ranged. */
  ammo?: number;
  /** Recruitment cost; `null` when not hireable (longbowman §4.4). */
  cost: number | null;
  /** Whether the unit participates in tactical combat (special units do not, §4.5). */
  fights: boolean;
  abilities: AbilityId[];
  perks: UnitPerks;
}

/** Shots every ranged unit carries into a battle (§4.4). */
export const RANGED_AMMO = 8;

/** Rank-II baseline; scaling helpers measure other ranks relative to this (§3.3). */
export const BASELINE_RANK: Rank = 2;

/**
 * The full unit catalog (§4), keyed by {@link UnitDef.id}. Order follows the
 * GDD tables: spearmen → shock → cavalry → ranged → special.
 */
export const UNIT_CATALOG: Record<string, UnitDef> = {
  // §4.1 Spearmen — Close Formation.
  'spear.light': {
    id: 'spear.light',
    name: 'Light spearman',
    category: 'spear',
    subtype: 'light',
    baseHp: 80,
    baseAtk: 12,
    baseMorale: 70,
    speed: 3,
    cost: 30_000,
    fights: true,
    abilities: ['closeFormation'],
    perks: { takesFromRanged: 1.5 },
  },
  'spear.medium': {
    id: 'spear.medium',
    name: 'Medium spearman',
    category: 'spear',
    subtype: 'medium',
    baseHp: 120,
    baseAtk: 15,
    baseMorale: 85,
    speed: 2,
    cost: 50_000,
    fights: true,
    abilities: ['closeFormation'],
    perks: { takesFromCharge: 0.75 },
  },
  'spear.heavy': {
    id: 'spear.heavy',
    name: 'Heavy spearman',
    category: 'spear',
    subtype: 'heavy',
    baseHp: 160,
    baseAtk: 18,
    baseMorale: 110,
    speed: 1,
    cost: 70_000,
    fights: true,
    abilities: ['closeFormation'],
    perks: { takesFromCharge: 0.5, takesFromRanged: 0.5 },
  },

  // §4.2 Shock Infantry — Breakthrough; rear hits count as flank for morale.
  'shock.light': {
    id: 'shock.light',
    name: 'Light infantry',
    category: 'shock',
    subtype: 'light',
    baseHp: 60,
    baseAtk: 20,
    baseMorale: 70,
    speed: 3,
    cost: 30_000,
    fights: true,
    abilities: ['breakthrough'],
    perks: { takesFromRanged: 1.5, rearActsAsFlank: true },
  },
  'shock.medium': {
    id: 'shock.medium',
    name: 'Medium infantry',
    category: 'shock',
    subtype: 'medium',
    baseHp: 90,
    baseAtk: 25,
    baseMorale: 85,
    speed: 2,
    cost: 50_000,
    fights: true,
    abilities: ['breakthrough'],
    perks: { rearActsAsFlank: true },
  },
  'shock.heavy': {
    id: 'shock.heavy',
    name: 'Heavy infantry',
    category: 'shock',
    subtype: 'heavy',
    baseHp: 120,
    baseAtk: 30,
    baseMorale: 100,
    speed: 1,
    cost: 70_000,
    fights: true,
    abilities: ['breakthrough'],
    perks: { takesFromCharge: 0.75, takesFromRanged: 0.5, rearActsAsFlank: true },
  },

  // §4.3 Cavalry — Ram Strike + Maneuverability + Dismount.
  'cavalry.light': {
    id: 'cavalry.light',
    name: 'Light cavalry',
    category: 'cavalry',
    subtype: 'light',
    baseHp: 70,
    baseAtk: 10,
    baseMorale: 80,
    speed: 5,
    ramMod: 8,
    cost: 40_000,
    fights: true,
    abilities: ['ramStrike', 'maneuverability', 'dismount'],
    perks: {
      dealsToRear: 1.5,
      dealsToRanged: 1.5,
      takesFromRanged: 1.5,
      notes: [
        'Deals ×1.5 to rear (stacks) and to ranged soldiers.',
        'Cannot be the target of a ranged opportunity attack (§4.3).',
        'Cannot move while an enemy ranged unit is in an adjacent hex (§4.3).',
      ],
    },
  },
  'cavalry.medium': {
    id: 'cavalry.medium',
    name: 'Medium cavalry',
    category: 'cavalry',
    subtype: 'medium',
    baseHp: 95,
    baseAtk: 15,
    baseMorale: 90,
    speed: 4,
    ramMod: 16,
    cost: 90_000,
    fights: true,
    abilities: ['ramStrike', 'maneuverability', 'dismount'],
    perks: { notes: ['Deals +×0.25 more to rear (stacks with the standard rear multiplier).'] },
  },
  'cavalry.heavy': {
    id: 'cavalry.heavy',
    name: 'Heavy cavalry',
    category: 'cavalry',
    subtype: 'heavy',
    baseHp: 120,
    baseAtk: 25,
    baseMorale: 100,
    speed: 3,
    ramMod: 24,
    cost: 160_000,
    fights: true,
    abilities: ['ramStrike', 'maneuverability', 'dismount'],
    perks: { takesFromRanged: 0.5 },
  },

  // §4.4 Ranged — Ranged Attack (3 modes); 8 shots per battle.
  'ranged.archer': {
    id: 'ranged.archer',
    name: 'Archer',
    category: 'ranged',
    subtype: 'archer',
    baseHp: 50,
    baseAtk: 6,
    baseMorale: 70,
    speed: 3,
    ammo: RANGED_AMMO,
    cost: 25_000,
    fights: true,
    abilities: ['rangedAttack'],
    perks: { notes: ['Baseline ranged unit.'] },
  },
  'ranged.horseArcher': {
    id: 'ranged.horseArcher',
    name: 'Horse archer',
    category: 'ranged',
    subtype: 'horseArcher',
    baseHp: 80,
    baseAtk: 6,
    baseMorale: 80,
    speed: 5,
    ammo: RANGED_AMMO,
    cost: 60_000,
    fights: true,
    abilities: ['rangedAttack', 'maneuverability', 'dismount'],
    perks: {
      dealsToRear: 1.5,
      notes: [
        'Dismounts into an archer (§5.3).',
        'Arcing 2 hexes; direct fire adjacent hex only; may fire into its flank & rear hexes.',
        'No hill bonuses. Counts as cavalry for terrain bonuses/penalties.',
        'Cannot be meleed in any hex except the one it began its turn in; while that holds it takes no close-combat penalty but cannot direct-fire until it moves 1 hex away.',
      ],
    },
  },
  'ranged.longbow': {
    id: 'ranged.longbow',
    name: 'Longbowman',
    category: 'ranged',
    subtype: 'longbow',
    baseHp: 60,
    baseAtk: 10,
    baseMorale: 80,
    speed: 3,
    ammo: RANGED_AMMO,
    cost: null,
    fights: true,
    abilities: ['rangedAttack'],
    perks: {
      notes: [
        'Not hireable. A rank III+ archer retrains over 5 years into a longbowman one rank lower with the "Long Bows" tech (strategic; not produced in-battle).',
      ],
    },
  },
  'ranged.crossbow': {
    id: 'ranged.crossbow',
    name: 'Crossbowman',
    category: 'ranged',
    subtype: 'crossbow',
    baseHp: 60,
    baseAtk: 40, // direct-fire damage (§4.4)
    baseMorale: 80,
    speed: 3,
    ammo: RANGED_AMMO,
    cost: 75_000,
    fights: true,
    abilities: ['rangedAttack'],
    perks: {
      ignoresAntiRangedReduction: true,
      notes: [
        'No arcing. Direct fire +1 hex range. Fires once per 2 turns.',
        'Deals full damage to heavy soldiers (🔴 §14: heavy anti-ranged reduction does not apply).',
        'Close-combat penalty ×0.75. Requires "Crossbow Mechanisms" tech.',
      ],
    },
  },

  // §4.5 Special units — do not fight. Hired only at full strength; cannot be rank I.
  'special.engineer': {
    id: 'special.engineer',
    name: 'Engineer',
    category: 'special',
    subtype: 'engineer',
    baseHp: 0,
    baseAtk: 0,
    baseMorale: 0,
    speed: 0,
    cost: 40_000,
    fights: false,
    abilities: [],
    perks: {
      notes: [
        'Build/siege specialist: +0.5 build speed; +0.25 and +10% siege-weapon damage per level from III. Strategic only.',
      ],
    },
  },
  'special.medic': {
    id: 'special.medic',
    name: 'Medic',
    category: 'special',
    subtype: 'medic',
    baseHp: 0,
    baseAtk: 0,
    baseMorale: 0,
    speed: 0,
    cost: 30_000,
    fights: false,
    abilities: [],
    perks: {
      notes: [
        'Reduces post-battle losses by 10% per rank from II, up to a 70% cap (§12.3).',
        'Scales down if the unit exceeds 1000. Cannot heal a unit that did not escape the field.',
      ],
    },
  },
};

/** Every catalog entry as an array, preserving insertion order. */
export const UNIT_DEFS: readonly UnitDef[] = Object.values(UNIT_CATALOG);

/** Look up a catalog entry by id (e.g. `'cavalry.heavy'`). */
export function getUnitDef(id: string): UnitDef | undefined {
  return UNIT_CATALOG[id];
}

/**
 * The "analogous" foot unit a mounted unit becomes when it **dismounts** (§5.3):
 * cavalry → the same-weight spearman, horse archer → archer. Keyed by mounted
 * def id; absent for units that cannot dismount.
 */
export const DISMOUNT_MAP: Record<string, string> = {
  'cavalry.light': 'spear.light',
  'cavalry.medium': 'spear.medium',
  'cavalry.heavy': 'spear.heavy',
  'ranged.horseArcher': 'ranged.archer',
};

/** The dismounted foot-unit def for a mounted `def`, or `undefined` if it cannot dismount (§5.3). */
export function getDismountDef(def: UnitDef): UnitDef | undefined {
  const id = DISMOUNT_MAP[def.id];
  return id ? UNIT_CATALOG[id] : undefined;
}
