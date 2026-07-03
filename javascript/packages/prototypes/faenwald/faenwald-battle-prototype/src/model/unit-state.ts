/**
 * Model layer — observable UnitState (GDD §15.1).
 *
 * One observable unit on the field. It is hydrated from a catalog {@link UnitDef}
 * plus its instance data (side, rank, count, position, facing). Entering maxes
 * are derived once via {@link computeEnteringStats}; current HP/morale and the
 * per-turn flags are mutable observable state the View renders from. Combat
 * actions are added in later phases — this model only *holds* the state.
 */

import { makeAutoObservable } from 'mobx';
import { getDismountDef, type Category, type Rank, type Subtype, type UnitDef, type UnitPerks } from './catalog.ts';
import { computeEnteringStats, roundHalfUp } from './stats.ts';
import type { Axial, Facing, Side } from './types.ts';

/** Display glyph per category, for tokens and cards. */
const CATEGORY_ICON: Record<Category, string> = {
  spear: '🛡️',
  shock: '⚔️',
  cavalry: '🐎',
  ranged: '🏹',
  special: '⚙️',
};

/** Everything needed to instantiate a unit on the board. */
export interface UnitInit {
  id: string;
  def: UnitDef;
  side: Side;
  rank: Rank;
  /** Soldier count, 0..100 (§3.2). */
  count: number;
  hex: Axial;
  facing: Facing;
  /** Optional display name; defaults to the catalog name. */
  name?: string;
  /** Pre-battle strength multiplier (§3.5); defaults to 1. */
  strengthMod?: number;
  isRuler?: boolean;
  /** Override starting HP/morale (e.g. resuming a saved battle); default = max. */
  hp?: number;
  morale?: number;
}

export class UnitState {
  readonly id: string;
  /** Active catalog def — swapped on Dismount/Mount (§5.3); otherwise constant. */
  def: UnitDef;
  readonly side: Side;
  readonly name: string;
  readonly rank: Rank;
  readonly count: number;
  readonly strengthMod: number;
  readonly isRuler: boolean;

  /** Entering maxes after rank → count → strategy (§3.2–3.5); recomputed on Dismount/Mount. */
  maxHp: number;
  maxMorale: number;
  /** Full attack output before half-health degradation (§3.4). */
  enteringAttack: number;

  hex: Axial;
  facing: Facing;
  hp: number;
  morale: number;
  /** Extra morale capacity from a present ruler's aura (§11.3); 0 when no ruler buffs this side. */
  auraMorale = 0;
  /** Remaining ranged shots (§4.4); 0 for non-ranged units. */
  shotsLeft: number;
  hasActed = false;
  hasAttacked = false;
  /** Set when the unit has made a reactive opportunity attack this turn — it may then only turn (§8). */
  madeOpportunityAttack = false;
  dismounted = false;
  /** The mounted def stashed while dismounted, so Mount can re-saddle (§5.3). */
  mountedDef: UnitDef | null = null;
  /** Where this unit's horses wait while it is dismounted (§5.3); `null` once they flee. */
  horsesHex: Axial | null = null;
  /** Consecutive hexes moved straight forward this turn — the charge run (§5.3). */
  chargeHexes = 0;
  /** Battle turn on which the unit last fired (§4.4), for the crossbow 2-turn cadence. */
  lastFiredTurn: number | null = null;
  /** The hex the unit began this turn in — anchors the horse-archer melee rule (§4.4). */
  turnStartHex: Axial;
  /** Hexes of movement left this battle turn (§7.2); resets to speed each turn. */
  movementLeft: number;
  /** Whether the heavy-unit free turn (§7.2) has been spent this turn. */
  freeTurnUsed = false;

  constructor(init: UnitInit) {
    const entering = computeEnteringStats({
      baseHp: init.def.baseHp,
      baseAtk: init.def.baseAtk,
      baseMorale: init.def.baseMorale,
      rank: init.rank,
      count: init.count,
      strengthMod: init.strengthMod,
    });

    this.id = init.id;
    this.def = init.def;
    this.side = init.side;
    this.name = init.name ?? init.def.name;
    this.rank = init.rank;
    this.count = init.count;
    this.strengthMod = init.strengthMod ?? 1;
    this.isRuler = init.isRuler ?? false;

    this.maxHp = entering.maxHp;
    this.maxMorale = entering.maxMorale;
    this.enteringAttack = entering.attack;

    this.hex = init.hex;
    this.turnStartHex = init.hex;
    this.facing = init.facing;
    this.hp = init.hp ?? entering.maxHp;
    this.morale = init.morale ?? entering.maxMorale;
    this.shotsLeft = init.def.ammo ?? 0;
    this.movementLeft = init.def.speed;

    makeAutoObservable(this);
  }

  get category(): Category {
    return this.def.category;
  }

  /** Armour subtype (§3.6, §4.4) — surfaced for terrain matchups (mud §10). */
  get subtype(): Subtype {
    return this.def.subtype;
  }

  /** Base movement speed; never scales with rank or count (§3.2–3.3, §6.1). */
  get speed(): number {
    return this.def.speed;
  }

  /** Charge accumulation per consecutive hex, % (cavalry only, §4.3, §5.3). */
  get ramMod(): number | undefined {
    return this.def.ramMod;
  }

  /** Whether the unit takes part in combat (special units do not, §4.5). */
  get fights(): boolean {
    return this.def.fights;
  }

  /** Catalog matchup perks (§4) — lets a unit stand in for a combat {@link Defender}/{@link Attacker}. */
  get perks(): UnitPerks {
    return this.def.perks;
  }

  /** Heavy subtypes turn once per turn for free (§7.2). */
  get isHeavy(): boolean {
    return this.def.subtype === 'heavy';
  }

  /** Reset the per-turn flags and movement budget at the start of a battle turn (§6.2, §7.2). */
  beginTurn(): void {
    this.hasActed = false;
    this.hasAttacked = false;
    this.madeOpportunityAttack = false;
    this.freeTurnUsed = false;
    this.movementLeft = this.def.speed;
    this.chargeHexes = 0; // the charge bonus lasts only the turn it was built (§5.3)
    this.turnStartHex = this.hex;
  }

  /** Whether this unit can dismount into an analogous foot unit (§5.3). */
  get canDismount(): boolean {
    return !this.dismounted && getDismountDef(this.def) !== undefined;
  }

  /** Whether this dismounted unit can re-saddle its waiting horses (§5.3). */
  get canMount(): boolean {
    return this.dismounted && this.mountedDef !== null && this.horsesHex !== null;
  }

  /** Recompute the entering maxes from the active def after a Dismount/Mount swap (§5.3). */
  private recomputeMaxes(): void {
    const entering = computeEnteringStats({
      baseHp: this.def.baseHp,
      baseAtk: this.def.baseAtk,
      baseMorale: this.def.baseMorale,
      rank: this.rank,
      count: this.count,
      strengthMod: this.strengthMod,
    });
    this.maxHp = entering.maxHp;
    this.maxMorale = entering.maxMorale;
    this.enteringAttack = entering.attack;
  }

  /**
   * Swap the active def to its analogous foot unit, preserving HP/morale **by
   * percentage** (§5.3). Costs 1 hex of movement; the horses wait in the
   * vacated hex. Returns whether the dismount happened.
   */
  dismount(): boolean {
    const footDef = getDismountDef(this.def);
    if (!footDef || this.dismounted || this.movementLeft < 1) return false;

    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    const moraleRatio = this.maxMorale > 0 ? this.morale / this.maxMorale : 0;

    this.mountedDef = this.def;
    this.horsesHex = this.hex;
    this.def = footDef;
    this.recomputeMaxes();
    this.hp = roundHalfUp(this.maxHp * hpRatio);
    this.morale = roundHalfUp(this.maxMorale * moraleRatio);
    // A horse archer keeps its remaining arrows as an archer; a spearman has none.
    if (footDef.ammo === undefined) this.shotsLeft = 0;
    this.movementLeft -= 1;
    this.chargeHexes = 0;
    this.dismounted = true;
    this.hasActed = true;
    return true;
  }

  /**
   * Re-saddle the waiting horses, swapping back to the mounted def and again
   * preserving HP/morale by percentage (§5.3). Costs 1 hex. Returns whether the
   * mount happened (false if the horses have fled).
   */
  mount(): boolean {
    if (!this.canMount || this.movementLeft < 1) return false;

    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    const moraleRatio = this.maxMorale > 0 ? this.morale / this.maxMorale : 0;

    this.def = this.mountedDef!;
    this.mountedDef = null;
    this.horsesHex = null;
    this.recomputeMaxes();
    this.hp = roundHalfUp(this.maxHp * hpRatio);
    this.morale = roundHalfUp(this.maxMorale * moraleRatio);
    this.movementLeft -= 1;
    this.dismounted = false;
    this.hasActed = true;
    return true;
  }

  /** The horses flee (a battle reaches their hex, or fire passes through it, §5.3). */
  fleeHorses(): void {
    this.horsesHex = null;
  }

  get icon(): string {
    return CATEGORY_ICON[this.def.category];
  }

  /** Below half the entering max HP → attack output halves (§3.4). */
  get bloodied(): boolean {
    return this.maxHp > 0 && this.hp < this.maxHp / 2;
  }

  /** Attack actually dealt right now, after the half-health rule (§3.4). */
  get attack(): number {
    return this.bloodied ? roundHalfUp(this.enteringAttack * 0.5) : this.enteringAttack;
  }

  /** Still on the field (HP > 0, §11.1). */
  get isAlive(): boolean {
    return this.hp > 0;
  }

  /** Morale has hit zero → the unit routs (§11.1). */
  get isRouted(): boolean {
    return this.morale <= 0;
  }

  /** Morale capacity including a present ruler's aura (§11.3) — what the bar fills against. */
  get effectiveMaxMorale(): number {
    return this.maxMorale + this.auraMorale;
  }

  /**
   * Set this unit's ruler-aura morale to `amount` (§11.3), moving current morale
   * by the same delta so granting the aura lifts morale and losing it (the
   * ruler falls) drops it. Idempotent — re-setting the same amount does nothing.
   */
  setAura(amount: number): void {
    const delta = amount - this.auraMorale;
    if (delta === 0) return;
    this.auraMorale = amount;
    this.morale = Math.max(0, this.morale + delta);
  }

  /** 0..1 for an HP bar. */
  get hpRatio(): number {
    return this.maxHp === 0 ? 0 : Math.max(0, this.hp / this.maxHp);
  }

  /** 0..1 for a morale bar — filled against the aura-boosted capacity (§11.3). */
  get moraleRatio(): number {
    return this.effectiveMaxMorale === 0 ? 0 : Math.max(0, this.morale / this.effectiveMaxMorale);
  }
}
