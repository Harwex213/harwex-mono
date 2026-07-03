/**
 * View layer — the action bar for the selected unit (GDD §7, §5).
 *
 * Surfaces the per-turn actions a unit can take besides clicking the board:
 * **turning** (§7.2), the category specials wired in phase 4 — Dismount/Mount
 * and the cavalry charge run (§5.3), shock **Breakthrough** (§5.2), ranged
 * **firing modes** with their targets and **resupply** (§5.4, §4.4) — and the
 * at-a-glance per-turn state (movement, shots, charge). Move and basic melee
 * Attack are still driven by clicking the highlighted hexes / enemies.
 */

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { BattleStore } from '@/model/battle-store';
import type { UnitState } from '@/model/unit-state';
import { HEX_DIRECTION_COUNT } from '@/model/hex';
import { RANGED_AMMO } from '@/model/catalog';
import type { RangedMode } from '@/model/ranged';
import type { Facing } from '@/model/types';
import styles from './ActionBar.module.css';

interface ActionBarProps {
  unit: UnitState;
  store: BattleStore;
}

export const ActionBar = observer(({ unit, store }: ActionBarProps) => {
  const rotate = (delta: number) => {
    const facing = ((unit.facing + delta + HEX_DIRECTION_COUNT) % HEX_DIRECTION_COUNT) as Facing;
    store.turnUnit(unit.id, facing);
  };

  const canTurn = !unit.hasAttacked && (unit.movementLeft >= 1 || (unit.isHeavy && !unit.freeTurnUsed));

  const modes = store.rangedModes(unit);
  const [mode, setMode] = useState<RangedMode>(modes[0] ?? 'direct');
  const activeMode = modes.includes(mode) ? mode : modes[0];
  const fireTargets = !unit.hasAttacked && activeMode ? store.rangedTargets(unit, activeMode) : [];

  const isRanged = modes.length > 0;
  const breakthroughTarget = store.breakthroughTarget;

  return (
    <section className={styles.bar}>
      <div className={styles.row}>
        <span className={styles.label}>Movement</span>
        <span className={styles.value}>
          {unit.movementLeft} / {unit.def.speed} hex
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Action</span>
        <span className={styles.value}>{unit.hasAttacked ? 'attacked' : unit.hasActed ? 'moved' : 'ready'}</span>
      </div>
      {unit.category === 'cavalry' && unit.chargeHexes > 0 && (
        <div className={styles.row}>
          <span className={styles.label}>Charge run</span>
          <span className={styles.value}>{unit.chargeHexes} hex</span>
        </div>
      )}
      {isRanged && (
        <div className={styles.row}>
          <span className={styles.label}>Shots</span>
          <span className={styles.value}>{unit.shotsLeft}</span>
        </div>
      )}

      <div className={styles.turnControls}>
        <button className={styles.turnButton} onClick={() => rotate(-1)} disabled={!canTurn} title="Turn left">
          ↶ turn
        </button>
        <span className={styles.facing} title="Current facing">
          {unit.isHeavy && !unit.freeTurnUsed ? 'free turn' : ''}
        </span>
        <button className={styles.turnButton} onClick={() => rotate(1)} disabled={!canTurn} title="Turn right">
          turn ↷
        </button>
      </div>

      {(unit.canDismount || unit.canMount || (isRanged && unit.shotsLeft < RANGED_AMMO) || breakthroughTarget) && (
        <div className={styles.abilities}>
          {unit.canDismount && (
            <button className={styles.abilityButton} onClick={() => store.dismount(unit.id)} disabled={unit.movementLeft < 1}>
              Dismount
            </button>
          )}
          {unit.canMount && (
            <button className={styles.abilityButton} onClick={() => store.mount(unit.id)} disabled={unit.movementLeft < 1}>
              Mount
            </button>
          )}
          {isRanged && unit.shotsLeft < RANGED_AMMO && (
            <button
              className={styles.abilityButton}
              onClick={() => store.resupply(unit.id)}
              disabled={!store.isAtSupplyEdge(unit)}
              title="Refill arrows at the supply edge (§4.4)"
            >
              Resupply
            </button>
          )}
          {breakthroughTarget && (
            <button className={styles.abilityButtonAccent} onClick={() => store.applyBreakthroughNow()}>
              Breakthrough → {breakthroughTarget.name}
            </button>
          )}
        </div>
      )}

      {isRanged && !unit.hasAttacked && (
        <div className={styles.ranged}>
          <div className={styles.modeRow}>
            {modes.map((m) => (
              <button
                key={m}
                className={m === activeMode ? styles.modeButtonActive : styles.modeButton}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {fireTargets.length > 0 ? (
            <div className={styles.targetRow}>
              {fireTargets.map((target) => (
                <button
                  key={target.id}
                  className={styles.abilityButton}
                  onClick={() => activeMode && store.applyRangedAttack(unit.id, target.id, activeMode)}
                >
                  🎯 {target.name}
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>No target in {activeMode} range.</p>
          )}
        </div>
      )}

      <p className={styles.hint}>
        Click a dashed hex to move into your front; click a ringed enemy to attack (hover for the damage
        breakdown).
      </p>
    </section>
  );
});
