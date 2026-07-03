/**
 * Model layer — BattleStore.
 *
 * The single MobX store for the prototype. Loads the battle through the API
 * layer and hydrates the transport DTOs into the observable {@link Board} and
 * {@link UnitState} domain objects the View renders from. It also owns the
 * transient UI selection (which unit's card is open). Combat actions arrive in
 * later phases; phase 1 only loads, holds and selects.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { battleApi } from '@/api/battle-api';
import {
  canRangedAttack,
  isActive,
  moveTargets,
  performAttack,
  performBreakthrough,
  performMove,
  performRangedAttack,
  performTurn,
  previewAttack,
  rangedTargets,
  targetableEnemies,
} from './actions';
import { canBreakthrough, planBreakthrough } from './breakthrough';
import { distance, HEX_DIRECTION_COUNT } from './hex';
import { directionOf, isInFront } from './zones';
import { getUnitDef, RANGED_AMMO } from './catalog';
import { Board, Hex, coordKey } from './board';
import type { AttackResult } from './combat';
import { checkBattleEnd, postBattleLosses, type BattleEndResult, type PostBattleReport } from './battle-end';
import { initiativeOrder } from './initiative';
import {
  cascadePenalties,
  rollRulerFate,
  rulerPresent,
  RULER_AURA_MORALE,
  type RulerFate,
} from './morale';
import { opportunityAttackers, performOpportunityAttack, type OpportunityKind } from './opportunity';
import { availableModes, canFireAt, isSupplyEdge, type RangedMode } from './ranged';
import { DEFAULT_SEED, SeededRng } from './rng';
import { UnitState } from './unit-state';
import type { ScenarioSummary } from '@/api/types';
import type { Axial, Facing, Side } from './types';

/** A resolved opportunity attack, surfaced for the UI to announce (§8). */
export interface OpportunityEvent {
  threatId: string;
  threatName: string;
  moverName: string;
  kind: OpportunityKind;
  physical: number;
  morale: number;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export class BattleStore {
  status: LoadStatus = 'idle';
  error: string | null = null;

  id = '';
  name = '';
  /** The preset battles a viewer can pick between (§ showcase item 25). */
  scenarios: ScenarioSummary[] = [];
  /** The id of the loaded preset, or `null` for the default battle. */
  scenarioId: string | null = null;
  board: Board | null = null;
  units: UnitState[] = [];
  selectedUnitId: string | null = null;
  /** Battle-turn counter (§1); advanced when the initiative order wraps (§6.1). */
  turn = 1;
  /** Unit ids in this turn's initiative order (§6.1); fixed for the turn. */
  turnOrder: string[] = [];
  /** Index into {@link turnOrder} of the unit whose turn it currently is. */
  activeIndex = 0;
  /** The most recent attack, for offering a follow-up Breakthrough (§5.2). */
  lastAttack: { attackerId: string; defenderId: string; physical: number } | null = null;

  /** Seed for the battle's dice (§11.3, §15.3); re-running with it replays every roll. */
  seed = DEFAULT_SEED;
  /** The seeded RNG every in-battle die draws from (§11.3) — recreated from {@link seed} on load. */
  private rng = new SeededRng(DEFAULT_SEED);
  /** Units whose destruction/rout has already cascaded (§11.2), so each loss resolves once. */
  private processedLosses = new Set<string>();
  /** Each side's ruler fate once its unit leaves the field (§11.3); `null` while the ruler stands. */
  rulerFate: Record<Side, RulerFate | null> = { blue: null, red: null };
  /** Opportunity attacks (§8) triggered by the last move — surfaced for the UI, cleared on the next action. */
  lastOpportunityAttacks: OpportunityEvent[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  get blue(): UnitState[] {
    return this.units.filter((unit) => unit.side === 'blue');
  }

  get red(): UnitState[] {
    return this.units.filter((unit) => unit.side === 'red');
  }

  /** Survivors of a side — still on the field (§11.1). */
  survivors(side: Side): UnitState[] {
    return this.units.filter((unit) => unit.side === side && unit.isAlive && !unit.isRouted);
  }

  /** Whether the battle has ended and who won (§11.4) — derived from the live field. */
  get battleEnd(): BattleEndResult {
    return checkBattleEnd(this.units);
  }

  /** Convenience flag: the battle is over (§11.4) — the UI swaps to the result screen. */
  get isBattleOver(): boolean {
    return this.battleEnd.isOver;
  }

  /** The strategic output once the dust settles (§12–§13): per-unit and per-side losses. */
  get postBattleReport(): PostBattleReport {
    return postBattleLosses(this.units, this.battleEnd);
  }

  get selectedUnit(): UnitState | null {
    return this.units.find((unit) => unit.id === this.selectedUnitId) ?? null;
  }

  /** The one-line mechanic pitch for the loaded scenario (showcase item 25). */
  get scenarioMechanic(): string | null {
    return this.scenarios.find((scenario) => scenario.id === this.scenarioId)?.mechanic ?? null;
  }

  /** This turn's initiative order resolved to units, skipping any since removed (§6.1). */
  get orderedUnits(): UnitState[] {
    return this.turnOrder
      .map((id) => this.units.find((unit) => unit.id === id))
      .filter((unit): unit is UnitState => unit !== undefined);
  }

  /** The unit whose turn it currently is — the actor the UI lets you command (§6.2). */
  get activeUnit(): UnitState | null {
    const id = this.turnOrder[this.activeIndex];
    return id ? this.units.find((unit) => unit.id === id) ?? null : null;
  }

  /** The unit occupying a hex, if any (one unit per hex, §2.1). */
  unitAt(coord: Axial): UnitState | undefined {
    const key = coordKey(coord);
    return this.units.find((unit) => coordKey(unit.hex) === key);
  }

  select(id: string | null): void {
    this.selectedUnitId = id;
  }

  private find(id: string): UnitState | undefined {
    return this.units.find((unit) => unit.id === id);
  }

  /** Enemies of `attacker` it could legally attack right now — for the UI to offer (§7.1). */
  targetableEnemies(attacker: UnitState): UnitState[] {
    return targetableEnemies(attacker, this.units);
  }

  /** The front hexes a unit may step into this turn — passable, unoccupied (§7.2). */
  moveTargets(unit: UnitState): Axial[] {
    return this.board ? moveTargets(unit, this.board, this.units) : [];
  }

  /** Resolve a prospective attack **without** mutating — drives the damage preview (item 13). */
  previewAttack(attackerId: string, defenderId: string): AttackResult | null {
    const attacker = this.find(attackerId);
    const defender = this.find(defenderId);
    if (!attacker || !defender) return null;
    return previewAttack(attacker, defender, this.board ?? undefined, this.units);
  }

  /** Apply a basic Attack (§7.1, §9), subtracting both channels and tracking destroy/rout (§11.1). */
  applyAttack(attackerId: string, defenderId: string): AttackResult | null {
    const attacker = this.find(attackerId);
    const defender = this.find(defenderId);
    if (!attacker || !defender) return null;
    const result = performAttack(attacker, defender, this.board ?? undefined, this.units);
    if (result) {
      this.lastAttack = { attackerId, defenderId, physical: result.physical.damage };
      this.reconcileCasualties();
    }
    return result;
  }

  /**
   * The enemy a shock unit may currently push with Breakthrough (§5.2): set only
   * right after a qualifying melee attack while the target is still on the field,
   * adjacent and with a resolvable push plan. Pure — it never mutates. `null`
   * when no breakthrough is on offer.
   */
  get breakthroughTarget(): UnitState | null {
    if (!this.lastAttack || !this.board) return null;
    const attacker = this.find(this.lastAttack.attackerId);
    const defender = this.find(this.lastAttack.defenderId);
    if (!attacker || !defender || !defender.isAlive) return null;
    if (distance(attacker.hex, defender.hex) !== 1) return null;

    const actor = { category: attacker.category, hex: attacker.hex };
    const target = { id: defender.id, hex: defender.hex, facing: defender.facing, attack: defender.enteringAttack };
    if (!canBreakthrough(actor, target, this.lastAttack.physical)) return null;
    return planBreakthrough(actor, target, this.board, this.units) ? defender : null;
  }

  /** Apply the Breakthrough currently on offer (§5.2), then clear the offer. */
  applyBreakthroughNow(): boolean {
    if (!this.lastAttack) return false;
    const ok = this.applyBreakthrough(this.lastAttack.attackerId, this.lastAttack.defenderId, this.lastAttack.physical);
    this.lastAttack = null;
    return ok;
  }

  /** Firing modes a unit can use right now (§5.4) — empty for non-ranged units. */
  rangedModes(unit: UnitState): RangedMode[] {
    return unit.def.abilities.includes('rangedAttack') ? availableModes(unit.def) : [];
  }

  /** Enemies the firer can hit in `mode` right now — for the UI to offer (§5.4). */
  rangedTargets(firer: UnitState, mode: RangedMode): UnitState[] {
    return this.board ? rangedTargets(firer, mode, this.board, this.units, this.turn) : [];
  }

  /** Whether `firer` may hit `defender` in `mode` this turn (§5.4). */
  canFire(firer: UnitState, defenderId: string, mode: RangedMode): boolean {
    const defender = this.find(defenderId);
    return (
      defender !== undefined &&
      this.board !== null &&
      canRangedAttack(firer, defender, mode, this.board, this.units, this.turn)
    );
  }

  /** Resolve a prospective ranged shot **without** mutating — drives the damage preview. */
  previewRangedAttack(firerId: string, defenderId: string, mode: RangedMode): AttackResult | null {
    const firer = this.find(firerId);
    const defender = this.find(defenderId);
    if (!firer || !defender || !this.board) return null;
    if (!canFireAt(firer, defender.hex, mode, this.board, this.units, this.turn)) return null;
    return previewAttack(firer, defender, this.board, this.units);
  }

  /** Fire a ranged shot in `mode` (§5.4, §4.4), spending a shot. Returns the result or `null`. */
  applyRangedAttack(firerId: string, defenderId: string, mode: RangedMode): AttackResult | null {
    const firer = this.find(firerId);
    const defender = this.find(defenderId);
    if (!firer || !defender || !this.board) return null;
    const result = performRangedAttack(firer, defender, mode, this.board, this.units, this.turn);
    if (result) this.reconcileCasualties();
    return result;
  }

  /**
   * Attempt a shock-infantry Breakthrough push after an attack (§5.2), using the
   * physical damage just dealt as the combined-damage threshold input. Returns
   * whether the push happened.
   */
  applyBreakthrough(attackerId: string, defenderId: string, combinedDamage: number): boolean {
    const attacker = this.find(attackerId);
    const defender = this.find(defenderId);
    return (
      attacker !== undefined &&
      defender !== undefined &&
      this.board !== null &&
      performBreakthrough(attacker, defender, combinedDamage, this.board, this.units)
    );
  }

  /** Dismount a cavalry/horse-archer unit into its analogous foot unit (§5.3). */
  dismount(unitId: string): boolean {
    const unit = this.find(unitId);
    return unit !== undefined && unit.dismount();
  }

  /** Re-saddle a dismounted unit's waiting horses (§5.3). */
  mount(unitId: string): boolean {
    const unit = this.find(unitId);
    return unit !== undefined && unit.mount();
  }

  /** Whether `unit` stands on a supply edge where it could refill arrows (§4.4). */
  isAtSupplyEdge(unit: UnitState): boolean {
    return this.board ? isSupplyEdge(unit.hex, this.board) : false;
  }

  /** Refill a spent ranged unit's arrows when it stands on a supply edge (§4.4). */
  resupply(unitId: string): boolean {
    const unit = this.find(unitId);
    if (!unit || !this.board || !unit.def.abilities.includes('rangedAttack')) return false;
    if (!isSupplyEdge(unit.hex, this.board)) return false;
    unit.shotsLeft = RANGED_AMMO;
    return true;
  }

  /**
   * Step a unit one hex into a front hex (§7.2); returns whether it moved. A
   * move that lands the unit in an enemy's attack zone draws **opportunity
   * attacks** (§8), resolved immediately and out of initiative order, after
   * which casualties cascade (§11.2). Recorded in {@link lastOpportunityAttacks}.
   */
  moveUnit(unitId: string, target: Axial): boolean {
    const unit = this.find(unitId);
    if (!unit || !this.board || !performMove(unit, target, this.board, this.units)) return false;
    this.resolveOpportunityAttacks(unit);
    this.reconcileCasualties();
    return true;
  }

  /**
   * Resolve every enemy's opportunity attack on `mover` at its new hex (§8). Each
   * eligible threat strikes once; resolution stops if the mover is destroyed.
   * Replaces {@link lastOpportunityAttacks} with this move's reactions.
   */
  private resolveOpportunityAttacks(mover: UnitState): void {
    this.lastOpportunityAttacks = [];
    if (!this.board) return;

    const offers = opportunityAttackers(mover, mover.hex, this.board, this.units, this.turn);
    for (const { threat } of offers) {
      if (!mover.isAlive) break; // a destroyed mover draws no further reactions (§8)
      const outcome = performOpportunityAttack(threat, mover, this.board, this.units, this.turn);
      if (!outcome) continue;
      this.lastOpportunityAttacks.push({
        threatId: threat.id,
        threatName: threat.name,
        moverName: mover.name,
        kind: outcome.kind,
        physical: outcome.result.physical.damage,
        morale: outcome.result.morale.damage,
      });
    }
  }

  /** Reorient a unit (§7.2; heavy units turn free once per turn); returns whether it turned. */
  turnUnit(unitId: string, facing: Facing): boolean {
    const unit = this.find(unitId);
    return unit !== undefined && performTurn(unit, facing);
  }

  /**
   * Settle the morale fallout of any new casualties (§11.2–11.3). Refreshes each
   * side's ruler aura first — a fallen ruler's lost +10 can itself rout units —
   * then cascades the morale penalty from every unit destroyed or routed since
   * the last pass, looping until the field is stable. Each loss resolves once.
   */
  private reconcileCasualties(): void {
    let changed = true;
    while (changed) {
      changed = false;
      this.refreshAuras();
      for (const unit of this.units) {
        const lost = !unit.isAlive || unit.isRouted;
        if (lost && !this.processedLosses.has(unit.id)) {
          this.processedLosses.add(unit.id);
          this.handleLoss(unit);
          changed = true;
        }
      }
    }
  }

  /**
   * Apply the morale fallout of one unit leaving the field (§11.2–11.3): cascade
   * the morale penalty onto nearby allies (doubled if it carried the ruler), and
   * resolve the ruler's fate — a seeded d3 if destroyed, an automatic escape if
   * it merely routed (§11.3).
   */
  private handleLoss(unit: UnitState): void {
    for (const penalty of cascadePenalties(unit, this.units)) {
      const ally = this.find(penalty.unitId);
      if (ally) ally.morale = Math.max(0, ally.morale - penalty.amount);
    }

    if (unit.isRuler) {
      this.rulerFate[unit.side] = unit.isAlive ? 'fled' : rollRulerFate(this.rng);
    }
  }

  /** Re-apply each side's ruler aura (§11.3): +10 morale to its units while its ruler stands, else 0. */
  private refreshAuras(): void {
    for (const side of ['blue', 'red'] as Side[]) {
      const amount = rulerPresent(side, this.units) ? RULER_AURA_MORALE : 0;
      for (const unit of this.units) {
        if (unit.side === side) unit.setAura(amount);
      }
    }
  }

  /**
   * Drive the active unit through one deterministic auto-action, then hand the
   * turn on (§6) — the engine of end-to-end playback (showcase item 26). The
   * choice is greedy and fully deterministic: no `Math.random`, every tie broken
   * by unit id / coordinate, so a battle replays identically given the same
   * scenario and seed (the only randomness, the ruler-fate d3, draws from the
   * seeded RNG). Returns whether anything still moved — `false` once the battle
   * is over or no unit can act, so a caller's auto-play loop knows to stop.
   */
  autoStep(): boolean {
    if (this.isBattleOver) return false;
    const actor = this.activeUnit;
    if (!actor) return false;

    this.autoAct(actor);
    this.advance();
    return !this.isBattleOver;
  }

  /**
   * Pick and apply one action for `actor`, greedily and deterministically:
   * fire if a ranged shot is on offer (best total damage), else melee the
   * adjacent enemy with the least HP (turning to face it first, then chaining a
   * Breakthrough when offered), else turn toward and step nearer the closest
   * enemy. Returns whether an action was taken.
   */
  private autoAct(actor: UnitState): boolean {
    if (!this.board) return false;

    // 1. Ranged — fire the mode/target pairing with the highest combined damage.
    if (actor.def.abilities.includes('rangedAttack') && !actor.hasAttacked) {
      let best: { mode: RangedMode; targetId: string; score: number } | null = null;
      for (const mode of this.rangedModes(actor)) {
        for (const target of this.rangedTargets(actor, mode)) {
          const preview = this.previewRangedAttack(actor.id, target.id, mode);
          const score = preview ? preview.physical.damage + preview.morale.damage : 0;
          if (!best || score > best.score || (score === best.score && target.id < best.targetId)) {
            best = { mode, targetId: target.id, score };
          }
        }
      }
      if (best) return this.applyRangedAttack(actor.id, best.targetId, best.mode) !== null;
    }

    // 2. Melee — turn to face the weakest adjacent enemy, then strike (and push).
    if (!actor.hasAttacked) {
      const adjacent = this.units
        .filter((u) => u.side !== actor.side && u.isAlive && distance(actor.hex, u.hex) === 1)
        .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
      const target = adjacent[0];
      if (target) {
        if (!isInFront(actor, target.hex)) this.faceToward(actor, target.hex);
        if (this.applyAttack(actor.id, target.id)) {
          if (this.breakthroughTarget) this.applyBreakthroughNow();
          return true;
        }
      }
    }

    // 3. Manoeuvre — close on the nearest enemy: turn to face it, then step in.
    const enemies = this.units.filter((u) => u.side !== actor.side && isActive(u));
    if (enemies.length === 0) return false;
    const nearest = enemies.reduce((closest, u) => {
      const du = distance(actor.hex, u.hex);
      const dc = distance(actor.hex, closest.hex);
      return du < dc || (du === dc && u.id < closest.id) ? u : closest;
    });

    if (!isInFront(actor, nearest.hex)) this.faceToward(actor, nearest.hex);

    const steps = this.moveTargets(actor);
    if (steps.length === 0) return false;
    const step = steps.reduce((best, hex) =>
      distance(hex, nearest.hex) < distance(best, nearest.hex) ||
      (distance(hex, nearest.hex) === distance(best, nearest.hex) && coordKey(hex) < coordKey(best))
        ? hex
        : best,
    );
    // Only step if it actually closes the gap — never wander away.
    if (distance(step, nearest.hex) > distance(actor.hex, nearest.hex)) return false;
    return this.moveUnit(actor.id, step);
  }

  /** Turn `unit` so `target` falls into its front arc, if a turn is available (§7.2). */
  private faceToward(unit: UnitState, target: Axial): void {
    const dir = directionOf(unit.hex, target);
    if (dir >= 0) this.turnUnit(unit.id, (dir % HEX_DIRECTION_COUNT) as Facing);
  }

  /**
   * Hand the turn to the next unit in initiative order (§6.1). Units that have
   * since been destroyed or routed are skipped; when the order is exhausted the
   * battle turn ends and a fresh turn begins. The active unit is auto-selected
   * so its card and action affordances follow the loop.
   */
  advance(): void {
    if (this.isBattleOver) return; // no further turns once a side has lost the field (§11.4)
    this.lastAttack = null; // the breakthrough window closes when the actor's turn ends (§5.2)
    this.lastOpportunityAttacks = []; // and so does the opportunity-attack notice (§8)
    let next = this.activeIndex + 1;
    while (next < this.turnOrder.length) {
      const unit = this.find(this.turnOrder[next]);
      if (unit && isActive(unit)) break;
      next += 1;
    }

    if (next >= this.turnOrder.length) {
      this.beginNextTurn();
      return;
    }

    this.activeIndex = next;
    this.syncSelectionToActive();
  }

  /** Start a fresh battle turn (§6.2): reset per-turn flags, bump the counter, rebuild the order. */
  private beginNextTurn(): void {
    for (const unit of this.units) unit.beginTurn();
    this.turn += 1;
    this.rebuildTurnOrder();
  }

  /** Recompute the initiative order from the current units and reset the pointer (§6.1). */
  private rebuildTurnOrder(): void {
    this.turnOrder = initiativeOrder(this.units).map((unit) => unit.id);
    this.activeIndex = 0;
    this.syncSelectionToActive();
  }

  /** Keep the selection on the active unit as the loop advances. */
  private syncSelectionToActive(): void {
    if (this.activeUnit) this.selectedUnitId = this.activeUnit.id;
  }

  /**
   * Set the battle seed (§11.3, §15.3) and reload so the new value seeds every
   * die from turn 1 — the input behind reproducible playback (showcase item 26).
   * A non-finite value is ignored.
   */
  setSeed(seed: number): Promise<void> {
    if (!Number.isFinite(seed)) return Promise.resolve();
    this.seed = Math.trunc(seed) >>> 0;
    return this.load();
  }

  /** Switch to a preset scenario by id and load it fresh (showcase item 25). */
  selectScenario(scenarioId: string): Promise<void> {
    this.scenarioId = scenarioId;
    return this.load();
  }

  /** Fetch the list of selectable preset scenarios (showcase item 25). */
  async loadScenarios(): Promise<void> {
    try {
      const summaries = await battleApi.listScenarios();
      runInAction(() => {
        this.scenarios = summaries;
        if (this.scenarioId === null) this.scenarioId = summaries[0]?.id ?? null;
      });
    } catch {
      // The scenario picker is optional polish — a failure just leaves it empty.
    }
  }

  /** Load the battle from the API and hydrate the board and units. */
  async load(): Promise<void> {
    this.status = 'loading';
    this.error = null;

    try {
      const dto = await battleApi.loadBattle(this.scenarioId ?? undefined);

      const hexes = dto.hexes.map(
        (hex) =>
          new Hex({
            coord: { q: hex.q, r: hex.r },
            terrain: hex.terrain,
            elevation: hex.elevation,
            state: hex.state ?? null,
          }),
      );

      const units = dto.units.map((unit) => {
        const def = getUnitDef(unit.defId);
        if (!def) {
          throw new Error(`Unknown unit def "${unit.defId}" for unit ${unit.id}`);
        }
        return new UnitState({
          id: unit.id,
          def,
          side: unit.side,
          rank: unit.rank,
          count: unit.count,
          hex: { q: unit.q, r: unit.r },
          facing: unit.facing,
          name: unit.name,
          strengthMod: unit.strengthMod,
          isRuler: unit.isRuler,
          hp: unit.hp,
          morale: unit.morale,
        });
      });

      runInAction(() => {
        this.id = dto.id;
        this.name = dto.name;
        this.board = new Board(hexes);
        this.units = units;
        this.turn = 1;
        this.turnOrder = initiativeOrder(units).map((unit) => unit.id);
        this.activeIndex = 0;
        this.selectedUnitId = this.turnOrder[0] ?? null;
        // Reset the reactive layer (§8, §11.2–11.3) and seed the dice for a replayable battle.
        this.rng = new SeededRng(this.seed);
        this.processedLosses = new Set();
        this.rulerFate = { blue: null, red: null };
        this.lastOpportunityAttacks = [];
        this.refreshAuras(); // present rulers grant their +10 aura from turn 1 (§11.3)
        this.status = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
        this.status = 'error';
      });
    }
  }

  reset(): Promise<void> {
    return this.load();
  }
}
